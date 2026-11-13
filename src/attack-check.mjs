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
    // 보낸 요청의 observed에는 받은 HTTP 상태만 적습니다. 요청 ID·시각·본문 요약은 실행마다 달라 심판이 다시 보낸 요청 기록과 맞지 않습니다.
    const attempts = [{ attackId: 'anonymous_note_read', expected: '공개 data.json에 메모가 없어야 함',
      observed: `HTTP ${response.status}` }];
    // /api 점검은 보내지 않고 not_run으로 둡니다. 심판 격리 실행 기록에 /api 요청이 남지 않아 보낸 상태를 대조할 수 없고, 복원은 POST입니다.
    for (const [step, attackId] of [[3, 'anonymous_api_read'], [3, 'invalid_token_read'], [8, 'anonymous_notice_read'],
      [10, 'anonymous_note_restore'], [12, 'anonymous_ops_read']]) {
      if (config.step >= step) attempts.push({ attackId, expected: '토큰이 없거나 잘못되면 자료 없이 HTTP 401', observed: 'not_run' });
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
        observed: '미실행: 자기 점검은 로그인 요청을 보내지 않음(A 로그인 요청은 아직 없음, B 브라우저 실측은 README 12단계 표)' });
    }
    if (config.step >= 9) {
      attempts.push({ attackId: 'burst_read_revocation',
        expected: '같은 가명 사용자의 10분 안 GET 121건 이상은 propose_revocation·burst_read, 정상 조회는 observe로 기기 유지',
        observed: '미실행: 운영 반 엔진의 사건 전달·접속 회수 경로가 연결되지 않음(로컬 npm run detect:test만 통과)' });
    }
    if (config.step >= 10) {
      attempts.push({ attackId: 'backup_note_restore',
        expected: '시험 계정 B의 사본 메모 한 건만 ID·소유자·내용 해시를 대조해 되살리고, 남의 사본·사본에 없는 ID는 404, 사본 해시 불일치는 409',
        observed: '미실행: 자기 점검은 로그인 요청을 보내지 않음(사본 SQL은 실행해 B 사본 1건이 현재 메모와 같음, 사본 메모 복원 요청은 아직 보내지 않음)' });
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
        observed: '미실행: 자기 점검은 로그인 요청을 보내지 않음(승인하지 않은 다른 브라우저의 요청은 아직 보내지 않음)' });
      attempts.push({ attackId: 'approved_device_vault',
        expected: 'SQL Editor에서 확인 코드로 승인한 기기에서만 기존 자료실(본인 메모 추가·수정·삭제)이 열림',
        observed: '미실행: 자기 점검은 로그인 요청을 보내지 않음(B 기기를 SQL Editor로 승인한 뒤의 자료실 요청은 README 12단계 표)' });
    }
    if (config.step >= 12) {
      attempts.push({ attackId: 'ops_record_match',
        expected: '승인 기기의 작전실 화면 줄이 Vercel Runtime Logs의 같은 id aleph.ops 줄과 글자 그대로 같고 메모 본문이 없음',
        observed: '미실행: 자기 점검은 로그인 요청을 보내지 않음(작전실 화면 줄과 Runtime Logs 같은 id 줄의 대조는 아직 하지 않음)' });
      attempts.push({ attackId: 'stage_matrix_live',
        expected: '작전실 실측 표에서 1~11단계 정상 9건 허용·금지 10건 거부가 실제 응답으로 남고 보내지 않은 8건은 미실행',
        observed: '미실행: 자기 점검은 로그인 요청을 보내지 않음(B가 배포된 작전실에서 실측한 표는 README 12단계)' });
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
