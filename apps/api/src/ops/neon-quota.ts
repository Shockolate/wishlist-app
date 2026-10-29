import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Clock } from '../core/clock.js';
import type { ErrorReporter } from '../observability/error-reporter.js';
import type { CronHeartbeat } from './cron-heartbeat.js';

/**
 * Port for the daily check of production's compute against Neon's free quota (D105). It never
 * throws, so it can't change the cron's answer.
 */
export interface QuotaCheck {
  run(): Promise<void>;
}

export const QUOTA_CHECK = Symbol('QUOTA_CHECK');

/** Used when the check isn't configured: previews, CI, tests and local development. */
export const NO_QUOTA_CHECK: QuotaCheck = { run: () => Promise.resolve() };

/** Neon Free allows 100 CU-hours a period. Even at 0.5 CU, 60 leaves at least 3 days to act. */
export const ALERT_USED_CU_HOURS = 60;
export const ALERT_PROJECTED_CU_HOURS = 90;
/** Before this, a projection is mostly noise. */
const MIN_ELAPSED_MS = 3 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

export interface QuotaReading {
  usedCuHours: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface QuotaVerdict {
  usedCuHours: number;
  /** Used so far, scaled to the whole period. Undefined in its first 3 days. */
  projectedCuHours: number | undefined;
  over: boolean;
}

export function judgeQuota(reading: QuotaReading, now: Date): QuotaVerdict {
  const start = reading.periodStart.getTime();
  const elapsed = now.getTime() - start;
  const length = reading.periodEnd.getTime() - start;
  const projectedCuHours =
    elapsed >= MIN_ELAPSED_MS ? (reading.usedCuHours * length) / elapsed : undefined;
  const over =
    reading.usedCuHours >= ALERT_USED_CU_HOURS ||
    (projectedCuHours !== undefined && projectedCuHours >= ALERT_PROJECTED_CU_HOURS);
  return { usedCuHours: reading.usedCuHours, projectedCuHours, over };
}

/** The fields Neon documents for tracking a Free-plan project's usage. */
const ProjectSchema = z.object({
  project: z.object({
    compute_time_seconds: z.number().nonnegative(),
    consumption_period_start: z.iso.datetime(),
    consumption_period_end: z.iso.datetime(),
  }),
});

/**
 * Reads the project record from Neon's API, a control-plane read that never wakes the database,
 * then pings the quota heartbeat: `failed` when over. When Neon can't be read it pings nothing, so
 * the heartbeat goes quiet and alerts. The key is a secret: a failure is reported with a fixed
 * message and the status only, never the error's message or cause.
 */
export class NeonQuotaCheck implements QuotaCheck {
  private readonly logger = new Logger('NeonQuota');

  constructor(
    private readonly projectId: string,
    private readonly apiKey: string,
    private readonly heartbeat: CronHeartbeat,
    private readonly reporter: ErrorReporter,
    private readonly clock: Clock,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async run(): Promise<void> {
    const reading = await this.read();
    if (!reading) return;
    const verdict = judgeQuota(reading, this.clock.now());
    const projected = verdict.projectedCuHours?.toFixed(1) ?? 'not yet';
    this.logger.log(
      `${verdict.usedCuHours.toFixed(1)} CU-hours used, projected ${projected}${verdict.over ? ': over' : ''}`,
    );
    await (verdict.over ? this.heartbeat.failed() : this.heartbeat.succeeded());
  }

  private async read(): Promise<QuotaReading | undefined> {
    let status = 'none';
    // A plain timer rather than AbortSignal.timeout, so tests can drive the deadline.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchFn(
        `https://console.neon.tech/api/v2/projects/${this.projectId}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
          signal: deadline.signal,
        },
      );
      if (res.ok) {
        const parsed = ProjectSchema.safeParse(await res.json());
        if (parsed.success) {
          const { project } = parsed.data;
          return {
            usedCuHours: project.compute_time_seconds / 3600,
            periodStart: new Date(project.consumption_period_start),
            periodEnd: new Date(project.consumption_period_end),
          };
        }
        status = 'invalid';
      } else {
        status = String(res.status);
      }
    } catch {
      // Network error, timeout or a body that isn't JSON. Its message may hold the key, so neither
      // it nor its cause is kept.
    } finally {
      clearTimeout(timer);
    }
    this.reporter.captureWarning(`neon quota check failed status=${status}`);
    return undefined;
  }
}
