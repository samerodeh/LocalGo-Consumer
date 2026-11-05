const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function render(overrides = {}, showHistory = false) {
  const sent = [];
  const state = { ownerEmail: 'alice@example.test', isOpen: true, uiMessages: [], isStreaming: false,
    isHistoryLoading: false, pendingMessage: null, streamingText: '', activeAgent: 'cart', mode: 'llm',
    close() {}, clearChat() {}, ...overrides };
  let hook = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  const react = { useCallback: fn => fn, useMemo: fn => fn(), useEffect() {},
    useState: initial => [[initial, initial, showHistory][hook++], () => {}] };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../../src/components/goer/GoerSheet.tsx');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { ...Object.fromEntries(['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable',
      'Text', 'TextInput', 'View'].map(key => [key, key])), Platform: { OS: 'ios' },
      StyleSheet: { create: s => s, absoluteFill: {} }, useWindowDimensions: () => ({ width: 400 }) };
    if (name === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (name === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name.endsWith('/theme/theme')) return { accentGradient: [], radius: {} };
    if (name.endsWith('/theme/ThemeContext')) return { useTheme: () => ({ colors: {} }) };
    if (name.endsWith('/goer/goerStore')) return { goerOwnerGeneration: () => 7, useGoerStore: select => select(state) };
    if (name.endsWith('/goer/authenticatedClient')) return { authenticatedGoerEnabled: true };
    if (name.endsWith('/goer/config')) return { MAX_UI_MESSAGES: 50 };
    if (name.endsWith('/goer/send')) return { sendGoerMessage: (...args) => sent.push(args) };
    return Object.fromEntries(['DisplayText', 'ConfirmModal', 'AgentBadge', 'MessageView', 'MessageBubble',
      'TypingIndicator', 'GoerHistory'].map(key => [key, key]));
  } });
  const tree = module.exports.GoerSheet();
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    nodes.push(node); visit(node.props?.children);
  }
  visit(tree);
  return { nodes, sent };
}

test('pending history has an explicit retry button, blocks new mutations and never promises deletion', () => {
  const h = render({ pendingMessage: 'add pizza' });
  const retry = h.nodes.find(n => n.type === 'Pressable' && n.props.children?.props?.children === 'Retry pending turn');
  assert.ok(retry); assert.equal(retry.props.disabled, false); retry.props.onPress();
  assert.deepEqual(h.sent, [['add pizza', true]]);
  assert.equal(h.nodes.find(n => n.type === 'TextInput').props.editable, false);
  assert.equal(h.nodes.find(n => n.props?.accessibilityLabel === 'New conversation').props.disabled, true);
  const modal = h.nodes.find(n => n.type === 'ConfirmModal');
  assert.match(modal.props.message, /stays in your account history/);
  assert.equal(modal.props.destructive, false);
});

test('history picker and transcript cap are visible and streaming blocks conversation changes', () => {
  const h = render({ isStreaming: true }, true);
  assert.ok(h.nodes.some(n => n.type === 'GoerHistory' && n.key === 7));
  assert.ok(h.nodes.some(n => n.type === 'Text' && /latest 50 messages/.test(n.props.children)));
  assert.equal(h.nodes.find(n => n.props?.accessibilityLabel === 'Saved conversations').props.disabled, true);
});
