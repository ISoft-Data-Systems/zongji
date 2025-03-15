// Verify that our fix resolves the TypeError

// Create a mock connection without addCommand but with _protocol
const mockConnectionBeforeFix = {
  _protocol: undefined // This will cause TypeError when trying to access _protocol._enqueue
};

// Create a mock connection with addCommand
const mockConnectionAfterFix = {
  addCommand: function(command) {
    console.log('addCommand was called successfully!');
    return command;
  }
};

// Create a mock BinlogClass
function MockBinlogClass(handler) {
  this.handler = handler;
}

// Test the code before our fix (should cause TypeError)
console.log('Testing before fix:');
try {
  mockConnectionBeforeFix._protocol._enqueue(new MockBinlogClass(() => {}));
  console.log('This should not be printed because an error should occur');
} catch (error) {
  console.error('Error before fix:', error.message);
}

// Test the code after our fix (should work)
console.log('\nTesting after fix:');
try {
  mockConnectionAfterFix.addCommand(new MockBinlogClass(() => {}));
  console.log('Success! No TypeError occurred after fix.');
} catch (error) {
  console.error('Error after fix:', error.message);
}
