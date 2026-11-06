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
function harness(shared = {}) {
  const email = 'alice@example.test';
  const ownerId = shared.ownerId ??= randomUUID(), conversationId = shared.conversationId ??= randomUUID();
  const data = shared.data ??= new Map(), history = shared.history ??= new Map(), modules = {};
  const statuses = shared.statuses ??= new Map();
  const state = shared.state ??= { payments: 0, agentTurns: 0, cartRevision: 1 };
  let paymentGate; 
  const address = { id: 'home', ownerEmail: email, isDefault: true, sortOrder: 0,
    addressLine: '1510 Boulevard De Maisonneuve Ouest', postalCode: 'H3G 1M8',
    latitude: 45.496339, longitude: -73.578666 };
  const addresses = new Map([[email, [address]]]);
  const line = { item: { id: 'pizza', name: 'Cheese Pizza Slice', price: 5.5, restaurantID: 'al-taib' }, quantity: 1 };
  const cart = shared.cart ??= { ownerEmail: email, lines: [], revision: state.cartRevision, restaurantID: 'al-taib', busy: false, pending: null,
    subtotal: () => cart.lines.length ? 5.5 : 0, deliveryFee: () => cart.lines.length ? 5 : 0,
    refresh: async () => {}, acceptServerCart: value => { cart.lines = value.lines.length ? [line] : []; cart.revision = value.revision; } };
  const reply = value => ({ ok: true, status: 200, json: async () => value });
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/v1/cart/checkout')) return reply({ checkout: [...statuses.values()].find(s => !['consumed', 'released'].includes(s.status)) ?? null });
    if (url.includes('/payments/cart/')) {
      const value = statuses.get(url.split('/').at(-1));
      return value ? reply(value) : { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
    }
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
      state.agentTurns++;
      const body = JSON.parse(options.body);
      const remote = { revision: ++state.cartRevision, merchant_id: 'al-taib', currency: 'CAD', lines: [{ product_id: 'pizza' }],
        subtotal_cents: 550, delivery_fee_cents: 500, total_cents: 1050 };
      return reply({ conversation_id: conversationId, turn_id: body.request_id, trace_id: randomUUID(), text: 'Added one cheese pizza slice.',
        cards: [{ type: 'cart_summary', cart: remote, display_subtotal: '$5.50', display_delivery_fee: '$5.00', display_total: '$10.50' }], actions: [] });
    }
    throw Error(`Unexpected HTTP ${url}`);
  };
  function load(name) {
    if (modules[name]) return modules[name].exports;
    const module = { exports: {} }; modules[name] = module;
    const folders = { addressStore: 'store', deliveryLocation: 'lib', deliveryZone: 'lib', checkoutSession: 'lib' };
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
          getItem: async k => data.get(k) ?? null, setItem: async (k, v) => { shared.writeHook?.(k, v); data.set(k, v); }, removeItem: async k => data.delete(k) } };
        if (dependency === '../lib/storage') return { loadGoerChat: async () => null, saveGoerChat: async () => {},
          loadAddresses: async e => addresses.get(e) ?? [], saveAddresses: async (e, values) => addresses.set(e, values) };
        if (dependency === '../lib/serverCart' || dependency === './serverCart') return { serverCartEnabled: true, validateCart: v => v,
          customerToken: async e => { assert.equal(e, email); return { token: 'test-private-token', userId: ownerId }; } };
        if (dependency === '../store/cartStore') return { useCartStore: { getState: () => cart } };
        if (dependency === '../store/authStore') return { useAuthStore: { getState: () => ({ currentUser: { email } }) } };
        if (dependency === '../store/ordersStore') return { useOrdersStore: { getState: () => ({ orders: [] }) } };
        if (dependency === '../lib/placeOrder') return { placeOrder: async input => {
          assert.ok(input.expectedCheckoutId);
          state.payments++;
          statuses.set(input.expectedCheckoutId, { order_id: input.expectedCheckoutId, cart_revision: input.cartRevision,
            tip_cents: Math.round(input.tip * 100), status: 'prepared' });
          if (paymentGate) await paymentGate;
          statuses.get(input.expectedCheckoutId).status = 'consumed';
          cart.lines = []; cart.revision++;
          return { ok: true, orderId: input.expectedCheckoutId }; } };
        if (dependency === './api') return { API_URL: 'https://localgo.test' };
        if (dependency === '../lib/geocoding') return { searchAddresses: async () => [
          { label: address.addressLine, addressLine: address.addressLine, postalCode: address.postalCode, city: 'Montreal', latitude: address.latitude, longitude: address.longitude },
          { label: 'Outside delivery zone', addressLine: '123 Far Street', postalCode: '', city: 'Toronto', latitude: 43.65, longitude: -79.38 } ] };
        if (dependency === './config') return { isGoerLLMConfigured: true, MAX_API_MESSAGES: 24, MAX_UI_MESSAGES: 50 };
        const actual = { './authenticatedClient': 'authenticatedClient', './goerStore': 'goerStore', './checkoutChat': 'checkoutChat', './checkoutIntent': 'checkoutIntent', './history': 'history',
          '../store/addressStore': 'addressStore', '../lib/deliveryLocation': 'deliveryLocation', './deliveryZone': 'deliveryZone', '../lib/checkoutSession': 'checkoutSession', './serverCart': 'serverCart' }[dependency];
        if (actual) return load(actual);
        throw Error(`Unexpected dependency ${dependency}`);
      },
    });
    return module.exports;
  }
  const store = load('goerStore').useGoerStore;
  const addressStore = load('addressStore').useAddressStore;
  const send = load('send').sendGoerMessage;
  return { store, addressStore, send, history, addresses, shared, data, beginCheckout: load('checkoutSession').beginCheckout,
    deferPayment: () => { let finish; paymentGate = new Promise(resolve => { finish = resolve; }); return finish; },
    start: async () => { await addressStore.getState().configure(email); await store.getState().configure(email); },
    payments: () => state.payments, agentTurns: () => state.agentTurns,
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
  assert.match(h.lastText(), /Reference: [0-9a-f-]{36}/);
  assert.equal(h.agentTurns(), 1, 'checkout controls never ask an agent to pay');
  await h.send(`confirm order ${code}`);
  assert.equal(h.payments(), 1);
  assert.equal(h.history.size, 5);
  assert.ok([...h.history.values()].some(row => row.p_response.text.includes('payment is confirmed')));
  const original = [...h.shared.statuses.values()][0];
  await assert.rejects(h.beginCheckout('alice@example.test', original.cart_revision, original.tip_cents, original.order_id), /replacement payment was not started/);
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

test('a payment finishing across A-B-A preserves its original receipt without touching the new UI', async () => {
  const h = harness(); await h.start();
  await h.send('add one cheese pizza slice'); await h.send('checkout');
  const command = `confirm order ${h.store.getState().stagedOrder.id.slice(0, 8)}`;
  const finish = h.deferPayment(); const pending = h.send(command);
  await new Promise(setImmediate);
  assert.equal(h.payments(), 1);
  await h.store.getState().configure(null);
  await h.store.getState().configure('alice@example.test');
  finish(); await pending;
  assert.doesNotMatch(h.lastText() ?? '', /Reference:/);
  await h.send(command, true);
  assert.equal(h.payments(), 1);
  assert.match(h.lastText(), /Reference: [0-9a-f-]{36}/);
});

test('a new A generation can wait on its original payment without a second callback or conflicting history envelope', async () => {
  const h = harness(); await h.start();
  await h.send('add one cheese pizza slice'); await h.send('checkout');
  const command = `confirm order ${h.store.getState().stagedOrder.id.slice(0, 8)}`;
  const finish = h.deferPayment(); const original = h.send(command);
  await new Promise(setImmediate);
  await h.store.getState().configure(null); await h.store.getState().configure('alice@example.test');
  const retry = h.send(command, true); await new Promise(setImmediate);
  assert.equal(h.payments(), 1);
  finish(); await Promise.all([original, retry]);
  assert.equal(h.payments(), 1);
  assert.equal(h.history.size, 3);
  assert.match(h.lastText(), /Reference: [0-9a-f-]{36}/);
});

for (const boundary of ['receipt', 'envelope']) {
  test(`restart after payment but before ${boundary} caching reconciles the original order without paying again`, async () => {
    const h = harness(); await h.start();
    await h.send('add one cheese pizza slice'); await h.send('checkout');
    const command = `confirm order ${h.store.getState().stagedOrder.id.slice(0, 8)}`;
    let failed = false;
    h.shared.writeHook = (key, value) => {
      const record = JSON.parse(value);
      const match = boundary === 'receipt'
        ? key.startsWith('localgo.goer.checkout:') && record.reply
        : key.startsWith('localgo.goer.session:') && record.pending?.response;
      if (!failed && match) { failed = true; throw Error('Simulated native-storage interruption'); }
    };
    await h.send(command);
    assert.equal(failed, true);
    assert.equal(h.payments(), 1);
    const restarted = harness(h.shared); await restarted.start();
    assert.equal(restarted.store.getState().stagedOrder, null, 'no in-memory summary survives restart');
    await restarted.send(command, true);
    assert.equal(restarted.payments(), 1);
    assert.match(restarted.lastText(), /Reference: [0-9a-f-]{36}/);
    assert.ok([...restarted.history.values()].some(row => row.p_response.text.includes('payment is confirmed')));
  });
}
