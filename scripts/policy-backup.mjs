// 10단계: 침해 전에 검증한 안전 정책 사본을 만들고, 시험 정책과의 차이만 보여 줍니다.
// 운영 정책(src/decider.mjs, aleph.config.json, sql/)은 읽기만 하고 고치지 않습니다.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkDecider } from './decider-test.mjs';
import { fixtureRequests } from './fixture-7.mjs';

export const SNAPSHOT_DIR = 'backup/policy';
export const DRILL_DIR = 'artifacts/policy-drill';
export const AUDIT_LOG = 'artifacts/policy-audit.jsonl';
const MANIFEST = 'manifest.json';
// 사본 이름 → 운영 원본. allowedRoutes는 단계 번호 변경과 섞이지 않게 그 칸만 떼어 한 줄에 경로 하나로 저장합니다.
export const SOURCES = Object.freeze({
  'decider.mjs': 'src/decider.mjs',
  'allowedRoutes.json': 'aleph.config.json#allowedRoutes',
  'step5-revoke-direct-access.sql': 'sql/step5-revoke-direct-access.sql',
});
// 침공 흉내: 시험 사본의 반 공지 구역에 쓰기 경로를 끼워 넣어 규칙 한 줄을 바꿉니다.
const DRILL_FILE = 'decider.mjs';
const DRILL_FROM = "routes: ['GET /notices'] }";
const DRILL_TO = "routes: ['GET /notices', 'POST /notices'] }";

const sha256 = data => createHash('sha256').update(data).digest('hex');
const versionOf = ({ step, sourceCommit, fingerprint }) => ({ step, sourceCommit, fingerprint });

// 감사 기록은 덧붙이기만 합니다. 시험 사본을 다시 만들거나 복원해도 지우지 않습니다.
function appendAudit(root, record) {
  mkdirSync(join(root, dirname(AUDIT_LOG)), { recursive: true });
  appendFileSync(join(root, AUDIT_LOG), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

function readSource(root, source) {
  const [path, key] = source.split('#');
  const text = readFileSync(join(root, path), 'utf8');
  if (!key) return text;
  const value = JSON.parse(text)[key];
  if (!Array.isArray(value) || !value.every(route => typeof route === 'string')) {
    throw new Error(`${source}가 문자열 배열이 아닙니다.`);
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createSnapshot(root, sourceCommit) {
  const dir = join(root, SNAPSHOT_DIR);
  if (existsSync(dir)) throw new Error(`${SNAPSHOT_DIR}가 이미 있습니다. 검증한 사본은 덮어쓰지 않습니다.`);
  // 원본을 모두 읽은 뒤에 쓰므로 원본 하나가 없으면 반쪽 사본이 남지 않습니다.
  const contents = Object.entries(SOURCES).map(([name, source]) => [name, source, readSource(root, source)]);
  const { step } = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, source, text] of contents) {
    writeFileSync(join(dir, name), text);
    files[name] = { source, sha256: sha256(text) };
  }
  const manifest = { schema: 'aleph.policy-backup.v1', step, sourceCommit, createdAt: new Date().toISOString(), files };
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return verifySnapshot(root);
}

// 사본이 없거나, 목록이 세 원본과 다르거나, 해시가 하나라도 다르면 예외로 중단합니다.
// shortcut: manifest를 함께 고친 위조는 여기서 못 잡음. 저장점 README에 적은 사본 지문과 대조하고, 필요하면 별도 보관소로 옮길 것.
export function verifySnapshot(root) {
  const dir = join(root, SNAPSHOT_DIR);
  const manifestPath = join(dir, MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`검증한 사본이 없습니다: ${SNAPSHOT_DIR}/${MANIFEST}`);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  for (const [name, source] of Object.entries(SOURCES)) {
    const entry = manifest.files?.[name];
    if (entry?.source !== source) throw new Error(`사본 목록에 ${name}(${source})가 없거나 원본 경로가 다릅니다.`);
    const path = join(dir, name);
    if (!existsSync(path)) throw new Error(`사본 파일이 없습니다: ${SNAPSHOT_DIR}/${name}`);
    if (sha256(readFileSync(path)) !== entry.sha256) throw new Error(`해시가 맞지 않습니다: ${SNAPSHOT_DIR}/${name}`);
  }
  return { ...manifest, fingerprint: sha256(manifestText) };
}

export function createDrill(root) {
  const manifest = verifySnapshot(root);
  const original = readFileSync(join(root, SNAPSHOT_DIR, DRILL_FILE), 'utf8');
  if (original.split(DRILL_FROM).length !== 2) throw new Error(`시험으로 바꿀 줄을 사본에서 정확히 한 번 찾지 못했습니다: ${DRILL_FROM}`);
  const dir = join(root, DRILL_DIR);
  rmSync(dir, { recursive: true, force: true }); // 시험 사본은 매번 검증한 사본에서 새로 만듭니다.
  mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(SOURCES)) cpSync(join(root, SNAPSHOT_DIR, name), join(dir, name));
  writeFileSync(join(dir, DRILL_FILE), original.replace(DRILL_FROM, DRILL_TO));
  appendAudit(root, { action: 'drill', ...versionOf(manifest), file: DRILL_FILE });
  return manifest;
}

const lineRange = (start, count) => (count === 0 ? `${start}줄 뒤에 추가` : count === 1 ? `${start}줄` : `${start}~${start + count - 1}줄`);

// 검증한 사본(복원할 버전)과 시험 정책을 비교합니다. 아무 파일도 바꾸지 않습니다.
function comparePolicy(root) {
  const manifest = verifySnapshot(root);
  if (!existsSync(join(root, DRILL_DIR))) throw new Error(`시험 사본이 없습니다: ${DRILL_DIR}. 먼저 npm run policy:drill`);
  const files = Object.keys(SOURCES).map(name => {
    const from = `${SNAPSHOT_DIR}/${name}`;
    const to = `${DRILL_DIR}/${name}`;
    if (!existsSync(join(root, to))) return { name, state: '시험 정책에 없음', sha256: null };
    // autocrlf를 끄지 않으면 .gitattributes(-text)인 사본 쪽만 변환이 빠져, 같은 파일이 전부 다르게 보입니다.
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', '--no-ext-diff', '-U0', '--', from, to],
      { cwd: root, encoding: 'utf8' });
    if (result.status === 0) return { name, state: '같음' };
    if (result.status !== 1) throw new Error(`git diff 실패: ${result.stderr || result.error?.message}`);
    const ranges = [...result.stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)]
      .map(([, start, count]) => lineRange(Number(start), count === undefined ? 1 : Number(count)));
    return {
      name,
      state: `다름 (${ranges.length}곳: 사본 ${ranges.join(', ')})`,
      ranges,
      sha256: sha256(readFileSync(join(root, to))),
      // 파일 머리줄을 빼고 @@부터만 보여 줍니다. SQL 주석(--)이 머리줄로 오인되지 않게 위치로 자릅니다.
      hunk: result.stdout.slice(result.stdout.indexOf('@@')).trimEnd(),
    };
  });
  const changed = files.filter(file => file.state !== '같음');
  // 확인 코드: 사본 지문과 바뀐 시험 파일의 해시를 묶습니다. 미리보기 뒤 무엇이든 바뀌면 코드가 달라져 실행을 막습니다.
  const code = sha256([manifest.fingerprint, ...changed.map(file => `${file.name}:${file.sha256}`)].join('\n')).slice(0, 12);
  return { manifest, files, changed, code };
}

function report({ manifest, files }) {
  const out = [
    '복원할 버전(검증한 사본)',
    `  ${manifest.step}단계 · 커밋 ${manifest.sourceCommit} · 만든 시각 ${manifest.createdAt}`,
    `  사본 지문(manifest SHA-256) ${manifest.fingerprint}`,
    `변경 범위(검증한 사본 ${SNAPSHOT_DIR} → 시험 정책 ${DRILL_DIR})`,
    ...files.map(file => `  ${file.name}: ${file.state}`),
  ];
  const hunks = files.filter(file => file.hunk).flatMap(file => [`--- ${file.name}`, file.hunk]);
  if (hunks.length) out.push('', '차이(- 검증한 사본, + 시험 정책)', ...hunks);
  return out;
}

const OPERATION_NOTE = '운영 정책(src/decider.mjs, aleph.config.json, sql/)은 바꾸지 않았습니다.';

export function diffPolicy(root) {
  return [...report(comparePolicy(root)), '', `미리보기만 했습니다. ${OPERATION_NOTE}`].join('\n');
}

// 복원 뒤 1~9단계 판정기 연습(npm run decider:test)에 더해 확인할 요청입니다.
// B가 A의 메모 한 건을 고르는 요청은 판정기가 아니라 메모 API의 소유자 검사가 404로 막습니다.
const restoreChecks = () => {
  const { normal } = fixtureRequests();
  const ask = changes => ({ ...normal, requestId: randomUUID(), ...changes });
  const b = { subjectId: 'learner_fixture_b' };
  return [
    { name: 'A 반 공지 읽기', request: ask({ service: 'notices', path: '/notices', route: 'GET /notices' }), decision: 'allow' },
    { name: 'B 반 공지 쓰기(시험에서 열린 규칙)', request: ask({ ...b, service: 'notices', method: 'POST', path: '/notices',
      route: 'POST /notices' }), decision: 'deny', reasonCode: 'route_not_allowed' },
    { name: 'B 메모 전체 목록', request: ask({ ...b, path: '/notes', route: 'GET /notes' }),
      decision: 'deny', reasonCode: 'route_not_allowed' },
  ];
};

export function previewRestore(root) {
  const plan = comparePolicy(root);
  if (!plan.changed.length) return '복원할 항목이 없습니다. 시험 정책이 검증한 사본과 같습니다.';
  const same = plan.files.filter(file => file.state === '같음').map(file => file.name);
  return [
    ...report(plan),
    '',
    `바뀔 파일: ${plan.changed.map(file => `${DRILL_DIR}/${file.name}`).join(', ')} → 위 - 줄(검증한 사본)로 되돌립니다.`,
    `보존: 같은 파일(${same.join(', ') || '없음'}), 바뀐 파일의 표시되지 않은 줄, 감사 기록 ${AUDIT_LOG}, 운영 정책`,
    `복원 뒤 확인: npm run decider:test 4건 + ${restoreChecks().map(item => item.name).join(', ')}`,
    '',
    `실행하려면: npm run policy:restore -- --confirm ${plan.code}`,
    '아직 아무것도 바꾸지 않았습니다.',
  ].join('\n');
}

export async function applyRestore(root, code) {
  const plan = comparePolicy(root);
  if (code !== plan.code) {
    throw new Error('확인 코드가 미리보기와 다릅니다. 그 사이 사본이나 시험 정책이 바뀌었을 수 있으니 npm run policy:restore로 다시 확인하세요.');
  }
  for (const file of plan.changed) cpSync(join(root, SNAPSHOT_DIR, file.name), join(root, DRILL_DIR, file.name));
  // 되돌린 파일이 사본 해시와 같을 때만 판정기 사본을 실행합니다. 바뀐 정책 코드는 실행하지 않습니다.
  for (const name of Object.keys(SOURCES)) {
    if (sha256(readFileSync(join(root, DRILL_DIR, name))) !== plan.manifest.files[name].sha256) {
      throw new Error(`복원 뒤 해시가 맞지 않습니다: ${DRILL_DIR}/${name}`);
    }
  }
  const deciderPath = join(root, DRILL_DIR, 'decider.mjs');
  const { decide, RULE_IDS } = await import(`${pathToFileURL(deciderPath).href}?sha=${plan.manifest.files['decider.mjs'].sha256}`);
  const checks = await checkDecider({ decide, ruleIds: RULE_IDS, extraChecks: restoreChecks() });
  appendAudit(root, {
    action: 'restore',
    ...versionOf(plan.manifest),
    files: plan.changed.map(file => ({ name: file.name, ranges: file.ranges ?? null, beforeSha256: file.sha256,
      afterSha256: plan.manifest.files[file.name].sha256 })),
    checks,
  });
  return checks;
}

const git = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args[0]} 실패: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    const command = process.argv[2];
    if (command === 'snapshot') {
      // 커밋된 상태만 사본으로 삼습니다. sql/은 Git 제외라 이 검사 대상이 아닙니다.
      if (git(root, ['status', '--porcelain', '--', 'src/decider.mjs', 'aleph.config.json'])) {
        throw new Error('src/decider.mjs 또는 aleph.config.json에 커밋하지 않은 변경이 있습니다.');
      }
      const manifest = createSnapshot(root, git(root, ['rev-parse', 'HEAD']));
      console.log(`검증한 사본을 만들었습니다: ${SNAPSHOT_DIR} (${manifest.step}단계 · 커밋 ${manifest.sourceCommit})`);
      for (const [name, { sha256: hash }] of Object.entries(manifest.files)) console.log(`  ${name} ${hash}`);
      console.log(`사본 지문(manifest SHA-256) ${manifest.fingerprint}`);
    } else if (command === 'drill') {
      createDrill(root);
      console.log(`시험 사본을 만들고 ${DRILL_FILE}의 한 줄을 바꿨습니다: ${DRILL_DIR}`);
      console.log(`  ${DRILL_FROM}  →  ${DRILL_TO}`);
    } else if (command === 'diff') {
      console.log(diffPolicy(root));
    } else if (command === 'restore' && process.argv[3] === undefined) {
      console.log(previewRestore(root));
    } else if (command === 'restore' && process.argv[3] === '--confirm' && process.argv[4]) {
      const checks = await applyRestore(root, process.argv[4]);
      console.log(`검증한 사본으로 시험 정책을 되돌렸습니다: ${DRILL_DIR}`);
      for (const item of checks) console.log(`${item.passed ? '통과' : '확인 필요'} · ${item.name}`);
      console.log(`감사 기록에 덧붙였습니다: ${AUDIT_LOG}`);
      console.log(`가상 요청 연습이며 심판 판정이 아닙니다. ${OPERATION_NOTE}`);
      if (checks.some(item => !item.passed)) process.exitCode = 1;
    } else {
      throw new Error('사용법: node scripts/policy-backup.mjs snapshot|drill|diff|restore [--confirm 코드]');
    }
  } catch (error) {
    console.error(`중단: ${error.message}`);
    process.exitCode = 1;
  }
}
