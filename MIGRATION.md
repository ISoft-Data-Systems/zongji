# Migration: tap → node:test

**Goal:** Remove the `tap@14.10.7` dev dependency (critical vulnerabilities) and replace it with
Node.js's built-in `node:test` runner.

**Reference implementation:** [test/rotate-node-test.js](test/rotate-node-test.js) — already uses
`node:test` and is the established pattern for this repo. Use it as the template for all
migrations.

---

## Prerequisites / One-time setup

- [ ] Update `engines.node` in `package.json` from `>= 8.0` to `>= 18.0`
      (`node:test` is stable from Node 18; the `--test-bail` CLI flag requires Node 20+)
- [ ] After all files are migrated, update the `test` script in `package.json`:
      ```
      "test": "node --test --test-bail test/*.js"
      ```
      Note: `--test-bail` is the equivalent of tap's `--bail` and requires Node 20+.
      If targeting Node 18, omit `--test-bail`.
- [ ] Remove `tap` from `devDependencies` and run `npm install`

---

## File checklist

| File | Complexity | Status |
|---|---|---|
| [test/codemap.js](test/codemap.js) | Low | [ ] |
| [test/errors.js](test/errors.js) | Medium | [ ] |
| [test/filtering.js](test/filtering.js) | Medium | [ ] |
| [test/rowimage.js](test/rowimage.js) | Medium | [ ] |
| [test/rotate.js](test/rotate.js) | Medium | [ ] |
| [test/types.js](test/types.js) | High | [ ] |
| [test/events.js](test/events.js) | High | [ ] |

`test/rotate-node-test.js` — already migrated (the reference implementation).  
`test/mysql.version.test.js` — references packages not in this repo (`@isoftdata/aggregator-plugin-logger`); likely dead/copied from another project. Exclude from `test/*.js` glob or delete it.

---

## API mapping

| tap | node:test / node:assert |
|---|---|
| `const tap = require('tap')` | `const { describe, it, before, after } = require('node:test')` |
| `tap.test(name, fn)` | `it(name, fn)` or `describe` + `it` |
| `test.test(name, fn)` (subtest) | nested `it(name, fn)` inside a `describe` |
| `test.end()` | removed — async tests end when the returned Promise resolves |
| `test.plan(n)` | removed — delete the call (used once in filtering.js) |
| `test.tearDown(fn)` | `try/finally` block inside the `it`, or `after(fn)` in a wrapping `describe` |
| `test.ok(val, msg)` | `assert.ok(val, msg)` |
| `test.equal(a, b, msg)` | `assert.equal(a, b, msg)` |
| `test.strictEqual(a, b, msg)` | `assert.strictEqual(a, b, msg)` |
| `test.deepEqual(a, b, msg)` | `assert.deepEqual(a, b, msg)` |
| `test.same(a, b, msg)` | `assert.deepStrictEqual(a, b, msg)` |
| `test.strictSame(a, b, msg)` | `assert.deepStrictEqual(a, b, msg)` |
| `test.notOk(val, msg)` | `assert.ok(!val, msg)` |
| `test.pass(msg)` | remove, or replace with a `console.log` if the message is useful |
| `test.fail(msg)` | `assert.fail(msg)` |
| `test.threw(err)` | `assert.ok(err instanceof Error)` or just `if (err) throw err` |

---

## Key pattern translations

### 1. Async event-driven test with tearDown

Most tests in this repo start a ZongJi instance, wait for binlog events via an event emitter, then
call `test.end()` from within the event handler. The equivalent in `node:test` is to wrap the
event-driven logic in a `Promise` and `await` it.

**Before (tap):**
```js
tap.test('description', test => {
    const zongji = new ZongJi(config);
    zongji.on('binlog', evt => {
        test.ok(evt.something);
        test.end();
    });
    zongji.start({ startAtEnd: true, serverId: 99 });
    test.tearDown(() => zongji.stop());
});
```

**After (node:test):**
```js
it('description', { timeout: 10000 }, async () => {
    const zongji = new ZongJi(config);
    try {
        await new Promise((resolve, reject) => {
            zongji.on('error', reject);
            zongji.on('binlog', evt => {
                try {
                    assert.ok(evt.something);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
            zongji.start({ startAtEnd: true, serverId: 99 });
        });
    } finally {
        zongji.stop();
    }
});
```

### 2. Nested subtests

`test.test()` maps to a nested `it()` call. Since `node:test`'s nested tests require an enclosing
`describe` to group them, wrap the outer `tap.test` block in a `describe` and convert each
`test.test` to an `it`.

**Before (tap):**
```js
tap.test('outer', test => {
    test.test('inner A', t => { t.ok(true); t.end(); });
    test.test('inner B', t => { t.ok(true); t.end(); });
    test.end();
});
```

**After (node:test):**
```js
describe('outer', () => {
    it('inner A', () => { assert.ok(true); });
    it('inner B', () => { assert.ok(true); });
});
```

### 3. Per-test teardown with shared state

When multiple `it` blocks inside a `describe` need individual cleanup (e.g., stopping a ZongJi
instance after each test), use `after` scoped to an inner `describe`, or use `try/finally`.

**Pattern using try/finally (preferred for self-contained tests):**
```js
it('test name', { timeout: 15000 }, async () => {
    const zongji = new ZongJi(config);
    try {
        // ... test body
    } finally {
        zongji.stop();
    }
});
```

### 4. Multiple events before test ends

Some tests (e.g., types.js) collect N events and only assert after all have been received. The
pattern is to use a counter inside the Promise:

```js
await new Promise((resolve, reject) => {
    let received = 0;
    zongji.on('binlog', evt => {
        try {
            // assert on evt
            if (++received === EXPECTED_COUNT) resolve();
        } catch (e) {
            reject(e);
        }
    });
    zongji.start({ ... });
});
```

---

## Notes per file

### codemap.js
Synchronous tests only. Trivial migration — swap `tap.test` → `it`, remove `test.end()`.

### errors.js
Uses `test.threw(err)` — replace with `assert.ok(err instanceof Error)` or just re-throw.
Has 3 `tearDown` calls — use `try/finally` in each `it`.

### filtering.js
Has one `test.plan(2)` call — just delete it.
Has nested subtests — wrap outer block in `describe`, convert `test.test` to `it`.
Has `test.fail` calls inside error handlers — replace with `assert.fail` or `reject(err)` in
the Promise wrapper.

### rowimage.js
Similar structure to filtering.js. Nested subtests + tearDown. Use the pattern above.

### rotate.js
Similar to rotate-node-test.js (which is already migrated). Should be straightforward.

### types.js
Largest file. Tests are likely generated in a loop — preserve that loop structure but use `it`
instead of `tap.test`. Pay attention to assertion helpers that receive `test` as a parameter;
replace with `assert` calls or pass `assert` directly.

### events.js
Most complex file. Heavy use of async event patterns and nested subtests. Work through it
methodically using the patterns above. Set per-test `{ timeout: 15000 }` or higher as needed
since binlog events can be slow.

---

## Suggested migration order

1. `codemap.js` — warmup, trivial
2. `rotate.js` — similar to existing reference implementation
3. `errors.js` — introduces the tearDown/try-finally pattern
4. `rowimage.js` — introduces nested subtests
5. `filtering.js` — adds plan removal + deeper subtests
6. `types.js` — complex but mostly repetitive patterns
7. `events.js` — most complex, save for last

After each file: run `node --test test/<file>.js` to verify it passes before moving to the next.
