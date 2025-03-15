const ZongJi = require('./');

// Mock the mysql2 connection
const mockConnection = {
  addCommand: function(command) {
    console.log('addCommand was called successfully with:', command.constructor.name);
  }
};

// Create a ZongJi instance
const zongji = new ZongJi({});

// Replace the connection with our mock
zongji.connection = mockConnection;

// Set up a mock BinlogClass
zongji.BinlogClass = function(handler) {
  this.handler = handler;
  this.constructor = { name: 'MockBinlogClass' };
};

// Trigger the code that previously caused the error
zongji.ready = true;
zongji.emit = function(event) {
  console.log(`Event emitted: ${event}`);
};

// This would have caused the TypeError before our fix
try {
  zongji.connection.addCommand(new zongji.BinlogClass(() => {}));
  console.log('Success! No TypeError occurred.');
} catch (error) {
  console.error('Error:', error);
}
