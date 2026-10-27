#!/usr/bin/env node
// Asserts the CI/CD trust model (spec addendum 2026-10-08 §2, §5; Plan 1 review I-1, I-2, M-1,
// M-3) so a later edit can't quietly undo it. Run: node scripts/workflow-policy.test.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// POLICY_ROOT lets scripts/workflow-policy.mutations.test.mjs check mutated copies.
const root = process.env.POLICY_ROOT ?? new URL('..', import.meta.url).pathname;
const dir = join(root, '.github/workflows');
const failures = [];
const fail = (msg) => failures.push(msg);

const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((file) => ({ file, wf: parse(readFileSync(join(dir, file), 'utf8')) }));
const byFile = Object.fromEntries(workflows.map(({ file, wf }) => [file, wf]));

// D85: secret jobs run the Vercel CLI from the lockfile, never through npx, so its whole
// dependency tree is pinned by integrity hash, and they install it without install scripts.
// It runs by path from the repo root: `pnpm --filter … exec` would run it in tools/vercel-cli, where
// there's no .vercel/output to deploy.
const VERCEL_CLI = 'tools/vercel-cli/node_modules/.bin/vercel';
// No --prod: vercel is that package's devDependency, so `pnpm audit --prod` gates only what
// production runs (the CLI has its own monthly audit, docs/operations.md).
// pnpm then also installs the root's devDependencies; the allowlist above still lets these
// jobs run nothing but the CLI.
const VERCEL_INSTALL =
  'pnpm install --frozen-lockfile --ignore-scripts --filter @wishlist/vercel-cli';
const PROD_INSTALL =
  'pnpm install --prod --frozen-lockfile --ignore-scripts --filter @wishlist/api';
const MIGRATOR = 'apps/api/src/db/migrate-cli.ts';
// Data a secret job may download. Never anything it executes (final review C-1).
const SAFE_ARTIFACTS = ['vercel-settings', 'api-output', 'web-output', 'web-sourcemaps'];
const PACKAGE_RUNNER = /\b(pnpm|pnpx|npm|npx|yarn|bun|bunx|corepack)\b/;

// Secret names used in ${{ }} expressions, case-insensitive. '*' means the whole context
// (toJSON(secrets), a computed secrets[...] key), which no job may use.
function secretsIn(value) {
  const names = new Set();
  const named = /\bsecrets\s*(?:\.\s*([\w-]+)|\[\s*'([^']+)'\s*\])/gi;
  for (const [, expr] of JSON.stringify(value ?? {}).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    for (const m of expr.matchAll(named)) names.add((m[1] ?? m[2]).toUpperCase());
    if (/\bsecrets\b/i.test(expr.replace(named, ''))) names.add('*');
  }
  return [...names];
}
// One entry per shell command line, with backslash continuations joined and comments dropped.
const commandLines = (job) =>
  (job.steps ?? [])
    .flatMap((s) =>
      String(s.run ?? '')
        .replace(/\\\n/g, ' ')
        .split('\n'),
    )
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
const envName = (job) =>
  typeof job.environment === 'string' ? job.environment : job.environment?.name;

for (const { file, wf } of workflows) {
  // Rule 6: every run step fails on any error in a pipeline. A workflow with no run step has
  // none to fail, which lets scorecard.yml omit `defaults` as publishing requires (Rule 11).
  const hasRunStep = Object.values(wf.jobs ?? {}).some((job) =>
    (job.steps ?? []).some((s) => s.run !== undefined),
  );
  if (hasRunStep && wf.defaults?.run?.shell !== 'bash')
    fail(`${file}: set defaults.run.shell: bash (-eo pipefail)`);
  if (secretsIn(wf.env).length) fail(`${file}: secrets at workflow level; scope them to steps`);

  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const where = `${file}#${jobName}`;
    const secrets = secretsIn(job);
    if (job.secrets !== undefined) secrets.push('*'); // `secrets: inherit` on a reusable call

    if (job.env && 'VERCEL_TOKEN' in job.env)
      fail(`${where}: VERCEL_TOKEN at job level; scope it to the steps that deploy`);

    for (const step of job.steps ?? []) {
      const uses = step.uses;
      if (!uses) continue;
      if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses))
        fail(`${where}: action not pinned to a commit SHA: ${uses}`);
      if (uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) {
        fail(`${where}: checkout must set persist-credentials: false`);
      }
      // Review Focus #3: functions carry a hidden .vc-config.json that uploads drop by default.
      if (
        uses.startsWith('actions/upload-artifact@') &&
        /output/.test(String(step.with?.path)) &&
        step.with?.['include-hidden-files'] !== true
      ) {
        fail(
          `${where}: Vercel output contains dotfiles; upload it with include-hidden-files: true`,
        );
      }
    }

    // Rules 1 and 2, as an allowlist: a job that holds any secret (or a deployment environment)
    // runs no workspace or dependency code beyond the pinned Vercel CLI, a cache-free prod install
    // and the migrator from source. The one exception is preview.yml's smoke job, which runs a full
    // install next to the preview bypass secret only (spec addendum §3.4).
    if (file === 'preview.yml' && jobName === 'smoke') {
      const leaked = secrets.filter((s) => s !== 'VERCEL_AUTOMATION_BYPASS_SECRET');
      if (leaked.length)
        fail(`${where}: may hold only VERCEL_AUTOMATION_BYPASS_SECRET (${leaked.join(', ')})`);
    } else if (secrets.length > 0 || job.environment) {
      for (const line of commandLines(job)) {
        const runsPackages = PACKAGE_RUNNER.test(line.replaceAll(VERCEL_CLI, ''));
        if (runsPackages && line !== PROD_INSTALL && line !== VERCEL_INSTALL)
          fail(
            `${where}: secret-holding job may only run "${PROD_INSTALL}", "${VERCEL_INSTALL}" or ${VERCEL_CLI}: ${line}`,
          );
        if (/\bvercel\s+[a-z]/.test(line) && !line.includes(VERCEL_CLI))
          fail(`${where}: invoke the Vercel CLI as ${VERCEL_CLI}: ${line}`);
        for (const [, target] of line.matchAll(/\bnode\s+(\S+)/g)) {
          if (target !== MIGRATOR)
            fail(`${where}: secret-holding job may only run node ${MIGRATOR}: ${line}`);
        }
      }
      for (const step of job.steps ?? []) {
        const uses = String(step.uses ?? '');
        const w = step.with ?? {};
        // Final review C-2: a cache written by a full-install job can carry modified files.
        if (uses.startsWith('actions/cache')) fail(`${where}: no caches in a secret-holding job`);
        if (
          uses.startsWith('actions/setup-node@') &&
          (w.cache !== undefined || w['package-manager-cache'] !== false)
        )
          fail(
            `${where}: setup-node must not cache here (no cache:, package-manager-cache: false)`,
          );
        if (uses.startsWith('pnpm/action-setup@') && (w.run_install || w.cache))
          fail(`${where}: pnpm/action-setup must not install or cache here`);
        if (uses.startsWith('actions/download-artifact@') && !SAFE_ARTIFACTS.includes(w.name))
          fail(
            `${where}: may only download ${SAFE_ARTIFACTS.join(', ')}, got ${w.name ?? 'all artifacts'}`,
          );
      }
    }

    // Build output crosses from an untrusted job into this one: deploy only what
    // check-vercel-output.sh accepted (complete, self-contained, no symlink leaving it).
    const steps = job.steps ?? [];
    const deployAt = steps.findIndex((s) => /\bvercel@\S+ deploy --prebuilt\b/.test(s.run ?? ''));
    const outputCheckAt = steps.findIndex((s) =>
      /^scripts\/check-vercel-output\.sh /.test(s.run ?? ''),
    );
    if (deployAt !== -1 && (outputCheckAt === -1 || outputCheckAt > deployAt))
      fail(`${where}: run scripts/check-vercel-output.sh before vercel deploy --prebuilt`);
  }
}

// Rule 3: production is reachable only from main, only by the jobs that need it, and every job
// that touches it re-checks that it is deploying main's tip (Review Focus #2).
const PROD_JOBS = ['settings', 'migrate', 'deploy-api', 'deploy-web', 'sourcemaps'];
for (const [jobName, job] of Object.entries(byFile['deploy.yml']?.jobs ?? {})) {
  const where = `deploy.yml#${jobName}`;
  if (!String(job.if ?? '').includes("github.ref == 'refs/heads/main'"))
    fail(`${where}: must be gated with if: github.ref == 'refs/heads/main'`);
  const isProd = envName(job) === 'production';
  if (isProd !== PROD_JOBS.includes(jobName))
    fail(`${where}: only ${PROD_JOBS.join(', ')} may use environment: production`);
  if (isProd || jobName === 'guard') {
    const at = (job.steps ?? []).findIndex((s) => s.run === 'scripts/assert-main-tip.sh');
    if (at !== 1) fail(`${where}: must run scripts/assert-main-tip.sh immediately after checkout`);
  }
}
for (const name of ['guard', ...PROD_JOBS, 'build', 'smoke']) {
  if (!byFile['deploy.yml']?.jobs?.[name]) fail(`deploy.yml: missing job ${name}`);
}

// Rule 4: previews skip forks and bots, branch from preview-seed, verify that, and never post the API URL.
const preview = byFile['preview.yml']?.jobs ?? {};
const settingsIf = String(preview.settings?.if ?? '');
if (
  !settingsIf.includes('head.repo.full_name == github.repository') ||
  !settingsIf.includes("github.event.pull_request.user.type != 'Bot'")
) {
  fail('preview.yml#settings: fork and bot PRs must not get previews');
}
for (const [jobName, job] of Object.entries(preview)) {
  if (jobName !== 'settings' && !job.needs)
    fail(`preview.yml#${jobName}: must need an earlier job so the fork/bot skip propagates`);
}
const provisionSteps = preview.provision?.steps ?? [];
const branchStep = provisionSteps.find((s) =>
  String(s.uses).startsWith('neondatabase/create-branch-action@'),
);
if (branchStep?.with?.parent_branch !== 'preview-seed')
  fail('preview.yml#provision: create pr-* branches with parent_branch: preview-seed');
const runsAt = (re) => provisionSteps.findIndex((s) => re.test(s.run ?? ''));
const checkAt = runsAt(/preview-seed\.sh check/);
const childAt = runsAt(/preview-seed\.sh assert-child/);
const migrateAt = runsAt(/migrate-cli\.ts/);
const branchAt = provisionSteps.indexOf(branchStep);
if (!(checkAt !== -1 && checkAt < branchAt && branchAt < childAt && childAt < migrateAt)) {
  fail(
    'preview.yml#provision: order must be preview-seed check → create branch → assert-child → migrate',
  );
}
const comment = (preview.comment?.steps ?? []).find((s) =>
  String(s.uses).startsWith('marocchino/sticky-pull-request-comment@'),
);
if (!comment || /api_url|\/api\/health/.test(String(comment.with?.message)))
  fail('preview.yml#comment: post the web alias only, never the API preview URL');

// Rule 5: the seed job only runs on main and resolves the branch, refusing production, before any wipe.
const seedJob = byFile['preview-seed.yml']?.jobs?.seed;
if (!String(seedJob?.if ?? '').includes("github.ref == 'refs/heads/main'"))
  fail("preview-seed.yml#seed: must only run on main (if: github.ref == 'refs/heads/main')");
const seedSteps = (seedJob?.steps ?? []).map((s) => s.name);
const ensureAt = seedSteps.indexOf('Ensure the seed branch exists (never main)');
const wipeAt = seedSteps.indexOf('Wipe and rebuild from zero');
if (ensureAt === -1 || wipeAt === -1 || ensureAt > wipeAt)
  fail(
    'preview-seed.yml#seed: "Ensure the seed branch exists (never main)" must run before "Wipe and rebuild from zero"',
  );
// Final review I-2: a seed with a parent may hold production rows, so it is always wiped.
const wipeIf = String(seedJob?.steps?.[wipeAt]?.if ?? '');
if (!wipeIf.includes("steps.seed.outputs.root != 'true'"))
  fail(
    "preview-seed.yml#seed: wipe whenever the seed isn't a root branch (steps.seed.outputs.root != 'true')",
  );

// D87: previews live in their own Neon project. The seed is never created by schema-only copy from
// another project, and every step that runs a Neon script knows production's project ID, which the
// scripts refuse.
if (seedJob && byFile['preview-seed.yml']?.on?.workflow_dispatch?.inputs?.init_source)
  fail('preview-seed.yml: no init_source input; the seed is a child of the preview project (D87)');
const PRODUCTION_PROJECT_VAR = '${{ vars.NEON_PRODUCTION_PROJECT_ID }}';
for (const { file, wf } of workflows) {
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!/\b(preview-seed|neon-sweep)\.sh\b/.test(String(step.run ?? ''))) continue;
      if (step.env?.NEON_PRODUCTION_PROJECT_ID !== PRODUCTION_PROJECT_VAR)
        fail(
          `${file}#${jobName}: "${step.name ?? step.run}" must set NEON_PRODUCTION_PROJECT_ID: ${PRODUCTION_PROJECT_VAR} (D87)`,
        );
    }
  }
}

// Rule 7: GitHub logs a deployment for every job that names an environment. Jobs that only need
// the preview environment's secrets opt out, so a PR shows one "deployed to preview" per run:
// deploy-web's, linked to the web alias.
for (const file of ['preview.yml', 'cleanup.yml']) {
  for (const [jobName, job] of Object.entries(byFile[file]?.jobs ?? {})) {
    if (envName(job) !== 'preview') continue;
    const where = `${file}#${jobName}`;
    if (file === 'preview.yml' && jobName === 'deploy-web') {
      if (
        job.environment?.deployment === false ||
        !String(job.environment?.url).includes('WEB_ALIAS')
      )
        fail(`${where}: the one preview deployment; link it with environment.url to the web alias`);
    } else if (job.environment?.deployment !== false) {
      fail(
        `${where}: only deploy-web logs a preview deployment; set environment.deployment: false`,
      );
    }
  }
}

// Rule 8 (Plan 5a; D48, spec §10 Recovery): the backup runs only on main, holds only its own
// secrets (never the owner role's DATABASE_URL_DIRECT), checks age's checksum before extracting
// it, and never uploads an artifact: on a public repo anyone can download one.
const BACKUP_SECRETS = [
  'DATABASE_URL_BACKUP',
  'AGE_RECIPIENT',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'BACKUP_HEARTBEAT_URL',
];
const backupJobs = Object.entries(byFile['backup.yml']?.jobs ?? {});
if (backupJobs.length === 0) fail('backup.yml: missing, or has no jobs');
for (const [jobName, job] of backupJobs) {
  const where = `backup.yml#${jobName}`;
  if (!String(job.if ?? '').includes("github.ref == 'refs/heads/main'"))
    fail(`${where}: must be gated with if: github.ref == 'refs/heads/main'`);
  const extra = secretsIn(job).filter((s) => !BACKUP_SECRETS.includes(s));
  if (extra.length)
    fail(`${where}: may hold only ${BACKUP_SECRETS.join(', ')} (got ${extra.join(', ')})`);
  const steps = job.steps ?? [];
  if (steps.some((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@')))
    fail(`${where}: never upload an artifact; anyone can download it from a public repo`);
  for (const step of steps.filter((s) => /FiloSottile\/age\/releases/.test(s.run ?? ''))) {
    const run = String(step.run);
    const verifyAt = run.indexOf('sha256sum -c');
    if (verifyAt === -1 || verifyAt > run.indexOf('tar '))
      fail(`${where}: check age's sha256 (sha256sum -c) before extracting it`);
  }
}

// Rule 9 (Plan 5b, D50): the web DSN reaches only the production build. A preview, CI or any
// other job that inlined it would report from unreviewed code.
for (const { file, wf } of workflows) {
  // Workflow-level env reaches every job, so no workflow may set it there.
  if (JSON.stringify(wf.env ?? {}).includes('SENTRY_DSN_WEB'))
    fail(`${file}: SENTRY_DSN_WEB must not be set in workflow-level env; only deploy.yml#build`);
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const allowed = file === 'deploy.yml' && jobName === 'build';
    if (!allowed && JSON.stringify(job).includes('SENTRY_DSN_WEB'))
      fail(`${file}#${jobName}: only deploy.yml#build may read SENTRY_DSN_WEB`);
  }
}
if (!JSON.stringify(byFile['deploy.yml']?.jobs?.build ?? {}).includes('vars.SENTRY_DSN_WEB'))
  fail('deploy.yml#build: set SENTRY_DSN_WEB from vars.SENTRY_DSN_WEB');

// Rule 10 (Plan 5b, D52): source maps reach Sentry from a job that holds only SENTRY_AUTH_TOKEN,
// runs sentry-cli only after installing it through its checksum check, and that no release waits
// on, so a Sentry outage never blocks a deploy (Review Focus #5). The build job's own sentry-cli
// install is continue-on-error for the same reason.
const deployJobs = byFile['deploy.yml']?.jobs ?? {};
const mapsJob = deployJobs.sourcemaps;
if (!mapsJob) fail('deploy.yml: missing job sourcemaps');
const mapsSecrets = secretsIn(mapsJob ?? {}).filter((s) => s !== 'SENTRY_AUTH_TOKEN');
if (mapsSecrets.length)
  fail(`deploy.yml#sourcemaps: may hold only SENTRY_AUTH_TOKEN (got ${mapsSecrets.join(', ')})`);
for (const [jobName, job] of Object.entries(deployJobs)) {
  const needs = [job.needs ?? []].flat();
  if (needs.includes('sourcemaps')) fail(`deploy.yml#${jobName}: no job may wait on sourcemaps`);
  const steps = job.steps ?? [];
  const installAt = steps.findIndex((s) => /scripts\/install-sentry-cli\.sh/.test(s.run ?? ''));
  const usesAt = steps.findIndex((s) =>
    /(^|\n|\s)(sentry-cli|scripts\/extract-sourcemaps\.sh)\s/.test(s.run ?? ''),
  );
  if (usesAt !== -1 && (installAt === -1 || installAt > usesAt))
    fail(
      `deploy.yml#${jobName}: install sentry-cli with scripts/install-sentry-cli.sh before using it`,
    );
  // The build job's CLI is only for the Sentry-tooling steps there; a GitHub releases outage
  // must not block the release. The sourcemaps job's install must fail loudly: nothing waits on it.
  if (jobName === 'build')
    for (const s of steps)
      if (/scripts\/install-sentry-cli\.sh/.test(s.run ?? '') && s['continue-on-error'] !== true)
        fail('deploy.yml#build: the sentry-cli install must be continue-on-error: true');
}

// Rule 11 (OpenSSF Scorecard): publishing the result is rejected by the Scorecard API unless the
// workflow has no top-level env or defaults, no job env or defaults, no run step, only approved
// actions, and `id-token: write` on the scorecard-action job alone. The job gets an OIDC token,
// so it must never run on pull requests, hold a secret, or run anything but those actions.
const SCORECARD_ACTIONS = [
  'actions/checkout@',
  'ossf/scorecard-action@',
  'github/codeql-action/upload-sarif@',
];
const SCORECARD_TRIGGERS = ['schedule', 'push', 'branch_protection_rule'];
const scorecard = byFile['scorecard.yml'];
if (scorecard) {
  const w = 'scorecard.yml';
  if (scorecard.env !== undefined || scorecard.defaults !== undefined)
    fail(`${w}: no top-level env or defaults; the Scorecard API rejects a publishing workflow`);
  for (const trigger of Object.keys(scorecard.on ?? {}))
    if (!SCORECARD_TRIGGERS.includes(trigger))
      fail(`${w}: may only run on ${SCORECARD_TRIGGERS.join(', ')} (got ${trigger})`);
  if (secretsIn(scorecard).length)
    fail(`${w}: holds no secrets; it reads the ruleset with the default token`);
  const top = scorecard.permissions ?? {};
  if (typeof top === 'string' ? top === 'write-all' : Object.values(top).includes('write'))
    fail(`${w}: no workflow-level write permissions`);
  const scorecardJobs = Object.entries(scorecard.jobs ?? {}).filter(([, job]) =>
    (job.steps ?? []).some((s) => String(s.uses ?? '').startsWith('ossf/scorecard-action@')),
  );
  if (scorecardJobs.length !== 1)
    fail(`${w}: needs exactly one job that runs ossf/scorecard-action`);
  for (const [jobName, job] of Object.entries(scorecard.jobs ?? {})) {
    const where = `${w}#${jobName}`;
    for (const key of ['env', 'defaults', 'container', 'services'])
      if (job[key] !== undefined) fail(`${where}: no job-level ${key}`);
    const isScorecardJob = scorecardJobs.some(([name]) => name === jobName);
    if (job.permissions?.['id-token'] === 'write' && !isScorecardJob)
      fail(`${where}: only the ossf/scorecard-action job may use id-token: write`);
    for (const step of job.steps ?? []) {
      if (step.run !== undefined) fail(`${where}: no run steps; the Scorecard API rejects them`);
      const uses = String(step.uses ?? '');
      if (uses && !SCORECARD_ACTIONS.some((a) => uses.startsWith(a)))
        fail(`${where}: ${uses.split('@')[0]} is not on the Scorecard allowlist`);
    }
  }
}

// Rule 12: GitHub's dependency graph lists only direct packages, so Dependabot alerts and the
// dependency-review check miss advisories in transitive ones. CI audits the lockfile itself, for
// what ships. It must stay blocking, and --prod keeps the dev tooling's open advisories (the Vercel
// CLI's tree) from failing every build.
const auditGate = (byFile['ci.yml']?.jobs?.checks?.steps ?? []).find((s) =>
  /^pnpm audit\b/.test(String(s.run ?? '').trim()),
);
if (
  !auditGate ||
  !/^pnpm audit --prod --audit-level (low|moderate|high)$/.test(auditGate.run.trim())
)
  fail('ci.yml#checks: run `pnpm audit --prod --audit-level high` (Rule 12)');
else if (auditGate['continue-on-error'] === true || auditGate['continue-on-error'] === 'true')
  fail('ci.yml#checks: the production audit must block the build (no continue-on-error)');

// Rule 13: a job's container image is pinned by digest, as actions are by SHA. Both smoke jobs run
// in Playwright's image, which ships Chromium and its system packages, so nothing comes from apt,
// whose mirror stalled smoke past its timeout twice on 2026-10-22. Its version is the one
// @playwright/test is pinned to, since Playwright only finds the browser build it was released with.
const e2ePkg = JSON.parse(readFileSync(join(root, 'e2e/package.json'), 'utf8'));
const playwrightVersion = e2ePkg.devDependencies?.['@playwright/test'];
const imageOf = (spec) => (typeof spec === 'string' ? spec : spec?.image);
for (const { file, wf } of workflows) {
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const images = [job.container, ...Object.values(job.services ?? {})]
      .map(imageOf)
      .filter((image) => image !== undefined);
    for (const image of images)
      if (!/^[\w./:-]+@sha256:[0-9a-f]{64}$/.test(String(image)))
        fail(`${file}#${jobName}: container image not pinned by digest: ${image}`);
  }
}
for (const [file, jobName] of [
  ['deploy.yml', 'smoke'],
  ['preview.yml', 'smoke'],
]) {
  const job = byFile[file]?.jobs?.[jobName];
  if (!job) continue;
  const where = `${file}#${jobName}`;
  const image = String(imageOf(job.container) ?? '');
  if (!image.startsWith(`mcr.microsoft.com/playwright:v${playwrightVersion}-`))
    fail(
      `${where}: run in mcr.microsoft.com/playwright:v${playwrightVersion}-<os>, the version @playwright/test is pinned to (Rule 13)`,
    );
  if (commandLines(job).some((line) => /\bplaywright install\b/.test(line)))
    fail(`${where}: the Playwright image already has the browser; don't run playwright install`);
}

// D85: no workflow fetches the Vercel CLI on the fly, and every job that runs it installs it from
// the lockfile first, in an earlier step.
for (const { file, wf } of workflows) {
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const where = `${file}#${jobName}`;
    let installed = false;
    for (const step of job.steps ?? []) {
      const lines = String(step.run ?? '').split('\n');
      for (const line of lines) {
        if (/\b(npx|pnpx|pnpm dlx|bunx)\b.*\bvercel\b/.test(line))
          fail(
            `${where}: run the Vercel CLI as ${VERCEL_CLI}, never through a package fetcher: ${line.trim()}`,
          );
        if (line.includes(VERCEL_CLI) && !installed)
          fail(`${where}: run "${VERCEL_INSTALL}" in an earlier step before ${VERCEL_CLI}`);
      }
      if (lines.some((line) => line.trim() === VERCEL_INSTALL)) installed = true;
    }
  }
}

// The CLI's version is exact, in its own package; a range would float in token-holding jobs.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.devDependencies?.vercel || pkg.dependencies?.vercel)
  fail('package.json: vercel lives in tools/vercel-cli (@wishlist/vercel-cli), not the root (D85)');
const cliPkgPath = join(root, 'tools/vercel-cli/package.json');
const cliPkg = existsSync(cliPkgPath) ? JSON.parse(readFileSync(cliPkgPath, 'utf8')) : {};
if (cliPkg.name !== '@wishlist/vercel-cli')
  fail('tools/vercel-cli/package.json: name must be @wishlist/vercel-cli');
if (!/^\d+\.\d+\.\d+$/.test(cliPkg.devDependencies?.vercel ?? ''))
  fail('tools/vercel-cli/package.json: devDependencies.vercel must be an exact x.y.z version');
if (Object.keys(cliPkg.dependencies ?? {}).length > 0)
  fail('tools/vercel-cli/package.json: no dependencies; the CLI is a devDependency (D85)');

const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
if (!renovate.extends?.includes('helpers:pinGitHubActionDigests'))
  fail('renovate.json: extends must include helpers:pinGitHubActionDigests');
if (!renovate.minimumReleaseAge) fail('renovate.json: minimumReleaseAge must be set');
// D88: automerge only minor and patch updates of named dev-only tooling, which runs in
// secret-free jobs and never shapes the production build. Everything else waits for review. The
// whole config is walked, so automerge can't hide in a nested block (a manager, lockFileMaintenance,
// an update type) or a preset, and the one allowed rule is pinned exactly: widening it means
// editing this test on purpose (final review).
const AUTOMERGE_PACKAGES = [
  '@types/**',
  '!@types/node',
  'eslint',
  'prettier',
  'vitest',
  'testcontainers',
  '@testcontainers/**',
];
const AUTOMERGE_RULE_KEYS = [
  'description',
  'matchDepTypes',
  'matchUpdateTypes',
  'matchPackageNames',
  'automerge',
  'automergeType',
];
const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
function checkAutomergeRule(rule, where) {
  const extra = Object.keys(rule).filter((k) => !AUTOMERGE_RULE_KEYS.includes(k));
  if (extra.length)
    fail(
      `${where}: an automerge rule may only set ${AUTOMERGE_RULE_KEYS.join(', ')} (D88), not ${extra.join(', ')}`,
    );
  if (JSON.stringify(rule.matchDepTypes) !== JSON.stringify(['devDependencies']))
    fail(`${where}: an automerge rule matches only devDependencies (D88)`);
  const types = rule.matchUpdateTypes ?? [];
  if (types.length === 0 || types.some((t) => !['minor', 'patch'].includes(t)))
    fail(`${where}: an automerge rule matches only minor and patch updates (D88)`);
  if (rule.automergeType !== 'pr')
    fail(`${where}: automergeType must be "pr", behind the required checks (D88)`);
  if (!sameSet(rule.matchPackageNames ?? [], AUTOMERGE_PACKAGES))
    fail(`${where}: matchPackageNames must be exactly ${AUTOMERGE_PACKAGES.join(', ')} (D88)`);
}
let automergeRules = 0;
(function walk(node, where) {
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${where}[${i}]`));
  if (!node || typeof node !== 'object') return;
  for (const preset of Array.isArray(node.extends) ? node.extends : [])
    if (/automerge/i.test(String(preset))) fail(`${where}: no automerge preset (${preset}) (D88)`);
  if (node.automerge !== undefined && node.automerge !== false) {
    if (/^renovate\.json: packageRules\[\d+\]$/.test(where)) {
      automergeRules += 1;
      checkAutomergeRule(node, where);
    } else fail(`${where}: automerge is allowed only in the one D88 packageRules entry`);
  }
  for (const [key, value] of Object.entries(node))
    walk(value, key === 'packageRules' ? `${where}: packageRules` : `${where}.${key}`);
})(renovate, 'renovate.json');
if (automergeRules > 1) fail('renovate.json: only one packageRules entry may automerge (D88)');

// Rule 14 (D97, D99; spec 2026-10-27 §3.6–§3.9): OpenTofu. infra-plan.yml runs PR code next to the
// plan credentials and the state passphrase, the trust model's second named exception (§3.7), so
// both infra workflows are held to exactly this shape. The environment's required approval is the
// boundary; these rules keep an honest edit from loosening what runs inside it.
const INFRA_ENV_JOBS = {
  'infra-plan': 'infra-plan.yml#plan',
  'infra-drift': 'infra-drift.yml#drift',
};
const TOFU_SECRET_LINE = /^tofu -chdir=infra (init|plan|show)\b/;
// A tofu subcommand: `tofu`, any global flags (-chdir=…), then the command word.
const tofuCommand = (words) => new RegExp(`\\btofu(\\s+-\\S+)*\\s+(${words})\\b`);
const TOFU_WRITE = tofuCommand('apply|import|state|destroy|force-unlock|taint|untaint');
const TOFU_PLAN = tofuCommand('plan');
const lines = (step) =>
  String(step.run ?? '')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
for (const { file, wf } of workflows) {
  const on = wf.on ?? wf[true] ?? {};
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
  if (triggers.includes('pull_request_target'))
    fail(`${file}: never pull_request_target; it runs with secrets on fork code (§3.6)`);
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const where = `${file}#${jobName}`;
    const env = envName(job);
    for (const [infraEnv, owner] of Object.entries(INFRA_ENV_JOBS))
      if (env === infraEnv && where !== owner) fail(`${where}: only ${owner} may use ${infraEnv}`);
    for (const line of commandLines(job)) {
      if (TOFU_WRITE.test(line)) fail(`${where}: CI never writes state or infrastructure: ${line}`);
      if (TOFU_PLAN.test(line) && !/(^|\s)-lock=false(\s|$)/.test(line))
        fail(`${where}: CI plans with -lock=false and a read-only state token: ${line}`);
    }
    if (!(env in INFRA_ENV_JOBS)) continue;
    const steps = job.steps ?? [];
    const at = (re) => steps.findIndex((st) => lines(st).some((l) => re.test(l)));
    const installAt = at(/^scripts\/install-tofu\.sh /);
    const guardAt = at(/^scripts\/infra-guard\.sh\b/);
    const secretAt = steps.findIndex((st) => secretsIn(st).length > 0);
    if (!(installAt !== -1 && installAt < guardAt && (secretAt === -1 || guardAt < secretAt)))
      fail(`${where}: run scripts/install-tofu.sh, then scripts/infra-guard.sh, before any secret`);
    if (secretsIn(job.env).length) fail(`${where}: secrets at job level; scope them to tofu steps`);
    if (String(job.env?.TF_CLI_CONFIG_FILE) !== '/dev/null')
      fail(`${where}: set TF_CLI_CONFIG_FILE: /dev/null (a CLI config could bypass the lockfile)`);
    for (const st of steps) {
      if (secretsIn(st).length === 0) continue;
      if (st.uses) fail(`${where}: no action may hold the infra credentials (${st.uses})`);
      for (const l of lines(st))
        if (!TOFU_SECRET_LINE.test(l))
          fail(
            `${where}: steps holding the infra credentials run only tofu init, plan or show: ${l}`,
          );
    }
  }
}
const infraPlan = byFile['infra-plan.yml'];
if (!infraPlan) fail('infra-plan.yml: missing (D97)');
else {
  const on = infraPlan.on ?? infraPlan[true] ?? {};
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
  if (triggers.length !== 1 || triggers[0] !== 'pull_request')
    fail('infra-plan.yml: trigger only on pull_request');
  const plan = infraPlan.jobs?.plan;
  const planIf = String(plan?.if ?? '');
  const needs = [plan?.needs ?? []].flat();
  if (!needs.includes('changes')) fail('infra-plan.yml#plan: must need changes');
  for (const want of [
    "needs.changes.outputs.infra == 'true'",
    'github.event.pull_request.head.repo.full_name == github.repository',
    "github.event.pull_request.user.type != 'Bot'",
  ])
    if (!planIf.includes(want)) fail(`infra-plan.yml#plan: its if must include ${want}`);
  if (envName(plan ?? {}) !== 'infra-plan') fail('infra-plan.yml#plan: use environment infra-plan');
  for (const name of ['changes', 'comment']) {
    const job = infraPlan.jobs?.[name];
    if (!job) fail(`infra-plan.yml: missing job ${name}`);
    else if (secretsIn(job).length || job.environment)
      fail(`infra-plan.yml#${name}: holds no secret and no environment`);
  }
}

if (failures.length > 0) {
  console.error(`workflow-policy: ${failures.length} violation(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('workflow-policy: ok');
