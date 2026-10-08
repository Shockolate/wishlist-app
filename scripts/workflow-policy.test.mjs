#!/usr/bin/env node
// Asserts the CI/CD supply-chain policy (final review of Plan 1, findings I-1, I-2, M-3) so a
// later edit can't quietly undo it. Run: node scripts/workflow-policy.test.mjs
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

for (const { file, wf } of workflows) {
  if (wf.env && 'VERCEL_TOKEN' in wf.env) fail(`${file}: VERCEL_TOKEN set at workflow level`);
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    if (job.env && 'VERCEL_TOKEN' in job.env) {
      fail(`${file}#${jobName}: VERCEL_TOKEN set at job level; scope it to the steps that deploy`);
    }
    for (const step of job.steps ?? []) {
      const uses = step.uses;
      if (!uses) continue;
      // Third-party code runs with this job's secrets: pin it to an immutable commit.
      if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses)) {
        fail(`${file}#${jobName}: action not pinned to a commit SHA: ${uses}`);
      }
      if (uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) {
        fail(`${file}#${jobName}: checkout must set persist-credentials: false`);
      }
    }
  }
}

const byFile = Object.fromEntries(workflows.map(({ file, wf }) => [file, wf]));

const deploy = byFile['deploy.yml']?.jobs?.deploy;
if (!String(deploy?.if ?? '').includes("github.ref == 'refs/heads/main'")) {
  fail(
    "deploy.yml#deploy: must only run for refs/heads/main (if: github.ref == 'refs/heads/main')",
  );
}
const deploySteps = (deploy?.steps ?? []).map((s) => s.name);
const guard = deploySteps.indexOf('Refuse to deploy a stale commit');
const migrate = deploySteps.indexOf('Migrate production database');
if (guard === -1 || migrate === -1 || guard > migrate) {
  fail('deploy.yml#deploy: a "Refuse to deploy a stale commit" step must run before migrating');
}

const preview = byFile['preview.yml']?.jobs?.preview;
if (!String(preview?.if ?? '').includes("github.event.pull_request.user.type != 'Bot'")) {
  fail('preview.yml#preview: bot PRs (Renovate) must not get previews with deploy credentials');
}

// Rule 6 (spec addendum §2): every run step fails on any error in a pipeline.
for (const { file, wf } of workflows) {
  if (wf.defaults?.run?.shell !== 'bash') {
    fail(`${file}: set defaults.run.shell: bash (GitHub runs it with -eo pipefail)`);
  }
}

// Rule 5 (spec addendum §3.3): the seed job only runs on main and resolves the branch, refusing
// production, before anything can wipe it.
const seedJob = byFile['preview-seed.yml']?.jobs?.seed;
if (!String(seedJob?.if ?? '').includes("github.ref == 'refs/heads/main'")) {
  fail("preview-seed.yml#seed: must only run on main (if: github.ref == 'refs/heads/main')");
}
const seedSteps = (seedJob?.steps ?? []).map((s) => s.name);
const ensureAt = seedSteps.indexOf('Ensure the seed branch exists (never main)');
const wipeAt = seedSteps.indexOf('Wipe and rebuild from zero');
if (ensureAt === -1 || wipeAt === -1 || ensureAt > wipeAt) {
  fail(
    'preview-seed.yml#seed: "Ensure the seed branch exists (never main)" must run before "Wipe and rebuild from zero"',
  );
}

const renovate = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
if (!renovate.extends?.includes('helpers:pinGitHubActionDigests')) {
  fail('renovate.json: extends must include helpers:pinGitHubActionDigests');
}
if (!renovate.minimumReleaseAge) fail('renovate.json: minimumReleaseAge must be set');
if (JSON.stringify(renovate).includes('"automerge":true')) {
  fail('renovate.json: no automerge until builds run without deploy credentials');
}

if (failures.length > 0) {
  console.error(`workflow-policy: ${failures.length} violation(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('workflow-policy: ok');
