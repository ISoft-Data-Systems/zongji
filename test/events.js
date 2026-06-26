const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const ZongJi = require('../');
const expectEvents = require('./helpers/expectEvents');
const testDb = require('./helpers');
const settings = require('./settings/mysql');

const initDb = () => new Promise((resolve, reject) => {
  testDb.init(err => err ? reject(err) : resolve());
});

const execute = queries => new Promise((resolve, reject) => {
  testDb.execute(queries, (err, result) => err ? reject(err) : resolve(result));
});

const checkTableMatches = function(tableName) {
  return function(assert, event) {
    const tableDetails = event.tableMap[event.tableId];
    assert.strictEqual(tableDetails.parentSchema, testDb.SCHEMA_NAME);
    assert.strictEqual(tableDetails.tableName, tableName);
  };
};

// For use with expectEvents()
const tableMapEvent = function(tableName) {
  return {
    _type: 'TableMap',
    tableName: tableName,
    schemaName: testDb.SCHEMA_NAME,
  };
};

before(initDb);

describe('Binlog option startAtEnd', () => {
  const TEST_TABLE = 'start_at_end_test';

  before(async () => {
    await execute([
      'FLUSH LOGS', // Ensure ZongJi perserveres through a rotation event
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (col INT UNSIGNED)`,
      `INSERT INTO ${TEST_TABLE} (col) VALUES (12)`,
    ]);
  });

  it('start', { timeout: 15000 }, async () => {
    const events = [];

    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);
        zongji.on('binlog', evt => events.push(evt));
        zongji.start({
          startAtEnd: true,
          includeEvents: ['tablemap', 'writerows'],
        });

        zongji.on('ready', () => {
          execute([
            `INSERT INTO ${TEST_TABLE} (col) VALUES (9)`,
          ]).then(() => {
            // Should only have 2 events since ZongJi start
            expectEvents(events,
              [
                { /* do not bother testing anything on first event */ },
                { rows: [ { col: 9 } ] }
              ], 1,
              err => err ? reject(err) : resolve()
            );
          }).catch(reject);
        });
      });
    } finally {
      zongji.stop();
    }
  });
});

describe('Class constructor', () => {
  const TEST_TABLE = 'conn_obj_test';
  const mysql = require('@vlasky/mysql');

  before(async () => {
    await execute([
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (col INT UNSIGNED)`,
      `INSERT INTO ${TEST_TABLE} (col) VALUES (10)`,
    ]);
  });

  function run(zongji) {
    return new Promise((resolve, reject) => {
      const events = [];
      zongji.on('error', reject);
      zongji.on('binlog', evt => events.push(evt));
      zongji.start({
        startAtEnd: true,
        serverId: testDb.serverId(),
        includeEvents: ['tablemap', 'writerows'],
      });
      zongji.on('ready', () => {
        let value = Math.round(Math.random() *  100);
        execute([
          `INSERT INTO ${TEST_TABLE} (col) VALUES (${value})`,
        ]).then(() => {
          // Should only have 2 events since ZongJi start
          expectEvents(events, [
            { /* do not bother testing anything on first event */ },
            { rows: [ { col: value } ] }
          ], 1, err => err ? reject(err) : resolve());
        }).catch(reject);
      });
    });
  }

  it('pass a mysql connection instance', { timeout: 15000 }, async () => {
    const conn = mysql.createConnection(settings.connection);
    const zongji = new ZongJi(conn);
    zongji.on('stopped', () => conn.destroy());
    try {
      await run(zongji);
    } finally {
      zongji.stop();
    }
  });

  it('pass a mysql pool', { timeout: 15000 }, async () => {
    const pool = mysql.createConnection(settings.connection);
    const zongji = new ZongJi(pool);
    zongji.on('stopped', () => pool.end());
    try {
      await run(zongji);
    } finally {
      zongji.stop();
    }
  });
});

describe('Write events', () => {
  const TEST_TABLE = 'write_events_test';

  before(async () => {
    await execute([
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (col INT UNSIGNED)`,
    ]);
  });

  it('write a record', { timeout: 15000 }, async () => {
    const events = [];
    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);
        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'writerows'],
        });

        zongji.on('ready', () => {
          execute([
            `INSERT INTO ${TEST_TABLE} (col) VALUES (14)`,
          ]).catch(reject);
        });

        zongji.on('binlog', evt => {
          events.push(evt);

          if (events.length == 2) {
            expectEvents(events,
              [
                tableMapEvent(TEST_TABLE),
                {
                  _type: 'WriteRows',
                  _checkTableMap: checkTableMatches(TEST_TABLE),
                  rows: [ { col: 14 } ],
                }
              ], 1,
              err => err ? reject(err) : resolve()
            );
          }
        });
      });
    } finally {
      zongji.stop();
    }
  });

  it('update a record', { timeout: 15000 }, async () => {
    const events = [];
    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);
        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'updaterows'],
        });

        zongji.on('ready', () => {
          execute([
            `UPDATE ${TEST_TABLE} SET col=15`,
          ]).catch(reject);
        });

        zongji.on('binlog', evt => {
          events.push(evt);

          if (events.length == 2) {
            expectEvents(events,
              [
                tableMapEvent(TEST_TABLE),
                {
                  _type: 'UpdateRows',
                  _checkTableMap: checkTableMatches(TEST_TABLE),
                  rows: [ { before: { col: 14 }, after: { col: 15 } } ],
                }
              ], 1,
              err => err ? reject(err) : resolve()
            );
          }
        });
      });
    } finally {
      zongji.stop();
    }
  });

  it('delete a record', { timeout: 15000 }, async () => {
    const events = [];
    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);
        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'deleterows'],
        });

        zongji.on('ready', () => {
          execute([
            `DELETE FROM ${TEST_TABLE}`,
          ]).catch(reject);
        });

        zongji.on('binlog', evt => {
          events.push(evt);

          if (events.length == 2) {
            expectEvents(events,
              [
                tableMapEvent(TEST_TABLE),
                {
                  _type: 'DeleteRows',
                  _checkTableMap: checkTableMatches(TEST_TABLE),
                  rows: [ { col: 15 } ],
                }
              ], 1,
              err => err ? reject(err) : resolve()
            );
          }
        });
      });
    } finally {
      zongji.stop();
    }
  });
});

describe('Intvar / Query event', () => {
  const TEST_TABLE = 'intvar_test';

  before(async () => {
    await execute([
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, col INT)`,
    ]);
  });

  it('begin', { timeout: 15000 }, async () => {
    const events = [];
    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);
        zongji.on('binlog', event => {
          if (event.getTypeName() === 'Query' && event.query === 'BEGIN') {
            return;
          }
          events.push(event);

          if (events.length === 6) {
            expectEvents(events, [
                { _type: 'IntVar', type: 2, value: 1 },
                { _type: 'Query' },
                { _type: 'IntVar', type: 2, value: 2 },
                { _type: 'Query' },
                { _type: 'IntVar', type: 1, value: 2 },
                { _type: 'Query' },
              ], 1, err => err ? reject(err) : resolve()
            );
          }
        });

        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['intvar', 'query'],
        });

        zongji.on('ready', () => {
          execute([
            'SET SESSION binlog_format=STATEMENT',
            `INSERT INTO ${TEST_TABLE} (col) VALUES (10)`,
            `INSERT INTO ${TEST_TABLE} (col) VALUES (11)`,
            `INSERT INTO ${TEST_TABLE} (id, col) VALUES (100, LAST_INSERT_ID())`,
            // Other tests expect row-based replication, so reset here
            'SET SESSION binlog_format=ROW',
          ]).catch(reject);
        });
      });
    } finally {
      zongji.stop();
    }
  });
});

it('With many columns', { timeout: 15000 }, async () => {
  const TEST_TABLE = '33_columns';
  const events = [];

  const zongji = new ZongJi(settings.connection);

  try {
    await new Promise((resolve, reject) => {
      zongji.on('error', reject);
      zongji.on('binlog', evt => events.push(evt));
      zongji.start({
        startAtEnd: true,
        serverId: testDb.serverId(),
        includeEvents: ['tablemap', 'writerows'],
      });

      zongji.on('ready', () => {
        execute([
          `DROP TABLE IF EXISTS ${TEST_TABLE}`,
          `CREATE TABLE ${TEST_TABLE} (
            col1 INT SIGNED NULL, col2 BIGINT SIGNED NULL,
            col3 TINYINT SIGNED NULL, col4 SMALLINT SIGNED NULL,
            col5 MEDIUMINT SIGNED NULL, col6 INT SIGNED NULL,
            col7 BIGINT SIGNED NULL, col8 TINYINT SIGNED NULL,
            col9 SMALLINT SIGNED NULL, col10 INT SIGNED NULL,
            col11 BIGINT SIGNED NULL, col12 TINYINT SIGNED NULL,
            col13 SMALLINT SIGNED NULL, col14 INT SIGNED NULL,
            col15 BIGINT SIGNED NULL, col16 TINYINT SIGNED NULL,
            col17 SMALLINT SIGNED NULL, col18 INT SIGNED NULL,
            col19 BIGINT SIGNED NULL, col20 TINYINT SIGNED NULL,
            col21 SMALLINT SIGNED NULL, col22 INT SIGNED NULL,
            col23 BIGINT SIGNED NULL, col24 TINYINT SIGNED NULL,
            col25 SMALLINT SIGNED NULL, col26 INT SIGNED NULL,
            col27 BIGINT SIGNED NULL, col28 TINYINT SIGNED NULL,
            col29 SMALLINT SIGNED NULL, col30 INT SIGNED NULL,
            col31 BIGINT SIGNED NULL, col32 TINYINT SIGNED NULL,
            col33 SMALLINT SIGNED NULL)`,
          `INSERT INTO ${TEST_TABLE} (col1, col2, col3, col4, col5, col33) VALUES
              (null, null, null, null, null, null),
              (-1, -1, -1, -1, -1, -1),
              (2147483647, 9007199254740993, 127, 32767, 8388607, 12),
              (-2147483648, -9007199254740993, -128, -32768, -8388608, 10),
              (-2147483645, -1, -126, -32766, -8388606, 6),
              (-1, 9223372036854775809, -1, -1, null, -6),
              (123456, -9223372036854775809, 96, 300, 1000, null),
              (-123456, 9223372036854775807, -96, -300, -1000, null)`,
          `SELECT * FROM ${TEST_TABLE}`,
        ]).then(result => {
          expectEvents(events, [
            { _type: 'TableMap' },
            { rows: result[result.length - 1], _type: 'WriteRows' }
          ], 1, err => err ? reject(err) : resolve());
        }).catch(reject);
      });
    });
  } finally {
    zongji.stop();
  }
});
