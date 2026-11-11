// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 어느 규칙에도 맞지 않는 요청은 마지막 기본 응답으로 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required']);

// step_up_required 기준. shortcut: 계약에 사용자별 평소 시각·네트워크 이력이 없어 고정값을 씀, 엔진이 이력을 계약으로 주면 교체.
const OFF_HOUR_END = 6; // 00~05시를 평소와 다른 시각으로 봅니다.
const BURST_WINDOW_SECONDS = 300;
const BURST_COUNT = 10;
const MAX_STEP_UP_AGE_SECONDS = 900;

const SIGNAL_KEYS = 'hour,network,region,source';
const EVENT_KEYS = 'ageSeconds,count,kind';
const hasKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === keys;
const validEvent = event => hasKeys(event, EVENT_KEYS) && typeof event.kind === 'string' && event.kind !== ''
  && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0
  && Number.isInteger(event.count) && event.count >= 0;

// 입력 검사: 계약의 signals·recentEvents만 읽습니다. 헤더·geo 등 계약 밖 값은 보지 않습니다.
// 지역·네트워크·시각은 엔진의 가상 신호(judge_fixture)일 때만 읽고, 실제 위치 증거로 쓰지 않습니다.
// 값이 없거나 출처가 none·불명확하면 null(모름)로 두며 정상값으로 채우지 않습니다.
export function readAccessSignals(request) {
  const signals = request?.signals;
  const source = hasKeys(signals, SIGNAL_KEYS) && ['judge_fixture', 'none'].includes(signals.source)
    ? signals.source : 'unknown';
  const virtual = source === 'judge_fixture';
  const label = value => (virtual && typeof value === 'string' && value !== '' && value !== 'unknown' ? value : null);
  const events = request?.recentEvents;
  return {
    source,
    region: label(signals?.region),
    network: label(signals?.network),
    hour: virtual && Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23 ? signals.hour : null,
    recentEvents: Array.isArray(events) && events.length <= 12 && events.every(validEvent) ? events : null,
  };
}

export async function decide(request) {
  // device_registered: 엔진이 확인한 값이 정확히 true가 아니면(false·누락 포함) 거부합니다.
  if (request.deviceRegistered !== true) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }
  // step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 최근 대량 요청이 모두 확인될 때만 추가 확인합니다.
  // 지역은 조건에 넣지 않습니다. 차단 대신 재확인을 요청하고 상태를 저장하지 않으므로 영구 차단이 없습니다.
  // 값이 모름(null)이면 이 규칙의 근거가 없으므로 발동하지 않습니다.
  const signals = readAccessSignals(request);
  const unusualAccess = signals.hour !== null && signals.hour < OFF_HOUR_END
    && signals.network === 'unusual'
    && signals.recentEvents !== null
    && signals.recentEvents.filter(event => event.ageSeconds <= BURST_WINDOW_SECONDS)
      .reduce((sum, event) => sum + event.count, 0) >= BURST_COUNT;
  const stepUp = request.stepUp;
  const stepUpVerified = hasKeys(stepUp, 'authAgeSeconds,verified') && stepUp.verified === true
    && Number.isFinite(stepUp.authAgeSeconds)
    && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= MAX_STEP_UP_AGE_SECONDS;
  if (unusualAccess && !stepUpVerified) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'step_up',
      reasonCode: 'step_up_required',
      ruleIds: ['step_up_required'],
    };
  }
  // 등록 기기라도 로그인한 주체의 자료실 읽기(GET)만 허용합니다. 재확인을 거친 허용은 두 규칙을 함께 남깁니다.
  if (typeof request.subjectId === 'string' && request.subjectId !== ''
      && request.service === 'notes' && request.method === 'GET') {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'allow',
      reasonCode: 'approved',
      ruleIds: unusualAccess ? ['device_registered', 'step_up_required'] : ['device_registered'],
    };
  }
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'deny',
    reasonCode: 'starter_not_ready',
    ruleIds: [RULE_IDS[0]],
  };
}
