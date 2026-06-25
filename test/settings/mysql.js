// Replication logs will be cleared!
// Database will be recreated!

// Run the test process in UTC so DATETIME (parsed host-local) and TIMESTAMP
// (stored UTC) round-trips agree regardless of the machine's timezone.
process.env.TZ = 'UTC';

// Each docker-compose MySQL service listens on a fixed port. The
// `npm run test:5.7` / `test:8.3` / `test:8.4` scripts select the target via
// the script name, which npm exposes as npm_lifecycle_event (cross-platform,
// no per-version .env files needed). TEST_MYSQL_PORT still overrides if set.
const VERSION_PORTS = { '5.7': 33057, '8.3': 33083, '8.4': 33084 };
const scriptVersion = (process.env.npm_lifecycle_event || '').split(':')[1];
const port = Number(process.env.TEST_MYSQL_PORT) || VERSION_PORTS[scriptVersion] || VERSION_PORTS['5.7'];

module.exports = {
  connection: {
    host     : process.env.MYSQL_HOST || 'localhost',
    user     : 'root',
    password : 'numtel',
    charset  : 'utf8mb4_unicode_ci',
    port     : port,
    dateStrings : process.env.TEST_DATE_STRINGS === 'true',
    // Required so @vlasky/mysql can complete a caching_sha2_password handshake
    // over the plaintext test connection (MySQL 8.x default auth plugin).
    // Harmless on 5.7 / mysql_native_password.
    secureAuth: true,
    database: 'zongji_test',
    // debug: true
  },
  sessionSqlMode: process.env.TEST_SESSION_SQL_MODE || '',
  // The auth plugin each port's root account uses: 5.7 is mysql_native_password,
  // 8.x defaults to caching_sha2_password (see docker-compose.yml).
  expectedAuthPlugin: port === VERSION_PORTS['5.7'] ? 'mysql_native_password' : 'caching_sha2_password',
};
