import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAttackChecks } from '../src/attack-check.mjs';

test('2단계 빌드는 원본과 이전 정적 파일의 메모를 공개하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'defense-step2-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'public'));
    for (const file of ['build-public.mjs', 'deployment-identity.mjs']) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(root, 'scripts', file));
    }
    const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url)));
    assert.equal(config.step, 2);
    await writeFile(join(root, 'aleph.config.json'), JSON.stringify(config));
    const privateData = JSON.stringify({ notes: [{ title: 'test', content: 'PRIVATE_SENTINEL' }] });
    await writeFile(join(root, 'data.json'), privateData);
    await writeFile(join(root, 'public', 'data.json'), privateData);
    execFileSync(process.execPath, [join(root, 'scripts', 'build-public.mjs'), '--local']);
    await assert.rejects(readFile(join(root, 'public', 'data.json')), { code: 'ENOENT' });
    execFileSync(process.execPath, [join(root, 'scripts', 'build-public.mjs')], {
      env: { ...process.env, VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'test-owner',
        VERCEL_GIT_REPO_SLUG: 'test-repo', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
        VERCEL_URL: 'test-deployment.vercel.app' },
    });
    const identity = JSON.parse(await readFile(join(root, 'public', 'aleph.json')));
    assert.equal(identity.step, 2);
    assert.equal(identity.repoUrl, 'https://github.com/test-owner/test-repo');
    assert.deepEqual(JSON.parse(await readFile(new URL('../data.json', import.meta.url))).notes, []);
    await assert.rejects(readFile(new URL('../public/data.json', import.meta.url)), { code: 'ENOENT' });
    for (const step of [3, 12]) {
      await writeFile(join(root, 'aleph.config.json'), JSON.stringify({ ...config, step }));
      execFileSync(process.execPath, [join(root, 'scripts', 'build-public.mjs')], {
        env: { ...process.env, VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'test-owner',
          VERCEL_GIT_REPO_SLUG: 'test-repo', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
          VERCEL_URL: 'test-deployment.vercel.app' },
      });
      assert.equal(JSON.parse(await readFile(join(root, 'public', 'aleph.json'))).step, step);
      await assert.rejects(readFile(join(root, 'public', 'data.json')), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('2단계 자기 점검은 404와 빈 목록을 통과시키며 오류 응답을 거부한다', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const config = { step: 2, sampleMarker: 'SAMPLE_NOTE_1', publicAppUrl: 'https://example.vercel.app' };
    for (const [body, status, passes] of [['{"notes":[]}', 200, true], ['{"notes":[{}]}', 200, false],
      ['<html/>', 200, false], ['<html/>', 404, true], ['error', 500, false]]) {
      globalThis.fetch = async () => new Response(body, { status });
      const [result] = await runAttackChecks(config);
      assert.equal(result.observed.endsWith('제거 확인'), passes);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
