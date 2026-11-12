(() => {
  const status = document.querySelector('#ops-status');
  const record = document.querySelector('#ops-record');
  const board = document.querySelector('#ops-board');
  const reload = document.querySelector('#ops-reload');
  const SECTIONS = [['rules', '판정기 규칙'], ['detection', '탐지 사건'], ['revocation', '회수 상태'], ['restore', '복구 버전']];
  const STATES = { confirmed: 'API 응답 확인', not_run: '미실행', unavailable: '확인 못 함' };
  // src/ops.mjs의 opsRecord와 같은 형식입니다. 화면 줄과 Vercel 서버 기록 줄을 글자 그대로 대조합니다.
  const token = row => `${row.key}=${row.state}:${row.value ?? '-'}`;
  const valid = report => report?.schema === 'aleph.ops.v1' && typeof report.id === 'string' && /^[\w-]{1,64}$/u.test(report.id)
    && Array.isArray(report.rows) && report.rows.every(row => /^[a-z]+\.[a-z_]+$/u.test(row?.key)
      && Object.hasOwn(STATES, row.state) && typeof row.detail === 'string'
      && (row.value === null || Number.isSafeInteger(row.value) || (typeof row.value === 'string' && /^[\w@.-]{1,40}$/u.test(row.value))));

  const fetchReport = async (retry = true) => {
    const response = await fetch('/api/ops', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401 && retry) {
      // 접속 토큰이 만료됐을 수 있어 세션을 한 번만 갱신하고 다시 읽습니다.
      await fetch('/api/auth/session', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      return fetchReport(false);
    }
    if (response.status === 401) throw new Error('자료실에서 로그인한 뒤 다시 여세요.');
    if (response.status === 403) throw new Error('서버가 승인한 기기에서만 작전실을 열 수 있습니다.');
    if (!response.ok) throw new Error('서버에서 요약을 읽지 못했습니다. 잠시 후 다시 시도하세요.');
    const report = await response.json();
    if (!valid(report)) throw new Error('요약 형식이 맞지 않아 표시하지 않습니다.');
    return report;
  };

  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const load = async () => {
    reload.disabled = true;
    status.textContent = '서버 기록을 읽는 중…';
    record.textContent = '';
    board.replaceChildren();
    try {
      const report = await fetchReport();
      const count = state => report.rows.filter(row => row.state === state).length;
      status.textContent = Object.entries(STATES).map(([state, label]) => `${label} ${count(state)}`).join(' · ');
      record.textContent = ['aleph.ops', `id=${report.id}`, ...Object.keys(STATES).map(state => `${state}=${count(state)}`),
        ...report.rows.map(token)].join(' ');
      board.replaceChildren(...SECTIONS.map(([prefix, title]) => {
        const section = element('section');
        const list = element('ul');
        list.replaceChildren(...report.rows.filter(row => row.key.startsWith(`${prefix}.`)).map(row => {
          const item = element('li');
          item.dataset.state = row.state;
          item.append(element('strong', `${STATES[row.state]} · ${row.value ?? '값 없음'}`),
            element('span', row.detail), element('code', token(row)));
          return item;
        }));
        section.append(element('h2', title), list);
        return section;
      }));
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '요약을 읽지 못했습니다.';
    } finally {
      reload.disabled = false;
    }
  };

  // 1~11단계 실측 표: 버튼을 누를 때만 실제 요청을 보내고 응답의 상태·오류 코드만 적습니다.
  // 보내지 않은 요청은 미실행으로 두며, 기대와 일치해도 심판 판정이 아닙니다. 메모 제목·본문과 사용자 ID는 표에 넣지 않습니다.
  const matrixRun = document.querySelector('#matrix-run');
  const matrixStatus = document.querySelector('#matrix-status');
  const matrixBody = document.querySelector('#matrix-body');
  const matrixText = document.querySelector('#matrix-text');
  const MISSING = '00000000-0000-4000-8000-000000000000';
  const TEST_NOTE = { title: '작전실 실측용 가상 메모', body: '실측 뒤 바로 지우는 가상 본문입니다.' };
  const browserTime = () => `${new Date().toISOString()} (브라우저 시각)`;

  const measure = async (path, { method = 'GET', anonymous = false, headers = {}, body } = {}) => {
    try {
      const response = await fetch(path, { method, cache: 'no-store', credentials: anonymous ? 'omit' : 'same-origin',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      let data = null;
      try { data = await response.json(); } catch { /* 204·HTML 응답은 상태만 봅니다. */ }
      const date = Date.parse(response.headers.get('date') ?? '');
      // x-vercel-id는 Vercel 응답 ID입니다. 런타임 로그 requestId와 같은 값인지는 문서로 확인되지 않아 시각과 함께 적습니다.
      return { status: response.status, data, requestId: response.headers.get('x-vercel-id') ?? '-',
        at: Number.isFinite(date) ? new Date(date).toISOString() : browserTime() };
    } catch {
      return { failed: true, requestId: '-', at: browserTime() };
    }
  };

  // 응답에서 상태 코드와 짧은 코드 값만 꺼냅니다. 메모 제목·본문, user.id, 확인 코드는 읽어도 적지 않습니다.
  const describe = r => {
    if (r.failed) return '응답 없음(네트워크 오류 또는 브라우저 차단)';
    const data = r.data && typeof r.data === 'object' ? r.data : {};
    return [`HTTP ${r.status}`,
      /^[A-Z_]{1,40}$/u.test(data.error ?? '') && data.error,
      Array.isArray(r.data) && `배열 ${r.data.length}건`,
      'user' in data && `user ${data.user ? '있음' : '없음'}`,
      /^[a-z]{1,20}$/u.test(data.deviceApproval ?? '') && `deviceApproval=${data.deviceApproval}`,
      typeof data.id === 'string' && 'id 받음'].filter(Boolean).join(' · ');
  };

  const plan = ctx => {
    const code = (status, error) => r => r.status === status && r.data?.error === error;
    const withNote = send => () => (ctx.id ? send(`/api/notes/${encodeURIComponent(ctx.id)}`) : null);
    const engine = '미실행: 운영 엔진·판정기 경로라 이 화면에서 보낼 수 없음(심판 수행, npm run decider:test는 가상 연습)';
    const events = '미실행: 운영 반 엔진의 사건 전달이 연결되지 않음(npm run detect:test는 가상 사건 연습)';
    return [
      { stage: 1, kind: '정상', request: 'GET / 첫 화면', expected: 'HTTP 200', send: () => measure('/'), ok: r => r.status === 200 },
      { stage: 1, kind: '금지', request: 'GET /data.json 비로그인', expected: 'HTTP 404·410 (공개 메모 없음)',
        send: () => measure('/data.json', { anonymous: true }), ok: r => [404, 410].includes(r.status) },
      { stage: 2, kind: '정상', request: 'GET /api/notes 로그인', expected: 'HTTP 200 · 배열',
        send: () => measure('/api/notes'), ok: r => r.status === 200 && Array.isArray(r.data) },
      { stage: 2, kind: '금지', request: 'GET /api/notes 비로그인', expected: 'HTTP 401 UNAUTHORIZED',
        send: () => measure('/api/notes', { anonymous: true }), ok: code(401, 'UNAUTHORIZED') },
      { stage: 3, kind: '정상', request: 'POST /api/notes 실측용 가상 메모 추가', expected: 'HTTP 201 · id',
        send: async () => {
          const r = await measure('/api/notes', { method: 'POST', body: TEST_NOTE });
          ctx.id = r.status === 201 && typeof r.data?.id === 'string' ? r.data.id : null;
          return r;
        }, ok: r => r.status === 201 && Boolean(ctx.id) },
      { stage: 3, kind: '정상', request: 'PUT /api/notes/:id 실측용 메모 수정', expected: 'HTTP 200 · 같은 id',
        send: withNote(path => measure(path, { method: 'PUT', body: { ...TEST_NOTE, title: `${TEST_NOTE.title}(수정)` } })),
        ok: r => r.status === 200 && r.data?.id === ctx.id },
      { stage: 3, kind: '금지', request: 'GET /api/notes 잘못된 토큰', expected: 'HTTP 401 UNAUTHORIZED',
        send: () => measure('/api/notes', { anonymous: true, headers: { Authorization: 'Bearer invalid' } }), ok: code(401, 'UNAUTHORIZED') },
      { stage: 4, kind: '정상', request: 'GET /api/notes/:id 내 메모', expected: 'HTTP 200 · 같은 id',
        send: withNote(path => measure(path)), ok: r => r.status === 200 && r.data?.id === ctx.id },
      { stage: 4, kind: '금지', request: 'GET /api/notes/:id 내 것이 아닌 ID', expected: 'HTTP 404 NOTE_NOT_FOUND (남의 메모와 같은 응답)',
        send: () => measure(`/api/notes/${MISSING}`), ok: code(404, 'NOTE_NOT_FOUND') },
      { stage: 4, kind: '금지', request: 'PUT /api/notes/:id 소유자 바꾸기(owner_id)', expected: 'HTTP 400 INVALID_NOTE',
        send: withNote(path => measure(path, { method: 'PUT', body: { ...TEST_NOTE, owner_id: MISSING } })), ok: code(400, 'INVALID_NOTE') },
      { stage: 5, kind: '정상', request: 'POST /api/auth/session 서버 로그인 확인', expected: 'HTTP 200 · user 있음',
        send: () => measure('/api/auth/session', { method: 'POST', body: {} }), ok: r => r.status === 200 && Boolean(r.data?.user) },
      { stage: 5, kind: '금지', request: 'POST /api/auth/session 쿠키 없이', expected: 'HTTP 200 · user 없음',
        send: () => measure('/api/auth/session', { method: 'POST', anonymous: true, body: {} }), ok: r => r.status === 200 && r.data?.user === null },
      { stage: 6, kind: '정상', request: '등록 기기의 엔진 경유 요청', expected: 'allow', skip: engine },
      { stage: 6, kind: '금지', request: '미등록 기기의 엔진 경유 요청', expected: 'deny · device_not_registered', skip: engine },
      { stage: 7, kind: '정상', request: '다시 로그인한 뒤 새 요청', expected: 'allow', skip: engine },
      { stage: 7, kind: '금지', request: '복합 이상 접속', expected: 'step_up · step_up_required', skip: engine },
      { stage: 8, kind: '정상', request: 'GET /api/notices 공지 읽기', expected: 'HTTP 200 · 배열',
        send: () => measure('/api/notices'), ok: r => r.status === 200 && Array.isArray(r.data) },
      { stage: 8, kind: '금지', request: 'POST /api/notices 공지 쓰기', expected: 'HTTP 405 METHOD_NOT_ALLOWED',
        send: () => measure('/api/notices', { method: 'POST', body: TEST_NOTE }), ok: code(405, 'METHOD_NOT_ALLOWED') },
      { stage: 9, kind: '정상', request: '평소 조회 사건', expected: 'observe', skip: events },
      { stage: 9, kind: '금지', request: '10분 안 GET 121건', expected: 'propose_revocation · burst_read', skip: events },
      { stage: 10, kind: '정상', request: 'POST /api/notes/:id/restore 사본 메모 복원', expected: 'HTTP 200 · ownerMatches',
        skip: '미실행: 사본으로 현재 메모를 덮어써 자동 실측하지 않음(README 10단계 절차 2로 직접 실행)' },
      { stage: 10, kind: '금지', request: 'POST /api/notes/:id/restore 사본에 없는 ID', expected: 'HTTP 404 NOTE_NOT_FOUND',
        send: () => measure(`/api/notes/${MISSING}/restore`, { method: 'POST' }), ok: code(404, 'NOTE_NOT_FOUND') },
      { stage: 10, kind: '금지', request: 'POST /api/notes/:id/restore 비로그인', expected: 'HTTP 401 UNAUTHORIZED',
        send: () => measure(`/api/notes/${MISSING}/restore`, { method: 'POST', anonymous: true }), ok: code(401, 'UNAUTHORIZED') },
      { stage: 11, kind: '정상', request: 'POST /api/auth/session 이 기기 승인 상태', expected: 'HTTP 200 · deviceApproval=approved',
        send: () => measure('/api/auth/session', { method: 'POST', body: {} }), ok: r => r.status === 200 && r.data?.deviceApproval === 'approved' },
      { stage: 11, kind: '금지', request: 'POST /api/auth/device 비로그인 승인 요청', expected: 'HTTP 200 · user 없음 · 승인 상태 없음',
        send: () => measure('/api/auth/device', { method: 'POST', anonymous: true, body: {} }),
        ok: r => r.status === 200 && r.data?.user === null && r.data?.deviceApproval === undefined },
      { stage: 11, kind: '금지', request: '승인 전 기기의 자료 요청', expected: 'HTTP 403 DEVICE_NOT_APPROVED',
        skip: '미실행: 이 브라우저는 승인된 기기라 보낼 수 없음(승인하지 않은 다른 브라우저에서 확인)' },
      // 실측용 메모는 마지막에 지웁니다. 앞 요청이 실패해도 id가 있으면 지웁니다.
      { stage: 3, kind: '정상', request: 'DELETE /api/notes/:id 실측용 메모 삭제', expected: 'HTTP 204',
        send: withNote(path => measure(path, { method: 'DELETE' })), ok: r => r.status === 204 },
    ];
  };

  const cell = text => String(text).replaceAll('|', '\\|');
  const runMatrix = async () => {
    matrixRun.disabled = true;
    matrixStatus.textContent = '요청을 보내는 중…';
    matrixBody.replaceChildren();
    matrixText.textContent = '';
    const ctx = { id: null };
    const rows = [];
    try {
      for (const step of plan(ctx)) {
        const r = step.skip ? null : await step.send();
        const result = !r ? '미실행' : r.failed ? '측정 실패' : step.ok(r) ? '기대와 일치' : '기대와 다름';
        rows.push({ ...step, result, observed: r ? describe(r) : (step.skip ?? '미실행: 앞 요청(메모 추가)이 실패해 보내지 않음'),
          requestId: r?.requestId ?? '-', at: r?.at ?? '-' });
      }
      rows.sort((a, b) => a.stage - b.stage);
      const columns = ['stage', 'kind', 'request', 'expected', 'observed', 'result', 'requestId', 'at'];
      matrixBody.replaceChildren(...rows.map(row => {
        const tr = element('tr');
        tr.append(...columns.map(key => element('td', row[key])));
        return tr;
      }));
      matrixText.textContent = ['| 단계 | 구분 | 요청 | 기대 결과 | 실제 API 결과 | 대조 | Vercel 응답 ID | 확인 시각 |',
        '|---|---|---|---|---|---|---|---|', ...rows.map(row => `| ${columns.map(key => cell(row[key])).join(' | ')} |`)].join('\n');
      const tally = kind => ['기대와 일치', '기대와 다름', '측정 실패', '미실행']
        .map(result => `${result} ${rows.filter(row => row.kind === kind && row.result === result).length}`).join(' · ');
      const leftover = ctx.id && rows.find(row => row.request.startsWith('DELETE')).result !== '기대와 일치';
      matrixStatus.textContent = `정상 요청: ${tally('정상')} / 금지 요청: ${tally('금지')}. `
        + '이 표의 일치는 심판 판정이 아니며, 운영 41종 시험은 이 표에 없고 미실행입니다.'
        + (leftover ? ' 실측용 가상 메모가 지워지지 않았을 수 있으니 자료실에서 확인하세요.' : '');
    } finally {
      matrixRun.disabled = false;
    }
  };

  reload.addEventListener('click', () => { void load(); });
  matrixRun.addEventListener('click', () => { void runMatrix(); });
  void load();
})();
