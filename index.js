const mysql = require('mysql')
const util = require('util')
const EventEmitter = require('events').EventEmitter
const initBinlogClass = require('./lib/sequence/binlog')

const ConnectionConfigMap = {
	'Connection': obj => obj.config,
	'Pool': obj => obj.config.connectionConfig,
}

const TableInfoQueryTemplate = `
	SELECT 
  		COLUMN_NAME, COLLATION_NAME, CHARACTER_SET_NAME, 
  		COLUMN_COMMENT, COLUMN_TYPE 
  	FROM 
		information_schema.columns 
	WHERE 
  		table_schema='%s' AND table_name='%s' 
	ORDER BY ORDINAL_POSITION;`

function ZongJi(dsn) {
	EventEmitter.call(this)

	this._options({})
	this._filters({})
	this.ctrlCallbacks = []
	this.tableMap = {}
	this.ready = false
	this.useChecksum = false

	this._establishConnection(dsn)
}

util.inherits(ZongJi, EventEmitter)

// dsn - can be one instance of Connection or Pool / object / url string
ZongJi.prototype._establishConnection = function(dsn) {
	const createConnection = options => {
		let connection = mysql.createConnection(options)
		connection.on('error', this.emit.bind(this, 'error'))
		connection.on('unhandledError', this.emit.bind(this, 'error'))
		// don't need to call connection.connect() here
		// we use implicitly established connection
		// see https://github.com/mysqljs/mysql#establishing-connections
		return connection
	}

	const configFunc = ConnectionConfigMap[dsn.constructor.name]
	let binlogDsn

	if (typeof dsn === 'object' && configFunc) {
		// dsn is a pool or connection object
		let conn = dsn // reuse as ctrlConnection
		this.ctrlConnection = conn
		this.ctrlConnectionOwner = false
		binlogDsn = { ...configFunc(conn) }
	}

	if (!binlogDsn) {
		// assuming that the object passed is the connection settings
		this.ctrlConnectionOwner = true
		this.ctrlConnection = createConnection(dsn)
		binlogDsn = dsn
	}

	this.connection = createConnection(binlogDsn)
}

ZongJi.prototype._isChecksumEnabled = function(next) {
	const SelectChecksumParamSql = 'select @@GLOBAL.binlog_checksum as checksum'
	const SetChecksumSql = 'set @master_binlog_checksum=@@global.binlog_checksum'

	const query = (conn, sql) => {
		return new Promise(
			(resolve, reject) => {
				conn.query(sql, (err, result) => {
					if (err) {
						reject(err)
					} else {
						resolve(result)
					}
				})
			},
		)
	}

	let checksumEnabled = true

	query(this.ctrlConnection, SelectChecksumParamSql)
		.then(rows => {
			if (rows[0].checksum === 'NONE') {
				checksumEnabled = false
			}

			if (checksumEnabled) {
				return query(this.connection, SetChecksumSql)
			}
		})
		.catch(err => {
			if (err.toString().match(/ER_UNKNOWN_SYSTEM_VARIABLE/)) {
				checksumEnabled = false
				// a simple query to open this.connection
				return query(this.connection, 'SELECT 1')
			}
      
			next(err)
		})
		.then(() => {
			next(null, checksumEnabled)
		})
}

ZongJi.prototype._findBinlogEnd = function(next) {
	this.ctrlConnection.query('SHOW BINARY LOGS', (err, rows) => {
		if (err) {
			// Errors should be emitted
			next(err)
		} else {
			next(null, rows.length > 0 ? rows[rows.length - 1] : null)
		}
	})
}

ZongJi.prototype._fetchTableInfo = function(tableMapEvent, next) {
	const sql = util.format(TableInfoQueryTemplate,
		tableMapEvent.schemaName, tableMapEvent.tableName)

	this.ctrlConnection.query(sql, (err, rows) => {
		if (err) {
			// Errors should be emitted
			this.emit('error', err)
			// This is a fatal error, no additional binlog events will be
			// processed since next() will never be called
			return
		}

		if (rows.length === 0) {
			// Let consumer handle error, could be a table that no longer exists or a permissions issue
			this.emit('error', new Error(`No rows returned from getTableInfo query ${tableMapEvent.schemaName}.${tableMapEvent.tableName}`))
			// This is a not necessarily a fatal error so continue
			next()
			// exit?
			return
		}

		this.tableMap[tableMapEvent.tableId] = {
			columnSchemas: rows,
			parentSchema: tableMapEvent.schemaName,
			tableName: tableMapEvent.tableName,
		}

		next()
	})
}

// #_options will reset all the options.
ZongJi.prototype._options = function({
	serverId,
	filename,
	position,
	startAtEnd,
	cacheInterval = 0, // in seconds, determines how often to check if binlog is updated
}) {
	this.options = {
		serverId,
		filename,
		position,
		startAtEnd,
		cacheInterval,
	}
}

// #_filters will reset all the filters.
ZongJi.prototype._filters = function({
	includeEvents,
	excludeEvents,
	includeSchema,
	excludeSchema,
}) {
	this.filters = {
		includeEvents,
		excludeEvents,
		includeSchema,
		excludeSchema,
	}
}

ZongJi.prototype.get = function(name) {
	let result
	if (typeof name === 'string') {
		result = this.options[name]
	} else if (Array.isArray(name)) {
		result = name.reduce(
			(acc, cur) => {
				acc[cur] = this.options[cur]
				return acc
			},
			{},
		)
	}

	return result
}

// @options contains a list options
// - `serverId` unique identifier
// - `filename`, `position` the position of binlog to beigin with
// - `startAtEnd` if true, will update filename / postion automatically
// - `includeEvents`, `excludeEvents`, `includeSchema`, `exludeSchema` filter different binlog events bubbling
// - `cacheInterval` in seconds, determines how often to compare current and most recently seen binlog position, off by default
ZongJi.prototype.start = function(options = {}) {
	this._options(options)
	this._filters(options)
	this._cachedPosition = {}
	this._queriedPosition = {}

	const testChecksum = (resolve, reject) => {
		this._isChecksumEnabled((err, checksumEnabled) => {
			if (err) {
				reject(err)
			} else {
				this.useChecksum = checksumEnabled
				resolve()
			}
		})
	}

	const findBinlogEnd = (resolve, reject) => {
		this._findBinlogEnd((err, result) => {
			if (err) {
				return reject(err)
			}

			if (result) {
				this._options(
					{ ...options, filename: result.Log_name,
						position: result.File_size },
				)
			}

			resolve()
		})
	}
	const updateCurrentBinlogPosition = (resolve, reject) => {
		this._findBinlogEnd((err, result) => {
			if (err) {
				return reject(err)
			}

			if (result) {
				this._queriedPosition =
					{
						filename: result.Log_name,
						position: result.File_size,
					}
			}

			resolve()
		})
	}

	const binlogHandler = (error, event) => {
		if (error) {
			return this.emit('error', error)
		}

		// Do not emit events that are undefined or have been filtered out
		if (event === undefined) {
			return
		}
		if (event._filtered === true) {
			// // Store event position in mem even if filtered out
			this._cachedPosition = {
				position: event.nextPosition,
				filename: this.options.filename,
			}

			return
		}

		switch (event.getTypeName()) {
			case 'TableMap': {
				// TableMap is a special event but we can update cache anyway
				this._cachedPosition = {
					position: event.nextPosition,
					filename: this.options.filename,
				}
				const tableMap = this.tableMap[event.tableId]
				if (!tableMap) {
					this.connection.pause()
					// add options to event, should updated with rotate event so it's always valid
					event.instanceOptions = this.options
					this._fetchTableInfo(event, () => {
						const returnedTableMap = this.tableMap[event.tableId]
						if (!returnedTableMap || !returnedTableMap.columnSchemas) {
							// Skip if no column info is returned
							this.connection.resume()
						} else {
							// merge the column info with metadata
							event.updateColumnInfo()
							this.emit('binlog', event)
							this.connection.resume()
						}
					})
					//return
				}
				break
			}
			case 'Rotate':
				if (this.options.filename !== event.binlogName) {
					this.options.filename = event.binlogName

					// Actual binlog rotate event, change position to nextPosition
					this.options.position = event.nextPosition
					// Update position cache
					// TODO: confirm this
					this._cachedPosition = {
						position: event.position,
						filename: event.binlogName,
					}
				} else {
					// Its an "extra" binlog rotate event, don't change options.position to nextPosition but filename stays the same
					this.options.position = event.position
					// Update position cache again?
					this._cachedPosition = {
						position: event.position,
						filename: event.binlogName,
					}
				}

				break
			default:
				// Store event position in mem
				this._cachedPosition = {
					position: event.nextPosition,
					filename: this.options.filename,
				}
		}
	
		// We don't want nextPosition set here if it's not an actual rotate event
		this.emit('binlog', event)
	}
	let promises = [ new Promise(testChecksum) ]

	if (this.options.startAtEnd) {
		promises.push(new Promise(findBinlogEnd))
	}

	Promise.all(promises)
		.then(() => {
			this.BinlogClass = initBinlogClass(this)
			const currentPosition = this.options.position
			const currentBinlog = this.options.filename
			// update positionCache with current position from options or from findBinlogEnd query
			this._cachedPosition = {
				position: currentPosition,
				filename: currentBinlog,
			}

			this.ready = true
			this.emit('ready')

			this.connection._protocol._enqueue(
				new this.BinlogClass(binlogHandler),
			)
		})
		.catch(err => {
			this.emit('error', err)
		})
	// Check setting before starting timer
	if (this.options.cacheInterval) {
		this.cacheCheckInterval = setInterval(() => {
			const getCurrentPosition = new Promise(updateCurrentBinlogPosition)
			getCurrentPosition.then(() => {
				const positionDifference = this._queriedPosition.position - this._cachedPosition.position
				// Emit warning event if current and cached position are different, let the consumer handle
				if ((positionDifference > 0) || (this._queriedPosition.filename !== this._cachedPosition.filename)) {
					this.emit('warning', { msg: `Current and cached position mismatch: ${positionDifference}`, positionDifference, cachedPosition: this._cachedPosition, queriedPosition: this._queriedPosition })
				}
			}).catch(err => {
				console.error('Zongji cacheCheckInterval Error: ', err)
			})
		}, this.options.cacheInterval)
	}
}

ZongJi.prototype.stop = function() {
	// Stop the timer if exists
	if (this.cacheCheckInterval) {
		clearInterval(this.cacheCheckInterval)
	}
	// Binary log connection does not end with destroy()
	this.connection.destroy()
	this.ctrlConnection.query(
		`KILL ${ this.connection.threadId}`,
		() => {
			if (this.ctrlConnectionOwner) {
				this.ctrlConnection.destroy()
			}
			this.emit('stopped')
		},
	)
}

// It includes every events by default.
ZongJi.prototype._skipEvent = function(name) {
	const includes = this.filters.includeEvents
	const excludes = this.filters.excludeEvents

	let included = (includes === undefined) ||
    (Array.isArray(includes) && (includes.indexOf(name) > -1))
	let excluded = Array.isArray(excludes) && (excludes.indexOf(name) > -1)

	return excluded || !included
}

// It doesn't skip any schema by default.
ZongJi.prototype._skipSchema = function(database, table) {
	const includes = this.filters.includeSchema
	const excludes = this.filters.excludeSchema || {}

	let included = (includes === undefined) ||
    (
    	(database in includes) &&
      (
      	includes[database] === true ||
        (
        	Array.isArray(includes[database]) &&
          includes[database].indexOf(table) > -1
        )
      )
    )
	let excluded = (database in excludes) &&
    (
    	excludes[database] === true ||
      (
      	Array.isArray(excludes[database]) &&
        excludes[database].indexOf(table) > -1
      )
    )

	return excluded || !included
}

module.exports = ZongJi
