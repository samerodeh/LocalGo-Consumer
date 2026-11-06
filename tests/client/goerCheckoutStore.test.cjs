const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { createStore } = require('zustand/vanilla');

function harness() {
  const address = { id: 'home', addressLine: '123 Test Street', latitude: 45.5, longitude: -73.57 };
  const addresses = { ownerEmail: 'a@test.invalid', allAddresses: [address], defaultAddress: address };
  const cart = { ownerEmail: 'a@test.invalid', lines: [{ item: { id: 'pizza' }, quantity: 1 }], revision: 2,
    restaurantID: 'al-taib', busy: false, pending: null, subtotal: () => 5.5, deliveryFee: () => 5 };
  let calls = 0;
  let finish;
  let payment = async () => ({ ok: true, orderId: 'paid-order' });
  const dependencies = {
    zustand: { create: createStore }, 'expo-crypto': { randomUUID },
    '../lib/storage': { loadGoerChat: async () => null, saveGoerChat: async () => {} },
    '../lib/placeOrder': { placeOrder: async input => { calls++; return payment(input); } },
    '../lib/deliveryLocation': { deliveryLocationProblem: value => value ? null : 'Delivery address required.' },
    '../lib/serverCart': { serverCartEnabled: true },
    '../store/cartStore': { useCartStore: { getState: () => cart } },
    '../store/addressStore': { useAddressStore: { getState: () => addresses } },
    '../store/authStore': { useAuthStore: { getState: () => ({ currentUser: { email: addresses.ownerEmail } }) } },
    '../store/ordersStore': { useOrdersStore: { getState: () => ({ orders: [] }) } },
    './config': { isGoerLLMConfigured: false, MAX_API_MESSAGES: 24, MAX_UI_MESSAGES: 50 },
  };
  const filename = path.join(__dirname, '../../src/goer/goerStore.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, console, setTimeout: () => 1, clearTimeout, Date });
  const store = exports.useGoerStore;
  store.setState({ ownerEmail: 'a@test.invalid' });
  return { store, cart, addresses, calls: () => calls,
    deferred: () => { payment = () => new Promise(resolve => { finish = resolve; }); },
    resolve: value => finish(value), payment: value => { payment = async () => value; } };
}

test('checkout summary never pays and cart revision changes invalidate confirmation', async () => {
  const h = harness();
  assert.equal(h.store.getState().stageOrder().ok, true);
  assert.equal(h.calls(), 0);
  h.cart.revision++;
  assert.match(await h.store.getState().confirmStagedOrder(false), /cart changed/i);
  assert.equal(h.calls(), 0);
  assert.equal(h.store.getState().stagedOrder.status, 'stale');
});

test('tip/address edits invalidate the quoted summary and cross-account addresses cannot stage', () => {
  const h = harness();
  h.store.getState().stageOrder();
  h.store.getState().setChatTip({ kind: 'amount', value: 2 });
  assert.equal(h.store.getState().stagedOrder.status, 'stale');
  h.store.getState().stageOrder();
  h.store.getState().setChatAddressId('home');
  assert.equal(h.store.getState().stagedOrder.status, 'stale');
  h.addresses.ownerEmail = 'b@test.invalid';
  assert.equal(h.store.getState().stageOrder().ok, false);
});

test('explicit confirmation pays once and an A-B-A switch cannot accept the old completion', async () => {
  const h = harness(); h.deferred();
  h.store.getState().stageOrder();
  const pending = h.store.getState().confirmStagedOrder(false);
  await h.store.getState().confirmStagedOrder(false);
  assert.equal(h.calls(), 1);
  await h.store.getState().configure(null);
  // Return to the same identity without resetting the generation fence.
  h.store.setState({ ownerEmail: 'a@test.invalid' });
  h.resolve({ ok: true, orderId: 'old-owner-order' });
  assert.match(await pending, /Reference: old-owner-order/);
  assert.equal(Object.keys(h.store.getState().placedOrders).length, 0);
});

test('chat receives the actual paid reference and preserves publication warnings', async () => {
  const h = harness();
  h.payment({ ok: true, orderId: 'stable-paid-id', warning: 'Dispatch is pending; retry this same order.' });
  const staged = h.store.getState().stageOrder().staged;
  const text = await h.store.getState().confirmStagedOrder(false);
  assert.match(text, /stable-paid-id/);
  assert.match(text, /Dispatch is pending/);
  assert.equal(h.calls(), 1);
  assert.equal(h.store.getState().placedOrders[staged.id].status, 'placed');
  assert.equal(h.store.getState().uiMessages.filter(m => m.kind === 'system_note').length, 0);
});
