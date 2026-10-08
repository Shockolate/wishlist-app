#!/usr/bin/env node
// Asserts the CI/CD trust model (spec addendum 2026-10-08 §2, §5; Plan 1 review I-1, I-2, M-1,
// M-3) so a later edit can't quietly undo it. Run: node scripts/workflow-policy.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, '.github/workflows');
const failures = [];
const fail = (msg) => failures.push(msg);

const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((file) => ({ file, wf: parse(readFileSync(join(dir, file), 'utf8')) }));
const byFile = Object.fromEntries(workflows.map(({ file, wf }) => [file, wf]));

const VERCEL_CLI = 'npx --yes vercel@"$VERCEL_CLI_VERSION"';
const PROD_INSTALL = 'pnpm install --prod --frozen-lockfile --ignore-scripts';
const DEPLOY_SECRET = /^(VERCEL_TOKEN|NEON_API_KEY|DATABASE_URL\w*)$/;
const secretsIn = (value) => [
  ...new Set([...JSON.stringify(value ?? {}).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])),
];
const runsOf = (job) => (job.steps ?? []).map((s) => s.run ?? '').join('\n');
const isFullInstall = (runs) =>
  runs.split('\n').some((l) => /\bpnpm install\b/.test(l) && !l.includes(PROD_INSTALL));
const envName = (job) =>
  typeof job.environment === 'string' ? job.environment : job.environment?.name;

for (const { file, wf } of workflows) {
  // Rule 6: every run step fails on any error in a pipeline.
  if (wf.defaults?.run?.shell !== 'bash')
    fail(`${file}: set defaults.run.shell: bash (-eo pipefail)`);
  if (secretsIn(wf.env).length) fail(`${file}: secrets at workflow level; scope them to steps`);

  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const where = `${file}#${jobName}`;
    const secrets = secretsIn(job);
    const runs = runsOf(job);

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

    // Rule 1: a job that runs a full install (workspace and install-script code) holds no secrets.
    if (isFullInstall(runs)) {
      const allowed =
        file === 'preview.yml' && jobName === 'smoke' ? ['VERCEL_AUTOMATION_BYPASS_SECRET'] : [];
      const leaked = secrets.filter((s) => !allowed.includes(s));
      if (leaked.length) fail(`${where}: full pnpm install next to secrets (${leaked.join(', ')})`);
    }

    // Rule 2: a job holding deploy or database secrets runs only the pinned CLI and a prod install.
    if (secrets.some((s) => DEPLOY_SECRET.test(s))) {
      for (const line of runs.split('\n')) {
        if (/\bpnpm\b/.test(line) && !line.includes(PROD_INSTALL))
          fail(`${where}: secret-holding job may only run "${PROD_INSTALL}": ${line.trim()}`);
        if (/\bvercel (pull|build|deploy|alias)\b/.test(line) && !line.includes(VERCEL_CLI))
          fail(`${where}: invoke the Vercel CLI as ${VERCEL_CLI}: ${line.trim()}`);
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
const PROD_JOBS = ['settings', 'migrate', 'deploy-api', 'deploy-web'];
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
const migrateAt = runsAt(/migrate-cli\.js/);
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

const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
if (!renovate.extends?.includes('helpers:pinGitHubActionDigests'))
  fail('renovate.json: extends must include helpers:pinGitHubActionDigests');
if (!renovate.minimumReleaseAge) fail('renovate.json: minimumReleaseAge must be set');
if (JSON.stringify(renovate).includes('"automerge":true'))
  fail('renovate.json: no automerge until Ted decides to re-enable it');

if (failures.length > 0) {
  console.error(`workflow-policy: ${failures.length} violation(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('workflow-policy: ok');
