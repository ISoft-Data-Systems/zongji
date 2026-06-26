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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

before(initDb);

describe('Unit test', () => {
  const zongji = new ZongJi(settings.connection);

  it('Check that exclude overrides include', () => {
    zongji._filters({
      includeEvents: ['tablemap', 'writerows', 'updaterows', 'rotate'],
      excludeEvents: ['rotate'],
      includeSchema: {db1: true, db2: ['one_table'], db3: true},
      excludeSchema: {db3: true}
    });
    assert.ok(!zongji._skipEvent('tablemap'));
    assert.ok(zongji._skipEvent('rotate'));
    assert.ok(!zongji._skipSchema('db1', 'any_table'));
    assert.ok(!zongji._skipSchema('db2', 'one_table'));
    assert.ok(zongji._skipSchema('db2', 'another_table'));
    assert.ok(zongji._skipSchema('db3', 'any_table'));
  });

  it('includeSchema limits to listed tables', () => {
    zongji._filters({
      includeSchema: {db1: ['just_me']}
    });
    assert.ok(!zongji._skipSchema('db1', 'just_me'));
    assert.ok(zongji._skipSchema('db2', 'anything_else'));
    assert.ok(zongji._skipSchema('db1', 'not_me'));
  });

  it('excludeSchema skips listed tables', () => {
    zongji._filters({
      excludeSchema: {db1: ['not_me']}
    });

    assert.ok(!zongji._skipSchema('db1', 'anything_else'));
    assert.ok(!zongji._skipSchema('db2', 'anything_else'));
    assert.ok(zongji._skipSchema('db1', 'not_me'));
  });

  it('excludeEvents skips listed events', () => {
    zongji._filters({
      excludeEvents: ['rotate']
    });
    assert.ok(!zongji._skipEvent('tablemap'));
    assert.ok(zongji._skipEvent('rotate'));
  });

  it('includeEvents limits to listed events', () => {
    zongji._filters({
      includeEvents: ['rotate'],
    });
    assert.ok(zongji._skipEvent('tablemap'));
    assert.ok(!zongji._skipEvent('rotate'));
  });
});

it('Exclude all the schema', { timeout: 15000 }, async () => {
  const zongji = new ZongJi(settings.connection);

  const eventLog = [];
  const errorLog = [];

  zongji.on('binlog', event => eventLog.push(event));
  zongji.on('error', error => errorLog.push(error));

  try {
    await new Promise((resolve, reject) => {
      // Set includeSchema to not include anything, recieve no row events
      // Ensure that filters are applied
      const includeSchema = {};
      zongji.start({
        includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows'],
        includeSchema: includeSchema
      });

      zongji.on('ready', () => {
        const testTable = 'filter_test';
        execute([
          `DROP TABLE IF EXISTS ${testTable}`,
          `CREATE TABLE ${testTable} (col INT UNSIGNED)`,
          `INSERT INTO ${testTable} (col) VALUES (10)`,
          `UPDATE ${testTable} SET col = 15`,
          `DELETE FROM ${testTable}`,
        ]).then(() => {
          // Give 1 second to see if any events are emitted, they should not be!
          setTimeout(() => {
            try {
              assert.equal(eventLog.length, 0);
              assert.equal(errorLog.length, 0);
              resolve();
            } catch (e) {
              reject(e);
            }
          }, 1000);
        }).catch(reject);
      });
    });
  } finally {
    zongji.stop();
  }
});

it('Change filter when ZongJi is running', { timeout: 15000 }, async () => {
  // Set includeSchema to skip table after the tableMap has already been
  // cached once, recieve no row events afterwards
  const testTable = 'after_init_test';
  const includeSchema = {};
  includeSchema[settings.connection.database] = [ testTable ];

  const zongji = new ZongJi(settings.connection);
  const eventLog = [];

  zongji.on('binlog', event => eventLog.push(event));

  try {
    await new Promise((resolve, reject) => {
      zongji.on('error', reject);

      zongji.start({
        includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows'],
        includeSchema: includeSchema
      });

      execute([
        `DROP TABLE IF EXISTS ${testTable}`,
        `CREATE TABLE ${testTable} (col INT UNSIGNED)`,
        `INSERT INTO ${testTable} (col) VALUES (10)`,
      ]).then(() => delay(1000)).then(async () => {
        assert.equal(eventLog.length, 2);

        // update filter: reset for next phase
        eventLog.splice(0, eventLog.length);

        zongji._filters({
          includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows'],
          includeSchema: {},
        });

        await execute([
          `UPDATE ${testTable} SET col = 15`,
          `DELETE FROM ${testTable}`,
        ]);

        await delay(1000);
        assert.equal(eventLog.length, 0);
        resolve();
      }).catch(reject);
    });
  } finally {
    zongji.stop();
  }
});
