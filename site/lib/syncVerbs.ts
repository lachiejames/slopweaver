/**
 * The closed list of readings the console may TAKE, as opposed to read.
 *
 * `liveVerbs.ts` is what a page reads; a row here is what a page's own refresh runs to put a fresher reading in the
 * ledger for that page to read next. The two are separate lists on purpose: a verb that reads the
 * machine in 20 seconds belongs on the live list, and a verb that reads GitHub or Slack for a minute, or drains a
 * stream another actor also drains, and appends to the readings ledger belongs here, never on a free-running timer.
 * Three owners take them:
 *
 * - the landing reading: the shell, on every page while the console is in view, when the one shown cannot be counted as
 *   the owner's whole open population, drafts included, and when it is due against the landing cadence — woken at that
 *   instant, never on a free clock (`landingFreshness.ts`, `landingAutoRefresh.ts`) — so the row carries `--include-drafts`;
 * - the Queue takes its own currency check once per opening, when the one it shows is ten minutes old or missing
 *   (opening a page refreshes its cards; `currencyOpeningRefresh.ts`);
 * - the Fleet page's Now view takes its own session watch and fleet burn readings once per opening each, on the same
 *   rule (`../components/live/useFleetOpeningRefresh.ts`), so it never depends on a supervisor tick having run.
 *   `machine capacity` is deliberately NOT a row: it reads each Claude plan's ceiling through a probe that spends a
 *   token at Anthropic, so it stays the supervisor's reading.
 *
 * All share one automatic run per reading per ten minutes and one run at a time (`syncFreshness.ts`).
 *
 * What a row may never carry, and the reason this file is short: `--press`, `--register`, or any flag
 * that acts on the world. The console is READ-ONLY. A sync row reads a provider and
 * appends to the local ledger as `sync-now`, and that is the whole of what it may do. Adding a row here is
 * the only way to widen what the sync route can run; an unknown slug is a 404.
 */

/** One reading the console may take on demand. */
export interface SyncVerb {
  /** The name the sync route takes as `/api/sync/<slug>`. */
  readonly slug: string;
  /** The argv after `slopweaver` — literal, never built from a request. */
  readonly argv: readonly string[];
  /** How long the run may take before it is killed and reported as not taken. */
  readonly timeoutMs: number;
  /** The verb line as a reader would type it, printed in a refusal. */
  readonly title: string;
  /** The live-allowlist slug a page re-reads once this run has appended its reading. */
  readonly readsSlug: string;
}

/**
 * Two hundred and forty seconds, the live row's own budget for the same verb. MEASURED on an
 * install whose read spanned two repositories: the `@me` read below, over 44 open pull requests of the owner's with
 * drafts in and GitHub's open census of each repository (422 pull requests, 7.4s of it), took 146.5s — at the old
 * 150s budget's edge; the same read took 91s on an earlier, smaller install. The time grows with the organisation's repository count.
 * Reproduce with `time slopweaver github landing --author @me --json --include-drafts`, whose bare read covers
 * the organisation's own repositories plus this build's.
 */
const LANDING_TIMEOUT_MS = 240_000;

/**
 * One hundred and twenty seconds. A BUDGET, not a measurement: it is `READING_TIMEOUT_MS` in
 * `src/supervisor/scratch/tickCapture.ts`, which already bounds this same verb when the tick records it. Its wall time
 * grows with the Slack-anchored asks it checks, each bounded by `OWNER_REPLY_DEADLINE_MS`
 * (`src/cli/commands/slack/repliedRead.ts`) and checked concurrently.
 */
const CURRENCY_TIMEOUT_MS = 120_000;

/**
 * Sixty seconds. A BUDGET, not a measurement: twice `DRAIN_DEADLINE_MS` (30s, `src/cli/commands/session/watch.ts`),
 * the hard bound on one plain drain however busy the fleet is, leaving the rest for the cmux inventory and title
 * reads the report makes after it and the ledger append.
 */
const SESSION_WATCH_TIMEOUT_MS = 60_000;

/**
 * Twenty seconds. A BUDGET grounded in a measurement: about four times the 5.1s wall `fleet burn` took over a
 * full install's transcripts and rollouts, as `src/supervisor/scratch/fleetReadings.ts` records it with its
 * reproduction command.
 */
const FLEET_BURN_TIMEOUT_MS = 20_000;

/** Every reading a page's own refresh may take. */
export const SYNC_VERBS: readonly SyncVerb[] = [
  {
    argv: ["github", "landing", "--author", "@me", "--json", "--include-drafts", "--record-reading", "sync-now"],
    readsSlug: "landing-reading",
    slug: "landing",
    timeoutMs: LANDING_TIMEOUT_MS,
    title: "slopweaver github landing --author @me --json --include-drafts --record-reading sync-now",
  },
  {
    // Reads Slack threads and GitHub bodies through the typed verb and writes only the readings ledger; it exits
    // non-zero when the ledger refused the append, so the route never reports a reading taken that was not recorded.
    argv: ["handover", "currency", "--json", "--record-reading", "sync-now"],
    readsSlug: "currency-reading",
    slug: "currency",
    timeoutMs: CURRENCY_TIMEOUT_MS,
    title: "slopweaver handover currency --json --record-reading sync-now",
  },
  {
    // Drains cmux's hook stream into the local store's fold (the cursor and fold commit together under one
    // compare-and-set, so a drain racing the tick's loses visibly and appends nothing) and writes only that row and
    // the readings ledger; a refused append exits non-zero.
    argv: ["session", "watch", "--json-report", "--record-reading", "sync-now"],
    readsSlug: "watch-reading",
    slug: "session-watch",
    timeoutMs: SESSION_WATCH_TIMEOUT_MS,
    title: "slopweaver session watch --json-report --record-reading sync-now",
  },
  {
    // Reads the local transcripts and rollouts only — no probe, no network — and writes only the readings ledger.
    argv: ["fleet", "burn", "--json", "--record-reading", "sync-now"],
    readsSlug: "burn-reading",
    slug: "fleet-burn",
    timeoutMs: FLEET_BURN_TIMEOUT_MS,
    title: "slopweaver fleet burn --json --record-reading sync-now",
  },
];

/**
 * Resolve a slug off the URL to a row, or nothing.
 *
 * @param slug the name off the URL
 * @returns the row, or `undefined` for a slug the list does not hold
 */
export function syncVerbFor({ slug }: { slug: string }): SyncVerb | undefined {
  return SYNC_VERBS.find((row) => row.slug === slug);
}
