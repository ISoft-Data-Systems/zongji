const { it } = require('node:test');
const assert = require('node:assert');
const getEventClass = require('./../lib/code_map').getEventClass;

it('Codemap', () => {
  assert.equal(getEventClass(2).name, 'Query');
  assert.equal(getEventClass(490).name, 'Unknown');
});
