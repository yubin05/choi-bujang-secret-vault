import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import {
  applyRestore, AUDIT_LOG, createDrill, createSnapshot, diffPolicy, DRILL_DIR, previewRestore, SNAPSHOT_DIR, verifySnapshot,
} from '../scripts/policy-backup.mjs';

// 운영 저장소 대신 임시 폴더에 같은 모양의 정책 원본을 둡니다.
function fakeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'policy-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'sql'));
  cpSync(new URL('../src/decider.mjs', import.meta.url), join(root, 'src/decider.mjs'));
  writeFileSync(join(root, 'aleph.config.json'), JSON.stringify({ step: 9, allowedRoutes: ['GET /api/notes/:id', 'GET /api/notices'] }));
  writeFileSync(join(root, 'sql/step5-revoke-direct-access.sql'), '-- 가상 권한 회수\nREVOKE ALL ON TABLE t FROM anon;\n');
  return root;
}

test('시험 정책의 바뀐 한 줄만 보여 주고 운영 정책은 그대로 둡니다', t => {
  const root = fakeRoot(t);
  const live = readFileSync(join(root, 'src/decider.mjs'));
  createSnapshot(root, 'abc1234');
  createDrill(root);
  const report = diffPolicy(root);
  assert.match(report, /9단계 · 커밋 abc1234/);
  assert.match(report, /decider\.mjs: 다름 \(1곳: 사본 13줄\)/);
  assert.match(report, /allowedRoutes\.json: 같음/);
  assert.match(report, /step5-revoke-direct-access\.sql: 같음/);
  const changed = report.split('\n').filter(line => /^[-+]\s/.test(line));
  assert.equal(changed.length, 2);
  assert.match(changed[1], /routes: \['GET \/notices', 'POST \/notices'\]/);
  assert.deepEqual(readFileSync(join(root, 'src/decider.mjs')), live);
});

test('사본이 없거나 시험 사본이 없으면 중단합니다', t => {
  const root = fakeRoot(t);
  assert.throws(() => verifySnapshot(root), /검증한 사본이 없습니다/);
  assert.throws(() => createDrill(root), /검증한 사본이 없습니다/);
  createSnapshot(root, 'abc1234');
  assert.throws(() => diffPolicy(root), /시험 사본이 없습니다/);
  assert.throws(() => createSnapshot(root, 'def5678'), /덮어쓰지 않습니다/);
});

test('사본 파일의 해시가 다르거나 파일이 빠지면 중단합니다', t => {
  const root = fakeRoot(t);
  createSnapshot(root, 'abc1234');
  createDrill(root);
  writeFileSync(join(root, SNAPSHOT_DIR, 'allowedRoutes.json'), '["POST /api/notices"]\n');
  assert.throws(() => diffPolicy(root), /해시가 맞지 않습니다: backup\/policy\/allowedRoutes\.json/);
  assert.throws(() => createDrill(root), /해시가 맞지 않습니다/);
  rmSync(join(root, SNAPSHOT_DIR, 'allowedRoutes.json'));
  assert.throws(() => verifySnapshot(root), /사본 파일이 없습니다/);
});

const auditActions = root => readFileSync(join(root, AUDIT_LOG), 'utf8').trim().split('\n').map(line => JSON.parse(line).action);

test('확인 코드로 시험 정책만 되돌리고, B 공지 쓰기는 다시 거부되며 감사 기록은 남습니다', async t => {
  const root = fakeRoot(t);
  const live = readFileSync(join(root, 'src/decider.mjs'));
  createSnapshot(root, 'abc1234');
  createDrill(root);
  const drillPath = join(root, DRILL_DIR, 'decider.mjs');
  const tampered = readFileSync(drillPath);
  // 침공 상태에서는 B의 공지 쓰기가 열려 있어야 이후의 "다시 거부"가 의미 있습니다.
  const invaded = await import(`${pathToFileURL(drillPath).href}?t=invaded`);
  const bWrite = { ...fixtureRequests().normal, subjectId: 'learner_fixture_b', service: 'notices', method: 'POST',
    path: '/notices', route: 'POST /notices' };
  assert.equal((await invaded.decide(bWrite)).decision, 'allow');

  const preview = previewRestore(root);
  assert.match(preview, /9단계 · 커밋 abc1234/);
  assert.match(preview, /바뀔 파일: artifacts\/policy-drill\/decider\.mjs →/);
  assert.match(preview, /보존: 같은 파일\(allowedRoutes\.json, step5-revoke-direct-access\.sql\)/);
  assert.deepEqual(readFileSync(drillPath), tampered);
  await assert.rejects(applyRestore(root, 'wrong-code'), /확인 코드가 미리보기와 다릅니다/);
  assert.deepEqual(readFileSync(drillPath), tampered);

  const checks = await applyRestore(root, preview.match(/--confirm (\w+)/)[1]);
  assert.equal(checks.length, 7);
  assert.ok(checks.every(item => item.passed), JSON.stringify(checks));
  assert.ok(checks.some(item => item.name === '등록 기기의 정상 요청'));
  assert.ok(checks.some(item => item.name.startsWith('B 반 공지 쓰기')));
  assert.match(diffPolicy(root), /decider\.mjs: 같음/);
  assert.equal(previewRestore(root), '복원할 항목이 없습니다. 시험 정책이 검증한 사본과 같습니다.');
  assert.deepEqual(readFileSync(join(root, 'src/decider.mjs')), live);
  assert.deepEqual(auditActions(root), ['drill', 'restore']);
  createDrill(root);
  assert.deepEqual(auditActions(root), ['drill', 'restore', 'drill']);
});

test('미리보기 뒤 시험 정책이나 사본이 바뀌면 복원하지 않습니다', async t => {
  const root = fakeRoot(t);
  createSnapshot(root, 'abc1234');
  createDrill(root);
  const code = previewRestore(root).match(/--confirm (\w+)/)[1];
  const routesPath = join(root, DRILL_DIR, 'allowedRoutes.json');
  writeFileSync(routesPath, '["POST /api/notices"]\n');
  await assert.rejects(applyRestore(root, code), /확인 코드가 미리보기와 다릅니다/);
  assert.equal(readFileSync(routesPath, 'utf8'), '["POST /api/notices"]\n');
  writeFileSync(join(root, SNAPSHOT_DIR, 'decider.mjs'), 'export const tampered = true;\n');
  await assert.rejects(applyRestore(root, code), /해시가 맞지 않습니다/);
  assert.deepEqual(auditActions(root), ['drill']);
});
