#!/bin/bash
# Bash script to test all MySQL versions with different auth plugins
# Usage: ./test-all-versions.sh

echo "====================================="
echo "Testing ZongJi MySQL Version Compatibility"
echo "====================================="
echo ""

# Test configurations: version:auth_plugin
test_configs=(
    "5.7:native"
    "8.3:native"
    "8.3:sha2"
    "8.4:native"
    "8.4:sha2"
)

declare -A results

for config in "${test_configs[@]}"; do
    IFS=':' read -r version auth <<< "$config"
    
    test_name="MySQL $version with "
    if [ "$auth" = "native" ]; then
        test_name+="mysql_native_password"
    else
        test_name+="caching_sha2_password"
    fi
    
    echo "====================================="
    echo "Testing $test_name"
    echo "====================================="
    
    MYSQL_TEST_VERSION=$version MYSQL_TEST_AUTH_PLUGIN=$auth node --test test/mysql-versions/mysql.version.test.js
    
    exit_code=$?
    results[$config]=$exit_code
    
    if [ $exit_code -eq 0 ]; then
        echo "✓ $test_name : PASSED"
    else
        echo "✗ $test_name : FAILED (exit code: $exit_code)"
    fi
    
    echo ""
done

echo "====================================="
echo "Test Summary"
echo "====================================="

all_passed=true
for config in "${test_configs[@]}"; do
    IFS=':' read -r version auth <<< "$config"
    exit_code=${results[$config]}
    
    test_name="MySQL $version with "
    if [ "$auth" = "native" ]; then
        test_name+="mysql_native_password"
    else
        test_name+="caching_sha2_password"
    fi
    
    if [ $exit_code -eq 0 ]; then
        echo "$test_name : PASSED"
    else
        echo "$test_name : FAILED"
        all_passed=false
    fi
done

echo ""
echo "====================================="
echo "Expected Results:"
echo "====================================="
echo "MySQL 5.7 with mysql_native_password  : SHOULD PASS"
echo "MySQL 8.3 with mysql_native_password  : SHOULD PASS"
echo "MySQL 8.3 with caching_sha2_password  : SHOULD FAIL"
echo "MySQL 8.4 with mysql_native_password  : SHOULD PASS"
echo "MySQL 8.4 with caching_sha2_password  : SHOULD FAIL"
echo ""
echo "This demonstrates that ZongJi (using the 'mysql' package)"
echo "requires mysql_native_password authentication for compatibility."
echo ""

if [ "$all_passed" = true ]; then
    echo "All tests passed!"
    exit 0
else
    echo "Some tests failed - check if failures match expected results above."
    exit 1
fi
