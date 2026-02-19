const tap = require('tap');

const ZongJi = require('../');
const settings = require('./settings/mysql');
const testDb = require('./helpers');

tap.test('Initialise testing db', test => {
  testDb.init(err => {
    if (err) {
      return test.threw(err);
    }
    test.end();
  });
});

tap.test('Binlog rotate event handling', test => {
  const TEST_TABLE = 'rotate_test';

  test.test(`prepare table ${TEST_TABLE}`, test => {
    testDb.execute([
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    ], err => {
      if (err) {
        return test.fail(err);
      }
      test.end();
    });
  });

  test.test('handle rotate via FLUSH LOGS', test => {
    const events = [];
    let rotateEventReceived = false;
    let errorOccurred = false;

    const zongji = new ZongJi(settings.connection);
    test.tearDown(() => zongji.stop());

    zongji.on('error', err => {
      errorOccurred = true;
      test.fail(`Error occurred: ${err.message}`);
    });

    zongji.on('binlog', evt => {
      events.push(evt);

      if (evt.getTypeName() === 'Rotate') {
        rotateEventReceived = true;
        test.ok(evt.binlogName, 'Rotate event should have binlogName');
        test.ok(evt.position !== undefined, 'Rotate event should have position');
      }

      // Wait for some events after rotation to ensure stability
      if (rotateEventReceived && events.filter(e => e.getTypeName() === 'WriteRows').length >= 2) {
        test.ok(rotateEventReceived, 'Rotate event was received');
        test.notOk(errorOccurred, 'No errors should occur during rotation');
        test.end();
      }
    });

    zongji.start({
      startAtEnd: true,
      serverId: testDb.serverId(),
      includeEvents: ['tablemap', 'writerows', 'rotate'],
    });

    zongji.on('ready', () => {
      testDb.execute([
        `INSERT INTO ${TEST_TABLE} (data) VALUES ('before rotation')`,
        'FLUSH LOGS', // Force a binlog rotation
        `INSERT INTO ${TEST_TABLE} (data) VALUES ('after rotation')`,
      ], err => {
        if (err) {
          return test.fail(err);
        }
      });
    });
  });

  test.test('handle rotate with small binlog size', test => {
    const events = [];
    let rotateEventReceived = false;
    let errorOccurred = false;
    let writeRowsCount = 0;

    const zongji = new ZongJi(settings.connection);
    test.tearDown(() => zongji.stop());

    zongji.on('error', err => {
      errorOccurred = true;
      test.fail(`Error occurred during binlog rotation: ${err.message}`);
    });

    zongji.on('binlog', evt => {
      events.push(evt);

      if (evt.getTypeName() === 'Rotate') {
        rotateEventReceived = true;
        test.pass('Rotate event received');
      }

      if (evt.getTypeName() === 'WriteRows') {
        writeRowsCount++;
      }

      // Wait for enough writes to ensure we've passed rotation successfully
      if (writeRowsCount >= 3) {
        test.ok(rotateEventReceived, 'Rotate event should have been received');
        test.notOk(errorOccurred, 'No errors should occur during rotation');
        test.ok(events.length > 0, 'Events should be received');
        test.end();
      }
    });

    zongji.start({
      startAtEnd: true,
      serverId: testDb.serverId(),
      includeEvents: ['tablemap', 'writerows', 'rotate'],
    });

    zongji.on('ready', () => {
      // First, set a very small max_binlog_size to force rotation
      // Then insert enough data to trigger rotation
      testDb.execute([
        'SET GLOBAL max_binlog_size = 4096', // Very small binlog (4KB)
        `INSERT INTO ${TEST_TABLE} (data) VALUES ${testDb.strRepeat("('Data row ##')", 100)}`,
        'FLUSH LOGS', // Ensure rotation happens
        `INSERT INTO ${TEST_TABLE} (data) VALUES ('After forced rotation')`,
        'SET GLOBAL max_binlog_size = 1073741824', // Reset to default (1GB)
      ], err => {
        if (err) {
          return test.fail(err);
        }
      });
    });
  });

  test.test('position tracking across rotation', test => {
    let firstRotatePosition = null;
    let firstRotateBinlogName = null;
    let errorOccurred = false;

    const zongji = new ZongJi(settings.connection);
    test.tearDown(() => zongji.stop());

    zongji.on('error', err => {
      errorOccurred = true;
      test.fail(`Error occurred: ${err.message}`);
    });

    zongji.on('binlog', evt => {
      if (evt.getTypeName() === 'Rotate') {
        if (!firstRotatePosition) {
          firstRotatePosition = evt.position;
          firstRotateBinlogName = evt.binlogName;
          test.ok(firstRotateBinlogName, 'First rotate has binlog name');
          test.ok(firstRotatePosition !== undefined, 'First rotate has position');
        }
      }

      if (evt.getTypeName() === 'WriteRows' && firstRotatePosition) {
        // Verify we can still get position info after rotation
        const currentFilename = zongji.get('filename');
        const currentPosition = zongji.get('position');
        
        test.ok(currentFilename, 'Filename should be available after rotation');
        test.ok(currentPosition, 'Position should be available after rotation');
        test.notOk(errorOccurred, 'No errors should occur during rotation');
        test.end();
      }
    });

    zongji.start({
      startAtEnd: true,
      serverId: testDb.serverId(),
      includeEvents: ['tablemap', 'writerows', 'rotate'],
    });

    zongji.on('ready', () => {
      testDb.execute([
        'FLUSH LOGS',
        `INSERT INTO ${TEST_TABLE} (data) VALUES ('Test position tracking')`,
      ], err => {
        if (err) {
          return test.fail(err);
        }
      });
    });
  });

  test.end();
});
