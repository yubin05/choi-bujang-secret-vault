import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import handler from '../api/notes.js';
import { opsReport } from '../src/ops.mjs';
import { RULE_IDS } from '../src/decider.mjs';

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const aId = '11111111-1111-4111-8111-111111111111';
const bId = '55555555-5555-4555-8555-555555555555';
const kept = '77777777-7777-4777-8777-000000000001';
const changed = '77777777-7777-4777-8777-000000000002';
const SECRET_BODY = 'B 가상 본문 표시하면 안 됨';
const auth = { identity: { kind: 'student', userId: bId }, base: new URL('https://ops-test.supabase.co'), secret: 'sb_secret_ops-test' };

// 가짜 DB입니다. 서버가 소유자 조건을 빠뜨려도 걸리도록 A의 행도 섞어 돌려줍니다.
const fakeDb = (fail = false) => async url => {
  const { pathname, searchParams } = new URL(url);
  if (fail) return new Response('{}', { status: 404 });
  assert.equal(searchParams.get('owner_id'), `eq.${bId}`);
  if (pathname === '/rest/v1/aleph_defense_devices') {
    assert.equal(searchParams.get('select'), 'owner_id,approved_at');
    return Response.json([{ owner_id: bId, approved_at: '2026-11-12T00:00:00Z' }, { owner_id: bId, approved_at: null },
      { owner_id: aId, approved_at: '2026-11-12T00:00:00Z' }]);
  }
  if (pathname === '/rest/v1/aleph_defense_notes_backup') {
    assert.doesNotMatch(searchParams.get('select'), /content,|title/u);
    return Response.json([{ id: kept, owner_id: bId, content_sha256: sha256(SECRET_BODY) },
      { id: changed, owner_id: bId, content_sha256: sha256('사본 시점 본문') }, { id: kept, owner_id: aId, content_sha256: 'x' }]);
  }
  if (pathname === '/rest/v1/aleph_defense_notes') {
    assert.equal(searchParams.get('id'), `in.(${kept},${changed})`);
    return Response.json([{ id: kept, owner_id: bId, content: SECRET_BODY }, { id: changed, owner_id: bId, content: '바뀐 본문' }]);
  }
  throw new Error(`예상하지 못한 요청 ${pathname}`);
};

const capture = async (fn, fetcher) => {
  const original = { fetch: globalThis.fetch, info: console.info };
  const logs = [];
  globalThis.fetch = fetcher;
  console.info = line => logs.push(line);
  try { return { result: await fn(), logs }; } finally { globalThis.fetch = original.fetch; console.info = original.info; }
};

const runScreen = async (responses, route = async () => Response.json({ user: null })) => {
  const code = await readFile(new URL('../public/ops.js', import.meta.url), 'utf8');
  const node = () => ({ textContent: '', disabled: false, dataset: {}, children: [], handlers: {},
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    addEventListener(name, fn) { this.handlers[name] = fn; } });
  const nodes = Object.fromEntries(['ops-status', 'ops-record', 'ops-board', 'ops-reload',
    'matrix-run', 'matrix-status', 'matrix-body', 'matrix-text'].map(id => [id, node()]));
  const calls = [];
  runInNewContext(code, {
    document: { querySelector: selector => nodes[selector.slice(1)], createElement: node },
    fetch: async (path, options) => {
      calls.push(`${options.method ?? 'GET'} ${path}`);
      if (path !== '/api/ops') return route(path, options);
      assert.equal(options.credentials, 'same-origin');
      return responses.shift();
    },
  });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  const text = item => [item.textContent, ...item.children.map(text)].join('\n');
  return { nodes, calls, screen: text(nodes['ops-board']) };
};

test('작전실 요약은 실제로 읽은 값만 confirmed로 두고, 가린 서버 기록 줄과 화면 줄이 글자 그대로 같다', async () => {
  const { result: report, logs } = await capture(() => opsReport(auth), fakeDb());
  const values = Object.fromEntries(report.rows.map(row => [row.key, [row.state, row.value]]));
  assert.deepEqual(values['rules.loaded'], ['confirmed', RULE_IDS.length]);
  assert.deepEqual(values['detection.events'], ['not_run', null]);
  assert.deepEqual(values['revocation.approved_devices'], ['confirmed', 1]);
  assert.deepEqual(values['revocation.pending_devices'], ['confirmed', 1]);
  assert.deepEqual(values['restore.policy_version'], ['confirmed', 'step9@46578ea']);
  assert.deepEqual(values['restore.policy_fingerprint'], ['confirmed', 'cf54e7d58f88']);
  assert.deepEqual(values['restore.note_copies'], ['confirmed', 2]);
  assert.deepEqual(values['restore.note_matching'], ['confirmed', 1]);
  for (const key of ['rules.verdicts', 'revocation.executed', 'restore.policy_applied']) assert.deepEqual(values[key], ['not_run', null]);

  // 서버 기록은 한 줄이며 사용자 ID·본문·비밀 키가 없습니다.
  assert.equal(logs.length, 1);
  const [log] = logs;
  assert.match(log, new RegExp(`^aleph\\.ops id=${report.id} confirmed=7 not_run=4 unavailable=0 rules\\.loaded=confirmed:6 `, 'u'));
  for (const hidden of [bId, aId, SECRET_BODY, auth.secret, kept]) {
    assert.ok(!log.includes(hidden));
    assert.ok(!JSON.stringify(report).includes(hidden));
  }

  // 화면은 같은 응답으로 같은 줄을 만들고, 상태별 개수도 서버 기록과 같습니다. 본문은 화면에 없습니다.
  const { nodes, screen } = await runScreen([Response.json(report)]);
  assert.equal(nodes['ops-record'].textContent, log);
  assert.equal(nodes['ops-status'].textContent, 'API 응답 확인 7 · 미실행 4 · 확인 못 함 0');
  for (const title of ['판정기 규칙', '탐지 사건', '회수 상태', '복구 버전']) assert.match(screen, new RegExp(title, 'u'));
  for (const row of report.rows) assert.ok(screen.includes(`${row.key}=${row.state}:${row.value ?? '-'}`));
  assert.ok(!screen.includes(SECRET_BODY));
});

test('DB를 읽지 못하면 확인 못 함으로 두고 confirmed나 0으로 꾸미지 않는다', async () => {
  const { result: report, logs } = await capture(() => opsReport(auth), fakeDb(true));
  const failed = report.rows.filter(row => row.state === 'unavailable').map(row => [row.key, row.value]);
  assert.deepEqual(failed, [['revocation.approved_devices', null], ['revocation.pending_devices', null],
    ['restore.note_copies', null], ['restore.note_matching', null]]);
  assert.match(logs[0], / confirmed=3 not_run=4 unavailable=4 /u);
});

test('작전실 경로는 GET만 받고 로그인·기기 확인을 메모 API와 같이 거친다', async () => {
  const routing = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  assert.ok(routing.rewrites.some(route => route.source === '/api/ops' && route.destination === '/api/notes?ops=1'));
  const call = async method => {
    const result = { headers: {} };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await handler({ method, query: { ops: '1' }, headers: {} }, {
        setHeader: (key, value) => { result.headers[key] = value; },
        status: code => { result.status = code; return { json: body => { result.body = body; }, end: () => {} }; },
      });
    } finally { console.warn = originalWarn; }
    return result;
  };
  assert.deepEqual((await call('GET')).body, { error: 'UNAUTHORIZED' });
  const post = await call('POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
});

test('화면은 만료 시 세션을 한 번만 갱신하고, 미승인·형식 오류 응답은 수치 없이 안내만 한다', async () => {
  const expired = await runScreen([new Response('{}', { status: 401 }), new Response('{}', { status: 403 })]);
  assert.deepEqual(expired.calls, ['GET /api/ops', 'POST /api/auth/session', 'GET /api/ops']);
  assert.equal(expired.nodes['ops-status'].textContent, '서버가 승인한 기기에서만 작전실을 열 수 있습니다.');
  assert.equal(expired.nodes['ops-record'].textContent, '');
  const forged = await runScreen([Response.json({ schema: 'aleph.ops.v1', id: 'x', rows: [{ key: 'rules.loaded', state: 'passed', value: 6, detail: '' }] })]);
  assert.equal(forged.nodes['ops-status'].textContent, '요약 형식이 맞지 않아 표시하지 않습니다.');
  assert.equal(forged.screen, '');
});

// 가짜 배포 서버입니다. 응답마다 Date·x-vercel-id 헤더를 붙여 표의 요청 ID·확인 시각이 응답에서 왔는지 봅니다.
const fakeApp = ({ broken = false } = {}) => {
  const NEW = '99999999-9999-4999-8999-000000000001';
  const MISSING = '00000000-0000-4000-8000-000000000000';
  const state = { serial: 0, deleted: [], anonymous: [] };
  const reply = (body, status = 200) => {
    const headers = { date: 'Thu, 12 Nov 2026 05:00:00 GMT', 'x-vercel-id': `icn1::test-${++state.serial}` };
    return body === null ? new Response(null, { status, headers }) : typeof body === 'string'
      ? new Response(body, { status, headers }) : Response.json(body, { status, headers });
  };
  const route = async (path, options) => {
    const method = options.method ?? 'GET';
    const anonymous = options.credentials === 'omit';
    if (anonymous) state.anonymous.push(`${method} ${path}`);
    const note = { id: NEW, title: '가상 제목 표시 금지', body: SECRET_BODY };
    if (path === '/') return reply('<!doctype html>');
    if (path === '/data.json') { if (broken) throw new TypeError('network'); return reply({ error: 'gone' }, 404); }
    if (anonymous && path.startsWith('/api/notes')) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (path === '/api/notes') return method === 'POST' ? (broken ? reply({ error: 'NOTES_UNAVAILABLE' }, 502) : reply({ id: NEW }, 201)) : reply([note]);
    if (path === `/api/notes/${NEW}`) {
      if (method === 'DELETE') { state.deleted.push(NEW); return reply(null, 204); }
      if (method === 'PUT' && 'owner_id' in JSON.parse(options.body)) return reply({ error: 'INVALID_NOTE' }, 400);
      return reply(note);
    }
    if (path.startsWith(`/api/notes/${MISSING}`)) return reply({ error: 'NOTE_NOT_FOUND' }, 404);
    if (path === '/api/notices') return method === 'POST' && !broken ? reply({ error: 'METHOD_NOT_ALLOWED' }, 405) : reply([{ id: 'n1' }]);
    if (path === '/api/auth/session' || path === '/api/auth/device') {
      return reply(anonymous ? { user: null } : { user: { id: bId }, deviceApproval: 'approved' });
    }
    throw new Error(`예상하지 못한 요청 ${method} ${path}`);
  };
  return { route, state, NEW };
};

const runMatrix = async options => {
  const app = fakeApp(options);
  const screen = await runScreen([new Response('{}', { status: 403 })], app.route);
  await screen.nodes['matrix-run'].handlers.click();
  for (let i = 0; i < 500 && !screen.nodes['matrix-status'].textContent.includes('/'); i++) await new Promise(resolve => setImmediate(resolve));
  const rows = screen.nodes['matrix-body'].children.map(tr => tr.children.map(td => td.textContent));
  return { ...screen, app, rows, text: screen.nodes['matrix-text'].textContent, status: screen.nodes['matrix-status'].textContent };
};

test('1~11단계 실측 표는 보낸 요청만 응답의 요청 ID·시각과 함께 적고, 보내지 않은 요청은 미실행으로 둔다', async () => {
  const { rows, text, status, app } = await runMatrix();
  assert.equal(rows.length, 27);
  assert.deepEqual(rows.map(row => Number(row[0])), [...rows.map(row => Number(row[0]))].sort((a, b) => a - b));
  const skipped = rows.filter(row => row[5] === '미실행');
  assert.equal(skipped.length, 8);
  for (const row of skipped) assert.deepEqual([row[4].startsWith('미실행:'), row[6], row[7]], [true, '-', '-']);
  const measured = rows.filter(row => row[5] !== '미실행');
  assert.equal(measured.length, 19);
  for (const row of measured) {
    assert.equal(row[5], '기대와 일치', row.join(' | '));
    assert.match(row[6], /^icn1::test-\d+$/u);
    assert.equal(row[7], '2026-11-12T05:00:00.000Z');
  }
  assert.equal(new Set(measured.map(row => row[6])).size, 19);
  // 금지 요청과 정상 요청이 모두 실측으로 남습니다.
  assert.equal(status.split('. ')[0], '정상 요청: 기대와 일치 9 · 기대와 다름 0 · 측정 실패 0 · 미실행 4 / 금지 요청: 기대와 일치 10 · 기대와 다름 0 · 측정 실패 0 · 미실행 4');
  assert.match(status, /운영 41종 시험은 이 표에 없고 미실행/u);
  assert.ok(!/통과/u.test(text + status));
  // 비로그인 요청은 쿠키를 빼고 보내며, 실측용 메모는 마지막에 지웁니다.
  assert.ok(app.state.anonymous.includes('GET /api/notes') && app.state.anonymous.includes('POST /api/auth/device'));
  assert.deepEqual(app.state.deleted, [app.NEW]);
  assert.equal(text.split('\n').length, 29);
  for (const hidden of [SECRET_BODY, '가상 제목 표시 금지', bId]) assert.ok(!text.includes(hidden) && !rows.flat().join().includes(hidden));
});

test('금지 요청이 허용되면 기대와 다름, 응답이 없으면 측정 실패이며 앞 요청 실패 뒤의 요청은 보내지 않는다', async () => {
  const { rows, status, app } = await runMatrix({ broken: true });
  const find = request => rows.find(row => row[2] === request);
  assert.equal(find('POST /api/notices 공지 쓰기')[5], '기대와 다름');
  assert.equal(find('POST /api/notices 공지 쓰기')[4], 'HTTP 200 · 배열 1건');
  assert.deepEqual(find('GET /data.json 비로그인').slice(5, 7), ['측정 실패', '-']);
  assert.equal(find('POST /api/notes 실측용 가상 메모 추가')[5], '기대와 다름');
  for (const request of ['PUT /api/notes/:id 실측용 메모 수정', 'GET /api/notes/:id 내 메모', 'DELETE /api/notes/:id 실측용 메모 삭제']) {
    assert.deepEqual(find(request).slice(4, 7), ['미실행: 앞 요청(메모 추가)이 실패해 보내지 않음', '미실행', '-']);
  }
  assert.deepEqual(app.state.deleted, []);
  assert.match(status, /금지 요청: 기대와 일치 7 · 기대와 다름 1 · 측정 실패 1 · 미실행 5/u);
});
