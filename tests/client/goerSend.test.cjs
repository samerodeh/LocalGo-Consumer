const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let generation = 0;
  let reject;
  const response = new Promise((_, fail) => { reject = fail; });
  const messages = [];
  const streaming = [];
  const store = { isStreaming: false, appendMessage: m => messages.push(m),
    appendApiMessage: () => {}, setStreaming: value => streaming.push(value) };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../../src/goer/send.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, console: { warn() {} },
    require: name => {
      if (name === './checkoutChat') return { isCheckoutChatCommand: () => false };
      if (name === './cardGuard') return { CARD_REFUSAL: 'refused', containsPaymentCardData: () => false };
      if (name === './authenticatedClient') return { authenticatedGoerEnabled: true,
        runAuthenticatedGoerTurn: () => response };
      if (name === './goerStore') return { goerMsg: m => m,
        goerOwnerGeneration: () => generation, useGoerStore: { getState: () => store } };
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  return { send: module.exports.sendGoerMessage, messages, streaming, reject,
    switchAccount: () => { generation++; messages.length = 0; streaming.length = 0; },
    pending: text => { store.pendingMessage = text; } };
}

test('a delayed failure cannot append to or stop another account turn, including A-B-A', async () => {
  const h = harness();
  const pending = h.send('add pizza');
  h.switchAccount(); h.switchAccount();
  h.reject(new Error('response lost'));
  await pending;
  assert.equal(h.messages.length, 0);
  assert.equal(h.streaming.length, 0);
});

test('retrying a saved turn does not add another user bubble or accept a different message', async () => {
  const h = harness(); h.pending('add pizza');
  await h.send('add something else');
  assert.equal(h.messages.length, 0);
  const retry = h.send('add pizza', true);
  h.reject(new Error('history offline'));
  await retry;
  assert.equal(h.messages.filter(m => m.role === 'user').length, 0);
});

test('the current account sees its pending error and stops streaming', async () => {
  const h = harness();
  const pending = h.send('add pizza');
  h.reject(new Error('retry the same message'));
  await pending;
  assert.equal(h.messages.at(-1).text, 'retry the same message');
  assert.deepEqual(h.streaming, [true, false]);
});
