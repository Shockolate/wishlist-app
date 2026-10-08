#!/usr/bin/env node
// Proves workflow-policy.test.mjs catches each way of breaking the trust model it guards: copies
// the workflows, applies one mutation, and expects the policy to report a violation. Run:
// node scripts/workflow-policy.mutations.test.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

const root = new URL('..', import.meta.url).pathname;
const policy = join(root, 'scripts/workflow-policy.test.mjs');
const PINNED_CACHE = 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830';
const PINNED_DOWNLOAD = 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333';

function find(job, predicate) {
  const step = job.steps.find(predicate);
  if (!step) throw new Error('mutation target not found');
  return step;
}
const runStep = (job, re) => find(job, (s) => re.test(s.run ?? ''));
const usesStep = (job, prefix) => find(job, (s) => String(s.uses).startsWith(prefix));

// [name, file, mutate(parsed file)]
const mutations = [
  [
    'vercel@latest in a deploy job',
    'deploy.yml',
    (wf) => {
      const s = runStep(wf.jobs['deploy-api'], /deploy --prebuilt/);
      s.run = s.run.replace('vercel@"$VERCEL_CLI_VERSION"', 'vercel@latest');
    },
  ],
  [
    'run_install in a database job',
    'deploy.yml',
    (wf) => {
      usesStep(wf.jobs.migrate, 'pnpm/action-setup@').with = { run_install: true };
    },
  ],
  [
    'npm ci in a database job',
    'deploy.yml',
    (wf) => {
      runStep(wf.jobs.migrate, /pnpm install/).run = 'npm ci';
    },
  ],
  [
    'a command chained after the prod install',
    'deploy.yml',
    (wf) => {
      runStep(wf.jobs.migrate, /pnpm install/).run += ' && pnpm turbo run build';
    },
  ],
  [
    'a lowercase secret in a full-install job',
    'deploy.yml',
    (wf) => {
      wf.jobs.build.env.LEAK = '${{ secrets.vercel_token }}';
    },
  ],
  [
    'toJSON(secrets) in a full-install job',
    'deploy.yml',
    (wf) => {
      wf.jobs.build.env.LEAK = '${{ toJSON(secrets) }}';
    },
  ],
  [
    'pnpm i next to a secret',
    'deploy.yml',
    (wf) => {
      wf.jobs.settings.steps.splice(2, 0, { run: 'pnpm i' });
    },
  ],
  [
    'another npx package in a database job',
    'deploy.yml',
    (wf) => {
      runStep(wf.jobs.migrate, /migrate-cli/).run = 'npx --yes other@latest';
    },
  ],
  [
    'a secret job runs downloaded build output (C-1)',
    'preview.yml',
    (wf) => {
      runStep(wf.jobs.provision, /migrate-cli/).run = 'node apps/api/dist/db/migrate-cli.js';
    },
  ],
  [
    'a secret job downloads the migrator (C-1)',
    'preview-seed.yml',
    (wf) => {
      wf.jobs.seed.steps.splice(1, 0, {
        uses: PINNED_DOWNLOAD,
        with: { name: 'migrator', path: 'apps/api/dist' },
      });
    },
  ],
  [
    'the pnpm cache restored into a secret job (C-2)',
    'deploy.yml',
    (wf) => {
      usesStep(wf.jobs.migrate, 'actions/setup-node@').with.cache = 'pnpm';
    },
  ],
  [
    'automatic caching left on in a secret job (C-2)',
    'preview.yml',
    (wf) => {
      delete usesStep(wf.jobs.provision, 'actions/setup-node@').with['package-manager-cache'];
    },
  ],
  [
    'actions/cache in a secret job (C-2)',
    'preview.yml',
    (wf) => {
      wf.jobs.provision.steps.splice(1, 0, {
        uses: PINNED_CACHE,
        with: { path: '~/.pnpm-store', key: 'x' },
      });
    },
  ],
  [
    'the seed wipe ignores a non-root seed (I-2)',
    'preview-seed.yml',
    (wf) => {
      const s = find(wf.jobs.seed, (x) => x.name === 'Wipe and rebuild from zero');
      s.if = "steps.seed.outputs.created == 'true' || inputs.reset";
    },
  ],
  [
    'an unpinned Vercel CLI version',
    'package.json',
    (pkg) => {
      pkg.devDependencies.vercel = '^62.5.0';
    },
  ],
];

function copyRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  cpSync(join(root, '.github/workflows'), join(dir, '.github/workflows'), { recursive: true });
  for (const f of ['renovate.json', 'package.json']) cpSync(join(root, f), join(dir, f));
  return dir;
}

function rewrite(dir, file, mutate) {
  const path = file === 'package.json' ? join(dir, file) : join(dir, '.github/workflows', file);
  const isJson = file.endsWith('.json');
  const doc = isJson ? JSON.parse(readFileSync(path, 'utf8')) : parse(readFileSync(path, 'utf8'));
  mutate?.(doc);
  writeFileSync(path, isJson ? JSON.stringify(doc, null, 2) : stringify(doc));
}

function check(dir) {
  return spawnSync(process.execPath, [policy], {
    env: { ...process.env, POLICY_ROOT: dir },
    encoding: 'utf8',
  });
}

const problems = [];

// Baseline: the real workflows, round-tripped through the YAML serializer, still pass.
const base = copyRoot();
for (const f of ['deploy.yml', 'preview.yml', 'preview-seed.yml']) rewrite(base, f);
const baseline = check(base);
rmSync(base, { recursive: true, force: true });
if (baseline.status !== 0) problems.push(`baseline should pass: ${baseline.stderr.trim()}`);

for (const [name, file, mutate] of mutations) {
  const dir = copyRoot();
  try {
    rewrite(dir, file, mutate);
    const result = check(dir);
    if (result.status === 0) problems.push(`not caught: ${name}`);
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.error(
    `workflow-policy mutations: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`,
  );
  process.exit(1);
}
console.log(`workflow-policy mutations: ok (${mutations.length} caught)`);
