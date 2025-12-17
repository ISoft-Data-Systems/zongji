import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import mysql from '@vlasky/mysql'
import { exec } from 'child_process'
import { promisify } from 'util'

const execPromise = promisify(exec)

let mysqlConnection

// Helper function to promisify query
function query(connection, sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (err, results) => {
            if (err) return reject(err)
            resolve(results)
        })
    })
}

const mysqlConfig = {
    host: 'localhost',
    user: 'root',
    password: 'testpassword',
    database: 'testdb',
    port: 3308, // Using different port to avoid conflicts with other MySQL instances
    authPlugins: {
        caching_sha2_password: () => () => Buffer.from('testpassword\0')
    }
}

const testUserConfig = {
    host: 'localhost',
    user: 'testuser',
    password: 'testuserpass',
    database: 'testdb',
    port: 3308,
    authPlugins: {
        caching_sha2_password: () => () => Buffer.from('testuserpass\0')
    }
}

// Connect to and setup a mysql 8.3 instance for testing
before(async () => {
    console.log('Starting MySQL 8.3 container...')
    
    // Start the MySQL 8.3 container
    try {
        await execPromise('docker-compose up -d mysql83')
    } catch (error) {
        console.error('Error starting docker container:', error)
        throw error
    }
    
    // Wait for the MySQL container to be ready
    console.log('Waiting for MySQL to be ready...')
    await new Promise(resolve => setTimeout(resolve, 20000))
    
    // Create a connection to the MySQL instance
    mysqlConnection = await mysql.createConnection(mysqlConfig)
    console.log('Connected to MySQL 8.3')
    
    // Create test database
    await query(mysqlConnection, 'CREATE DATABASE IF NOT EXISTS testdb')
    await query(mysqlConnection, 'USE testdb')
    
    // Create a test user with caching_sha2_password
    await query(mysqlConnection, `DROP USER IF EXISTS '${testUserConfig.user}'@'%'`)
    await query(mysqlConnection,
        `CREATE USER '${testUserConfig.user}'@'%' IDENTIFIED WITH caching_sha2_password BY '${testUserConfig.password}'`
    )
    await query(mysqlConnection, `GRANT ALL PRIVILEGES ON ${testUserConfig.database}.* TO '${testUserConfig.user}'@'%'`)
    await query(mysqlConnection, 'FLUSH PRIVILEGES')
    
    console.log('Test user created with caching_sha2_password')
})

after(async () => {
    console.log('Cleaning up...')
    
    try {
        if (mysqlConnection) {
            await mysqlConnection.end()
        }
    } catch (err) {
        console.error('Error closing connection:', err)
    }
    
    // Stop and remove the MySQL container
    try {
        await execPromise('docker-compose down mysql83')
        console.log('MySQL 8.3 container stopped')
    } catch (error) {
        console.error('Error stopping docker container:', error)
    }
})

describe('MySQL 8.3 caching_sha2_password Authentication Tests', () => {
    it('should verify MySQL version is 8.3.x', async () => {
        const result = await query(mysqlConnection, 'SELECT VERSION() as version')
        console.log('MySQL version:', result[0].version)
        
        assert.ok(result[0].version.startsWith('8.3'), 'MySQL version should be 8.3.x')
    })

    it('should verify root user is using caching_sha2_password', async () => {
        const result = await query(mysqlConnection,
            `SELECT user, host, plugin FROM mysql.user WHERE user = 'root' LIMIT 1`
        )
        
        console.log('Root user authentication plugin:', result)
        
        assert.ok(Array.isArray(result) && result.length > 0, 'Root user should exist')
        assert.strictEqual(result[0].plugin, 'caching_sha2_password', 
            'Root user should use caching_sha2_password')
    })

    it('should verify test user is using caching_sha2_password', async () => {
        const result = await query(mysqlConnection,
            `SELECT user, host, plugin FROM mysql.user WHERE user = '${testUserConfig.user}' AND host = '%'`
        )
        
        console.log('Test user authentication plugin:', result)
        
        assert.ok(Array.isArray(result) && result.length > 0, 'Test user should exist')
        assert.strictEqual(result[0].plugin, 'caching_sha2_password', 
            'Test user should use caching_sha2_password')
    })

    it('should successfully authenticate as test user with caching_sha2_password', async () => {
        let testConnection
        
        try {
            // Attempt to connect as the test user
            testConnection = await mysql.createConnection(testUserConfig)
            
            // Verify connection by running a simple query
            const result = await query(testConnection, 'SELECT 1 as value')
            
            assert.strictEqual(result[0].value, 1, 'Query should return expected value')
            
            console.log('✓ Successfully authenticated with caching_sha2_password')
        } finally {
            if (testConnection) {
                await testConnection.end()
            }
        }
    })

    it('should successfully perform database operations after authentication', async () => {
        let testConnection
        
        try {
            testConnection = await mysql.createConnection(testUserConfig)
            
            // Create a test table
            await query(testConnection, `
                CREATE TABLE IF NOT EXISTS test_auth_table (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    value VARCHAR(255)
                )
            `)
            
            // Insert data
            await query(testConnection,
                `INSERT INTO test_auth_table (value) VALUES ('test_value')`
            )
            
            // Query data
            const result = await query(testConnection,
                `SELECT value FROM test_auth_table WHERE value = 'test_value'`
            )
            
            assert.ok(Array.isArray(result) && result.length > 0, 'Should retrieve inserted row')
            assert.strictEqual(result[0].value, 'test_value', 'Should have correct value')
            
            // Clean up
            await query(testConnection, 'DROP TABLE test_auth_table')
            
            console.log('✓ Successfully performed database operations with caching_sha2_password authentication')
        } finally {
            if (testConnection) {
                await testConnection.end()
            }
        }
    })
})
