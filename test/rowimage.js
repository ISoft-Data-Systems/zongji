const { describe, it, before } = require('node:test');

const ZongJi = require('../');
const testDb = require('./helpers');
const expectEvents = require('./helpers/expectEvents');
const settings = require('./settings/mysql');

const initDb = () => new Promise((resolve, reject) => {
  testDb.init(err => err ? reject(err) : resolve());
});

const execute = queries => new Promise((resolve, reject) => {
  testDb.execute(queries, (err, result) => err ? reject(err) : resolve(result));
});

// Determine the running MySQL version so we can skip tests that require a
// newer server (the tap version used helpers.requireVersion to gate these).
let mysqlVersion = [0, 0, 0];

function versionAtLeast(expected) {
  const parts = expected.split('.').map(part => parseInt(part, 10));
  for (let i = 0; i < parts.length; i++) {
    if (mysqlVersion[i] == parts[i]) {
      continue;
    }
    return mysqlVersion[i] > parts[i];
  }
  return true;
}

before(async () => {
  await initDb();
  const results = await execute(['SELECT VERSION() AS version']);
  mysqlVersion = results[results.length - 1][0]
    .version.split('-')[0]
    .split('.')
    .map(part => parseInt(part, 10));
});

describe('binlog_row_image', () => {
  it('Update with binlog_row_image=minimal', { timeout: 15000 }, async (t) => {
    if (!versionAtLeast('5.6.2')) {
      t.skip('requires MySQL >= 5.6.2');
      return;
    }

    const TEST_TABLE = 'row_image_minimal_test';

    await execute([
      'SET GLOBAL binlog_row_image=minimal',
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (
        id int primary key auto_increment,
        name varchar(20),
        age tinyint,
        height mediumint
      )`,
      `INSERT INTO ${TEST_TABLE} (name, age) VALUES ('Tom', 2)`,
    ]);

    const events = [];
    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);

        zongji.on('ready', () => {
          execute([
            `UPDATE ${TEST_TABLE} SET age=age+1 WHERE id=1`,
          ]).catch(reject);
        });

        zongji.on('binlog', evt => {
          events.push(evt);

          if (events.length == 2) {
            expectEvents(events,
              [
                {
                  _type: 'TableMap',
                  tableName: TEST_TABLE,
                  schemaName: testDb.SCHEMA_NAME,
                },
                {
                  _type: 'UpdateRows',
                  rows: [
                    {
                      before: { id: 1, age: null, name: null, height: null },
                      after: { id: null, age: 3, name: null, height: null },
                    },
                  ],
                }
              ], 1, err => err ? reject(err) : resolve()
            );
          }
        });

        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'updaterows'],
        });
      });
    } finally {
      zongji.stop();
    }
  });

  it('Update with binlog_row_image=noblob', { timeout: 15000 }, async (t) => {
    if (!versionAtLeast('5.6.2')) {
      t.skip('requires MySQL >= 5.6.2');
      return;
    }

    const TEST_TABLE = 'row_image_noblob_test';

    await execute([
      'SET GLOBAL binlog_row_image=noblob',
      `DROP TABLE IF EXISTS ${TEST_TABLE}`,
      `CREATE TABLE ${TEST_TABLE} (
        id int primary key auto_increment,
        summary text
      )`,
      `INSERT INTO ${TEST_TABLE} (summary) VALUES ('Hello world')`,
    ]);

    const events = [];
    const zongji = new ZongJi(settings.connection);
    try {
      await new Promise((resolve, reject) => {
        zongji.on('error', reject);

        zongji.on('ready', () => {
          execute([
            `UPDATE ${TEST_TABLE} SET summary='hello again' WHERE id=1`,
          ]).catch(reject);
        });

        zongji.on('binlog', evt => {
          events.push(evt);

          if (events.length == 2) {
            expectEvents(events,
              [
                {
                  _type: 'TableMap',
                  tableName: TEST_TABLE,
                  schemaName: testDb.SCHEMA_NAME,
                },
                {
                  _type: 'UpdateRows',
                  rows: [
                    {
                      before: { id: 1, summary: null },
                      after: { id: 1, summary: 'hello again' },
                    },
                  ],
                }
              ], 1, err => err ? reject(err) : resolve()
            );
          }
        });

        zongji.start({
          startAtEnd: true,
          serverId: testDb.serverId(),
          includeEvents: ['tablemap', 'updaterows'],
        });
      });
    } finally {
      zongji.stop();
    }
  });
});
