const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const ZongJi = require('../');
const settings = require('./settings/mysql');
const testDb = require('./helpers');

const initDb = () => new Promise((resolve, reject) => {
  testDb.init(err => err ? reject(err) : resolve());
});

const execute = queries => new Promise((resolve, reject) => {
  testDb.execute(queries, (err, result) => err ? reject(err) : resolve(result));
});

it('Connect to an invalid host', { timeout: 30000 }, async () => {
  const zongji = new ZongJi({
    host: 'wronghost',
    user: 'wronguser',
    password: 'wrongpass'
  });

  try {
    await new Promise(resolve => {
      zongji.on('error', function(error) {
        assert.ok(['ENOTFOUND', 'ETIMEDOUT'].indexOf(error.code) !== -1);
        resolve();
      });
      zongji.start();
    });
  } finally {
    zongji.stop();
  }
});

before(initDb);

const ACCEPTABLE_ERRORS = [
  'PROTOCOL_CONNECTION_LOST',
  // MySQL 5.1 emits a packet sequence error when the binlog disconnected
  'PROTOCOL_INCORRECT_PACKET_SEQUENCE'
];

it('Disconnect binlog connection', { timeout: 15000 }, async () => {
  const zongji = new ZongJi(settings.connection);

  await new Promise((resolve, reject) => {
    zongji.start({
      includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows'],
      serverId: testDb.serverId(),
    });

    zongji.on('ready', () => {
      let threadId = zongji.connection.threadId;
      assert.ok(!isNaN(threadId));
      execute([`kill ${threadId}`]).catch(reject);
    });

    zongji.on('error', err => {
      if (ACCEPTABLE_ERRORS.indexOf(err.code) > -1) {
        zongji.stop();
        resolve();
      } else {
        reject(err);
      }
    });
  });
});

it('Disconnect control connection', { timeout: 15000 }, async () => {
  const zongji = new ZongJi(settings.connection);

  await new Promise((resolve, reject) => {
    zongji.start({
      includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows'],
      serverId: testDb.serverId(),
    });

    zongji.on('ready', () => {
      let threadId = zongji.ctrlConnection.threadId;
      assert.ok(!isNaN(threadId));
      execute([`kill ${threadId}`]).catch(reject);
    });

    zongji.on('error', err => {
      if (ACCEPTABLE_ERRORS.indexOf(err.code) > -1) {
        zongji.stop();
        resolve();
      } else {
        reject(err);
      }
    });
  });
});

describe('Events come through in sequence', () => {
  const NEW_INST_TIMEOUT = 1000;
  const UPDATE_INTERVAL = 300;
  const UPDATE_COUNT = 5;
  const TEST_TABLE = 'reconnect_at_pos';

  before(async () => {
    await execute([
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (col INT UNSIGNED)`,
      `INSERT INTO ${TEST_TABLE} (col) VALUES (10)`,
    ]);
  });

  it('when reconnect', { timeout: 15000 }, async () => {
    const result = [];
    let first;
    let second;
    let updateInterval;

    function startPeriodicallyWriting() {
      let sequences = Array.from(
        {length: UPDATE_COUNT},
        (_, i) => `INSERT INTO ${TEST_TABLE} (col) VALUES (${i})`
      );

      updateInterval = setInterval(() => {
        execute([sequences.shift()]).catch(() => clearInterval(updateInterval));

        if (sequences.length === 0) {
          clearInterval(updateInterval);
        }
      }, UPDATE_INTERVAL);
    }

    // Stop an instance at most once and wait for its 'stopped' event, which is
    // when ZongJi issues the KILL and closes its sockets. Without waiting, the
    // binlog connection can stay open and keep the test process from exiting.
    const stopInstance = z => new Promise(resolve => {
      if (!z || z._testStopped) {
        return resolve();
      }
      z._testStopped = true;
      z.on('stopped', resolve);
      z.stop();
    });

    try {
      await new Promise((resolve, reject) => {
        function newInstance(options) {
          const zongji = new ZongJi(settings.connection);

          zongji.start({
            ...options,
            // Must include rotate events for filename and position properties
            includeEvents: [
              'rotate', 'tablemap', 'writerows', 'updaterows', 'deleterows'
            ]
          });

          zongji.on('error', reject);

          zongji.on('binlog', function(event) {
            if (event.getTypeName() === 'WriteRows') {
              result.push(event.rows[0].col);
            }

            if (result.length === UPDATE_COUNT) {
              try {
                assert.deepStrictEqual(
                  result,
                  Array.from({length: UPDATE_COUNT}, (_, i) => i)
                );
                resolve();
              } catch (e) {
                reject(e);
              }
            }
          });

          return zongji;
        }

        first = newInstance({
          serverId: testDb.serverId(),
          startAtEnd: true,
        });

        first.on('ready', () => {
          startPeriodicallyWriting();

          first.on('stopped', () => {
            // Start new ZongJi instance where the previous was when stopped
            second = newInstance({
              serverId: testDb.serverId(),
              filename: first.get('filename'),
              position: first.get('position'),
            });
          });
          setTimeout(() => stopInstance(first), NEW_INST_TIMEOUT);
        });
      });
    } finally {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
      await stopInstance(first);
      await stopInstance(second);
    }
  });
});
