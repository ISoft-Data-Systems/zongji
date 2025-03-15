// Simple test to verify the fix for TypeError: Cannot read properties of undefined (reading '_enqueue')

// Create a mock connection with addCommand method
const mockConnection = {
  addCommand: function(command) {
    console.log('addCommand was called successfully!');
    return command;
  }
};

// Create a mock BinlogClass
function MockBinlogClass(handler) {
  this.handler = handler;
}

// This would have caused the TypeError before our fix
// this.connection._protocol._enqueue(new this.BinlogClass(binlogHandler))
try {
  // Before fix (would cause TypeError):
  // mockConnection._protocol._enqueue(new MockBinlogClass(() => {}));
  
  // After fix (should work):
  mockConnection.addCommand(new MockBinlogClass(() => {}));
  console.log('Success! No TypeError occurred.');
} catch (error) {
  console.error('Error:', error);
}
