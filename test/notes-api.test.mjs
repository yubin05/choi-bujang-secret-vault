import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import handler from '../api/notes.js';

test('화면 → 서버 함수 → DB 응답으로 네 카드를 만들고 키·추가 필드는 노출하지 않는다', async () => {
  const originalFetch = globalThis.fetch;
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const fakeSecret = 'sb_secret_' + 'test-only-sentinel';
  const rows = Array.from({ length: 4 }, (_, i) => ({ title: `가상 ${i + 1}`, content: `테스트 ${i + 1}`,
    owner_id: 'private-owner', extra: fakeSecret }));
  const call = async (method = 'GET') => {
    const result = { headers: {} };
    await handler({ method }, {
      setHeader: (key, value) => { result.headers[key] = value; },
      status: status => { result.status = status; return { json: body => { result.body = body; } }; },
    });
    assert.ok(!JSON.stringify(result).includes(fakeSecret));
    assert.equal(result.headers['Cache-Control'], 'no-store');
    return result;
  };
  try {
    process.env.SUPABASE_URL = 'https://test-only.supabase.co';
    process.env.SUPABASE_SECRET_KEY = fakeSecret;
    globalThis.fetch = async (url, options) => {
      assert.equal(url.origin, process.env.SUPABASE_URL);
      assert.equal(url.pathname, '/rest/v1/aleph_defense_notes');
      assert.equal(url.searchParams.get('select'), 'title,content');
      assert.equal(options.headers.apikey, fakeSecret);
      assert.equal(options.redirect, 'error');
      return Response.json(rows);
    };
    const result = await call();
    assert.equal(result.status, 200);
    assert.equal(result.body.notes.length, 4);
    assert.deepEqual(Object.keys(result.body.notes[0]), ['title', 'content']);

    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    assert.ok(!html.includes('SUPABASE_SECRET_KEY'));
    assert.ok(!html.includes('supabase.co'));
    const element = () => ({ children: [], append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; } });
    const list = element();
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/u)[1];
    await runInNewContext(`(async () => {${script}})()`, {
      document: { querySelector: () => list, createElement: element },
      fetch: async (path, options) => {
        assert.equal(path, '/api/notes');
        assert.equal(options.credentials, 'omit');
        const response = await call();
        return Response.json(response.body, { status: response.status });
      },
    });
    assert.equal(list.children.length, 4);
    assert.equal(list.children[0].children[0].textContent, rows[0].title);
    assert.equal(list.children[0].children[1].textContent, rows[0].content);

    globalThis.fetch = async () => new Response(fakeSecret, { status: 403 });
    assert.equal((await call()).status, 502);
    globalThis.fetch = async () => { throw new Error(fakeSecret); };
    assert.equal((await call()).status, 502);
    globalThis.fetch = async () => Response.json({ error: fakeSecret });
    assert.equal((await call()).status, 502);
    delete process.env.SUPABASE_SECRET_KEY;
    assert.equal((await call()).status, 503);
    assert.equal((await call('POST')).status, 405);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SECRET_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
