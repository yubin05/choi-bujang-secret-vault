import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, readAccessSignals } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const UNKNOWN = { region: null, network: null, hour: null };
const pick = ({ region, network, hour }) => ({ region, network, hour });

test('엔진의 가상 신호는 judge_fixture 출처로 읽습니다', () => {
  const { suspicious } = fixtureRequests();
  assert.deepEqual(readAccessSignals(suspicious), {
    source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3,
    recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }],
  });
});

test('위조한 클라이언트 헤더는 신뢰하는 접속 정보로 승격되지 않습니다', () => {
  const { normal } = fixtureRequests();
  for (const signals of [
    { source: 'client_header', region: 'local', network: 'usual', hour: 14 },
    { source: 'judge_fixture', region: 'local', network: 'usual', hour: 14, forwardedFor: '203.0.113.7' },
    { source: 'judge_fixture', signals: { region: 'local' } },
    'judge_fixture',
    undefined,
  ]) {
    const result = readAccessSignals({ ...normal, signals,
      headers: { 'x-region': 'local', 'x-network': 'usual' }, geo: { region: 'local' } });
    assert.equal(result.source, 'unknown');
    assert.deepEqual(pick(result), UNKNOWN);
  }
});

test('출처 none이나 빠진 값은 정상값으로 채우지 않습니다', () => {
  const { normal } = fixtureRequests();
  const real = readAccessSignals({ ...normal, signals: { source: 'none', region: 'local', network: 'usual', hour: 14 } });
  assert.equal(real.source, 'none');
  assert.deepEqual(pick(real), UNKNOWN);

  const blank = readAccessSignals({ ...normal,
    signals: { source: 'judge_fixture', region: 'unknown', network: '', hour: 24 } });
  assert.deepEqual(pick(blank), UNKNOWN);

  const { recentEvents, ...noEvents } = normal;
  assert.equal(readAccessSignals(noEvents).recentEvents, null);
  for (const events of [
    [{ kind: 'risk_signal', ageSeconds: -1, count: 1 }],
    [{ kind: 'risk_signal', ageSeconds: 1, count: 1, region: 'local' }],
    Array.from({ length: 13 }, () => ({ kind: 'risk_signal', ageSeconds: 1, count: 1 })),
  ]) {
    assert.equal(readAccessSignals({ ...normal, recentEvents: events }).recentEvents, null);
  }
  assert.deepEqual(readAccessSignals(normal).recentEvents, []);
});

const verdict = async request => {
  const { decision, reasonCode, ruleIds } = await decide(request);
  return { decision, reasonCode, ruleIds };
};
const STEP_UP = { decision: 'step_up', reasonCode: 'step_up_required', ruleIds: ['step_up_required'] };

test('정해진 복합 사건은 추가 확인, 정상 사건은 허용입니다', async () => {
  const { normal, suspicious } = fixtureRequests();
  assert.equal((await decide(normal)).decision, 'allow');
  assert.deepEqual(await verdict(suspicious), STEP_UP);
  assert.deepEqual(await verdict({ ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } }),
    { decision: 'allow', reasonCode: 'approved', ruleIds: ['device_registered', 'zone_notes', 'step_up_required'] });
});

test('조건 하나만 맞거나 지역만 다르면 차단하지 않습니다', async () => {
  const { normal, suspicious } = fixtureRequests();
  const burst = [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }];
  const odd = { source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 };
  for (const request of [
    { ...normal, signals: { ...normal.signals, region: 'foreign' } },
    { ...normal, signals: odd },
    { ...normal, signals: { ...odd, hour: 14 }, recentEvents: burst },
    { ...normal, signals: { ...odd, network: 'usual' }, recentEvents: burst },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 600, count: 20 }] },
    { ...suspicious, signals: { ...odd, source: 'client_header' } },
  ]) assert.equal((await decide(request)).decision, 'allow');
});

test('재확인이 오래됐거나 형식이 틀리면 다시 추가 확인, 미등록 기기는 기존대로 거부합니다', async () => {
  const { suspicious } = fixtureRequests();
  for (const stepUp of [{ verified: true, authAgeSeconds: 901 }, { verified: true, authAgeSeconds: null },
    { verified: 'true', authAgeSeconds: 60 }, { verified: true }]) {
    assert.deepEqual(await verdict({ ...suspicious, stepUp }), STEP_UP);
  }
  assert.deepEqual(await verdict({ ...suspicious, deviceRegistered: false }),
    { decision: 'deny', reasonCode: 'device_not_registered', ruleIds: ['device_registered'] });
});
