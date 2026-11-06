const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load() {
  const filename = path.join(__dirname, '../../src/goer/checkoutIntent.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const { isCheckoutRequest } = load();

test('checkout requests inside normal sentences open the checkout summary', () => {
  for (const text of ['checkout', 'Checkout', 'check out please', 'place my order',
    'i have added the address, checkout my order now', 'ok lets checkout',
    'can you place the order now', 'I am ready to order', 'please complete my order']) {
    assert.equal(isCheckoutRequest(text), true, text);
  }
});

test('questions, cancellations and unrelated messages still go to the assistant', () => {
  for (const text of ['how does checkout work?', 'what is the checkout fee', 'cancel checkout',
    'show me pizza at Al-Taib', 'add 2 burgers to my cart', 'postal code is H3H 2J7',
    'x'.repeat(170) + ' checkout']) {
    assert.equal(isCheckoutRequest(text), false, text);
  }
});
