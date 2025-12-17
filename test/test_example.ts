import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import mysql from '@vlasky/mysql'
import { createSimpleTestRows, createSimpleTestTable } from './helpers/db.js'
import { createMysqlEventsInstance } from './helpers/mysqlEvents.js'
import { exec } from 'child_process'
import { Logger } from '@isoftdata/aggregator-plugin-logger'

const checkInUrl = 'https://system-status-reporting-server-puq6ph6rnq-uc.a.run.app'

// run node --test dist/tests/binlog.test.js

let mysqlConnection 

const mysqlConfig = {
    host: 'localhost',
    user: 'root',
    password: 'rootpassword',
    database: 'testdb',
    port: 3306,
    authPlugins: {
        caching_sha2_password: () => () => Buffer.from('rootpassword\0')
    }
}
const binlogConfig = {
    user: 'binloguser',
    password: 'binlogpassword',
    database: 'testdb',
    host: 'localhost',
    port: 3306,
    authPlugins: {
        caching_sha2_password: () => () => Buffer.from('binlogpassword\0')
    }
}

// Connect to and setup a mysql db/table/user(s) for testing
before(async () => {
    const logger = new Logger(checkInUrl, 11111, 'binlog')

    // Try running the docker file to create mysql db
    await new Promise((resolve, reject) => {
        exec('docker-compose up -d', (error, stdout, stderr) => {
            if (error) {
                reject(error)
            } else {
                resolve(stdout)
            }
        })
    })
    // Wait for the MySQL container to be ready
    await new Promise(resolve => setTimeout(resolve, 15000)) // Adjust the timeout as needed
    // Create a connection to the MySQL instance
    mysqlConnection = await mysql.createConnection(mysqlConfig)
    //binlogConnection = await mysql.createConnection(binlogConfig)
    await mysqlConnection.query(`CREATE USER '${binlogConfig.user}'@'%' IDENTIFIED WITH caching_sha2_password BY '${binlogConfig.password}'`)
    await mysqlConnection.query(`GRANT REPLICATION SLAVE, REPLICATION CLIENT, SELECT, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, SHOW VIEW ON *.* TO '${binlogConfig.user}'@'%'`)
    await mysqlConnection.query(`FLUSH PRIVILEGES`)
    // Create a test table for data
    await createSimpleTestTable(mysqlConnection)
    // Create a mysql events instance to watch binlog events 
    await createMysqlEventsInstance(binlogConfig, logger)
})

after(async () => {
    // Stop and remove the MySQL container
    // await new Promise((resolve, reject) => {
    //     exec('docker-compose down', (error, stdout, stderr) => {
    //         if (error) {
    //             reject(error)
    //         } else {
    //             resolve(stdout)
    //         }
    //     })
    // })
    // try {
    //     if (mysqlConnection) {
    //         // Close the MySQL connection
    //         await mysqlConnection.end()
    //     }
    // } catch (err) {
    //     console.error('Err during test teardown: ', err)
    //     throw err
    // }
})

describe('Simple Test', () => {
    it('should return true', () => {
        assert.strictEqual(true, true)
    })
})

describe('Authentication Method Test', () => {
    it('should verify users are using caching_sha2_password', async () => {
        try {
            // Query to check the authentication plugin for root user
            const rootResult = await mysqlConnection.query(
                `SELECT user, host, plugin FROM mysql.user WHERE user = 'root' AND host = '%'`
            )
            
            // Query to check the authentication plugin for binlog user
            const binlogResult = await mysqlConnection.query(
                `SELECT user, host, plugin FROM mysql.user WHERE user = '${binlogConfig.user}' AND host = '%'`
            )

            console.log('Root user authentication plugin:', rootResult)
            console.log('Binlog user authentication plugin:', binlogResult)

            // Verify binlog user is using caching_sha2_password
            assert.strictEqual(Array.isArray(binlogResult) && binlogResult.length > 0, true, 'Binlog user should exist')
            assert.strictEqual(binlogResult[0].plugin, 'caching_sha2_password', 'Binlog user should use caching_sha2_password')
            
            console.log('✓ Successfully verified caching_sha2_password authentication for binlog user')
        } catch (err) {
            console.error('Error during authentication verification:', err)
            throw err
        }
    })
})

describe('Binlog Event Test', () => {
    it('should log binlog events', { timeout: 60000 }, async (t) => {
        try {
            // Mock console.log to capture calls
            const logCalls: any[] = []
            const originalLog = console.log
            console.log = t.mock.fn((...args: any[]) => {
                logCalls.push(args)
                originalLog.apply(console, args)
            })

            // Create the test table and insert test data
            await createSimpleTestRows(mysqlConnection)
            // Wait for a short period to ensure binlog events are processed
            await new Promise(resolve => setTimeout(resolve, 5000))

            // Verify that handleEvent logged the expected binlog events
            const expectedLogText = 'Binlog event:'
            // Looks like some args may not be strings (booleans)
            const logMessageFound = logCalls.some(args => String(args[0]).includes(expectedLogText))
            assert.strictEqual(logMessageFound, true)

            // Restore console.log
            console.log = originalLog
        } catch (err) {
            console.error('Error during test:', err)
            throw err
        }
    })
})
