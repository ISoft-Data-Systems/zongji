# PowerShell script to test all MySQL versions with different auth plugins
# Usage: .\test-all-versions.ps1

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Testing ZongJi MySQL Version Compatibility" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Test configurations: version, auth_plugin
$testConfigs = @(
    @{Version="5.7"; Auth="native"}
    @{Version="8.3"; Auth="native"}
    @{Version="8.3"; Auth="sha2"}
    @{Version="8.4"; Auth="native"}
    @{Version="8.4"; Auth="sha2"}
)

$results = @{}

foreach ($config in $testConfigs) {
    $version = $config.Version
    $auth = $config.Auth
    
    $authName = if ($auth -eq "native") { "mysql_native_password" } else { "caching_sha2_password" }
    $testName = "MySQL $version with $authName"
    
    Write-Host "=====================================" -ForegroundColor Cyan
    Write-Host "Testing $testName" -ForegroundColor Cyan
    Write-Host "=====================================" -ForegroundColor Cyan
    
    $env:MYSQL_TEST_VERSION = $version
    $env:MYSQL_TEST_AUTH_PLUGIN = $auth
    
    node --test test/mysql-versions/mysql.version.test.js
    
    $exitCode = $LASTEXITCODE
    $results["$version-$auth"] = $exitCode
    
    if ($exitCode -eq 0) {
        Write-Host "✓ $testName : PASSED" -ForegroundColor Green
    } else {
        Write-Host "✗ $testName : FAILED (exit code: $exitCode)" -ForegroundColor Red
    }
    
    Write-Host ""
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

$allPassed = $true
foreach ($config in $testConfigs) {
    $version = $config.Version
    $auth = $config.Auth
    $authName = if ($auth -eq "native") { "mysql_native_password" } else { "caching_sha2_password" }
    $testName = "MySQL $version with $authName"
    $exitCode = $results["$version-$auth"]
    
    if ($exitCode -eq 0) {
        Write-Host "$testName : PASSED" -ForegroundColor Green
    } else {
        Write-Host "$testName : FAILED" -ForegroundColor Red
        $allPassed = $false
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Yellow
Write-Host "Expected Results:" -ForegroundColor Yellow
Write-Host "=====================================" -ForegroundColor Yellow
Write-Host "MySQL 5.7 with mysql_native_password  : SHOULD PASS" -ForegroundColor Green
Write-Host "MySQL 8.3 with mysql_native_password  : SHOULD PASS" -ForegroundColor Green
Write-Host "MySQL 8.3 with caching_sha2_password  : SHOULD FAIL" -ForegroundColor Red
Write-Host "MySQL 8.4 with mysql_native_password  : SHOULD PASS" -ForegroundColor Green
Write-Host "MySQL 8.4 with caching_sha2_password  : SHOULD FAIL" -ForegroundColor Red
Write-Host ""
Write-Host "This demonstrates that ZongJi (using the 'mysql' package)" -ForegroundColor Yellow
Write-Host "requires mysql_native_password authentication for compatibility." -ForegroundColor Yellow
Write-Host ""

if ($allPassed) {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some tests failed - check if failures match expected results above." -ForegroundColor Yellow
    exit 1
}
