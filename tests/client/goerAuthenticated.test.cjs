const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

function harness(shared = { data: new Map(), turns: new Map(), goerWrites: 0 }) {
  let generation = 0, historyDown = false, responseLost = false, block = null, creationBlock = null, storageBlock = null;
  const conversationId = randomUUID();
  const accepted = [];
  const state = { ownerEmail: 'alice@example.test', isStreaming: false, isHistoryLoading: false,
    pendingMessage: null, uiMessages: [], apiMessages: [],
    appendMessage: m => { if (!state.uiMessages.some(old => old.id === m.id)) state.uiMessages.push(m); },
    appendApiMessage: m => state.apiMessages.push(m), setActiveAgent() {},
    restoreTranscript: (ui, api) => { state.uiMessages = ui; state.apiMessages = api; } };
  const store = { getState: () => state, setState: value => Object.assign(state, value) };
  const storage = { getItem: async key => shared.data.get(key) ?? null,
    setItem: async (key, value) => {
      if (storageBlock) { const wait = storageBlock; storageBlock = null; await wait; }
      shared.data.set(key, value);
    }, removeItem: async key => shared.data.delete(key) };
  const backend = { serverCartEnabled: true,
    customerToken: async email => {
      if (email !== state.ownerEmail) throw Error('account changed');
      return { userId: 'alice-id', token: 'private-token' };
    }, validateCart: value => value };
  const cart = { revision: 1, merchant_id: 'al-taib', currency: 'CAD', lines: [],
    subtotal_cents: 0, delivery_fee_cents: 0, total_cents: 0 };
  const response = value => ({ ok: true, status: 200, json: async () => value });
  const fetch = async (url, options) => {
    if (url.includes('/rest/v1/rpc/')) {
      if (historyDown) throw Error('Supabase unavailable');
      const value = JSON.parse(options.body);
      const old = shared.turns.get(value.p_request_id);
      if (old) assert.deepEqual(old.response, value.p_response);
      shared.turns.set(value.p_request_id, { message: value.p_message, response: value.p_response, created_at: '2026-11-05T00:00:00Z' });
      if (responseLost) { responseLost = false; throw Error('receipt response lost'); }
      return response(null);
    }
    if (url.includes('/rest/v1/goer_conversations')) {
      if (historyDown) throw Error('Supabase unavailable');
      return response([...new Set([...shared.turns.values()].map(t => t.response.conversation_id))]
        .map(id => ({ id, title: 'Pizza', updated_at: 'now' })));
    }
    if (url.includes('/rest/v1/goer_history_turns')) {
      if (block) { const wait = block; block = null; await wait; }
      return response([...shared.turns.values()].reverse());
    }
    if (url.endsWith('/v1/conversations')) {
      if (creationBlock) { const wait = creationBlock; creationBlock = null; await wait; }
      return response({ conversation_id: conversationId });
    }
    assert.match(url, /\/v1\/conversations\/.+\/turns$/);
    shared.goerWrites++;
    const body = JSON.parse(options.body);
    if (block) { const wait = block; block = null; await wait; }
    return response({ conversation_id: conversationId, turn_id: body.request_id,
      text: 'Cart updated.', cards: [{ type: 'cart_summary', cart }] });
  };
  const modules = {};
  function load(name) {
    if (modules[name]) return modules[name];
    const filename = path.join(__dirname, `../../src/goer/${name}.ts`);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, Error,
      process: { env: { EXPO_PUBLIC_GOER_API_URL: 'https://goer.test',
        EXPO_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' } },
      require: dependency => {
        if (dependency === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage };
        if (dependency === 'expo-crypto') return { randomUUID };
        if (dependency === '../lib/serverCart') return backend;
        if (dependency === '../store/cartStore') return { useCartStore: { getState: () => ({
          acceptServerCart: value => accepted.push(value), refresh: async () => {} }) } };
        if (dependency === './goerStore') return { goerMsg: m => ({ ...m, id: randomUUID(), createdAt: 'now' }),
          goerOwnerGeneration: () => generation, useGoerStore: store };
        if (dependency === './history') return load('history');
        throw Error(`Unexpected dependency ${dependency}`);
      },
    });
    return modules[name] = module.exports;
  }
  return { api: load('authenticatedClient'), state, shared, accepted,
    historyDown: value => { historyDown = value; }, loseHistoryResponse: () => { responseLost = true; },
    blockNext: wait => { block = wait; },
    blockCreation: wait => { creationBlock = wait; }, blockStorage: wait => { storageBlock = wait; },
    switchAccount: email => { generation++; state.ownerEmail = email; state.uiMessages = []; state.apiMessages = []; },
    saved: () => JSON.parse(shared.data.get('localgo.goer.session:alice@example.test:alice-id') ?? '{}') };
}

test('a history outage retains the completed response and retries without another Goer/cart write after restart', async () => {
  const h = harness(); h.historyDown(true);
  await assert.rejects(h.api.runAuthenticatedGoerTurn('add pizza'), /turn completed/);
  assert.equal(h.shared.goerWrites, 1);
  assert.equal(h.accepted.length, 1, 'the confirmed cart result is already reflected');
  assert.ok(h.saved().pending.response);
  assert.equal(JSON.stringify([...h.shared.data.values()]).includes('private-token'), false);
  const restarted = harness(h.shared);
  await restarted.api.restoreAuthenticatedConversation();
  assert.equal(restarted.state.pendingMessage, 'add pizza');
  await restarted.api.runAuthenticatedGoerTurn('add pizza');
  assert.equal(h.shared.goerWrites, 1);
  assert.equal(h.shared.turns.size, 1);
  assert.equal(restarted.saved().pending, undefined);
  assert.equal(restarted.state.pendingMessage, null);
  assert.equal(restarted.state.uiMessages.filter(m => m.kind === 'text' && m.role === 'assistant').length, 1);
});

test('lost history acknowledgement replays once and hydration never duplicates the completed turn', async () => {
  const h = harness(); h.loseHistoryResponse();
  await assert.rejects(h.api.runAuthenticatedGoerTurn('add pizza'), /turn completed/);
  await assert.rejects(h.api.restoreAuthenticatedConversation(randomUUID()), /pending turn/);
  await h.api.restoreAuthenticatedConversation();
  assert.equal(h.state.uiMessages.length, 3);
  await h.api.runAuthenticatedGoerTurn('add pizza');
  assert.equal(h.shared.turns.size, 1);
  assert.equal(h.shared.goerWrites, 1);
  assert.equal(h.state.uiMessages.length, 3);
});

test('a fresh install restores the latest cloud conversation without applying historical cart snapshots', async () => {
  const h = harness(); await h.api.runAuthenticatedGoerTurn('add pizza');
  h.shared.data.clear();
  const reinstalled = harness(h.shared);
  await reinstalled.api.restoreAuthenticatedConversation();
  assert.equal(reinstalled.state.uiMessages.length, 3);
  assert.equal(reinstalled.accepted.length, 0);
  assert.equal(reinstalled.saved().conversationId, [...h.shared.turns.values()][0].response.conversation_id);
  assert.equal(h.shared.goerWrites, 1);
  await reinstalled.api.resetAuthenticatedConversation('alice@example.test');
  await reinstalled.api.restoreAuthenticatedConversation();
  assert.equal(reinstalled.state.uiMessages.length, 0);
  assert.equal(h.shared.turns.size, 1, 'new chat does not delete history');
});

test('history callbacks cannot hydrate another account, even after switching A-B-A', async () => {
  const h = harness(); await h.api.runAuthenticatedGoerTurn('add pizza');
  let release;
  h.blockNext(new Promise(resolve => { release = resolve; }));
  const restore = h.api.restoreAuthenticatedConversation();
  await new Promise(resolve => setImmediate(resolve));
  h.switchAccount('bob@example.test'); h.switchAccount('alice@example.test');
  release(); await restore;
  assert.equal(h.state.uiMessages.length, 0);
});

test('a stale conversation creation cannot replace a newer A-B-A pending response', async () => {
  const h = harness(); h.historyDown(true);
  let release;
  h.blockCreation(new Promise(resolve => { release = resolve; }));
  const stale = h.api.runAuthenticatedGoerTurn('old turn');
  await new Promise(resolve => setImmediate(resolve));
  h.switchAccount('bob@example.test'); h.switchAccount('alice@example.test');
  await assert.rejects(h.api.runAuthenticatedGoerTurn('new turn'), /turn completed/);
  const pending = h.saved().pending;
  assert.ok(pending.response);
  release(); await stale;
  assert.deepEqual(h.saved().pending, pending);
  assert.equal(h.shared.goerWrites, 1);
});

test('a delayed native storage write finishes before another generation reads or stages a turn', async () => {
  const h = harness();
  let release;
  h.blockStorage(new Promise(resolve => { release = resolve; }));
  const stale = h.api.runAuthenticatedGoerTurn('old turn');
  await new Promise(resolve => setImmediate(resolve));
  h.switchAccount('bob@example.test'); h.switchAccount('alice@example.test');
  const newer = h.api.runAuthenticatedGoerTurn('new turn');
  const rejected = assert.rejects(newer, /previous turn needs reconciliation/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.shared.data.size, 0);
  release(); await stale; await rejected;
  const requestId = h.saved().pending.requestId;
  assert.equal(h.saved().pending.message, 'old turn');
  assert.equal(h.shared.goerWrites, 0);
  await h.api.runAuthenticatedGoerTurn('old turn');
  assert.equal(h.shared.goerWrites, 1);
  assert.equal([...h.shared.turns.keys()][0], requestId);
});
