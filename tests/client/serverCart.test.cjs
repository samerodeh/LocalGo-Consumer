const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

function cart(quantity = 0, revision = 0) {
  return { revision, merchant_id: quantity ? 'al-taib' : null, currency: 'CAD',
    lines: quantity ? [{ product_id: 'pizza', name: 'Pizza', quantity, unit_price_cents: 550, line_total_cents: quantity * 550 }] : [],
    subtotal_cents: quantity * 550, delivery_fee_cents: quantity ? 500 : 0, total_cents: quantity ? quantity * 550 + 500 : 0 };
}

function harness() {
  const data = new Map();
  const carts = new Map();
  const receipts = new Map();
  let writes = 0;
  let drop = false;
  let gate = null;
  class CartApiError extends Error { constructor(message, uncertain) { super(message); this.uncertain = uncertain; } }
  const storage = {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async key => { data.delete(key); },
  };
  const backend = {
    CartApiError, serverCartEnabled: true, validateCart: value => value,
    customerToken: async owner => ({ userId: `${owner}-id`, token: 'never-persist-this' }),
    requestCart: async (owner, request) => {
      if (!request) return carts.get(owner) ?? cart();
      assert.equal(JSON.parse(data.get(`localgo.server-cart.pending:${owner.toLowerCase()}`)).key, request.key);
      if (gate) { const wait = gate; gate = null; await wait; }
      const receiptKey = `${owner}:${request.key}`;
      if (receipts.has(receiptKey)) return receipts.get(receiptKey);
      const current = carts.get(owner) ?? cart();
      assert.equal(request.body.cart_revision, current.revision);
      let quantity = current.lines[0]?.quantity ?? 0;
      if (request.path === '/v1/cart/clear' || request.method === 'DELETE') quantity = 0;
      else if (request.method === 'PATCH') quantity = request.body.quantity;
      else quantity += request.body.quantity;
      const next = cart(quantity, current.revision + 1);
      writes++;
      carts.set(owner, next);
      receipts.set(receiptKey, next);
      if (drop) { drop = false; throw new CartApiError('Response lost after commit', true); }
      return next;
    },
  };
  const filename = path.join(__dirname, '../../src/store/cartStore.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module, console, setTimeout, clearTimeout,
    require: name => {
      if (name === 'zustand') return require('zustand');
      if (name === 'expo-crypto') return { randomUUID };
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage };
      if (name === '../data/menu') return { menuItemById: () => undefined };
      if (name === '../lib/serverCart') return backend;
      throw Error(`Unexpected dependency ${name}`);
    },
  }, { filename });
  return { store: module.exports.useCartStore, data, carts,
    get writes() { return writes; }, dropNext: () => { drop = true; },
    holdNext: promise => { gate = promise; } };
}

test('serializes cart edits and computes queued decrements from the latest state', async () => {
  const h = harness();
  await h.store.getState().configure('alice');
  await Promise.all([h.store.getState().mutate('add', 'pizza', 2), h.store.getState().mutate('add', 'pizza', 1)]);
  assert.equal(h.store.getState().quantityFor('pizza'), 3);
  await Promise.all([h.store.getState().mutate('decrement', 'pizza'), h.store.getState().mutate('decrement', 'pizza')]);
  assert.equal(h.store.getState().quantityFor('pizza'), 1);
  assert.equal(h.writes, 4);
});

test('persists before sending and reconciles a lost response without another add', async () => {
  const h = harness();
  await h.store.getState().configure('alice');
  h.dropNext();
  await assert.rejects(h.store.getState().mutate('add', 'pizza', 2));
  assert.ok(h.store.getState().pending);
  assert.ok(h.data.get('localgo.server-cart.pending:alice'));
  assert.ok(!JSON.stringify([...h.data.values()]).includes('never-persist-this'));
  await assert.rejects(h.store.getState().mutate('add', 'pizza', 1));
  await h.store.getState().retryPending();
  assert.equal(h.writes, 1);
  assert.equal(h.store.getState().quantityFor('pizza'), 2);
  assert.equal(h.store.getState().pending, null);
});

test('an old-account response cannot replace another account cart or erase recovery', async () => {
  const h = harness();
  await h.store.getState().configure('alice');
  let release;
  h.holdNext(new Promise(resolve => { release = resolve; }));
  const edit = h.store.getState().mutate('add', 'pizza', 2);
  await new Promise(resolve => setTimeout(resolve, 0));
  await h.store.getState().configure('bob');
  release();
  await edit;
  assert.equal(h.store.getState().ownerEmail, 'bob');
  assert.equal(h.store.getState().itemCount(), 0);
  assert.ok(h.data.get('localgo.server-cart.pending:alice'));
  await h.store.getState().configure('alice');
  await h.store.getState().retryPending();
  assert.equal(h.store.getState().itemCount(), 2);
  assert.equal(h.writes, 1);
});
