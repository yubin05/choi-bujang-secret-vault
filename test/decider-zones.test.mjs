import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const ask = async (fields, base = fixtureRequests().normal) => {
  const { decision, reasonCode, ruleIds } = await decide({ ...base, requestId: randomUUID(), ...fields });
  return { decision, reasonCode, ruleIds };
};
const at = (method, path, route) => ({ method, path, route });
const allowed = ruleId => ({ decision: 'allow', reasonCode: 'approved', ruleIds: ['device_registered', ruleId] });
const denied = ruleId => ({ decision: 'deny', reasonCode: 'route_not_allowed', ruleIds: [ruleId] });
const STARTER_DENY = { decision: 'deny', reasonCode: 'starter_not_ready', ruleIds: ['starter.deny'] };
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];

test('메모는 ID 하나를 고르는 읽기만 허용하고 ID 형식은 좁히지 않습니다', async () => {
  // export도 기능이 아니라 :id 자리의 값으로만 봅니다. UUID 검사는 자료 API가 합니다.
  for (const id of ['demo', '22222222-2222-4222-8222-000000000001', 'export']) {
    assert.deepEqual(await ask({ service: 'notes', ...at('GET', `/notes/${id}`, 'GET /notes/:id') }),
      allowed('zone_notes'));
  }
  for (const request of [
    at('GET', '/notes', 'GET /notes'), // ID 없는 전체 목록
    at('POST', '/notes', 'POST /notes'),
    ...WRITES.map(method => at(method, '/notes/demo', `${method} /notes/:id`)),
    at('GET', '/notes/demo/export', 'GET /notes/:id/export'),
    // route 이름만 허용 경로로 바꾼 경우: 실제 경로 깊이·메서드가 다르면 거부합니다.
    at('GET', '/notes', 'GET /notes/:id'),
    at('GET', '/notes/', 'GET /notes/:id'),
    at('GET', '/notes/demo/export', 'GET /notes/:id'),
    at('GET', '/notices/demo', 'GET /notes/:id'),
    at('DELETE', '/notes/demo', 'GET /notes/:id'),
    at('GET', undefined, 'GET /notes/:id'),
  ]) assert.deepEqual(await ask({ service: 'notes', ...request }), denied('zone_notes'));
});

test('반 공지는 읽기만 허용하고 쓰기는 재확인을 거쳐도 누구에게나 거부합니다', async () => {
  assert.deepEqual(await ask({ service: 'notices', ...at('GET', '/notices', 'GET /notices') }),
    allowed('zone_notices'));
  const verified = { stepUp: { verified: true, authAgeSeconds: 60 } };
  for (const method of WRITES) {
    for (const request of [at(method, '/notices', `${method} /notices`),
      at(method, '/notices/n1', `${method} /notices/:id`)]) {
      assert.deepEqual(await ask({ service: 'notices', ...request, ...verified }), denied('zone_notices'));
    }
  }
  assert.deepEqual(await ask({ service: 'notices', ...at('GET', '/notices/n1', 'GET /notices/:id') }),
    denied('zone_notices'));
});

test('강사 자료와 알 수 없는 서비스는 추가 확인 없이 거부합니다', async () => {
  for (const method of ['GET', ...WRITES]) {
    assert.deepEqual(await ask({ service: 'materials', ...at(method, '/materials', `${method} /materials`) }),
      denied('zone_instructor_materials'));
  }
  for (const service of ['admin', 'constructor', '__proto__', undefined]) {
    assert.deepEqual(await ask({ service }), STARTER_DENY);
  }
  // 복합 이상 접속이어도 언제나 거부할 요청에는 step_up 대신 바로 거부합니다.
  const { suspicious } = fixtureRequests();
  assert.deepEqual(await ask({ service: 'admin' }, suspicious), STARTER_DENY);
  assert.deepEqual(await ask({ ...at('GET', '/notes', 'GET /notes') }, suspicious), denied('zone_notes'));
  // 허용 경로라도 주체가 없으면 기존 기본 거부, 미등록 기기는 기존 기기 규칙이 먼저입니다.
  assert.deepEqual(await ask({ subjectId: '' }), STARTER_DENY);
  assert.deepEqual(await ask({ service: 'materials', deviceRegistered: false }),
    { decision: 'deny', reasonCode: 'device_not_registered', ruleIds: ['device_registered'] });
});

test('allowedRoutes에는 판정기가 허용하는 경로만 메서드와 함께 적습니다', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
  assert.deepEqual(config.allowedRoutes, ['GET /api/notes/:id', 'GET /api/notices']);
});
