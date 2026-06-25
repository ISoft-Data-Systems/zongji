const { it, before } = require('node:test');
const assert = require('node:assert');
const testDb = require('./helpers');
const settings = require('./settings/mysql');

const initDb = () => new Promise((resolve, reject) => {
  testDb.init(err => err ? reject(err) : resolve());
});

const execute = queries => new Promise((resolve, reject) => {
  testDb.execute(queries, (err, result) => err ? reject(err) : resolve(result));
});

// The plugin the target server's root account uses, derived from the selected
// port (5.7 = mysql_native_password, 8.x = caching_sha2_password).
const expectedPlugin = settings.expectedAuthPlugin;

before(initDb);

it('connecting account uses the expected authentication plugin', async () => {
  // A successful connection already proves @vlasky/mysql completed the
  // handshake for whatever plugin this account uses; assert it is the one we
  // intend to exercise (caching_sha2_password on MySQL 8.x).
  const results = await execute([
    "SELECT plugin FROM mysql.user " +
    "WHERE user = SUBSTRING_INDEX(CURRENT_USER(), '@', 1) " +
    "AND host = SUBSTRING_INDEX(CURRENT_USER(), '@', -1)"
  ]);
  const rows = results[results.length - 1];

  assert.ok(rows.length > 0, 'current account should be present in mysql.user');
  assert.strictEqual(
    rows[0].plugin,
    expectedPlugin,
    `expected to authenticate with ${expectedPlugin} but the account uses ${rows[0].plugin}`
  );
});
