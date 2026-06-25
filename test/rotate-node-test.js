const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mysql = require('@vlasky/mysql');
const ZongJi = require('../');
const settings = require('./settings/mysql');

// Use the shared connection settings (port selected per docker-compose service,
// plus secureAuth for the caching_sha2 handshake on MySQL 8.x).
const mysqlConfigWithDb = settings.connection;
const mysqlConfig = { ...settings.connection };
// Don't specify database initially - we'll create it first
delete mysqlConfig.database;

let mysqlConnection;
let zongjiInstance;

// Helper to execute query as promise
function queryPromise(connection, sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// Helper to execute multiple queries
async function executeQueries(connection, queries) {
    const results = [];
    for (const query of queries) {
        const result = await queryPromise(connection, query);
        results.push(result);
    }
    return results;
}

before(async () => {
    console.log('Setting up test database...');
    
    // Create connection
    mysqlConnection = mysql.createConnection(mysqlConfig);
    await new Promise((resolve, reject) => {
        mysqlConnection.connect((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    
    // Reset database
    await executeQueries(mysqlConnection, [
        'DROP DATABASE IF EXISTS zongji_test',
        'CREATE DATABASE zongji_test',
        'USE zongji_test'
    ]);
    
    console.log('Test database ready');
});

after(async () => {
    console.log('Cleaning up...');
    
    if (zongjiInstance) {
        zongjiInstance.stop();
        await new Promise(resolve => {
            zongjiInstance.on('stopped', resolve);
        });
    }
    
    if (mysqlConnection) {
        await new Promise((resolve) => {
            mysqlConnection.end(() => resolve());
        });
    }
    
    console.log('Cleanup complete');
});

describe('Binlog Rotate Event Tests', () => {
    
    it('should handle rotate via FLUSH LOGS without errors', { timeout: 15000 }, async () => {
        const TEST_TABLE = 'rotate_test_1';
        const events = [];
        let rotateEventReceived = false;
        let errorOccurred = false;
        
        // Create table
        await executeQueries(mysqlConnection, [
            `DROP TABLE IF EXISTS ${TEST_TABLE}`,
            `CREATE TABLE ${TEST_TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`
        ]);
        
        // Create ZongJi instance
        zongjiInstance = new ZongJi(mysqlConfigWithDb);
        
        zongjiInstance.on('error', (err) => {
            errorOccurred = true;
            console.error('ZongJi error:', err);
        });
        
        zongjiInstance.on('binlog', (evt) => {
            events.push(evt);
            
            if (evt.getTypeName() === 'Rotate') {
                rotateEventReceived = true;
                console.log('Rotate event received:', evt.binlogName, 'position:', evt.position);
                assert.ok(evt.binlogName, 'Rotate event should have binlogName');
                assert.ok(evt.position !== undefined, 'Rotate event should have position');
            }
        });
        
        // Start ZongJi
        zongjiInstance.start({
            startAtEnd: true,
            serverId: 102,
            includeEvents: ['tablemap', 'writerows', 'rotate']
        });
        
        // Wait for ready
        await new Promise((resolve) => {
            zongjiInstance.on('ready', resolve);
        });
        
        // Perform operations that trigger rotation
        await executeQueries(mysqlConnection, [
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('before rotation')`,
            'FLUSH LOGS',
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('after rotation')`
        ]);
        
        // Wait for events to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify results
        assert.ok(rotateEventReceived, 'Rotate event should have been received');
        assert.strictEqual(errorOccurred, false, 'No errors should occur during rotation');
        
        const writeRowsEvents = events.filter(e => e.getTypeName() === 'WriteRows');
        assert.ok(writeRowsEvents.length >= 2, 'Should receive WriteRows events before and after rotation');
        
        console.log(`✓ Handled rotation via FLUSH LOGS successfully (${events.length} total events)`);
        
        // Stop ZongJi for next test
        zongjiInstance.stop();
        await new Promise(resolve => {
            zongjiInstance.on('stopped', resolve);
        });
    });
    
    it('should handle rotate with small binlog size without errors', { timeout: 20000 }, async () => {
        const TEST_TABLE = 'rotate_test_2';
        const events = [];
        let rotateEventReceived = false;
        let errorOccurred = false;
        
        // Create table
        await executeQueries(mysqlConnection, [
            `DROP TABLE IF EXISTS ${TEST_TABLE}`,
            `CREATE TABLE ${TEST_TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`
        ]);
        
        // Create ZongJi instance
        zongjiInstance = new ZongJi(mysqlConfigWithDb);
        
        zongjiInstance.on('error', (err) => {
            errorOccurred = true;
            console.error('ZongJi error:', err);
        });
        
        zongjiInstance.on('binlog', (evt) => {
            events.push(evt);
            
            if (evt.getTypeName() === 'Rotate') {
                rotateEventReceived = true;
                console.log('Rotate event received via small binlog');
            }
        });
        
        // Start ZongJi
        zongjiInstance.start({
            startAtEnd: true,
            serverId: 103,
            includeEvents: ['tablemap', 'writerows', 'rotate']
        });
        
        // Wait for ready
        await new Promise((resolve) => {
            zongjiInstance.on('ready', resolve);
        });
        
        // Generate data rows
        const dataRows = [];
        for (let i = 0; i < 100; i++) {
            dataRows.push(`('Data row ${i}')`);
        }
        
        // Perform operations with small binlog
        await executeQueries(mysqlConnection, [
            'SET GLOBAL max_binlog_size = 4096',
            `INSERT INTO ${TEST_TABLE} (data) VALUES ${dataRows.join(', ')}`,
            'FLUSH LOGS',
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('After forced rotation')`,
            'SET GLOBAL max_binlog_size = 1073741824'
        ]);
        
        // Wait for events to be processed
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Verify results
        assert.ok(rotateEventReceived, 'Rotate event should have been received');
        assert.strictEqual(errorOccurred, false, 'No errors should occur during rotation');
        assert.ok(events.length > 0, 'Should receive events');
        
        console.log(`✓ Handled rotation with small binlog size (${events.length} total events)`);
        
        // Stop ZongJi for next test
        zongjiInstance.stop();
        await new Promise(resolve => {
            zongjiInstance.on('stopped', resolve);
        });
    });
    
    it('should maintain position tracking across rotation', { timeout: 15000 }, async () => {
        const TEST_TABLE = 'rotate_test_3';
        let firstRotatePosition = null;
        let firstRotateBinlogName = null;
        let errorOccurred = false;
        let positionVerified = false;
        
        // Create table
        await executeQueries(mysqlConnection, [
            `DROP TABLE IF EXISTS ${TEST_TABLE}`,
            `CREATE TABLE ${TEST_TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`
        ]);
        
        // Create ZongJi instance
        zongjiInstance = new ZongJi(mysqlConfigWithDb);
        
        zongjiInstance.on('error', (err) => {
            errorOccurred = true;
            console.error('ZongJi error:', err);
        });
        
        zongjiInstance.on('binlog', (evt) => {
            if (evt.getTypeName() === 'Rotate') {
                if (!firstRotatePosition) {
                    firstRotatePosition = evt.position;
                    firstRotateBinlogName = evt.binlogName;
                    console.log('First rotate position:', firstRotatePosition, 'file:', firstRotateBinlogName);
                    assert.ok(firstRotateBinlogName, 'First rotate should have binlog name');
                    assert.ok(firstRotatePosition !== undefined, 'First rotate should have position');
                }
            }
            
            if (evt.getTypeName() === 'WriteRows' && firstRotatePosition) {
                // Verify we can still get position info after rotation
                const currentFilename = zongjiInstance.get('filename');
                const currentPosition = zongjiInstance.get('position');
                
                assert.ok(currentFilename, 'Filename should be available after rotation');
                assert.ok(currentPosition, 'Position should be available after rotation');
                console.log('After rotation - file:', currentFilename, 'position:', currentPosition);
                positionVerified = true;
            }
        });
        
        // Start ZongJi
        zongjiInstance.start({
            startAtEnd: true,
            serverId: 104,
            includeEvents: ['tablemap', 'writerows', 'rotate']
        });
        
        // Wait for ready
        await new Promise((resolve) => {
            zongjiInstance.on('ready', resolve);
        });
        
        // Trigger rotation and insert data
        await executeQueries(mysqlConnection, [
            'FLUSH LOGS',
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('Test position tracking')`
        ]);
        
        // Wait for events to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify results
        assert.ok(positionVerified, 'Position should have been verified after rotation');
        assert.strictEqual(errorOccurred, false, 'No errors should occur during rotation');
        
        console.log('✓ Position tracking maintained across rotation');
        
        // Stop ZongJi
        zongjiInstance.stop();
        await new Promise(resolve => {
            zongjiInstance.on('stopped', resolve);
        });
    });
});
