# Quick Start Guide

## What You Need to Add

Before running the tests, you need to add the `helpers/db.js` file with these functions:

```javascript
// test/mysql-versions/helpers/db.js

async function createSimpleTestTable(connection) {
    // Create your test table structure
}

async function createSimpleTestRows(connection) {
    // Insert test data
}

module.exports = {
    createSimpleTestTable,
    createSimpleTestRows
};
```

## Quick Test Commands

### Test MySQL 5.7 (default - mysql_native_password)
```bash
node --test test/mysql-versions/mysql.version.test.js
```

### Test MySQL 8.3 with mysql_native_password
```powershell
# PowerShell
$env:MYSQL_TEST_VERSION="8.3"; $env:MYSQL_TEST_AUTH_PLUGIN="native"; node --test test/mysql-versions/mysql.version.test.js

# Bash
MYSQL_TEST_VERSION=8.3 MYSQL_TEST_AUTH_PLUGIN=native node --test test/mysql-versions/mysql.version.test.js
```

### Test MySQL 8.3 with caching_sha2_password (EXPECTED TO FAIL)
```powershell
# PowerShell
$env:MYSQL_TEST_VERSION="8.3"; $env:MYSQL_TEST_AUTH_PLUGIN="sha2"; node --test test/mysql-versions/mysql.version.test.js

# Bash
MYSQL_TEST_VERSION=8.3 MYSQL_TEST_AUTH_PLUGIN=sha2 node --test test/mysql-versions/mysql.version.test.js
```

### Test MySQL 8.4 with mysql_native_password
```powershell
# PowerShell
$env:MYSQL_TEST_VERSION="8.4"; $env:MYSQL_TEST_AUTH_PLUGIN="native"; node --test test/mysql-versions/mysql.version.test.js

# Bash
MYSQL_TEST_VERSION=8.4 MYSQL_TEST_AUTH_PLUGIN=native node --test test/mysql-versions/mysql.version.test.js
```

### Test MySQL 8.4 with caching_sha2_password (EXPECTED TO FAIL)
```powershell
# PowerShell
$env:MYSQL_TEST_VERSION="8.4"; $env:MYSQL_TEST_AUTH_PLUGIN="sha2"; node --test test/mysql-versions/mysql.version.test.js

# Bash
MYSQL_TEST_VERSION=8.4 MYSQL_TEST_AUTH_PLUGIN=sha2 node --test test/mysql-versions/mysql.version.test.js
```

### Test All Versions and Auth Plugins
```powershell
# PowerShell (Windows)
.\test\mysql-versions\test-all-versions.ps1

# Bash (Linux/Mac)
chmod +x test/mysql-versions/test-all-versions.sh
./test/mysql-versions/test-all-versions.sh
```

## Cleanup
```bash
docker-compose down
```

## What Gets Tested

✅ Connection to each MySQL version  
✅ Correct authentication method (mysql_native_password or caching_sha2_password)  
✅ ZongJi compatibility with different auth plugins  
✅ ZongJi can read binlog events  
✅ INSERT operations  
✅ UPDATE operations  
✅ DELETE operations

## Expected Test Results

The tests are designed to demonstrate ZongJi's compatibility with different MySQL authentication plugins:

| MySQL Version | Auth Plugin | Expected Result |
|--------------|-------------|-----------------|
| 5.7 | mysql_native_password | ✅ PASS |
| 8.3 | mysql_native_password | ✅ PASS |
| 8.3 | caching_sha2_password | ❌ FAIL |
| 8.4 | mysql_native_password | ✅ PASS |
| 8.4 | caching_sha2_password | ❌ FAIL |

**Why?** ZongJi uses the `mysql` package which does not natively support `caching_sha2_password` authentication (the default in MySQL 8.0+). To use ZongJi with MySQL 8.x, you must create users with `mysql_native_password`:

```sql
CREATE USER 'binloguser'@'%' IDENTIFIED WITH mysql_native_password BY 'password';
```

## Ports Used

- MySQL 5.7: `localhost:33057`
- MySQL 8.3: `localhost:33083`
- MySQL 8.4: `localhost:33084`

## Key Features

- **Mocked Logger**: No need for `@isoftdata/aggregator-plugin-logger`
- **Standard MySQL Library**: Uses `mysql` from package.json
- **Isolated Tests**: Separate from main test suite
- **Multi-Version**: Test all customer MySQL versions easily
- **Auth Plugin Testing**: Demonstrates compatibility requirements for different authentication methods
- **Clear Expected Results**: Shows which configurations work and which don't
