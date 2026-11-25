/**
 * How current each provider's stored data is, one row per fetchable source — what the console names on every
 * page so old data is never presented as current.
 *
 * The rule: the console says up front when a provider's sync has a problem, because a page that reads as
 * current while its data has drifted from the provider's own UI is worse than one that names the gap.
 *
 * A display projection over `./freshness.ts`'s rows, never a second judge: whether a source is late, failing,
 * blocked, paused or unscheduled was decided there, by the same code the Fleet Briefing renders, so the console
 * and the briefing cannot disagree. What this adds is one row per source even when the roster could not build
 * a policy for it (a provider must never vanish from the page because its policy failed), ages measured
 * against one instant, and one primary state for the line above the fold beside every simultaneous mark.
 *
 * **The clock is the last VERIFIED resync** (`ResyncState.lastSuccessAtIso`). A hand-run `refresh` does not
 * advance it: the sync-run ledger closes before the store leg runs (`cli/commands/refresh/run.ts`
 * `ingestAndReport`), so a ledger success proves a fetch, not that a reader can query the rows. Counting it
 * would recreate the false "current" this exists to remove; the cost is that a manual refresh can leave a row
 * reading older than it is, which errs the safe way.
 *
 * **An age is time since that sync, never literal provider lag.** `./freshness.ts`'s header explains why a
 * quiet source and a frozen one look identical from here, so the words say "last verified sync 7h ago",
 * never "Slack is exactly 7h behind".
 *
 * Pure: values in, one report out. No clock, no filesystem.
 */
import { corpusFreshnessWindowMs } from "../corpus/freshnessPolicy.js";
import type { CorpusSource } from "../corpus/types.js";
import { renderAge } from "../lib/duration.js";
import { resyncTargetLabel } from "../live/resync/target.js";
import type { FreshnessRow } from "./freshness.js";

/** One source's primary state — the one the line above the fold names. */
type SourceFreshnessState =
  "current" | "late" | "failing" | "blocked" | "paused" | "unscheduled" | "never-synced" | "unreadable" | "unverified";

/** Every simultaneous truth about a source, kept beside the one primary state chosen for display. */
interface SourceFreshnessMarks {
  readonly late: boolean;
  readonly failing: boolean;
  readonly blocked: boolean;
  readonly paused: boolean;
  readonly unscheduled: boolean;
  readonly unverified: boolean;
  readonly recordUnreadable: boolean;
}

/** One provider's row. */
interface SourceFreshnessRow {
  readonly source: CorpusSource;
  readonly label: string;
  readonly recipeId: string;
  /** The cadence this build derives, or `null` when the roster built no policy for the source. */
  readonly cadence: string | null;
  readonly storedCadence: string | null;
  readonly windowMs: number;
  /** When the last resync that a reader can query actually succeeded. */
  readonly lastVerifiedSyncAtIso: string | null;
  /** Time since that sync, measured at the report's own instant. */
  readonly behindMs: number | null;
  /** How far past its window that is — zero inside it. */
  readonly lateByMs: number | null;
  /** The newest record the store holds for the source. */
  readonly newestRecordAtIso: string | null;
  readonly newestRecordAgeMs: number | null;
  /** When the last recorded attempt finished, whatever its outcome. */
  readonly lastAttemptAtIso: string | null;
  readonly state: SourceFreshnessState;
  readonly marks: SourceFreshnessMarks;
  /** Every recorded problem, verbatim, in a stable order — never wording invented here. */
  readonly problems: readonly string[];
  readonly blocker: { readonly reason: string; readonly steps: readonly string[] } | null;
}

/** The whole report one read produced. */
export interface SourceFreshnessReport {
  readonly observedAtIso: string;
  readonly sources: readonly SourceFreshnessRow[];
  /** Roster-wide problems — a target the roster could not build a policy for, in its own words. */
  readonly issues: readonly string[];
}

/** How each provider reads to a person. */
const SOURCE_LABELS: Readonly<Record<CorpusSource, string>> = {
  calendar: "Calendar",
  chatgpt: "ChatGPT",
  fathom: "Fathom",
  github: "GitHub",
  gmail: "Gmail",
  gold: "Gold",
  linear: "Linear",
  notion: "Notion",
  outlook: "Outlook",
  "outlook-calendar": "Outlook Calendar",
  self: "Self",
  slack: "Slack",
};

/**
 * Project the briefing's corpus rows into one row per requested source.
 *
 * @param rows the corpus rows `projectFreshness` judged
 * @param sources every source the report must carry, in display order — a source with no row still gets one
 * @param rosterProblems every target the roster could not build a policy for
 * @param nowIso the one instant every age is measured against
 * @returns the report
 */
export function projectSourceFreshness({
  rows,
  sources,
  rosterProblems,
  nowIso,
}: {
  readonly rows: readonly FreshnessRow[];
  readonly sources: readonly CorpusSource[];
  readonly rosterProblems: readonly string[];
  readonly nowIso: string;
}): SourceFreshnessReport {
  const nowMs = Date.parse(nowIso);
  return {
    issues: rosterProblems,
    observedAtIso: nowIso,
    sources: sources.map((source): SourceFreshnessRow => {
      const row = rows.find((one) => one.target.kind === "corpus" && one.target.source === source);
      if (row === undefined) {
        return unrosteredRow({ rosterProblems, source, windowMs: corpusFreshnessWindowMs({ source }) });
      }
      return rosteredRow({ nowMs, row, source });
    }),
  };
}

/** A source with a row: ages, marks and the primary state. */
function rosteredRow({
  row,
  source,
  nowMs,
}: {
  readonly row: FreshnessRow;
  readonly source: CorpusSource;
  readonly nowMs: number;
}): SourceFreshnessRow {
  const behindMs = ageMs({ iso: row.lastSuccessAtIso, nowMs });
  const marks: SourceFreshnessMarks = {
    blocked: row.blocker !== null,
    failing: row.failing,
    late: row.late,
    paused: row.paused,
    recordUnreadable: row.recordUnreadable !== null,
    unscheduled: row.unscheduled,
    unverified: row.unverified,
  };
  return {
    behindMs,
    blocker: row.blocker,
    cadence: row.cadence,
    label: SOURCE_LABELS[source],
    lastAttemptAtIso: row.lastAttempt === null ? null : row.lastAttempt.finishedAtIso,
    lastVerifiedSyncAtIso: row.lastSuccessAtIso,
    lateByMs: behindMs === null ? null : Math.max(0, behindMs - row.windowMs),
    marks,
    newestRecordAgeMs: ageMs({ iso: row.clock, nowMs }),
    newestRecordAtIso: row.clock,
    problems: problemsOf({ row }),
    recipeId: row.recipeId,
    source,
    state: primaryState({ marks, neverSynced: row.lastSuccessAtIso === null }),
    storedCadence: row.storedCadence,
    windowMs: row.windowMs,
  };
}

/**
 * A source the roster built no policy for: it still gets a row, unscheduled, carrying the roster's own words.
 *
 * Nothing schedules it, so nothing is known about its last sync, and saying so is the point: a provider that
 * silently dropped off the page would read as one with nothing wrong.
 */
function unrosteredRow({
  source,
  windowMs,
  rosterProblems,
}: {
  readonly source: CorpusSource;
  readonly windowMs: number;
  readonly rosterProblems: readonly string[];
}): SourceFreshnessRow {
  // Every corpus roster problem opens with the target's own label (`live/resync/policy.ts`, `roster.ts`), so the
  // match is that exact prefix — `github` alone would also claim the GitHub ATLAS's problems.
  const label = resyncTargetLabel({ target: { kind: "corpus", source } });
  const mentioning = rosterProblems.filter((problem) => problem.startsWith(`${label}:`));
  return {
    behindMs: null,
    blocker: null,
    cadence: null,
    label: SOURCE_LABELS[source],
    lastAttemptAtIso: null,
    lastVerifiedSyncAtIso: null,
    lateByMs: null,
    marks: {
      blocked: false,
      failing: false,
      late: true,
      paused: false,
      recordUnreadable: false,
      unscheduled: true,
      unverified: false,
    },
    newestRecordAgeMs: null,
    newestRecordAtIso: null,
    problems: mentioning.length === 0 ? [`no scheduled resync is derived for ${source}`] : mentioning,
    recipeId: `resync-corpus-${source}`,
    source,
    state: "unscheduled",
    storedCadence: null,
    windowMs,
  };
}

/**
 * The one state the line above the fold names, in precedence order.
 *
 * An unreadable record outranks everything because nothing else on the row can be believed; a blocker outranks
 * a failure because it says what clears it; paused and unscheduled outrank lateness because they say why it
 * will not get better on its own.
 */
function primaryState({
  marks,
  neverSynced,
}: {
  readonly marks: SourceFreshnessMarks;
  readonly neverSynced: boolean;
}): SourceFreshnessState {
  if (marks.recordUnreadable) {
    return "unreadable";
  }
  if (marks.blocked) {
    return "blocked";
  }
  if (marks.paused) {
    return "paused";
  }
  if (marks.unscheduled) {
    return "unscheduled";
  }
  if (marks.failing) {
    return "failing";
  }
  if (neverSynced) {
    return "never-synced";
  }
  if (marks.late) {
    return "late";
  }
  if (marks.unverified) {
    return "unverified";
  }
  return "current";
}

/** Every recorded problem on a row, verbatim: the unreadable record, the failed attempt's own words, the blocker. */
function problemsOf({ row }: { readonly row: FreshnessRow }): readonly string[] {
  const failed = row.lastAttempt?.outcome === "failed" ? row.lastAttempt.problems : [];
  const blocker = row.blocker === null || failed.includes(row.blocker.reason) ? [] : [row.blocker.reason];
  return [...(row.recordUnreadable === null ? [] : [row.recordUnreadable]), ...failed, ...blocker];
}

/**
 * The report as terminal lines: one per source, each problem indented under it, then the roster's issues.
 *
 * @param report what one read produced
 * @returns the lines, in source order
 */
export function sourceFreshnessLines({ report }: { readonly report: SourceFreshnessReport }): readonly string[] {
  const rows = report.sources.flatMap((row) => {
    const synced =
      row.behindMs === null
        ? "no verified sync on record"
        : `last verified sync ${renderAge({ ms: row.behindMs })} ago`;
    const past =
      row.lateByMs === null || row.lateByMs === 0 ? "" : `, ${renderAge({ ms: row.lateByMs })} past its window`;
    const newest =
      row.newestRecordAgeMs === null
        ? "no stored record"
        : `newest stored record ${renderAge({ ms: row.newestRecordAgeMs })} old`;
    return [
      `${row.label} — ${row.state}; ${synced}${past}; ${newest}`,
      ...row.problems.map((problem) => `    ${problem}`),
      ...(row.blocker === null ? [] : row.blocker.steps.map((step, index) => `    ${String(index + 1)}. ${step}`)),
    ];
  });
  return [...rows, ...report.issues.map((issue) => `issue: ${issue}`)];
}

/** Milliseconds from an instant to `nowMs`, or `null` when there is no instant or it will not parse. */
function ageMs({ iso, nowMs }: { readonly iso: string | null; readonly nowMs: number }): number | null {
  if (iso === null) {
    return null;
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then) || Number.isNaN(nowMs)) {
    return null;
  }
  return Math.max(0, nowMs - then);
}
