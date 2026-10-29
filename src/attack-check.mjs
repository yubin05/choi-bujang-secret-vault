// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (config.step >= 2) {
    let empty = response.status === 404 || response.status === 410;
    try {
      const data = await response.json();
      empty ||= response.ok && Array.isArray(data.notes) && data.notes.length === 0;
    } catch {
      // HTML이나 오류 응답을 성공으로 기록하지 않습니다.
    }
    const attempts = [{ attackId: 'anonymous_note_read', expected: '공개 data.json에 메모가 없어야 함',
      observed: `HTTP ${response.status}; 공개 메모 제거 ${empty ? '확인' : '미확인'}` }];
    if (config.step >= 3) {
      for (const invalid of [false, true]) {
        const result = await fetch(new URL('/api/notes', app), {
          redirect: 'error', signal: AbortSignal.timeout(10000),
          ...(invalid ? { headers: { Authorization: 'Bearer invalid' } } : {}),
        });
        let rejected = false;
        try {
          const body = await result.json();
          rejected = result.status === 401 && body.error === 'UNAUTHORIZED'
            && Object.keys(body).length === 1;
        } catch { /* 자료 없는 JSON 거부 응답만 성공으로 기록합니다. */ }
        attempts.push({ attackId: invalid ? 'invalid_token_read' : 'anonymous_api_read',
          expected: '토큰이 없거나 잘못되면 자료 없이 HTTP 401',
          observed: `HTTP ${result.status}; 자료 없는 거부 ${rejected ? '확인' : '미확인'}` });
      }
    }
    return attempts;
  }
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
