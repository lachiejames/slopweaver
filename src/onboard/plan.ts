/**
 * The PURE decision core of `slopweaver onboard plan`. The slash command remains the wizard, but it asks
 * this live verb for the exact per-source refresh commands instead of restating them in prose. That keeps
 * the important concurrency decision executable: every connected source gets its own command, and the
 * caller launches those commands together.
 *
 * Pure: no I/O, no clock. Every function is total and unit-tested with fixtures.
 */
import type { ConnectSource } from "../connect/types.js";
import { err, ok, type Result } from "../lib/result.js";

/** The chosen backfill depth: a rolling lookback window, an explicit start date, or the full history. */
export type BackfillChoice =
  | { readonly kind: "days"; readonly days: number }
  | { readonly kind: "since"; readonly since: string }
  | { readonly kind: "all" };

/** The default backfill: ~3 months, matching the onboarding recommendation for current-work questions. */
export const DEFAULT_BACKFILL_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a date-shaped value is a real UTC calendar day rather than a normalised impossible date. */
function isCalendarDate({ value }: { value: string }): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * Parse a raw backfill answer: `all` ⇒ full history; a `YYYY-MM-DD` ⇒ an explicit `--since` start; a
 * positive integer ⇒ a rolling `--lookback-days` window. Pure — anything else is an error.
 *
 * @param value the raw answer (e.g. `90`, `all`, a `YYYY-MM-DD` date)
 * @returns the typed choice, or an error
 */
export function parseBackfillChoice({ value }: { value: string }): Result<BackfillChoice> {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "all") {
    return ok({ kind: "all" });
  }
  if (isCalendarDate({ value: trimmed })) {
    return ok({ kind: "since", since: trimmed });
  }
  const days = Number(trimmed);
  if (Number.isInteger(days) && days > 0) {
    return ok({ days, kind: "days" });
  }
  return err([`unrecognised backfill: ${value} (expected a day count, a YYYY-MM-DD date, or "all")`]);
}

/** The backfill choice as the `refresh` window flags. Pure. */
function backfillFlags({ backfill }: { backfill: BackfillChoice }): readonly string[] {
  if (backfill.kind === "all") {
    return ["--all", "--accept-full-history"];
  }
  if (backfill.kind === "since") {
    return ["--since", backfill.since];
  }
  return ["--lookback-days", String(backfill.days)];
}

/**
 * One independently runnable refresh command. `argv` starts after the `slopweaver` executable.
 */
export interface OnboardingRefreshCommand {
  readonly source: ConnectSource;
  readonly argv: readonly string[];
}

/** GitHub's source-specific flags. Every other connector needs only the common source + window flags. */
function githubFlags({ org, repo }: { org: string; repo: string }): readonly string[] {
  return ["--all-repos", "--repo", repo, "--github-org", org];
}

/** Build one source's exact refresh argv. */
function refreshCommandFor({
  source,
  repo,
  org,
  backfill,
}: {
  source: ConnectSource;
  repo: string;
  org: string;
  backfill: BackfillChoice;
}): OnboardingRefreshCommand {
  return {
    argv: [
      "refresh",
      "--source",
      source,
      ...(source === "github" ? githubFlags({ org, repo }) : []),
      ...backfillFlags({ backfill }),
    ],
    source,
  };
}

/**
 * Build the exact independent refresh commands the onboarding flow launches concurrently.
 *
 * @param repo the `owner/repo` anchor
 * @param org the GitHub org (repo owner unless overridden)
 * @param backfill the chosen depth
 * @param sources the connected sources to refresh, in launch order
 * @returns one argv tail per source, each beginning with `refresh`
 */
export function buildRefreshCommands({
  repo,
  org,
  backfill,
  sources,
}: {
  repo: string;
  org: string;
  backfill: BackfillChoice;
  sources: readonly ConnectSource[];
}): readonly OnboardingRefreshCommand[] {
  return sources.map((source) => refreshCommandFor({ backfill, org, repo, source }));
}
