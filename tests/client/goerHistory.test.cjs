const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

function harness() {
  const calls = [];
  let reply = null;
  let valid = true;
  const module = { exports: {} };
  const filename = path.join(__dirname, '../../src/goer/history.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, AbortController, setTimeout, clearTimeout,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' } },
    fetch: async (url, options) => { calls.push({ url, ...options });
      return { ok: valid, status: 200, json: async () => reply }; },
    require: name => {
      assert.equal(name, '../lib/serverCart');
      return { customerToken: async () => ({ userId: 'alice', token: 'private-session-token' }),
        validateCart: cart => { if (!cart || !Array.isArray(cart.lines)) throw Error('invalid cart'); return cart; } };
    },
  });
  return { api: module.exports, calls, respond: value => { reply = value; }, fail: () => { valid = false; } };
}
function envelope(cards = []) {
  return { conversation_id: randomUUID(), turn_id: randomUUID(), text: 'Your cart is updated.', cards };
}

test('history saves exact turn identity with captured bearer, never credentials in persisted body', async () => {
  const h = harness(), response = envelope();
  await h.api.saveHistoryTurn('alice@example.test', 'alice', 'add pizza', response);
  const call = h.calls[0];
  assert.match(call.url, /rest\/v1\/rpc\/save_goer_history_turn$/);
  assert.equal(call.headers.Authorization, 'Bearer private-session-token');
  assert.equal(call.body.includes('private-session-token'), false);
  assert.equal(JSON.parse(call.body).p_request_id, response.turn_id);
  await assert.rejects(h.api.saveHistoryTurn('alice@example.test', 'bob', 'add pizza', response), /account changed/);
  assert.equal(h.calls.length, 1);
});

test('restored cart cards are display snapshots with stable IDs, not cart writes', () => {
  const h = harness();
  const cart = { lines: [{ product_id: 'pizza', name: 'Pizza', quantity: 2, unit_price_cents: 550 }],
    subtotal_cents: 1100, delivery_fee_cents: 500, total_cents: 1600 };
  const response = h.api.parseEnvelope(envelope([{ type: 'cart_summary', cart }]));
  const turn = { message: 'add two', response, created_at: '2026-11-05T00:00:00Z' };
  const result = h.api.transcript([turn]);
  assert.equal(result.uiMessages.length, 3);
  assert.equal(result.uiMessages[2].snapshot.total, 16);
  assert.equal(result.uiMessages[2].id, `${response.turn_id}:card:0`);
  assert.equal(result.apiMessages[0].content, 'add two');
  assert.equal(h.calls.length, 0);
});

test('history rejects malformed product cards, response identities and non-owned results', async () => {
  const h = harness(), response = envelope();
  assert.throws(() => h.api.parseEnvelope({ ...response, turn_id: 'not-a-uuid' }));
  assert.throws(() => h.api.parseEnvelope({ ...response, cards: [{ type: 'product_list', items: [{}] }] }));
  h.respond([{ message: 'hello', response: { ...response, conversation_id: randomUUID() }, created_at: 'now' }]);
  await assert.rejects(h.api.loadHistory('alice@example.test', response.conversation_id), /identity/);
  h.fail();
  await assert.rejects(h.api.listHistory('alice@example.test'), /unavailable/);
});

test('history lists use explicit pages and transcript reads restore chronological order', async () => {
  const h = harness(), response = envelope();
  h.respond([{ id: response.conversation_id, title: 'Pizza', updated_at: 'now' }]);
  assert.equal((await h.api.listHistory('alice@example.test', 20))[0].title, 'Pizza');
  assert.match(h.calls[0].url, /limit=20&offset=20/);
  const second = { ...response, turn_id: randomUUID(), text: 'second' };
  h.respond([{ message: 'two', response: second, created_at: 'later' },
    { message: 'one', response, created_at: 'earlier' }]);
  const turns = await h.api.loadHistory('alice@example.test', response.conversation_id);
  assert.equal(turns[0].message, 'one');
  assert.equal(turns[1].response.text, 'second');
});
