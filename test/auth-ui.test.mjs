import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('공식 SDK 로그인·로그아웃에 따라 화면이 바뀌고 실패 이유를 표시한다', async () => {
  const code = await readFile(new URL('../public/auth.js', import.meta.url), 'utf8');
  const ids = ['login-form', 'login-email', 'login-password', 'login-button', 'logout-button', 'auth-state', 'auth-message', 'notes'];
  const nodes = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', hidden: false,
    disabled: id === 'login-button', handlers: {}, children: [],
    replaceChildren(...items) { this.children = items; },
    addEventListener(name, fn) { this.handlers[name] = fn; } }]));
  let listener;
  let failure;
  let signOutFailure;
  const session = { user: { id: 'test-account-a' }, access_token: 'sdk-test-access' };
  let reads = 0;
  let delayed;
  let delayNext = false;
  const auth = {
    onAuthStateChange(fn) { listener = fn; fn('INITIAL_SESSION', null); },
    async signInWithPassword(credentials) {
      assert.equal(credentials.email, 'account-a');
      assert.equal(credentials.password, 'test-only-password');
      if (failure) return { error: failure, data: {} };
      listener('SIGNED_IN', session);
      return { error: null, data: { session } };
    },
    async signOut(options) {
      assert.equal(options.scope, 'local');
      if (signOutFailure) return { error: { status: 500 } };
      listener('SIGNED_OUT', null);
      return { error: null };
    },
  };
  runInNewContext(code, {
    document: { querySelector: selector => nodes[selector.slice(1)],
      createElement: () => ({ children: [], append(...items) { this.children.push(...items); } }) },
    fetch: async (path, options) => {
      reads++;
      assert.equal(path, '/api/notes');
      assert.equal(options.headers.Authorization, `Bearer ${session.access_token}`);
      assert.equal(options.credentials, 'omit');
      if (delayNext) return new Promise(resolve => { delayed = resolve; });
      return Response.json({ notes: Array.from({ length: 4 }, (_, i) => ({ title: `카드 ${i}`, content: '가상 테스트' })) });
    },
    SUPABASE_PUBLIC_CONFIG: { url: 'https://test-only.supabase.co', publishableKey: 'sb_publishable_test' },
    supabase: { createClient: () => ({ auth }) },
  });
  assert.equal(nodes['auth-state'].textContent, '로그인하지 않음');
  assert.equal(nodes.notes.hidden, true);
  assert.equal(reads, 0);
  const submit = async () => {
    nodes['login-email'].value = ' account-a ';
    nodes['login-password'].value = 'test-only-password';
    await nodes['login-form'].handlers.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes['login-password'].value, '');
    assert.equal(nodes['login-button'].disabled, false);
  };
  failure = { code: 'invalid_credentials', message: 'do not expose raw response' };
  await submit();
  assert.match(nodes['auth-message'].textContent, /이메일 또는 비밀번호/u);
  assert.equal(nodes['login-form'].hidden, false);
  failure = null;
  await submit();
  assert.equal(nodes['auth-state'].textContent, '로그인됨');
  assert.equal(nodes['login-form'].hidden, true);
  assert.equal(nodes['logout-button'].hidden, false);
  assert.equal(nodes.notes.hidden, false);
  assert.equal(nodes.notes.children.length, 4);
  signOutFailure = true;
  await nodes['logout-button'].handlers.click();
  assert.equal(nodes['auth-state'].textContent, '로그인됨');
  assert.match(nodes['auth-message'].textContent, /로그아웃하지 못했습니다/u);
  signOutFailure = false;
  await nodes['logout-button'].handlers.click();
  assert.equal(nodes['auth-state'].textContent, '로그인하지 않음');
  assert.equal(nodes['login-form'].hidden, false);
  assert.equal(nodes['logout-button'].hidden, true);
  assert.equal(nodes.notes.hidden, true);
  assert.equal(nodes.notes.children.length, 0);
  delayNext = true;
  listener('SIGNED_IN', session);
  assert.equal(nodes['auth-state'].textContent, '로그인됨');
  listener('SIGNED_OUT', null);
  assert.equal(nodes['auth-state'].textContent, '로그인하지 않음');
  delayed(Response.json({ notes: [{ title: '늦은 응답', content: '표시되면 안 됨' }] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.notes.hidden, true);
  assert.equal(nodes.notes.children.length, 0);
});
