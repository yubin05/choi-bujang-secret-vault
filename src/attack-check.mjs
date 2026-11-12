// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
      // 10단계: 로그인 없는 복원 요청. 가상 UUID라 DB 조회 전에 401이어야 합니다.
      // 10단계 비로그인 복원은 POST라 보내지 않습니다. 심판 격리 실행은 공개 HTTPS GET·HEAD만 허용합니다.
      if (config.step >= 10) {
        attempts.push({ attackId: 'anonymous_note_restore',
          expected: '토큰이 없거나 잘못되면 자료 없이 HTTP 401', observed: 'not_run' });
      }
      // 12단계: 로그인 없는 작전실 요약 요청. 수치 없이 401이어야 합니다.
      if (config.step >= 12) probes.push(['/api/ops', false, 'anonymous_ops_read']);
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
    if (config.step >= 10) {
      attempts.push({ attackId: 'backup_note_restore',
        expected: '시험 계정 B의 사본 메모 한 건만 ID·소유자·내용 해시를 대조해 되살리고, 남의 사본·사본에 없는 ID는 404, 사본 해시 불일치는 409',
        observed: '미실행: 비공개 사본 SQL·배포·실제 B 로그인 요청을 아직 하지 않음(로컬 모의 시험만 통과)' });
      attempts.push({ attackId: 'policy_restore_recheck',
        expected: '검증한 정책 사본으로 되돌린 뒤 정상 요청은 allow, 침공 때 열린 B 공지 쓰기는 다시 deny',
        observed: '미실행: 운영 정책에는 적용하지 않음(로컬 시험 정책 npm run policy:restore 7건만 통과)' });
    }
    if (config.step >= 11) {
      // 11단계 비로그인 기기 승인 요청은 POST라 보내지 않습니다. 심판 격리 실행은 공개 HTTPS GET·HEAD만 허용합니다.
      attempts.push({ attackId: 'anonymous_device_approval',
        expected: '로그인 없는 기기 승인 요청은 기기 쿠키·승인 상태 없이 거부', observed: 'not_run' });
      attempts.push({ attackId: 'unapproved_device_read',
        expected: '로그인했어도 승인 전 기기의 메모·공지·복원 요청은 403 DEVICE_NOT_APPROVED로 자료 없이 거부, 승인 요청 버튼이나 앱 설치만으로는 열리지 않음',
        observed: '미실행: 기기 승인 표 SQL·배포·실제 B 로그인 요청을 아직 하지 않음(로컬 모의 시험만 통과)' });
      attempts.push({ attackId: 'approved_device_vault',
        expected: 'SQL Editor에서 확인 코드로 승인한 기기에서만 기존 자료실(본인 메모 추가·수정·삭제)이 열림',
        observed: '미실행: 실제 승인과 승인된 기기의 로그인 확인을 아직 하지 않음(로컬 모의 시험만 통과)' });
    }
    if (config.step >= 12) {
      attempts.push({ attackId: 'ops_record_match',
        expected: '승인 기기의 작전실 화면 줄이 Vercel Runtime Logs의 같은 id aleph.ops 줄과 글자 그대로 같고 메모 본문이 없음',
        observed: '미실행: 이 저장점의 배포·승인 기기 로그인·Runtime Logs 대조를 아직 하지 않음(로컬 모의 시험만 통과)' });
      attempts.push({ attackId: 'stage_matrix_live',
        expected: '작전실 실측 표에서 1~11단계 정상 9건 허용·금지 10건 거부가 실제 응답으로 남고 보내지 않은 8건은 미실행',
        observed: '미실행: 배포된 작전실에서 실측 시작을 아직 누르지 않음(로컬 모의 시험만 통과)' });
      attempts.push({ attackId: 'final_assault_41',
        expected: '총공세 41종 공격은 운영 엔진·심판이 실행해 방어 여부를 판정',
        observed: '미실행: 41종 시험은 심판이 수행하며 학생 자기 점검에서 실행하지 않음' });
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
