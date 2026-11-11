// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
      const probes = [['/api/notes', false, 'anonymous_api_read'], ['/api/notes', true, 'invalid_token_read']];
      if (config.step >= 8) probes.push(['/api/notices', false, 'anonymous_notice_read']);
      for (const [path, invalid, attackId] of probes) {
        const result = await fetch(new URL(path, app), {
          redirect: 'error', signal: AbortSignal.timeout(10000),
          ...(invalid ? { headers: { Authorization: 'Bearer invalid' } } : {}),
        });
        let rejected = false;
        try {
          const body = await result.json();
          rejected = result.status === 401 && body.error === 'UNAUTHORIZED'
            && Object.keys(body).length === 1;
        } catch { /* 자료 없는 JSON 거부 응답만 성공으로 기록합니다. */ }
        attempts.push({ attackId,
          expected: '토큰이 없거나 잘못되면 자료 없이 HTTP 401',
          observed: `HTTP ${result.status}; 자료 없는 거부 ${rejected ? '확인' : '미확인'}` });
      }
    }
    if (config.step >= 6) {
      attempts.push({ attackId: 'unregistered_device_read',
        expected: '미등록 기기 요청은 deny·device_not_registered로 거부',
        observed: '미실행: 미등록 기기 접속 시험은 심판이 수행' });
    }
    if (config.step >= 7) {
      attempts.push({ attackId: 'unusual_access_before_relogin',
        expected: '복합 이상 접속은 다시 로그인 전 step_up·step_up_required로 자료 없이 보류, 새 로그인 뒤 새 요청만 허용',
        observed: '미실행: 엔진의 같은 주체 다시 로그인 시각 확인 계약이 준비되지 않아 실제 자료 차단을 시험하지 않음' });
    }
    if (config.step >= 8) {
      attempts.push({ attackId: 'cross_zone_direct_api',
        expected: '메뉴를 우회한 직접 API 요청에서 남의 메모·공지 쓰기는 거부하고 본인 메모 읽기는 유지',
        observed: '미실행: 실제 A/B 로그인 요청은 보내지 않음(로컬 모의 시험만 통과)' });
    }
    if (config.step >= 9) {
      attempts.push({ attackId: 'burst_read_revocation',
        expected: '같은 가명 사용자의 10분 안 GET 121건 이상은 propose_revocation·burst_read, 정상 조회는 observe로 기기 유지',
        observed: '미실행: 운영 반 엔진의 사건 전달·접속 회수 경로가 연결되지 않음(로컬 npm run detect:test만 통과)' });
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
