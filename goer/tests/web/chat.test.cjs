const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../src/goer_localgo/web/chat.js'), 'utf8');

function browser(responses = [], saved = null) {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.value = ''; this.disabled = false; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    focus() {}
    set innerHTML(value) { throw Error('Unsafe HTML rendering'); }
  }
  const elements = Object.fromEntries(['#chat-form', '#prompt', '#send', '#new-chat', '#messages'].map(key => [key, new Element()]));
  const storage = new Map(saved ? [['goer.conversation_id', saved]] : []);
  const calls = [];
  const context = vm.createContext({
    document: { querySelector: key => elements[key], createElement: () => new Element() },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    URL, encodeURIComponent,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (!response) throw Error('Unexpected fetch');
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    },
  });
  vm.runInContext(source, context);
  return { elements, storage, calls, context, submit: async (text) => {
    elements['#prompt'].value = text;
    await elements['#chat-form'].listeners.submit({ preventDefault() {} });
  } };
}

function allText(element) {
  return [element.textContent || '', ...element.children.map(allText)].join(' ');
}

test('creates once, reuses ID, renders grounded cards as text, and resets', async () => {
  const b = browser([
    { status: 201, body: { conversation_id: 'conv-1' } },
    { status: 200, body: { text: 'Menu', cards: [{ type: 'product_list', total: 1, items: [{ name: '<img onerror=evil()>', display_price: '$5.50', currency: 'CAD', merchant_id: 'al-taib', image_url: 'javascript:evil()' }] }] } },
    { status: 200, body: { text: 'Details', cards: [{ type: 'product_detail', product: { name: 'Pizza', display_price: '$5.50', currency: 'CAD', merchant_id: 'al-taib' }, description: 'Cheese', allows_notes: true }] } },
  ]);
  await b.submit('pizza');
  await b.submit('the first one');
  assert.equal(b.calls.length, 3);
  assert.equal(b.calls[2].url, '/v1/conversations/conv-1/turns');
  assert.deepEqual(JSON.parse(b.calls[2].options.body), { message: 'the first one' });
  assert.match(allText(b.elements['#messages']), /<img onerror=evil\(\)>/);
  assert.match(allText(b.elements['#messages']), /\$5\.50 CAD/);
  assert.match(allText(b.elements['#messages']), /Cheese/);
  assert.equal(b.storage.get('goer.conversation_id'), 'conv-1');
  b.elements['#new-chat'].listeners.click();
  assert.equal(b.storage.size, 0);
  assert.equal(b.elements['#messages'].children.length, 1);
});

test('restores stored ID and clears an expired session without replaying the turn', async () => {
  const b = browser([{ status: 404, body: { detail: 'Conversation not found.' } }], 'old');
  await b.submit('pizza');
  assert.equal(b.calls.length, 1);
  assert.equal(b.storage.size, 0);
  assert.equal(b.elements['#prompt'].value, 'pizza');
  assert.equal(b.elements['#send'].disabled, false);
});

test('renders server cart totals and item names without interpreting HTML', () => {
  const b = browser();
  vm.runInContext(`renderCards(messagesEl, [{type:'cart_summary', cart:{merchant_id:'al-taib',lines:[{quantity:2,name:'<b>Pizza</b>'}]}, display_subtotal:'$11.00',display_delivery_fee:'$5.00',display_total:'$16.00'}]);`, b.context);
  assert.match(allText(b.elements['#messages']), /2 × <b>Pizza<\/b>/);
  assert.match(allText(b.elements['#messages']), /Total before tip: \$16\.00 CAD/);
});

test('ignores unknown card types and permits only HTTPS product images', () => {
  const b = browser();
  vm.runInContext(`renderCards(messagesEl, [{type:'unknown'}, {type:'product_detail', product:{name:'Pizza', display_price:'$5.50', currency:'CAD', merchant_id:'al-taib', image_url:'https://example.com/pizza.jpg'}}]);`, b.context);
  assert.equal(b.elements['#messages'].children.length, 1);
  assert.equal(b.elements['#messages'].children[0].children[0].src, 'https://example.com/pizza.jpg');
});
