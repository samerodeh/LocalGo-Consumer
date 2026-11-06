const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function transpile(name, requireFn = require) {
  const filename = path.join(__dirname, '../../src/goer', name + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, requireFn);
  return module.exports;
}

const guard = transpile('cardGuard');

test('card numbers and security codes are detected', () => {
  for (const text of ['my card is 4242 4242 4242 4242', '4000-0025-0000-3155', 'amex 378282246310005',
    'the cvv is 123', 'CVC: 4567']) {
    assert.equal(guard.containsPaymentCardData(text), true, text);
  }
});

test('ordinary chat, addresses, phone numbers and order codes are allowed', () => {
  for (const text of ['show me pizza', 'deliver to 2285 rue saint mathieu H3H 2J7', 'call 514 555 0199',
    'order 1234567890123 is late', 'CONFIRM ORDER e959fdab', 'tip $2.00']) {
    assert.equal(guard.containsPaymentCardData(text), false, text);
  }
});

test('a card number is never displayed, sent or saved', async () => {
  const messages = [], api = [];
  let sent = 0;
  const state = { isStreaming: false, isHistoryLoading: false, pendingMessage: null, mode: 'llm',
    appendMessage: m => messages.push(m), appendApiMessage: m => api.push(m), setStreaming() {} };
  const send = transpile('send', name => {
    if (name === './cardGuard') return guard;
    if (name === './checkoutChat') return { isCheckoutChatCommand: () => false, runCheckoutChatCommand() {} };
    if (name === './authenticatedClient') return { authenticatedGoerEnabled: true, runAuthenticatedGoerTurn: async () => { sent++; } };
    if (name === './goerStore') return { goerMsg: m => m, goerOwnerGeneration: () => 1, useGoerStore: { getState: () => state } };
    throw Error(`Unexpected dependency ${name}`);
  });
  await send.sendGoerMessage('pay with 4242 4242 4242 4242');
  assert.equal(sent, 0);
  assert.deepEqual(api, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'system_note');
  assert.equal(messages[0].text, guard.CARD_REFUSAL);
  assert.ok(!JSON.stringify(messages).includes('4242'));
});
