const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { createStore } = require('zustand/vanilla');

function harness() {
  let finish, fail, resetCalls = 0, turnCalls = 0;
  const reset = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const authenticated = { authenticatedGoerEnabled: true,
    resetAuthenticatedConversation: async () => { resetCalls++; await reset; },
    restoreAuthenticatedConversation: async () => {},
    runAuthenticatedGoerTurn: async () => { turnCalls++; } };
  const modules = {};
  function load(name) {
    if (modules[name]) return modules[name];
    const filename = path.join(__dirname, `../../src/goer/${name}.ts`);
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, console, Error, setTimeout, clearTimeout,
      process: { env: { EXPO_PUBLIC_GOER_API_URL: 'https://goer.test' } },
      require: dependency => {
        if (dependency === 'zustand') return { create: createStore };
        if (dependency === 'expo-crypto') return { randomUUID };
        if (dependency === '../lib/storage') return { loadGoerChat: async () => null, saveGoerChat: async () => {} };
        if (dependency === '../lib/placeOrder') return { placeOrder: async () => {} };
        if (dependency === '../lib/deliveryLocation') return { deliveryLocationProblem: () => null };
        if (dependency === '../lib/serverCart') return { serverCartEnabled: true };
        if (dependency.startsWith('../store/')) return new Proxy({}, { get: () => ({ getState: () => ({}) }) });
        if (dependency === './config') return { isGoerLLMConfigured: true, MAX_UI_MESSAGES: 50, MAX_API_MESSAGES: 24 };
        if (dependency === './authenticatedClient') return authenticated;
        if (dependency === './checkoutChat') return { isCheckoutChatCommand: () => false };
        if (dependency === './cardGuard') return { CARD_REFUSAL: 'refused', containsPaymentCardData: () => false };
        if (dependency === './goerStore') return load('goerStore');
        throw Error(`Unexpected dependency ${dependency}`);
      },
    });
    return modules[name] = module.exports;
  }
  const store = load('goerStore').useGoerStore;
  store.setState({ ownerEmail: 'alice@example.test', uiMessages: [{ id: 'old', kind: 'system_note', text: 'Old chat' }] });
  return { store, send: load('send').sendGoerMessage, finish, fail,
    resetCalls: () => resetCalls, turnCalls: () => turnCalls };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('New conversation locks synchronously against sends, history switches and another reset', async () => {
  const h = harness();
  h.store.getState().clearChat();
  assert.equal(h.store.getState().isHistoryLoading, true);
  await h.send('do not send into the old conversation');
  h.store.getState().clearChat();
  await tick();
  assert.equal(h.turnCalls(), 0);
  assert.equal(h.resetCalls(), 1);
  assert.equal(h.store.getState().uiMessages.length, 1);
  let lockedDuringClear = false;
  const unsubscribe = h.store.subscribe((state, previous) => {
    if (previous.uiMessages.length && !state.uiMessages.length) lockedDuringClear = state.isHistoryLoading;
  });
  h.finish(); await tick(); unsubscribe();
  assert.equal(lockedDuringClear, true, 'synchronous subscribers cannot send before reset finally releases its lock');
  assert.equal(h.store.getState().isHistoryLoading, false);
  assert.equal(h.store.getState().uiMessages.length, 0);
  await h.send('new conversation');
  assert.equal(h.turnCalls(), 1);
});

test('a failed reset releases its own lock and keeps the previous transcript', async () => {
  const h = harness(); h.store.getState().clearChat(); await tick();
  h.fail(Error('Reconcile the pending turn first.')); await tick();
  assert.equal(h.store.getState().isHistoryLoading, false);
  assert.equal(h.store.getState().uiMessages[0].id, 'old');
  assert.equal(h.store.getState().uiMessages.at(-1).text, 'Reconcile the pending turn first.');
});

test('an old reset cannot clear or unlock another account history operation', async () => {
  const h = harness(); h.store.getState().clearChat(); await tick();
  await h.store.getState().configure('bob@example.test');
  h.store.setState({ isHistoryLoading: true, uiMessages: [{ id: 'bob', kind: 'system_note', text: 'Bob chat' }] });
  h.finish(); await tick();
  assert.equal(h.store.getState().isHistoryLoading, true);
  assert.equal(h.store.getState().uiMessages[0].id, 'bob');
});
