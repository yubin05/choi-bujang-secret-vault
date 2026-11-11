// 9단계 탐지 함수입니다. 사건마다 docs/DETECT_EVENTS.md 계약의 at·method·identity.sub 세 값만 읽습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.

// 사건 하나에서 세 값만 꺼냅니다. 본문·토큰·이름·네트워크·기기·지역 등 다른 칸은 복사하지 않습니다.
// 하나라도 없거나 형식이 틀리면 null(모름)로 두고 값을 채워 넣지 않습니다.
export function readDetectionEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const { at, method, identity } = event;
  const time = typeof at === 'string' ? Date.parse(at) : NaN;
  const sub = identity && typeof identity === 'object' ? identity.sub : undefined;
  if (!Number.isFinite(time) || typeof method !== 'string' || !method
    || typeof sub !== 'string' || !sub) return null;
  return { at: time, method, sub };
}

export function readDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  return events.map(readDetectionEvent).filter(Boolean);
}

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120; // 이 수를 넘을 때만 의심합니다. 정확히 120건은 정상입니다.

// 규칙 burst_read: 같은 sub의 GET이 어느 10분 구간(첫 사건부터 10분 미만)에서든 120건을 넘으면 회수를 제안합니다.
// 창 계산은 at 시각만 쓰며, 다른 사용자의 사건은 합치지 않습니다.
export function detect(events) {
  const timesBySub = new Map();
  for (const { at, method, sub } of readDetectionEvents(events)) {
    if (method !== 'GET') continue;
    if (!timesBySub.has(sub)) timesBySub.set(sub, []);
    timesBySub.get(sub).push(at);
  }
  for (const [sub, times] of timesBySub) {
    times.sort((a, b) => a - b);
    for (let start = 0, end = 0; end < times.length; end++) {
      while (times[end] - times[start] >= BURST_WINDOW_MS) start++;
      if (end - start + 1 > BURST_LIMIT) {
        return { action: 'propose_revocation', reasonCode: 'burst_read', subject: sub };
      }
    }
  }
  return { action: 'observe' };
}
