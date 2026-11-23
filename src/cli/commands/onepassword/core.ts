/**
 * The PURE core of `slopweaver onepassword sync|reset`: flag parsing, the default audit window, the exit
 * code a report earns, and the human rendering of one. No fs, no clock, no subprocess — the shells
 * ({@link ./syncRun}, {@link ./resetRun}) own every read, write, `op` invocation and credential resolution.
 */
import type { OnepasswordSensitivityFinding } from "../../../atlas/onepassword/sensitivity.js";
import type { OnepasswordSyncReport } from "../../../atlas/onepassword/sync.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";

/**
 * How far back the audit walk reaches when `--since` is absent.
 *
 * Thirty days rather than "everything": the Events API is paginated and the walk is bounded, so an
 * unbounded default would silently truncate on a busy account and report a gap on every run. A caller who
 * wants more says so.
 *
 * @internal
 */
export const ONEPASSWORD_DEFAULT_SINCE_DAYS = 30;

/**
 * `onepassword sync`'s flag SPEC, exported so the repo-wide `--help`-truth ratchet reads the same list the
 * parser does. Two copies of a flag list is how a verb starts advertising a flag it does not accept.
 *
 * @internal
 */
export const ONEPASSWORD_SYNC_FLAG_SPEC = { boolean: ["json"], value: ["home", "since"] } as const;

/**
 * `onepassword reset`'s flag SPEC, exported for the same reason.
 *
 * @internal
 */
export const ONEPASSWORD_RESET_FLAG_SPEC = { boolean: ["json"], value: ["home", "confirm"] } as const;

/** Every flag `onepassword sync` accepts, as the `--`-prefixed tokens a caller types. */
export const ONEPASSWORD_SYNC_FLAG_NAMES: readonly string[] = [
  ...ONEPASSWORD_SYNC_FLAG_SPEC.value.map((name) => `--${name}`),
  ...ONEPASSWORD_SYNC_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** Every flag `onepassword reset` accepts, as the `--`-prefixed tokens a caller types. */
export const ONEPASSWORD_RESET_FLAG_NAMES: readonly string[] = [
  ...ONEPASSWORD_RESET_FLAG_SPEC.value.map((name) => `--${name}`),
  ...ONEPASSWORD_RESET_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * The validated `onepassword reset` invocation.
 *
 * @internal
 */
export interface OnepasswordResetOptions {
  readonly home: string;
  readonly json: boolean;
  /** The caller's `--confirm` value, unvalidated here — the verb decides what it must equal. */
  readonly confirm: string | undefined;
}

/**
 * Parse the `reset` verb tail.
 *
 * Deliberately does NOT enforce `--confirm archive`: that is the verb's own refusal, with its own message,
 * and pushing it in here would make every `--help`-truth probe of another flag fail on the missing confirm
 * instead of on the flag it was testing.
 *
 * @param rest the argv tail (after `slopweaver onepassword reset`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed options, or every rejection
 */
export function parseOnepasswordResetOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<OnepasswordResetOptions> {
  const parsed = parseFlagTail({ rest, spec: ONEPASSWORD_RESET_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({
    confirm: values["confirm"],
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  });
}

/**
 * The validated `onepassword sync` invocation.
 *
 * @internal
 */
export interface OnepasswordSyncOptions {
  readonly home: string;
  readonly json: boolean;
  readonly since: string | null;
}

/**
 * Parse the `sync` verb tail into validated options.
 *
 * @param rest the argv tail (after `slopweaver onepassword sync`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseOnepasswordSyncOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<OnepasswordSyncOptions> {
  const parsed = parseFlagTail({ rest, spec: ONEPASSWORD_SYNC_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags } = parsed.value;
  const since = flagValue({ name: "since", parsed: parsed.value });
  if (since !== null && Number.isNaN(Date.parse(since))) {
    return err([`--since "${since}" is not an ISO timestamp — pass something like 2026-08-01T00:00:00Z`]);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    since,
  });
}

/**
 * The instant the audit walk starts from: the caller's `--since`, else {@link ONEPASSWORD_DEFAULT_SINCE_DAYS}
 * before this run.
 *
 * @param at this run's ISO timestamp
 * @param since the caller's `--since`, or `null`
 * @returns the ISO instant to walk from
 */
export function onepasswordSinceFor({ at, since }: { at: string; since: string | null }): string {
  if (since !== null) {
    return since;
  }
  return new Date(Date.parse(at) - ONEPASSWORD_DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The exit code a sync report earns.
 *
 * Neither half being configured is `exitExpectedEmpty` rather than an error: a first run with no `op`
 * session and no Events token has nothing to report and has not failed at anything.
 *
 * @param report what the sync established
 * @param exitOk the code for a fully-complete sync
 * @param exitExpectedEmpty the code for a run with neither credential
 * @param exitError the code when any kind synced incompletely
 * @returns the exit code
 */
export function exitCodeForOnepasswordSyncReport({
  report,
  exitOk,
  exitExpectedEmpty,
  exitError,
}: {
  report: OnepasswordSyncReport;
  exitOk: number;
  exitExpectedEmpty: number;
  exitError: number;
}): number {
  if (!report.adminCliConfigured && !report.eventsConfigured) {
    return exitExpectedEmpty;
  }
  return report.kinds.every((kind) => kind.complete) ? exitOk : exitError;
}

/**
 * The ONE stderr line a sync that exits on an incomplete kind ends on, naming every incomplete kind and why,
 * or `null` when every kind synced completely. Pure.
 *
 * A scheduled resync runs this verb in process and its slot record keeps only the last three non-blank
 * STDERR lines (`../../../live/automation/verbFailureWhy.ts`), two of which `automation resync` writes itself.
 * The kind reasons go to stdout, so none of them reached the record. MEASURED: `resync-atlas-onepassword`'s
 * firing exited 1 on `vault-grant: op vault group list <id> failed; spawnSync op ETIMEDOUT`
 * and its record's why was the sensitivity scan's 32 MiB size WARNING, which caused nothing. Repro: `grep -h
 * '"detail"' $SLOPWEAVER_HOME/live/recipe/slot-attempts/*.json | grep onepassword`.
 *
 * Kept on ONE physical line, so a reason's own line breaks cannot push its first half out of that tail.
 *
 * @param report what the sync established
 * @returns the closing line, or `null` when nothing was incomplete
 */
export function onepasswordSyncFailureClosingLine({ report }: { report: OnepasswordSyncReport }): string | null {
  const incomplete = report.kinds.filter((kind) => !kind.complete);
  if (incomplete.length === 0) {
    return null;
  }
  const clauses = incomplete.map((kind) => {
    const said = kind.reasons.join("; ").replace(/\s+/g, " ").trim();
    return `${kind.kind}: ${said.length === 0 ? "incomplete without a stated reason" : said}`;
  });
  return `onepassword sync incomplete: ${clauses.join("; ")}`;
}

/**
 * The reported-findings lines, GROUPED BY CLASS with a count.
 *
 * One line per finding is what this printed first, and the first real events pull made the reason obvious:
 * 5,248 findings of a single class, every line identical but for a line number, burying the sync's own
 * outcome under a wall nobody reads. The count is the information; the individual positions are already in
 * the findings the report carries.
 *
 * @param findings every `report`-disposition finding the gate produced
 * @returns one line per distinct class, or nothing at all when the gate reported none
 */
function renderReportedFindingLines({
  findings,
}: {
  findings: readonly OnepasswordSensitivityFinding[];
}): readonly string[] {
  const byLabel = new Map<string, { count: number; reason: string }>();
  for (const finding of findings) {
    // A class's first finding opens its tally; every later one adds to it. The latest reason is the one shown.
    const seen = byLabel.get(finding.label);
    if (seen === undefined) {
      byLabel.set(finding.label, { count: 1, reason: finding.reason });
    } else {
      byLabel.set(finding.label, { count: seen.count + 1, reason: finding.reason });
    }
  }
  return [...byLabel.entries()].map(
    ([label, { count, reason }]) => `  recorded, not refused: ${String(count)} × ${label} — ${reason}`,
  );
}

/**
 * The human report lines for one sync run.
 *
 * Each half's configured state is printed even when it is fine, because "the roster is missing" and "the
 * roster is empty" look identical in a per-kind list and mean completely different things.
 *
 * @param report what the sync established
 * @returns the report lines, in display order
 */
export function renderOnepasswordSyncLines({ report }: { report: OnepasswordSyncReport }): readonly string[] {
  return [
    ...renderOnepasswordChannelLines({
      adminCliConfigured: report.adminCliConfigured,
      eventsConfigured: report.eventsConfigured,
    }),
    ...report.kinds.flatMap((kind) => [
      `${kind.kind}: ${kind.complete ? "synced" : "INCOMPLETE"}, ${String(kind.entityCount)} record(s)`,
      ...kind.reasons.map((reason) => `  ${reason}`),
    ]),
    ...renderOnepasswordTailLines({ report }),
  ];
}

/**
 * Which halves were configured — printed BEFORE any work starts, so "the roster is missing" and "the roster
 * is empty" cannot look alike while a long walk is still running.
 *
 * Takes the two flags rather than the report, because the caller knows both before the sync it would have
 * to finish to produce one.
 *
 * @returns one line per channel
 */
export function renderOnepasswordChannelLines({
  adminCliConfigured,
  eventsConfigured,
}: {
  adminCliConfigured: boolean;
  eventsConfigured: boolean;
}): readonly string[] {
  return [
    `admin-cli: ${adminCliConfigured ? "configured" : "NOT configured"}`,
    `events-api: ${eventsConfigured ? "configured" : "NOT configured"}`,
  ];
}

/**
 * Everything after the per-kind lines: why a kind fell short, what the gate recorded, where the README went.
 *
 * Split from {@link renderOnepasswordSyncLines} because a live run STREAMS its kinds through the progress
 * sink as they land, so reprinting them at the end would say everything twice — and the reasons, which are
 * the part a reader acts on, would be buried in the repeat.
 *
 * @param report what the sync established
 * @returns the tail lines, in display order
 */
export function renderOnepasswordTailLines({ report }: { report: OnepasswordSyncReport }): readonly string[] {
  return [
    ...report.kinds.flatMap((kind) => kind.reasons.map((reason) => `  ${kind.kind}: ${reason}`)),
    ...renderReportedFindingLines({ findings: report.reportedFindings }),
    ...(report.readmePath === null ? ["  the atlas README could not be written"] : [`README: ${report.readmePath}`]),
    ...(report.lockReleaseError === null ? [] : [`  the sync lock could not be released: ${report.lockReleaseError}`]),
  ];
}
