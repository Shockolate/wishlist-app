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
const PINNED_UPLOAD = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9';
const VERCEL_BIN = 'tools/vercel-cli/node_modules/.bin/vercel';

function find(job, predicate) {
  const step = job.steps.find(predicate);
  if (!step) throw new Error('mutation target not found');
  return step;
}
const runStep = (job, re) => find(job, (s) => re.test(s.run ?? ''));
function automergeRule(renovate) {
  const rule = renovate.packageRules.find((r) => r.automerge === true);
  if (!rule) throw new Error('mutation target not found');
  return rule;
}
const usesStep = (job, prefix) => find(job, (s) => String(s.uses).startsWith(prefix));

// [name, file, mutate(parsed file)]
const mutations = [
  [
    'the Vercel CLI fetched through npx in a deploy job (D85)',
    'deploy.yml',
    (wf) => {
      const s = runStep(wf.jobs['deploy-api'], /deploy --prebuilt/);
      s.run = s.run.replace(VERCEL_BIN, 'npx --yes vercel@64.7.0');
    },
  ],
  [
    'the Vercel CLI installed with its install scripts (D85)',
    'preview.yml',
    (wf) => {
      const s = runStep(wf.jobs['deploy-web'], /--filter @wishlist\/vercel-cli/);
      s.run = s.run.replace(' --ignore-scripts', '');
    },
  ],
  [
    'the Vercel CLI run before it is installed (D85)',
    'deploy.yml',
    (wf) => {
      const steps = wf.jobs.settings.steps;
      const at = steps.findIndex((s) => /--filter @wishlist\/vercel-cli/.test(s.run ?? ''));
      if (at === -1) throw new Error('mutation target not found');
      steps.push(...steps.splice(at, 1));
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
    'a top-level automerge (D88)',
    'renovate.json',
    (r) => {
      r.automerge = true;
    },
  ],
  [
    'automerge on a major (D88)',
    'renovate.json',
    (r) => {
      automergeRule(r).matchUpdateTypes.push('major');
    },
  ],
  [
    'automerge widened to runtime dependencies (D88)',
    'renovate.json',
    (r) => {
      automergeRule(r).matchDepTypes = ['devDependencies', 'dependencies'];
    },
  ],
  [
    'automerge for next (D88)',
    'renovate.json',
    (r) => {
      automergeRule(r).matchPackageNames.push('next');
    },
  ],
  [
    'automerge for GitHub Actions (D88)',
    'renovate.json',
    (r) => {
      automergeRule(r).matchManagers = ['github-actions'];
    },
  ],
  [
    'automerge for @types/node (D88)',
    'renovate.json',
    (r) => {
      const names = automergeRule(r).matchPackageNames;
      names.splice(names.indexOf('!@types/node'), 1);
    },
  ],
  [
    'a catch-all automerge pattern (D88)',
    'renovate.json',
    (r) => {
      automergeRule(r).matchPackageNames.push('**');
    },
  ],
  [
    'an unpinned Vercel CLI version',
    'tools/vercel-cli/package.json',
    (pkg) => {
      pkg.devDependencies.vercel = '^64.7.0';
    },
  ],
  [
    'the Vercel CLI as a production dependency, inside the prod audit gate (D85)',
    'tools/vercel-cli/package.json',
    (pkg) => {
      pkg.dependencies = { vercel: pkg.devDependencies.vercel };
      delete pkg.devDependencies;
    },
  ],
  [
    'the Vercel CLI back in the root package.json',
    'package.json',
    (pkg) => {
      pkg.devDependencies.vercel = '64.7.0';
    },
  ],
  [
    'the backup holds the owner database URL (D48)',
    'backup.yml',
    (wf) => {
      runStep(wf.jobs.backup, /scripts\/backup\.sh/).env.DATABASE_URL_BACKUP =
        '${{ secrets.DATABASE_URL_DIRECT }}';
    },
  ],
  [
    'the backup uploads its dump as an artifact',
    'backup.yml',
    (wf) => {
      wf.jobs.backup.steps.push({
        uses: PINNED_UPLOAD,
        with: { name: 'dump', path: '${{ runner.temp }}' },
      });
    },
  ],
  [
    'age extracted without its checksum',
    'backup.yml',
    (wf) => {
      const s = runStep(wf.jobs.backup, /FiloSottile\/age\/releases/);
      s.run = s.run
        .split('\n')
        .filter((l) => !l.includes('sha256sum'))
        .join('\n');
    },
  ],
  [
    'the backup runs from a branch other than main',
    'backup.yml',
    (wf) => {
      delete wf.jobs.backup.if;
    },
  ],
  [
    'a preview build inlines the web DSN (D50)',
    'preview.yml',
    (wf) => {
      const job = wf.jobs['build-web'];
      job.env = { ...(job.env ?? {}), SENTRY_DSN_WEB: '${{ vars.SENTRY_DSN_WEB }}' };
    },
  ],
  [
    'a preview workflow inlines the web DSN at workflow level (D50)',
    'preview.yml',
    (wf) => {
      wf.env = { ...(wf.env ?? {}), SENTRY_DSN_WEB: '${{ vars.SENTRY_DSN_WEB }}' };
    },
  ],
  [
    'the sourcemaps job holds the Vercel token',
    'deploy.yml',
    (wf) => {
      const s = runStep(wf.jobs.sourcemaps, /sourcemaps upload/);
      s.env.VERCEL_TOKEN = '${{ secrets.VERCEL_TOKEN }}';
    },
  ],
  [
    'sentry-cli used before its checksum check',
    'deploy.yml',
    (wf) => {
      wf.jobs.sourcemaps.steps = wf.jobs.sourcemaps.steps.filter(
        (s) => !/install-sentry-cli/.test(s.run ?? ''),
      );
    },
  ],
  [
    "the build job's sentry-cli install can fail the release",
    'deploy.yml',
    (wf) => {
      delete runStep(wf.jobs.build, /install-sentry-cli/)['continue-on-error'];
    },
  ],
  [
    'a release waits on the source-map upload',
    'deploy.yml',
    (wf) => {
      wf.jobs['deploy-web'].needs = [wf.jobs['deploy-web'].needs, 'sourcemaps'].flat();
    },
  ],
  [
    'the sourcemaps job skips the main-tip check',
    'deploy.yml',
    (wf) => {
      wf.jobs.sourcemaps.steps = wf.jobs.sourcemaps.steps.filter(
        (s) => s.run !== 'scripts/assert-main-tip.sh',
      );
    },
  ],
  [
    'a workflow with run steps drops its bash default (Rule 6)',
    'ci.yml',
    (wf) => {
      delete wf.defaults;
    },
  ],
  [
    'Scorecard gains top-level env (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.env = { FOO: 'bar' };
    },
  ],
  [
    'Scorecard gains top-level defaults (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.defaults = { run: { shell: 'bash' } };
    },
  ],
  [
    'Scorecard job gains env (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.jobs.scorecard.env = { FOO: 'bar' };
    },
  ],
  [
    'Scorecard job gains a run step (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.jobs.scorecard.steps.splice(1, 0, { run: 'echo hi' });
    },
  ],
  [
    'Scorecard job uses an action outside its allowlist (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.jobs.scorecard.steps.splice(1, 0, { uses: PINNED_CACHE, with: { path: 'x', key: 'x' } });
    },
  ],
  [
    'Scorecard holds a secret (Rule 11)',
    'scorecard.yml',
    (wf) => {
      usesStep(wf.jobs.scorecard, 'ossf/scorecard-action@').with.repo_token =
        '${{ secrets.SCORECARD_TOKEN }}';
    },
  ],
  [
    'Scorecard runs on pull requests (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.on.pull_request = null;
    },
  ],
  [
    'Scorecard gets workflow-level id-token write (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.permissions['id-token'] = 'write';
    },
  ],
  [
    'a second job in the Scorecard workflow gets id-token write (Rule 11)',
    'scorecard.yml',
    (wf) => {
      wf.jobs.other = {
        'runs-on': 'ubuntu-latest',
        permissions: { 'id-token': 'write' },
        steps: [{ uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' }],
      };
    },
  ],
  [
    'the production audit gate is removed from CI (Rule 12)',
    'ci.yml',
    (wf) => {
      wf.jobs.checks.steps = wf.jobs.checks.steps.filter((s) => !/pnpm audit/.test(s.run ?? ''));
    },
  ],
  [
    'the production audit gate stops blocking (Rule 12)',
    'ci.yml',
    (wf) => {
      runStep(wf.jobs.checks, /pnpm audit/)['continue-on-error'] = true;
    },
  ],
  [
    'the production audit gate drops --prod, so it would fail on dev tooling (Rule 12)',
    'ci.yml',
    (wf) => {
      const s = runStep(wf.jobs.checks, /pnpm audit/);
      s.run = s.run.replace(' --prod', '');
    },
  ],
  [
    'a smoke job without the Playwright image',
    'deploy.yml',
    (wf) => {
      delete wf.jobs.smoke.container;
    },
  ],
  [
    'a smoke image pinned by tag only',
    'preview.yml',
    (wf) => {
      wf.jobs.smoke.container.image = wf.jobs.smoke.container.image.replace(/@sha256:.*/, '');
    },
  ],
  [
    'a Playwright image that differs from @playwright/test',
    'e2e/package.json',
    (pkg) => {
      pkg.devDependencies['@playwright/test'] = '1.62.0';
    },
  ],
  [
    'a smoke job that installs browsers again',
    'deploy.yml',
    (wf) => {
      wf.jobs.smoke.steps.splice(-1, 0, {
        run: 'pnpm --filter @wishlist/e2e exec playwright install --with-deps chromium',
      });
    },
  ],
  [
    'an unpinned service image',
    'ci.yml',
    (wf) => {
      wf.jobs.e2e.services = { db: { image: 'postgres:17' } };
    },
  ],
];

function copyRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  cpSync(join(root, '.github/workflows'), join(dir, '.github/workflows'), { recursive: true });
  for (const f of [
    'renovate.json',
    'package.json',
    'e2e/package.json',
    'tools/vercel-cli/package.json',
  ])
    cpSync(join(root, f), join(dir, f));
  return dir;
}

function rewrite(dir, file, mutate) {
  const path = file.endsWith('.json') ? join(dir, file) : join(dir, '.github/workflows', file);
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
for (const f of ['deploy.yml', 'preview.yml', 'preview-seed.yml', 'backup.yml', 'scorecard.yml'])
  rewrite(base, f);
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
