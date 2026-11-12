import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RULE_IDS } from './decider.mjs';

// 12단계 탈환 작전실 요약입니다. 상태와 숫자·짧은 버전만 돌려주며 메모 제목·본문, 사용자 ID, 기기 해시, 확인 코드는 넣지 않습니다.
// confirmed: 이 요청에서 서버가 배포 파일·DB를 실제로 읽은 값 / not_run: 연결·실행하지 않음 / unavailable: 읽기 실패.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const row = (key, state, value = null, detail = '') => ({ key, state, value, detail });

async function select({ base, secret }, table, params) {
  const url = new URL(`/rest/v1/${table}`, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const upstream = await fetch(url, {
    headers: { apikey: secret, Accept: 'application/json' },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!upstream.ok) throw new Error();
  const rows = await upstream.json();
  if (!Array.isArray(rows)) throw new Error();
  return rows;
}

// 회수 상태: 이 계정의 기기 승인 표 행 수만 셉니다. 승인 회수(행 삭제·approved_at 비우기)는 SQL Editor에서 하며, 여기서는 바꾸지 않습니다.
async function deviceRows(auth) {
  const owner = auth.identity.userId;
  try {
    const rows = (await select(auth, 'aleph_defense_devices', { select: 'owner_id,approved_at', owner_id: `eq.${owner}` }))
      .filter(item => item?.owner_id === owner);
    const approved = rows.filter(item => item.approved_at).length;
    return [
      row('revocation.approved_devices', 'confirmed', approved, '기기 승인 표에서 이 계정의 승인된 기기 수'),
      row('revocation.pending_devices', 'confirmed', rows.length - approved, '승인 대기(또는 승인을 거둔) 기기 수'),
    ];
  } catch {
    return ['approved_devices', 'pending_devices']
      .map(name => row(`revocation.${name}`, 'unavailable', null, '기기 승인 표를 읽지 못했습니다'));
  }
}

// 복구 버전: 배포에 들어 있는 검증 사본 목록(backup/policy/manifest.json)을 읽어 버전과 지문을 냅니다.
function policyRows() {
  try {
    const text = readFileSync(new URL('../backup/policy/manifest.json', import.meta.url), 'utf8');
    const manifest = JSON.parse(text);
    if (!Number.isSafeInteger(manifest.step) || !/^[0-9a-f]{40}$/u.test(manifest.sourceCommit)) throw new Error();
    return [
      row('restore.policy_version', 'confirmed', `step${manifest.step}@${manifest.sourceCommit.slice(0, 7)}`, '배포된 서버 함수가 읽은 검증 정책 사본의 단계·커밋'),
      row('restore.policy_fingerprint', 'confirmed', sha256(text).slice(0, 12), '사본 지문(manifest SHA-256 앞 12자리)'),
    ];
  } catch {
    return ['policy_version', 'policy_fingerprint']
      .map(name => row(`restore.${name}`, 'unavailable', null, '검증 정책 사본 목록을 읽지 못했습니다'));
  }
}

// 메모 복구: 내 사본 수와, 현재 메모 내용의 SHA-256이 사본과 같은 수만 셉니다. 본문은 서버 안에서 해시로만 씁니다.
async function backupRows(auth) {
  const owner = auth.identity.userId;
  try {
    const copies = (await select(auth, 'aleph_defense_notes_backup', { select: 'id,owner_id,content_sha256', owner_id: `eq.${owner}` }))
      .filter(item => item?.owner_id === owner);
    if (copies.some(item => typeof item.id !== 'string' || !UUID.test(item.id))) throw new Error();
    let matching = 0;
    if (copies.length) {
      const current = (await select(auth, 'aleph_defense_notes', {
        select: 'id,owner_id,content', owner_id: `eq.${owner}`, id: `in.(${copies.map(item => item.id).join(',')})`,
      })).filter(item => item?.owner_id === owner && typeof item.content === 'string');
      const hashes = new Map(current.map(item => [item.id, sha256(item.content)]));
      matching = copies.filter(item => hashes.get(item.id) === item.content_sha256).length;
    }
    return [
      row('restore.note_copies', 'confirmed', copies.length, '비공개 사본 표에 있는 내 메모 사본 수'),
      row('restore.note_matching', 'confirmed', matching, '현재 메모 내용 해시가 사본과 같은 수'),
    ];
  } catch {
    return ['note_copies', 'note_matching']
      .map(name => row(`restore.${name}`, 'unavailable', null, '사본 표 또는 메모 표를 읽지 못했습니다'));
  }
}

// 서버 기록 한 줄입니다. 화면(public/ops.js)도 같은 형식으로 줄을 만들어 이 기록과 대조합니다.
export function opsRecord(id, rows) {
  const totals = ['confirmed', 'not_run', 'unavailable'].map(state => `${state}=${rows.filter(item => item.state === state).length}`);
  return ['aleph.ops', `id=${id}`, ...totals, ...rows.map(item => `${item.key}=${item.state}:${item.value ?? '-'}`)].join(' ');
}

export async function opsReport(auth) {
  const rows = [
    row('rules.loaded', 'confirmed', RULE_IDS.length, `배포된 판정기 규칙: ${RULE_IDS.join(', ')}`),
    row('rules.verdicts', 'not_run', null, '운영 엔진의 실제 판정 결과를 이 서버가 받지 않습니다. npm run decider:test는 가상 요청 연습입니다'),
    row('detection.events', 'not_run', null, '운영 반 엔진의 사건 전달이 연결되지 않아 받은 사건이 없습니다. npm run detect:test는 가상 사건 연습입니다'),
    ...await deviceRows(auth),
    row('revocation.executed', 'not_run', null, 'burst_read 회수 제안을 집행하는 경로가 연결되지 않았습니다'),
    ...policyRows(),
    row('restore.policy_applied', 'not_run', null, '운영 정책 복원은 실행하지 않았습니다. 로컬 시험 정책(npm run policy:restore)만 되돌렸습니다'),
    ...await backupRows(auth),
  ];
  const id = randomUUID();
  console.info(opsRecord(id, rows));
  return { schema: 'aleph.ops.v1', id, rows };
}
