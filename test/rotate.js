const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const ZongJi = require('../');
const settings = require('./settings/mysql');
const testDb = require('./helpers');

// Promisified wrappers around the callback-based test helpers
const initDb = () => new Promise((resolve, reject) => {
  testDb.init(err => err ? reject(err) : resolve());
});

const execute = queries => new Promise((resolve, reject) => {
  testDb.execute(queries, (err, result) => err ? reject(err) : resolve(result));
});

before(initDb);

describe('Binlog rotate event handling', () => {
  const TEST_TABLE = 'rotate_test';

  before(async () => {
    await execute([
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, data VARCHAR(255))`,
    ]);
  });

  it('handle rotate via FLUSH LOGS', { timeout: 15000 }, async () => {
    const events = [];
    let rotateEventReceived = false;

    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', err => reject(new Error(`Error occurred: ${err.message}`)));

        zongji.on('binlog', evt => {
          events.push(evt);

          if (evt.getTypeName() === 'Rotate') {
            rotateEventReceived = true;
            assert.ok(evt.binlogName, 'Rotate event should have binlogName');
            assert.ok(evt.position !== undefined, 'Rotate event should have position');
          }

          // Wait for some events after rotation to ensure stability
          if (rotateEventReceived && events.filter(e => e.getTypeName() === 'WriteRows').length >= 2) {
            assert.ok(rotateEventReceived, 'Rotate event was received');
            resolve();
          }
        });

        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'writerows', 'rotate'],
        });

        zongji.on('ready', () => {
          execute([
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('before rotation')`,
            'FLUSH LOGS', // Force a binlog rotation
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('after rotation')`,
          ]).catch(reject);
        });
      });
    } finally {
      zongji.stop();
    }
  });

  it('handle rotate with small binlog size', { timeout: 20000 }, async () => {
    const events = [];
    let rotateEventReceived = false;
    let writeRowsCount = 0;

    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', err => reject(new Error(`Error occurred during binlog rotation: ${err.message}`)));

        zongji.on('binlog', evt => {
          events.push(evt);

          if (evt.getTypeName() === 'Rotate') {
            rotateEventReceived = true;
          }

          if (evt.getTypeName() === 'WriteRows') {
            writeRowsCount++;
          }

          // The workload produces two WriteRows events: the batched 100-row
          // INSERT (one event) before FLUSH LOGS, then the single INSERT after
          // the rotation. Receiving the second one means we kept streaming
          // writes across the rotation.
          if (writeRowsCount >= 2) {
            assert.ok(rotateEventReceived, 'Rotate event should have been received');
            assert.ok(events.length > 0, 'Events should be received');
            resolve();
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
          execute([
            'SET GLOBAL max_binlog_size = 4096', // Very small binlog (4KB)
            `INSERT INTO ${TEST_TABLE} (data) VALUES ${Array.from({ length: 100 }, (_, i) => `('Data row ${i}')`).join(', ')}`,
            'FLUSH LOGS', // Ensure rotation happens
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('After forced rotation')`,
            'SET GLOBAL max_binlog_size = 1073741824', // Reset to default (1GB)
          ]).catch(reject);
        });
      });
    } finally {
      zongji.stop();
    }
  });

  it('position tracking across rotation', { timeout: 15000 }, async () => {
    let firstRotatePosition = null;
    let firstRotateBinlogName = null;

    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', err => reject(new Error(`Error occurred: ${err.message}`)));

        zongji.on('binlog', evt => {
          if (evt.getTypeName() === 'Rotate') {
            if (!firstRotatePosition) {
              firstRotatePosition = evt.position;
              firstRotateBinlogName = evt.binlogName;
              assert.ok(firstRotateBinlogName, 'First rotate has binlog name');
              assert.ok(firstRotatePosition !== undefined, 'First rotate has position');
            }
          }

          if (evt.getTypeName() === 'WriteRows' && firstRotatePosition) {
            // Verify we can still get position info after rotation
            const currentFilename = zongji.get('filename');
            const currentPosition = zongji.get('position');

            assert.ok(currentFilename, 'Filename should be available after rotation');
            assert.ok(currentPosition, 'Position should be available after rotation');
            resolve();
          }
        });

        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'writerows', 'rotate'],
        });

        zongji.on('ready', () => {
          execute([
            'FLUSH LOGS',
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('Test position tracking')`,
          ]).catch(reject);
        });
      });
    } finally {
      zongji.stop();
    }
  });

  it('resume from get() after a rotation skips no events and duplicates none', { timeout: 30000 }, async () => {
    // Phase 1: stream across a binlog rotation, then capture the live
    // coordinates the documented stop/resume pattern relies on. The saved
    // position is the cache's nextPosition of the post-rotation insert, i.e.
    // the offset of the *next* unread event in the new binlog file.
    let saved = null;

    const firstPass = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        let sawRotate = false;
        firstPass.on('error', err => reject(new Error(`first pass: ${err.message}`)));

        firstPass.on('binlog', evt => {
          const type = evt.getTypeName();
          if (type === 'Rotate') {
            sawRotate = true;
          }
          if (sawRotate && type === 'WriteRows' && evt.rows.some(r => r.data === 'after')) {
            saved = firstPass.get(['filename', 'position']);
            resolve();
          }
        });

        firstPass.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'writerows', 'rotate'],
        });

        firstPass.on('ready', () => {
          execute([
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('before')`,
            'FLUSH LOGS', // force a binlog rotation between the two inserts
            `INSERT INTO ${TEST_TABLE} (data) VALUES ('after')`,
          ]).catch(reject);
        });
      });
    } finally {
      firstPass.stop();
    }

    assert.ok(saved && saved.filename && saved.position,
      'should have captured filename/position after the rotation');

    // Phase 2: write more rows while no reader is attached.
    await execute([
      `INSERT INTO ${TEST_TABLE} (data) VALUES ('resumed-1')`,
      `INSERT INTO ${TEST_TABLE} (data) VALUES ('resumed-2')`,
    ]);

    // Phase 3: resume from the saved coordinates and collect WriteRows data.
    const seen = [];

    const secondPass = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        secondPass.on('error', err => reject(new Error(`second pass: ${err.message}`)));

        secondPass.on('binlog', evt => {
          if (evt.getTypeName() === 'WriteRows') {
            for (const row of evt.rows) {
              seen.push(row.data);
            }
            if (seen.includes('resumed-2')) {
              resolve();
            }
          }
        });

        secondPass.start({
          filename: saved.filename,
          position: saved.position,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'writerows', 'rotate'],
        });
      });
    } finally {
      secondPass.stop();
    }

    // No skip: every row written after the saved position must arrive, in order.
    assert.deepStrictEqual(
      seen.filter(d => d === 'resumed-1' || d === 'resumed-2'),
      ['resumed-1', 'resumed-2'],
      'resume should deliver every event written after the saved position'
    );
    // No duplication: rows consumed before the stop must not be replayed.
    assert.ok(!seen.includes('before'), 'resume must not replay pre-rotation events');
    assert.ok(!seen.includes('after'), 'resume must not replay the event at the saved position');
  });
});
