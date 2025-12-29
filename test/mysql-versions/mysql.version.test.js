const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mysql = require('@vlasky/mysql');
const { createSimpleTestRows, createSimpleTestTable } = require('./helpers/db.js');
const { createZongJiInstance } = require('./helpers/zongjiHelper.js');
const { MockLogger } = require('./helpers/mockLogger.js');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// MySQL version configurations for testing
// Test against 5.7, 8.3, and 8.4
const MYSQL_VERSIONS = {
    '5.7': { port: 33057, service: 'mysql57' },
    '8.3': { port: 33083, service: 'mysql83' },
    '8.4': { port: 33084, service: 'mysql84' }
};

// Select which version to test
const TEST_VERSION = process.env.MYSQL_TEST_VERSION || '5.7';
const TEST_AUTH_PLUGIN = process.env.MYSQL_TEST_AUTH_PLUGIN; // Optional: 'native' or 'sha2'
const versionConfig = MYSQL_VERSIONS[TEST_VERSION];

if (!versionConfig) {
    console.error(`Invalid MySQL version: ${TEST_VERSION}`);
    console.error(`Available versions: ${Object.keys(MYSQL_VERSIONS).join(', ')}`);
    process.exit(1);
}

// Determine auth plugin based on version and explicit setting
let authPlugin;
let authPluginName;
if (TEST_AUTH_PLUGIN === 'sha2') {
    authPlugin = 'caching_sha2_password';
    authPluginName = 'caching_sha2_password';
} else if (TEST_AUTH_PLUGIN === 'native') {
    authPlugin = 'mysql_native_password';
    authPluginName = 'mysql_native_password';
} else {
    // Default to mysql_native_password for all versions (compatible with ZongJi)
    authPlugin = TEST_VERSION === '5.7' ? 'mysql_native_password' : 'mysql_native_password';
    authPluginName = authPlugin;
}

console.log(`Testing MySQL version ${TEST_VERSION} on port ${versionConfig.port} with ${authPluginName}`);

let mysqlConnection;
let zongjiInstance;
let binlogEvents = [];

const mysqlConfig = {
    host: 'localhost',
    user: 'root',
    password: 'numtel',
    port: versionConfig.port
    // Don't specify database initially - we'll create it first
};

const binlogConfig = {
    user: 'binloguser',
    password: 'binlogpassword',
    database: 'testdb',
    host: 'localhost',
    port: versionConfig.port
};

// Helper to create async connection
function createConnection(config) {
    return new Promise((resolve, reject) => {
        const conn = mysql.createConnection(config);
        conn.connect((err) => {
            if (err) {
                reject(err);
            } else {
                resolve(conn);
            }
        });
    });
}

// Helper to execute query as promise
function queryPromise(connection, sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (err, results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
}

// Connect to and setup a mysql db/table/user(s) for testing
before(async () => {
    console.log(`Starting docker container for MySQL ${TEST_VERSION}...`);
    
    // Start the specific MySQL container
    try {
        await execPromise(`docker-compose up -d ${versionConfig.service}`);
        console.log(`Docker container ${versionConfig.service} started`);
    } catch (error) {
        console.error('Error starting docker container:', error);
        throw error;
    }
    
    // Wait for the MySQL container to be ready
    console.log('Waiting for MySQL to be ready...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Create a connection to the MySQL instance
    console.log('Creating MySQL connection...');
    mysqlConnection = await createConnection(mysqlConfig);
    
    // Create the test database
    await queryPromise(mysqlConnection, 'CREATE DATABASE IF NOT EXISTS testdb');
    await queryPromise(mysqlConnection, 'USE testdb');
    
    // Create binlog user with appropriate privileges
    console.log('Setting up binlog user...');
    try {
        await queryPromise(mysqlConnection, `DROP USER IF EXISTS '${binlogConfig.user}'@'%'`);
    } catch (err) {
        // Ignore if user doesn't exist
    }
    
    // Use the determined auth plugin
    console.log(`Creating user with ${authPluginName} authentication...`);
    await queryPromise(mysqlConnection, 
        `CREATE USER '${binlogConfig.user}'@'%' IDENTIFIED WITH ${authPlugin} BY '${binlogConfig.password}'`
    );
    
    await queryPromise(mysqlConnection, 
        `GRANT REPLICATION SLAVE, REPLICATION CLIENT, SELECT ON *.* TO '${binlogConfig.user}'@'%'`
    );
    await queryPromise(mysqlConnection, 'FLUSH PRIVILEGES');
    
    // Create a test table for data
    console.log('Creating test table...');
    await createSimpleTestTable(mysqlConnection);
    
    // Create a mock logger instance
    const mockLogger = new MockLogger('http://localhost', 12345, `mysql-${TEST_VERSION}-test`);
    
    // Create a ZongJi instance to watch binlog events
    console.log('Creating ZongJi instance...');
    zongjiInstance = await createZongJiInstance(binlogConfig, mockLogger);
    
    // Listen for binlog events
    zongjiInstance.on('binlog', (evt) => {
        console.log('Binlog event:', evt.getTypeName());
        binlogEvents.push(evt);
    });
    
    console.log('Setup complete, ready for tests');
});

after(async () => {
    console.log('Cleaning up...');
    
    // Stop ZongJi
    if (zongjiInstance) {
        zongjiInstance.stop();
        await new Promise(resolve => {
            zongjiInstance.on('stopped', resolve);
        });
    }
    
    // Close MySQL connection
    if (mysqlConnection) {
        await new Promise((resolve) => {
            mysqlConnection.end(() => resolve());
        });
    }
    
    // Optionally stop the docker container
    // Uncomment if you want to stop containers after tests
    // await execPromise(`docker-compose stop ${versionConfig.service}`);
    
    console.log('Cleanup complete');
});

describe(`MySQL ${TEST_VERSION} Version Tests`, () => {
    it('should return true', () => {
        assert.strictEqual(true, true);
    });
});

describe(`MySQL ${TEST_VERSION} Connection Test`, () => {
    it('should connect to MySQL successfully', () => {
        assert.ok(mysqlConnection, 'MySQL connection should exist');
    });
});

describe(`MySQL ${TEST_VERSION} Authentication Method Test (${authPluginName})`, () => {
    it('should verify binlog user exists and has correct authentication', async () => {
        try {
            // Query to check the authentication plugin for binlog user
            const binlogResult = await queryPromise(mysqlConnection,
                `SELECT user, host, plugin FROM mysql.user WHERE user = '${binlogConfig.user}' AND host = '%'`
            );

            console.log('Binlog user authentication plugin:', binlogResult);

            // Verify binlog user exists
            assert.strictEqual(Array.isArray(binlogResult) && binlogResult.length > 0, true, 
                'Binlog user should exist');
            
            // Check authentication method matches what we configured
            assert.strictEqual(binlogResult[0].plugin, authPluginName, 
                `Binlog user should use ${authPluginName} for MySQL ${TEST_VERSION}`);
            
            console.log(`✓ Successfully verified ${authPluginName} authentication for binlog user`);
        } catch (err) {
            console.error('Error during authentication verification:', err);
            throw err;
        }
    });
});

describe(`MySQL ${TEST_VERSION} Binlog Event Test (${authPluginName})`, () => {
    it('should receive and log binlog events', { timeout: 30000 }, async () => {
        try {
            // Clear any existing events
            binlogEvents = [];
            
            // Insert test data
            console.log('Inserting test data...');
            await createSimpleTestRows(mysqlConnection);
            
            // Wait for binlog events to be processed
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Verify that we received binlog events
            console.log(`Received ${binlogEvents.length} binlog events`);
            assert.ok(binlogEvents.length > 0, 'Should have received binlog events');
            
            // Check for specific event types
            const eventTypes = binlogEvents.map(evt => evt.getTypeName());
            console.log('Event types received:', eventTypes);
            
            // Should have at least TableMap and WriteRows events
            assert.ok(eventTypes.includes('TableMap'), 'Should have TableMap event');
            assert.ok(eventTypes.includes('WriteRows'), 'Should have WriteRows event');
            
            console.log('✓ Successfully received and processed binlog events');
        } catch (err) {
            console.error('Error during binlog event test:', err);
            throw err;
        }
    });
});

describe(`MySQL ${TEST_VERSION} ZongJi Integration Test (${authPluginName})`, () => {
    it('should handle insert, update, and delete operations', { timeout: 30000 }, async () => {
        try {
            binlogEvents = [];
            
            // Perform various operations
            console.log('Testing INSERT...');
            await queryPromise(mysqlConnection, 
                "INSERT INTO test_table (name) VALUES ('update_test')"
            );
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('Testing UPDATE...');
            await queryPromise(mysqlConnection, 
                "UPDATE test_table SET name = 'updated_test' WHERE name = 'update_test'"
            );
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('Testing DELETE...');
            await queryPromise(mysqlConnection, 
                "DELETE FROM test_table WHERE name = 'updated_test'"
            );
            
            // Wait for all events to be processed
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Verify we got the expected events
            const eventTypes = binlogEvents.map(evt => evt.getTypeName());
            console.log('Event types received:', eventTypes);
            
            assert.ok(eventTypes.includes('WriteRows'), 'Should have WriteRows event for INSERT');
            assert.ok(eventTypes.includes('UpdateRows'), 'Should have UpdateRows event for UPDATE');
            assert.ok(eventTypes.includes('DeleteRows'), 'Should have DeleteRows event for DELETE');
            
            console.log(`✓ Successfully handled all DML operations on MySQL ${TEST_VERSION}`);
        } catch (err) {
            console.error('Error during integration test:', err);
            throw err;
        }
    });
});
