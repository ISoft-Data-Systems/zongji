# Changes Summary for MySQL Version Testing

## Overview
Adapted the `mysql.version.test.js` file from another project to test the zongji library against MySQL versions 5.7, 8.3, and 8.4. The test now uses mocked dependencies and is properly integrated with the zongji library.

## Latest Updates - December 28, 2024

### Authentication Plugin Testing
Enhanced the test suite to demonstrate ZongJi's compatibility with different MySQL authentication plugins:

**New Feature: Configurable Authentication Plugin Testing**
- Added `MYSQL_TEST_AUTH_PLUGIN` environment variable to control which authentication plugin to test
- Options:
  - `native` - Uses `mysql_native_password` (compatible with ZongJi)
  - `sha2` - Uses `caching_sha2_password` (NOT compatible with ZongJi - expected to fail)
- Default behavior: Uses `mysql_native_password` for all versions

**Test Configurations:**
The test suite now runs 5 distinct test scenarios:
1. MySQL 5.7 with `mysql_native_password` - ✅ SHOULD PASS
2. MySQL 8.3 with `mysql_native_password` - ✅ SHOULD PASS  
3. MySQL 8.3 with `caching_sha2_password` - ❌ SHOULD FAIL
4. MySQL 8.4 with `mysql_native_password` - ✅ SHOULD PASS
5. MySQL 8.4 with `caching_sha2_password` - ❌ SHOULD FAIL

**Purpose:**
These tests demonstrate that ZongJi (using the `mysql` package) requires `mysql_native_password` authentication for compatibility. The `mysql` package does not support the newer `caching_sha2_password` authentication that is the default in MySQL 8.0+.

**Updated Scripts:**
- `test-all-versions.sh` - Now tests all 5 configurations and shows expected results
- `test-all-versions.ps1` - PowerShell version with colored output showing expected pass/fail
- Both scripts include a summary explaining the authentication requirement

**Updated Documentation:**
- `README.md` - Added section explaining expected test results and workarounds
- `QUICKSTART.md` - Updated with authentication plugin testing examples
- Added clear documentation on why some tests are expected to fail

### Modified Files
1. **mysql.version.test.js**
   - Added `MYSQL_TEST_AUTH_PLUGIN` environment variable support
   - Authentication plugin selection logic with defaults
   - Test descriptions now include auth plugin name
   - All tests show which authentication method is being tested

2. **test-all-versions.sh**
   - Tests all 5 configurations (5.7 native, 8.3 native, 8.3 sha2, 8.4 native, 8.4 sha2)
   - Shows expected results for each configuration
   - Explains why failures occur

3. **test-all-versions.ps1**
   - Equivalent PowerShell version with colored output
   - Clear visual distinction between expected passes and failures

4. **README.md**
   - Comprehensive table of expected results
   - Explanation of authentication compatibility
   - SQL examples for creating compatible users
   - Server configuration alternatives

5. **QUICKSTART.md**
   - Individual test commands for each configuration
   - Clearly marked which tests are expected to fail
   - Quick reference for running specific scenarios

## Changes Made (Initial Version)

### 1. New Directory Structure
Created `test/mysql-versions/` folder to separate version compatibility tests from the main test suite:

```
test/mysql-versions/
├── README.md                        # Documentation
├── QUICKSTART.md                    # Quick reference guide
├── CHANGES.md                       # This file
├── mysql.version.test.js            # Main test file
├── test-all-versions.ps1            # PowerShell script for Windows
├── test-all-versions.sh             # Bash script for Linux/Mac
└── helpers/
    ├── db.js                        # To be added by user
    ├── mockLogger.js                # Mock logger implementation
    └── zongjiHelper.js              # ZongJi instance helper
```

### 2. Key Modifications to Test File

#### Removed Dependencies
- ❌ `@vlasky/mysql` - Replaced with standard `mysql` library from package.json
- ❌ `@isoftdata/aggregator-plugin-logger` - Replaced with MockLogger

#### Added/Updated Dependencies
- ✅ `mysql` - Standard MySQL library (already in package.json v2.18.1)
- ✅ `MockLogger` - Custom mock logger implementation
- ✅ `createZongJiInstance` - Helper to create and configure ZongJi instances

#### Test Configuration
- Tests can be run for specific MySQL versions using environment variable `MYSQL_TEST_VERSION`
- Tests can specify authentication plugin using `MYSQL_TEST_AUTH_PLUGIN`
- Default version: 5.7
- Supported versions: 5.7, 8.3, 8.4
- Each version uses a unique port:
  - MySQL 5.7: Port 33057
  - MySQL 8.3: Port 33083
  - MySQL 8.4: Port 33084

#### Authentication Handling
- Configurable authentication plugin selection
- Default: `mysql_native_password` for all versions
- Can explicitly test with `caching_sha2_password` to demonstrate incompatibility

### 3. Docker Compose Updates
Updated `docker-compose.yml` to expose ports for each MySQL version:
- Added port mapping `33057:3306` for mysql57
- Added port mapping `33083:3306` for mysql83
- Added port mapping `33084:3306` for mysql84

### 4. Helper Files Created

#### `helpers/mockLogger.js`
- Provides basic logging functionality (info, error, warn, debug)
- Stores logs in memory for verification
- Outputs to console for debugging
- API compatible with @isoftdata/aggregator-plugin-logger

#### `helpers/zongjiHelper.js`
- Creates and configures ZongJi instances
- Sets up event listeners for binlog events
- Handles the ready state promise
- Configures appropriate event filters (tablemap, writerows, updaterows, deleterows)

### 5. Test Coverage

The test suite now includes:

1. **Simple Test** - Basic sanity check
2. **Connection Test** - Verifies MySQL connection
3. **Authentication Method Test** - Confirms correct auth plugin and tests compatibility
4. **Binlog Event Test** - Verifies ZongJi receives and processes INSERT binlog events
5. **ZongJi Integration Test** - Comprehensive test covering INSERT, UPDATE, and DELETE operations

### 6. Scripts for Easy Testing

Created convenience scripts to test all MySQL versions and authentication plugins:

- **test-all-versions.ps1** - PowerShell script for Windows users with colored output
- **test-all-versions.sh** - Bash script for Linux/Mac users

These scripts:
- Run tests against all MySQL versions and authentication plugins
- Track pass/fail status for each configuration
- Show expected results and explain why failures occur
- Provide a comprehensive summary
- Exit with appropriate status code

## Still Needed

The following file needs to be added by the user (as mentioned they will bring it over):
- `helpers/db.js` - Contains `createSimpleTestTable` and `createSimpleTestRows` functions

## Running the Tests

### Single Version with Specific Auth Plugin
```bash
# Windows PowerShell - MySQL 8.3 with native password (compatible)
$env:MYSQL_TEST_VERSION="8.3"; $env:MYSQL_TEST_AUTH_PLUGIN="native"; node --test test/mysql-versions/mysql.version.test.js

# Windows PowerShell - MySQL 8.3 with sha2 password (incompatible - will fail)
$env:MYSQL_TEST_VERSION="8.3"; $env:MYSQL_TEST_AUTH_PLUGIN="sha2"; node --test test/mysql-versions/mysql.version.test.js

# Linux/Mac - MySQL 8.3 with native password
MYSQL_TEST_VERSION=8.3 MYSQL_TEST_AUTH_PLUGIN=native node --test test/mysql-versions/mysql.version.test.js

# Linux/Mac - MySQL 8.3 with sha2 password (will fail)
MYSQL_TEST_VERSION=8.3 MYSQL_TEST_AUTH_PLUGIN=sha2 node --test test/mysql-versions/mysql.version.test.js
```

### All Versions and Authentication Plugins
```bash
# Windows PowerShell
.\test\mysql-versions\test-all-versions.ps1

# Linux/Mac
chmod +x test/mysql-versions/test-all-versions.sh
./test/mysql-versions/test-all-versions.sh
```

## Benefits

1. **Isolation** - Version tests are separate from main test suite
2. **No External Dependencies** - Mocked logger means no need for @isoftdata/aggregator-plugin-logger
3. **Multi-Version Support** - Easy to test against all customer MySQL versions
4. **Authentication Compatibility Testing** - Demonstrates which authentication methods work
5. **Clear Documentation** - README explains setup, running tests, and troubleshooting
6. **Automated Testing** - Scripts make it easy to test all configurations at once
7. **Proper MySQL Library** - Uses the standard `mysql` library that zongji depends on
8. **Educational Value** - Shows customers exactly what configurations are supported

## Key Takeaway

**ZongJi requires `mysql_native_password` authentication when using MySQL 8.0+**

Customers must either:
- Create users with `mysql_native_password` authentication, OR
- Configure MySQL server to use `default_authentication_plugin=mysql_native_password`, OR
- (Future) Migrate to a different MySQL client library that supports modern authentication

## Notes

- Docker containers are NOT automatically stopped after tests (to allow debugging)
- Manual cleanup: `docker-compose down`
- Tests wait 15 seconds for MySQL to be ready (adjustable if needed)
- Each test suite has 30-second timeouts for binlog event processing
- Some test failures are **expected** and demonstrate authentication incompatibility
- The test suite serves as both a validation tool and documentation of requirements
