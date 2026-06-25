const assert = require('node:assert');

const MAX_WAIT = 3000;

// Check an array of events against an array of expectations
// @param {[object]} events - Array of zongji events
// @param {[object]} expected - Array of expectations
// @param {string} expected.$._type - Special, match binlog event name
// @param {function} expected.$._[custom] - Apply custom tests for this event
//                                          function(assert, event){}
// @param {number} multiplier - Number of times to expect expected events
// @param {function} callback - Called when done. Receives an Error as its
//                              first argument if an assertion failed, so the
//                              caller can reject a Promise (optional).
// @param waitIndex - Do not specify, used internally
function expectEvents(events, expected, multiplier, callback, waitIndex) {
  if (events.length < (expected.length * multiplier) && !(waitIndex > 10)) {
    // Wait for events to appear
    setTimeout(function() {
      expectEvents(events, expected, multiplier, callback, (waitIndex || 0) + 1);
    }, MAX_WAIT / 10);
  } else {
    try {
      assert.strictEqual(events.length, expected.length * multiplier);
      events.forEach(function(event, index) {
        const exp = expected[index % expected.length];
        for (const i in exp) {
          if (Object.prototype.hasOwnProperty.call(exp, i)) {
            if (i === '_type') {
              assert.strictEqual(event.getTypeName(), exp[i]);
            } else if (String(i).substr(0, 1) === '_') {
              exp[i](assert, event);
            } else {
              assert.deepEqual(event[i], exp[i]);
            }
          }
        }
      });
    } catch (err) {
      if (typeof callback === 'function') return callback(err);
      throw err;
    }
    if (typeof callback === 'function') callback();
  }
}

module.exports = expectEvents;
