import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('서버 쿠키 로그인·로그아웃·갱신과 메모 CRUD, 늦은 응답 차단', async () => {
  const code = await readFile(new URL('../public/auth.js', import.meta.url), 'utf8');
  const ids = ['login-form', 'login-email', 'login-password', 'login-button', 'logout-button', 'auth-state', 'auth-message', 'notes',
    'note-workspace', 'note-form', 'note-title', 'note-body', 'note-save', 'note-cancel', 'note-message', 'device-state', 'device-request'];
  const nodes = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', hidden: false,
    disabled: id === 'login-button', handlers: {}, children: [],
    replaceChildren(...items) { this.children = items; },
    addEventListener(name, fn) { this.handlers[name] = fn; } }]));
  let failure;
  let signOutFailure;
  const session = { user: { id: 'test-account-a' }, deviceApproval: 'approved' };
  let deviceRequests = 0;
  let signedIn = false;
  let expired = false;
  let refreshes = 0;
  let reads = 0;
  let delayed;
  let delayNext = false;
  const store = new Map(Array.from({ length: 4 }, (_, i) => [String(i), { id: String(i), title: `카드 ${i}`, body: '가상 테스트' }]));
  const browser = {
    document: { querySelector: selector => nodes[selector.slice(1)],
      createElement: () => ({ children: [], handlers: {}, append(...items) { this.children.push(...items); },
        addEventListener(name, fn) { this.handlers[name] = fn; } }) },
    fetch: async (path, options) => {
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.headers.Authorization, undefined);
      if (path === '/api/auth/session') {
        if (expired) { expired = false; refreshes++; }
        return Response.json(signedIn ? session : { user: null });
      }
      if (path === '/api/auth/device') {
        assert.equal(options.method, 'POST');
        deviceRequests++;
        return Response.json(signedIn ? session : { user: null });
      }
      if (path === '/api/auth/login') {
        const credentials = JSON.parse(options.body);
        assert.equal(credentials.email, 'account-a');
        assert.equal(credentials.password, 'test-only-password');
        if (failure) return Response.json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
        signedIn = true;
        return Response.json({ ok: true });
      }
      if (path === '/api/auth/logout') {
        if (signOutFailure) return Response.json({ message: '로그아웃하지 못했습니다.' }, { status: 502 });
        signedIn = false;
        return Response.json({ ok: true });
      }
      reads++;
      assert.ok(path.startsWith('/api/notes'));
      if (expired || !signedIn) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
      if (delayNext) return new Promise(resolve => { delayed = resolve; });
      const id = path.split('/')[3];
      if (options.method === 'POST') {
        store.set('new-id', { id: 'new-id', ...JSON.parse(options.body) });
        return Response.json({ id: 'new-id' }, { status: 201 });
      }
      if (options.method === 'PUT') {
        Object.assign(store.get(id), JSON.parse(options.body));
        return Response.json(store.get(id));
      }
      if (options.method === 'DELETE') {
        store.delete(id);
        return new Response(null, { status: 204 });
      }
      return Response.json(id ? store.get(id) : [...store.values()]);
    },
  };
  runInNewContext(code, browser);
  await new Promise(resolve => setImmediate(resolve));
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
  assert.match(nodes['device-state'].textContent, /^승인된 기기/u);
  assert.equal(nodes['device-request'].hidden, true);
  assert.equal(nodes['login-form'].hidden, true);
  assert.equal(nodes['logout-button'].hidden, false);
  assert.equal(nodes.notes.hidden, false);
  assert.equal(nodes.notes.children.length, 4);
  assert.equal(nodes['note-workspace'].hidden, false);
  nodes['note-title'].value = '추가 제목';
  nodes['note-body'].value = '추가 본문';
  expired = true;
  await nodes['note-form'].handlers.submit({ preventDefault() {} });
  assert.equal(refreshes, 1);
  assert.equal(nodes.notes.children.length, 5);
  await nodes.notes.children[4].children[2].handlers.click();
  assert.equal(nodes['note-title'].value, '추가 제목');
  nodes['note-body'].value = '수정 본문';
  await nodes['note-form'].handlers.submit({ preventDefault() {} });
  assert.equal(store.get('new-id').body, '수정 본문');
  await nodes.notes.children[4].children[3].handlers.click();
  assert.equal(nodes.notes.children.length, 4);
  assert.equal(store.has('new-id'), false);
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
  await submit();
  assert.equal(nodes['auth-state'].textContent, '로그인됨');
  await nodes['logout-button'].handlers.click();
  assert.equal(nodes['auth-state'].textContent, '로그인하지 않음');
  delayed(Response.json([{ title: '늦은 응답', body: '표시되면 안 됨' }]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.notes.hidden, true);
  assert.equal(nodes.notes.children.length, 0);
  // 새 페이지에서는 SDK 저장소 없이 서버 쿠키로 로그인 상태를 복원합니다.
  delayNext = false;
  signedIn = true;
  runInNewContext(code, browser);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes['auth-state'].textContent, '로그인됨');
  assert.equal(nodes.notes.children.length, 4);
  assert.match(nodes['device-state'].textContent, /^승인된 기기/u);

  // 승인 전 기기: 로그인해도 자료를 요청·표시하지 않고, 승인 요청 버튼은 서버의 '대기' 응답만 받습니다.
  Object.assign(session, { deviceApproval: 'pending', deviceCode: 'TESTCODE' });
  const readsBefore = reads;
  runInNewContext(code, browser);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes['auth-state'].textContent, '로그인됨');
  assert.equal(nodes['note-workspace'].hidden, true);
  assert.equal(nodes.notes.hidden, true);
  assert.equal(nodes.notes.children.length, 0);
  assert.match(nodes['device-state'].textContent, /TESTCODE/u);
  assert.equal(nodes['device-request'].hidden, false);
  await nodes['device-request'].handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deviceRequests, 1);
  assert.equal(nodes['note-workspace'].hidden, true);
  assert.equal(reads, readsBefore);
  // 서버가 등록 기기로 확인한 뒤에만 기존 자료실이 열립니다.
  session.deviceApproval = 'approved';
  await nodes['device-request'].handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes['note-workspace'].hidden, false);
  assert.equal(nodes.notes.children.length, 4);
  assert.equal(nodes['device-request'].hidden, true);
});

test('서비스 워커는 오프라인 안내만 저장하고 API 요청은 가로채지 않음', async () => {
  const code = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const cached = [];
  const worker = {
    self: { addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: { open: async () => ({ add: async path => { cached.push(path); } }), match: async path => `cached:${path}` },
    fetch: async () => ({ status: 401 }),
  };
  runInNewContext(code, worker);
  let installing;
  handlers.install({ waitUntil: promise => { installing = promise; } });
  await installing;
  assert.deepEqual(cached, ['/offline.html']);
  let responded = false;
  handlers.fetch({ request: { mode: 'cors' }, respondWith: () => { responded = true; } });
  assert.equal(responded, false);
  const navigate = async () => {
    let page;
    handlers.fetch({ request: { mode: 'navigate' }, respondWith: promise => { page = promise; } });
    return page;
  };
  assert.deepEqual(await navigate(), { status: 401 });
  worker.fetch = async () => { throw new TypeError('offline'); };
  assert.equal(await navigate(), 'cached:/offline.html');
});
