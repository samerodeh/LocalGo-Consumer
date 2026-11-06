const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { createStore } = require('zustand/vanilla');

// Real chat transport, stores, address validation and checkout commands; external
// Auth, model, storage HTTP and native payment are isolated test doubles.
function harness() {
  const email = 'alice@example.test';
  const ownerId = randomUUID(), conversationId = randomUUID();
  const data = new Map(), history = new Map(), modules = {};
  let payments = 0, agentTurns = 0, cartRevision = 1;
  const address = { id: 'home', ownerEmail: email, isDefault: true, sortOrder: 0,
    addressLine: '1510 Boulevard De Maisonneuve Ouest', postalCode: 'H3G 1M8',
    latitude: 45.496339, longitude: -73.578666 };
  const addresses = new Map([[email, [address]]]);
  const line = { item: { id: 'pizza', name: 'Cheese Pizza Slice', price: 5.5, restaurantID: 'al-taib' }, quantity: 1 };
  const cart = { ownerEmail: email, lines: [], revision: cartRevision, restaurantID: 'al-taib', busy: false, pending: null,
    subtotal: () => cart.lines.length ? 5.5 : 0, deliveryFee: () => cart.lines.length ? 5 : 0,
    refresh: async () => {}, acceptServerCart: value => { cart.lines = value.lines.length ? [line] : []; cart.revision = value.revision; } };
  const reply = value => ({ ok: true, status: 200, json: async () => value });
  const fetch = async (url, options = {}) => {
    if (url.includes('/rest/v1/rpc/')) {
      const body = JSON.parse(options.body);
      const old = history.get(body.p_request_id);
      if (old) assert.deepEqual(old.p_response, body.p_response);
      history.set(body.p_request_id, body); return reply(null);
    }
    if (url.includes('/rest/v1/goer_conversations')) return reply([]);
    if (url.includes('/rest/v1/goer_history_turns')) return reply([]);
    if (url.endsWith('/v1/conversations')) return reply({ conversation_id: conversationId });
    if (url.includes('/turns')) {
      agentTurns++;
      const body = JSON.parse(options.body);
      const remote = { revision: ++cartRevision, merchant_id: 'al-taib', currency: 'CAD', lines: [{ product_id: 'pizza' }],
        subtotal_cents: 550, delivery_fee_cents: 500, total_cents: 1050 };
      return reply({ conversation_id: conversationId, turn_id: body.request_id, trace_id: randomUUID(), text: 'Added one cheese pizza slice.',
        cards: [{ type: 'cart_summary', cart: remote, display_subtotal: '$5.50', display_delivery_fee: '$5.00', display_total: '$10.50' }], actions: [] });
    }
    throw Error(`Unexpected HTTP ${url}`);
  };
  function load(name) {
    if (modules[name]) return modules[name].exports;
    const module = { exports: {} }; modules[name] = module;
    const folders = { addressStore: 'store', deliveryLocation: 'lib', deliveryZone: 'lib' };
    const filename = path.join(__dirname, '../../src', folders[name] ?? 'goer', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, Error, console, Date,
      process: { env: { EXPO_PUBLIC_GOER_API_URL: 'https://goer.test', EXPO_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' } },
      require: dependency => {
        if (dependency === 'zustand') return { create: createStore };
        if (dependency === 'expo-crypto') return { randomUUID };
        if (dependency === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
          getItem: async k => data.get(k) ?? null, setItem: async (k, v) => data.set(k, v), removeItem: async k => data.delete(k) } };
        if (dependency === '../lib/storage') return { loadGoerChat: async () => null, saveGoerChat: async () => {},
          loadAddresses: async e => addresses.get(e) ?? [], saveAddresses: async (e, values) => addresses.set(e, values) };
        if (dependency === '../lib/serverCart') return { serverCartEnabled: true, validateCart: v => v,
          customerToken: async e => { assert.equal(e, email); return { token: 'test-private-token', userId: ownerId }; } };
        if (dependency === '../store/cartStore') return { useCartStore: { getState: () => cart } };
        if (dependency === '../store/authStore') return { useAuthStore: { getState: () => ({ currentUser: { email } }) } };
        if (dependency === '../store/ordersStore') return { useOrdersStore: { getState: () => ({ orders: [] }) } };
        if (dependency === '../lib/placeOrder') return { placeOrder: async () => {
          payments++; cart.lines = []; cart.revision++; return { ok: true, orderId: 'sandbox-paid-order-reference' }; } };
        if (dependency === '../lib/checkoutSession') return { cancelPendingCheckout: async () => {} };
        if (dependency === '../lib/geocoding') return { searchAddresses: async () => [
          { label: address.addressLine, addressLine: address.addressLine, postalCode: address.postalCode, city: 'Montreal', latitude: address.latitude, longitude: address.longitude },
          { label: 'Outside delivery zone', addressLine: '123 Far Street', postalCode: '', city: 'Toronto', latitude: 43.65, longitude: -79.38 } ] };
        if (dependency === './config') return { isGoerLLMConfigured: true, MAX_API_MESSAGES: 24, MAX_UI_MESSAGES: 50 };
        const actual = { './authenticatedClient': 'authenticatedClient', './goerStore': 'goerStore', './checkoutChat': 'checkoutChat', './history': 'history',
          '../store/addressStore': 'addressStore', '../lib/deliveryLocation': 'deliveryLocation', './deliveryZone': 'deliveryZone' }[dependency];
        if (actual) return load(actual);
        throw Error(`Unexpected dependency ${dependency}`);
      },
    });
    return module.exports;
  }
  const store = load('goerStore').useGoerStore;
  const addressStore = load('addressStore').useAddressStore;
  const send = load('send').sendGoerMessage;
  return { store, addressStore, send, history, addresses,
    start: async () => { await addressStore.getState().configure(email); await store.getState().configure(email); },
    payments: () => payments, agentTurns: () => agentTurns,
    lastText: () => store.getState().uiMessages.filter(m => m.kind === 'text' && m.role === 'assistant').at(-1)?.text };
}

test('signed-in chat orders, stages, explicitly confirms and saves the outcome without cart-screen navigation', async () => {
  const h = harness(); await h.start();
  await h.send('add one cheese pizza slice');
  await h.send('checkout');
  assert.match(h.lastText(), /Total: \$11.49 CAD/);
  assert.equal(h.payments(), 0, 'a checkout request cannot charge');
  const code = h.store.getState().stagedOrder.id.slice(0, 8);
  await h.send('confirm order deadbeef');
  assert.equal(h.payments(), 0, 'confirmation must match the shown summary');
  await h.send(`confirm order ${code}`);
  assert.equal(h.payments(), 1);
  assert.match(h.lastText(), /sandbox-paid-order-reference/);
  assert.equal(h.agentTurns(), 1, 'checkout controls never ask an agent to pay');
  await h.send(`confirm order ${code}`);
  assert.equal(h.payments(), 1);
  assert.equal(h.history.size, 5);
  assert.ok([...h.history.values()].some(row => row.p_response.text.includes('payment is confirmed')));
});

test('new delivery address is searched, explicitly selected and validated entirely in chat', async () => {
  const h = harness(); await h.start();
  h.addressStore.setState({ allAddresses: [], defaultAddress: null });
  await h.send('add one cheese pizza slice');
  await h.send('checkout');
  assert.match(h.lastText(), /deliver to/);
  await h.send('deliver to 1510 Boulevard De Maisonneuve Ouest Montreal');
  assert.match(h.lastText(), /use address 1/);
  assert.doesNotMatch(h.lastText(), /Outside delivery zone/);
  assert.equal(h.addressStore.getState().allAddresses.length, 0, 'search is not consent to save');
  await h.send('use address 1');
  assert.equal(h.addressStore.getState().allAddresses.length, 1);
  await h.send('tip $0');
  await h.send('checkout');
  assert.match(h.lastText(), /Total: \$10.50 CAD/);
  const code = h.store.getState().stagedOrder.id.slice(0, 8);
  await h.send(`confirm order ${code}?`);
  assert.equal(h.payments(), 0, 'a question is not payment authorization');
  await h.send(`confirm order ${code}`);
  assert.equal(h.payments(), 1);
});
