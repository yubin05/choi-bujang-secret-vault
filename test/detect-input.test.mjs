import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, readDetectionEvent, readDetectionEvents } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1);
const reads = (count, sub = 'learner_fixture', stepMs = 2000) => Array.from({ length: count }, (_, i) => ({
  at: new Date(START + i * stepMs).toISOString(), method: 'GET', identity: { sub } }));
const burst = sub => ({ action: 'propose_revocation', reasonCode: 'burst_read', subject: sub });

test('burst_read는 10분 미만 구간의 같은 사용자 GET 121건부터 의심합니다', () => {
  assert.deepEqual(detect(reads(121).reverse()), burst('learner_fixture'));
  // 121번째 사건이 첫 사건과 정확히 10분 차이면 다른 구간이라 최대 120건입니다.
  assert.deepEqual(detect(reads(121, 'learner_fixture', 5000)), { action: 'observe' });
  assert.deepEqual(detect(reads(121).map(e => ({ ...e, method: 'POST' }))), { action: 'observe' });
  assert.deepEqual(detect([...reads(100, 'quiet_fixture'), ...reads(121, 'burst_fixture')]), burst('burst_fixture'));
});

test('탐지 입력은 at·method·identity.sub 세 값만 읽습니다', () => {
  const [base] = reads(1);
  const read = readDetectionEvent({ ...base, body: '가상 메모 본문', token: 'fake-token',
    identity: { sub: 'learner_fixture', name: '가상 실명' }, network: 'unusual', device: 'dev-x', geo: 'KR' });
  assert.deepEqual(read, { at: START, method: 'GET', sub: 'learner_fixture' });
  assert.doesNotMatch(JSON.stringify(read), /본문|fake-token|실명|unusual|dev-x|KR/);
});

test('세 값 중 하나라도 없거나 형식이 틀리면 모름(null)으로 둡니다', () => {
  const [ok] = reads(1);
  for (const bad of [null, {}, { ...ok, at: 'not-a-date' }, { ...ok, at: 0 }, { ...ok, method: '' },
    { ...ok, identity: {} }, { ...ok, identity: { sub: 7 } }]) assert.equal(readDetectionEvent(bad), null);
  assert.throws(() => detect('not-array'), /invalid_detection_events/);
});

test('정상 30건과 폭주 200건을 세 값만으로 읽습니다', () => {
  assert.equal(readDetectionEvents(reads(30)).length, 30);
  const burst = readDetectionEvents(reads(200));
  assert.equal(burst.length, 200);
  assert.ok(burst.every(e => Object.keys(e).join() === 'at,method,sub'));
});
