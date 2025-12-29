# MySQL Version Compatibility Tests

This directory contains tests to verify that the zongji library works correctly with different MySQL versions that are deployed to customers.

## Tested MySQL Versions

- MySQL 5.7
- MySQL 8.3
- MySQL 8.4

## Prerequisites

- Docker and Docker Compose installed
- Node.js (version 8 or higher)

## Project Structure

```
test/mysql-versions/
├── README.md                    # This file
├── mysql.version.test.js        # Main test file
├── helpers/
│   ├── db.js                    # Database setup helpers (to be added)
│   ├── mockLogger.js            # Mock logger to replace @isoftdata/aggregator-plugin-logger
│   └── zongjiHelper.js          # ZongJi instance creation helper
└── scripts/
    ├── test-all.sh              # Run tests for all MySQL versions (to be added)
    └── test-version.sh          # Run test for a specific version (to be added)
```

## Setup

The test automatically starts the appropriate MySQL Docker container before running. Each MySQL version runs on a different port:

- MySQL 5.7: Port 33057
- MySQL 8.3: Port 33083
- MySQL 8.4: Port 33084

## Running the Tests

### Test a specific MySQL version with authentication plugin

You can run tests for a specific MySQL version and authentication plugin by setting environment variables:

**MySQL 5.7 with mysql_native_password (default):**
```bash
# Bash
node --test test/mysql-versions/mysql.version.test.js

# Or explicitly
MYSQL_TEST_VERSION=5.7 MYSQL_TEST_AUTH_PLUGIN=native node --test test/mysql-versions/mysql.version.test.js
```

**MySQL 8.3 with mysql_native_password:**
```bash
# Bash
MYSQL_TEST_VERSION=8.3 MYSQL_TEST_AUTH_PLUGIN=native node --test test/mysql-versions/mysql.version.test.js

# PowerShell
$env:MYSQL_TEST_VERSION="8.3"; $env:MYSQL_TEST_AUTH_PLUGIN="native"; node --test test/mysql-versions/mysql.version.test.js
```

**MySQL 8.3 with caching_sha2_password (EXPECTED TO FAIL):**
```bash
# Bash
MYSQL_TEST_VERSION=8.3 MYSQL_TEST_AUTH_PLUGIN=sha2 node --test test/mysql-versions/mysql.version.test.js

# PowerShell
$env:MYSQL_TEST_VERSION="8.3"; $env:MYSQL_TEST_AUTH_PLUGIN="sha2"; node --test test/mysql-versions/mysql.version.test.js
```

**MySQL 8.4 with mysql_native_password:**
```bash
# Bash
MYSQL_TEST_VERSION=8.4 MYSQL_TEST_AUTH_PLUGIN=native node --test test/mysql-versions/mysql.version.test.js

# PowerShell
$env:MYSQL_TEST_VERSION="8.4"; $env:MYSQL_TEST_AUTH_PLUGIN="native"; node --test test/mysql-versions/mysql.version.test.js
```

**MySQL 8.4 with caching_sha2_password (EXPECTED TO FAIL):**
```bash
# Bash
MYSQL_TEST_VERSION=8.4 MYSQL_TEST_AUTH_PLUGIN=sha2 node --test test/mysql-versions/mysql.version.test.js

# PowerShell
$env:MYSQL_TEST_VERSION="8.4"; $env:MYSQL_TEST_AUTH_PLUGIN="sha2"; node --test test/mysql-versions/mysql.version.test.js
```

### Test all MySQL versions and authentication plugins

Use the provided scripts to test all combinations:

```bash
# Bash (Linux/Mac)
chmod +x test/mysql-versions/test-all-versions.sh
./test/mysql-versions/test-all-versions.sh

# PowerShell (Windows)
.\test\mysql-versions\test-all-versions.ps1
```

These scripts will run all 5 test configurations and show expected results.

## What the Tests Cover

1. **Connection Test**: Verifies that zongji can establish a connection to the MySQL server
2. **Authentication Test**: Confirms the correct authentication plugin is being used and tests compatibility
3. **Binlog Event Test**: Tests that zongji can receive and process binlog events for INSERT operations
4. **Integration Test**: Comprehensive test covering INSERT, UPDATE, and DELETE operations

## Expected Test Results

The tests demonstrate ZongJi's compatibility requirements with different MySQL authentication plugins:

| MySQL Version | Auth Plugin | Expected Result | Reason |
|--------------|-------------|-----------------|---------|
| 5.7 | mysql_native_password | ✅ PASS | Compatible |
| 8.3 | mysql_native_password | ✅ PASS | Compatible |
| 8.3 | caching_sha2_password | ❌ FAIL | Not supported by `mysql` package |
| 8.4 | mysql_native_password | ✅ PASS | Compatible |
| 8.4 | caching_sha2_password | ❌ FAIL | Not supported by `mysql` package |

### Why Some Tests Fail

ZongJi uses the `mysql` package which **does not natively support `caching_sha2_password` authentication**, which is the default in MySQL 8.0+. 

**To use ZongJi with MySQL 8.x, you MUST create users with `mysql_native_password`:**

```sql
CREATE USER 'binloguser'@'%' IDENTIFIED WITH mysql_native_password BY 'password';
GRANT REPLICATION SLAVE, REPLICATION CLIENT, SELECT ON *.* TO 'binloguser'@'%';
```

**Alternative:** Configure MySQL to use the old authentication plugin by default:
```ini
# In my.cnf
[mysqld]
default_authentication_plugin=mysql_native_password
```

## Test Configuration

The test creates:
- A test database named `testdb`
- A binlog user with appropriate replication privileges
- A test table for performing DML operations

## Environment Variables

- `MYSQL_TEST_VERSION`: Which MySQL version to test (`5.7`, `8.3`, or `8.4`). Default: `5.7`
- `MYSQL_TEST_AUTH_PLUGIN`: Which authentication plugin to use:
  - `native`: Uses `mysql_native_password` (recommended for compatibility)
  - `sha2`: Uses `caching_sha2_password` (expected to fail, demonstrates incompatibility)
  - If not specified, defaults to `mysql_native_password` for all versions

## Notes

- The tests use the standard `mysql` library (version 2.18.1) that is specified in package.json
- The `@isoftdata/aggregator-plugin-logger` dependency is mocked using `mockLogger.js`
- Tests wait 15 seconds for MySQL containers to be ready after starting
- Docker containers are NOT automatically stopped after tests complete (to allow for debugging)
- You can manually stop containers with: `docker-compose stop mysql57 mysql83 mysql84`
- Some test failures are **expected** and demonstrate authentication plugin incompatibility

## Troubleshooting

### Container already exists
If you get an error about the container already existing, you can remove it:
```bash
docker-compose down
```

### Connection timeout
If tests fail due to connection timeout, you may need to increase the wait time in the `before()` hook (currently 15 seconds).

### Port already in use
If ports 33057, 33083, or 33084 are already in use, you'll need to:
1. Stop the conflicting service
2. Or modify the port mappings in `docker-compose.yml` and the test file

## Cleanup

To stop and remove all MySQL containers:
```bash
docker-compose down
```

To also remove the volumes (will delete all data):
```bash
docker-compose down -v
```
