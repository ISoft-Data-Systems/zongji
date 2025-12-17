# Zongji Test Suite

## caching_sha2_password Test

The `caching_sha2_password.test.js` file tests MySQL 8.3 authentication using the `caching_sha2_password` plugin.

### What it tests

1. **MySQL Version Verification** - Confirms the container is running MySQL 8.3.x
2. **Root User Authentication** - Verifies the root user is using caching_sha2_password
3. **Test User Authentication** - Verifies a created test user is using caching_sha2_password
4. **User Authentication** - Confirms the library can successfully authenticate with caching_sha2_password
5. **Database Operations** - Performs actual database operations (CREATE TABLE, INSERT, SELECT, DROP) to ensure the authentication works for real-world scenarios

### Prerequisites

- Docker and Docker Compose installed
- Node.js 22+ (as specified in package.json)

### Running the test

```bash
node --test test/caching_sha2_password.test.js
```

The test will:
1. Spin up a MySQL 8.3 container on port 3308 (to avoid conflicts)
2. Wait 20 seconds for MySQL to be ready
3. Connect as root and create a test user with caching_sha2_password
4. Run all authentication and database operation tests
5. Clean up and stop the container

### Docker Configuration

The test uses the `mysql83` service defined in `docker-compose.yml`:

```yaml
mysql83:
  image: mysql:8.3
  command: [ "--server-id=1", "--log-bin=/var/lib/mysql/mysql-bin.log", "--binlog-format=row", "--default-authentication-plugin=caching_sha2_password" ]
  ports:
    - "3308:3306"
  environment:
    MYSQL_ROOT_PASSWORD: testpassword
    MYSQL_DATABASE: testdb
```

### Test Results

When all tests pass, you should see output like:

```
✔ should verify MySQL version is 8.3.x
✔ should verify root user is using caching_sha2_password
✔ should verify test user is using caching_sha2_password
✔ should successfully authenticate as test user with caching_sha2_password
✔ should successfully perform database operations after authentication
```

This confirms that the zongji library (via @vlasky/mysql) properly supports the caching_sha2_password authentication method introduced in MySQL 8.0 and used by default in MySQL 8.3.
