import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import handler from '../api/auth/login.js';

test('서버 로그인 입력·Origin 검사와 SDK 인증, HttpOnly 쿠키 및 오류 응답', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let rejectLogin = false;
  const body = { email: ' account-a ', password: ' test-password ' };
  const call = async (input = body, method = 'POST', origin = config.publicAppUrl) => {
    const result = { headers: {} };
    await handler({ method, headers: { origin }, body: input }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: status => { result.status = status; return { json: value => { result.body = value; } }; },
    });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    return result;
  };
  try {
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, '/auth/v1/token');
      const payload = JSON.parse(options.body);
      assert.equal(payload.email, 'account-a');
      assert.equal(payload.password, body.password);
      if (rejectLogin) return Response.json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, { status: 400 });
      return Response.json({ access_token: 'test-access-value', refresh_token: 'test-refresh-value',
        token_type: 'bearer', expires_in: 3600, user: { id: 'test-account-a' } });
    };
    assert.equal((await call(body, 'GET')).status, 405);
    assert.equal((await call(body, 'POST', 'https://other.example')).status, 403);
    for (const input of [null, {}, { email: 1, password: 'x' }, { email: ' ', password: 'x' }, { email: 'a', password: '' }, '{']) {
      assert.equal((await call(input)).status, 400);
    }
    assert.equal(calls, 0);
    const success = await call();
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, { ok: true });
    assert.equal(success.headers['Set-Cookie'].length, 2);
    for (const cookie of success.headers['Set-Cookie']) {
      assert.match(cookie, /^__Host-aleph-/u);
      assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax$/u);
    }
    rejectLogin = true;
    const failure = await call();
    assert.equal(failure.status, 401);
    assert.equal(failure.headers['Set-Cookie'], undefined);
    assert.ok(!JSON.stringify(failure.body).includes(body.password));
  } finally {
    globalThis.fetch = originalFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = savedKey;
  }
});
