const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { createStore } = require('zustand/vanilla');

function harness() {
  let waitLoad = null, waitSave = null;
  const saved = new Map();
  const dependencies = { zustand: { create: createStore }, 'expo-crypto': { randomUUID },
    '../lib/storage': {
      loadAddresses: async email => { if (waitLoad) { const p = waitLoad; waitLoad = null; await p; } return saved.get(email) ?? []; },
      saveAddresses: async (email, addresses) => { if (waitSave) { const p = waitSave; waitSave = null; await p; } saved.set(email, addresses); },
    } };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/store/addressStore.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: n => dependencies[n], Date });
  return { store: exports.useAddressStore, saved,
    blockLoad: p => { waitLoad = p; }, blockSave: p => { waitSave = p; } };
}

test('delayed address hydration cannot replace the newer signed-in account', async () => {
  const h = harness(); let finish;
  h.blockLoad(new Promise(resolve => { finish = resolve; }));
  const pending = h.store.getState().configure('a@test.invalid');
  await h.store.getState().configure('b@test.invalid');
  finish(); await pending;
  assert.equal(h.store.getState().ownerEmail, 'b@test.invalid');
  assert.equal(h.store.getState().allAddresses.length, 0);
});

test('A-B-A hydration waits for its earlier native save rather than reading stale addresses', async () => {
  const h = harness(); await h.store.getState().configure('a@test.invalid'); let finish;
  h.blockSave(new Promise(resolve => { finish = resolve; }));
  const pending = h.store.getState().save({ addressLine: '123 Old Street', latitude: 45.5, longitude: -73.57 });
  await new Promise(setImmediate);
  await h.store.getState().configure('b@test.invalid');
  const returned = h.store.getState().configure('a@test.invalid');
  assert.equal(h.store.getState().isHydrated, false);
  finish(); await pending; await returned;
  assert.equal(h.saved.get('a@test.invalid').length, 1);
  assert.equal(h.store.getState().allAddresses.length, 1);
  assert.equal(h.store.getState().isHydrated, true);
});

test('saving during hydration and concurrent edits preserve the existing list', async () => {
  const h = harness(); let finish;
  h.saved.set('a@test.invalid', [{ id: 'existing', addressLine: 'Existing address', isDefault: true, sortOrder: 0 }]);
  h.blockLoad(new Promise(resolve => { finish = resolve; }));
  const loading = h.store.getState().configure('a@test.invalid');
  const first = h.store.getState().save({ addressLine: 'Second address' });
  const second = h.store.getState().save({ addressLine: 'Third address' });
  assert.equal(h.store.getState().isHydrated, false);
  finish(); await Promise.all([loading, first, second]);
  assert.deepEqual(Array.from(h.saved.get('a@test.invalid'), a => a.addressLine), ['Existing address', 'Second address', 'Third address']);
});
