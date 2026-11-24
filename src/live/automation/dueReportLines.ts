/**
 * Rendering a {@link DueAskReport} as the lines a supervisor tick reads.
 *
 * Split from `./dueReport.ts` for the reason every renderer here is split from its data: the composition
 * is a claim about priority a test can pin, and the rendering is a shape a test can pin, and folding them
 * would make each one only testable through the other.
 *
 * The shape is the sweep contract's own idiom — one line per row whether or not it was selected, then one
 * summary line — because a tick pastes these into a briefing fold and a row that vanished when it went
 * quiet would read as a row that had been removed.
 */
import { renderAge } from "../../lib/duration.js";
import type { DueAskReport, DueAskRow } from "./dueReport.js";
import { BRIEFING_KIND } from "./kinds.js";
import { ownerHoldIsOwners } from "./ownerHoldPlacedBy.js";
import { ownRepositoryUnresolvedLine } from "./ownRepository.js";
import { absentStandingRowLine } from "./standingRowAbsence.js";
import { repositoryDriftLine } from "./standingRowRepositoryDrift.js";
import { supersededStandingRowLine } from "./standingRowSupersession.js";
import { strandedResyncLine } from "./strandedResync.js";

/**
 * A row OFF on an owner hold that carries no word of the owner's naming it — `./ownerHoldPlacedBy.ts`. A held row
 * with no finding and no attribution state at all is one too: nothing checked it, so it is never printed as the
 * owner's. A failure hold is decided by its finding alone, never by a finding line a hold with no finding carries.
 */
function unowned({ row }: { readonly row: DueAskRow }): boolean {
  if (row.offReason !== "held" || row.heldOnFinding !== undefined) {
    return false;
  }
  const state = row.ownerHoldPlacedByState;
  return state === undefined || !ownerHoldIsOwners({ recipeId: row.recipeId, state });
}

/**
 * The leading marker: what a reader scans the column for. A row the store holds on a failure finding is BROKEN
 * rather than `--`: it is off because it failed, and nothing brings it back until a seat fixes it. A row held on
 * a hold no word of the owner's names is UNOWNED: nobody the owner can see chose it, so a session finds the owner's
 * word or lifts it. A row with no executor keeps `!!` first and still says UNOWNED, so the label is never lost to it.
 */
function marker({ row }: { readonly row: DueAskRow }): string {
  if (row.shape === "no-executor") {
    return unowned({ row }) ? "!! UNOWNED" : "!!";
  }
  if (row.heldOnFinding !== undefined) {
    return "BROKEN";
  }
  if (unowned({ row })) {
    return "UNOWNED";
  }
  if (row.actionable) {
    return "DUE";
  }
  return "--";
}

/**
 * Which hold a HELD row is under, and what lifts it: the store's own failure hold, an owner hold no word of the
 * owner's names, or the owner's anchored hold.
 */
function heldLateness({ row }: { readonly row: DueAskRow }): string {
  if (row.heldOnFinding !== undefined) {
    return row.heldFindingLine === undefined
      ? `OFF · HELD by the store on finding ${row.heldOnFinding} — lifts when that finding settles with its fix, no hatch`
      : `OFF · HELD by the store — ${row.heldFindingLine}, no hatch`;
  }
  const state = row.ownerHoldPlacedByState;
  if (state?.kind === "unresolved") {
    return (
      `OFF · HELD, but no word of the owner's naming this automation is on the hold (${state.reason}) — ` +
      "find the owner's word naming it and fix `hold.placedBy`, or ask on the owner's Queue whether to lift it, no hatch"
    );
  }
  if (state === undefined || state.kind === "unanchored") {
    return (
      "OFF · HELD, but no word of the owner's naming this automation is on the hold — find the owner's word naming " +
      "it and write `hold.placedBy`, or ask on the owner's Queue whether to lift it, no hatch"
    );
  }
  if (unowned({ row })) {
    return (
      "OFF · HELD, but the hold's anchored state was not minted for this automation — find the owner's word " +
      "naming it and fix `hold.placedBy`, or ask on the owner's Queue whether to lift it, no hatch"
    );
  }
  return "OFF · HELD — lifted only by the owner's recorded approval (a Queue answer or the owner's bot DM), no hatch";
}

/**
 * How late the row is, or why that cannot be said.
 *
 * The OFF branch comes first among the not-due cases, and it is the one this function used to lack. A row
 * that is off and a row that is merely between firings are both `due: false`, so without it both printed
 * `current · next in <n>` — and a reader checking that something had been switched OFF was answered with
 * when it would next run. It says which of the two kinds of off it is, because only one of them can be
 * undone by writing a boolean back.
 */
function lateness({ row }: { readonly row: DueAskRow }): string {
  if (row.tolerance.band === "unschedulable") {
    return "cadence UNREADABLE";
  }
  if (row.offReason === "held") {
    return heldLateness({ row });
  }
  if (row.offReason === "disabled") {
    return "OFF · disabled";
  }
  // Never "current": a firing went by unrun and was given up, and the line says which.
  if (row.deferredSlotIso !== undefined) {
    const next =
      row.tolerance.nextFiringInMs === null ? "" : ` · next in ${renderAge({ ms: row.tolerance.nextFiringInMs })}`;
    return `DEFERRED · slot ${row.deferredSlotIso} handed to its successor${next}`;
  }
  if (!row.due) {
    return row.tolerance.nextFiringInMs === null
      ? "current"
      : `current · next in ${renderAge({ ms: row.tolerance.nextFiringInMs })}`;
  }
  const late = row.tolerance.lateByMs === null ? "" : ` ${renderAge({ ms: row.tolerance.lateByMs })} late`;
  return `${row.tolerance.band}${late}`;
}

/**
 * What running it costs, and what it would do to the world.
 *
 * The briefing-only kind gets its own sentence rather than the plain "run here", because both halves of it
 * are what a tick needs: asking the question IS a command in this process, and the answer is then the ask
 * lane's to judge and dispatch like any tag. Reading it as a bare in-process
 * row would hide the session it may still cost; reading it as a spawn would have the tick hold a slot the
 * lane is the one that decides about.
 */
function cost({ row }: { readonly row: DueAskRow }): string {
  if (row.shape === "no-executor") {
    return `${row.kind} · NO EXECUTOR in this build`;
  }
  if (row.kind === BRIEFING_KIND) {
    return `${row.kind} · ask here, ANSWERED in the ask lane · effect ${row.effect}`;
  }
  const where = row.shape === "spawn" ? "SPAWN a session" : "run here, in this process";
  return `${row.kind} · ${where} · effect ${row.effect}`;
}

/** The slot a run covers and how the older missed firings are treated — empty for a row that is not due. */
function slot({ row }: { readonly row: DueAskRow }): string {
  if (row.slotIso === null) {
    return "";
  }
  if (row.slotsOwedAfterThis > 0) {
    return ` · backfills slot ${row.slotIso} · ${String(row.slotsOwedAfterThis)} more slot(s) owed`;
  }
  if (row.firingsSinceWatermark > 1) {
    return ` · covers slot ${row.slotIso} · ${String(row.firingsSinceWatermark - 1)} firing(s) missed, onMissed ${row.onMissed}`;
  }
  return ` · covers slot ${row.slotIso}`;
}

/**
 * One row's line.
 *
 * A claimed row says who holds it and until when, rather than simply dropping to `--`: a supervisor that
 * cannot see why a due row is not actionable will eventually decide the read is broken and act anyway.
 *
 * @param row the composed row
 * @returns the line to print
 */
export function dueAskLine({ row }: { readonly row: DueAskRow }): string {
  const held = row.claim === undefined ? "" : ` · CLAIMED by ${row.claim.claimedBy} until ${row.claim.expiresAtIso}`;
  return `${marker({ row })} ${row.recipeId} · ${cost({ row })} · ${lateness({ row })}${slot({ row })}${held}`;
}

/**
 * The whole report as lines, ending in the one-line tally.
 *
 * The tally counts what a tick actually decides between — actionable rows, and how many of those want a
 * session — rather than how many rows exist, because the row count is the one number a supervisor cannot
 * act on.
 *
 * @param report the composed report
 * @returns the lines to print, in order
 */
export function dueAskLines({ report }: { readonly report: DueAskReport }): readonly string[] {
  return reportLines({ report, shown: report.rows });
}

/** The row lines in print order, the `--brief` omission line under them, and the two counts the tally reads. */
function rowSection({ report, shown }: { readonly report: DueAskReport; readonly shown: readonly DueAskRow[] }): {
  readonly lines: readonly string[];
  readonly broken: number;
  readonly unowned: number;
} {
  // A row held on a failure finding prints above every DUE row. MEASURED: resync-corpus-notion,
  // off since its failure the day before, printed 34th — below eleven DUE rows and twenty-two current
  // ones — and the owner saw Notion failing on the sidebar before the chair read it here.
  // An UNOWNED row prints next, still above every DUE row: MEASURED, vulnfix-topup-acme-admin sat
  // under a hold the chair placed by keypress, printing `--` among the current rows, while the owner asked where it was.
  const broken = report.rows.filter((row) => row.heldOnFinding !== undefined);
  const unownedRows = report.rows.filter((row) => row.heldOnFinding === undefined && unowned({ row }));
  const rest = report.rows.filter((row) => row.heldOnFinding === undefined && !unowned({ row }));
  const rows = [...broken, ...unownedRows, ...rest]
    .filter((row) => shown.includes(row))
    .map((row) => dueAskLine({ row }));
  const omitted = report.rows.length - shown.length;
  const omission =
    omitted === 0
      ? []
      : [`automation due · ${String(omitted)} quiet row(s) omitted by --brief — drop --brief to list them`];
  return { broken: broken.length, lines: [...rows, ...omission], unowned: unownedRows.length };
}

/**
 * The report as lines with only `shown` of its rows printed, and one line counting the rest above the tally.
 * The problem lines above the rows and the tally itself are always the WHOLE report's: a brief read hides quiet
 * rows, never a problem and never a count.
 */
function reportLines({
  report,
  shown,
}: {
  readonly report: DueAskReport;
  readonly shown: readonly DueAskRow[];
}): readonly string[] {
  // A declared row that is GONE prints first, above every rejected file and every live row. It is the one
  // line here that is about something the report cannot otherwise see, and the seventeen days it took to
  // notice the last one is what buys it the top of the output rather than a footnote under the tally.
  const registry = teamRepositoryLines({ registry: report.teamRepositories });
  const retired = retirementLines({ retirements: report.retirements });
  const missing = [
    ...retired.leading,
    ...registry.leading,
    ...ownRepositoryLines({ state: report.ownRepository }),
    ...report.missing.map((absence) => absentStandingRowLine({ absence })),
    ...report.superseded.map((supersession) => supersededStandingRowLine({ supersession })),
    ...report.repositoryDrift.map((drift) => repositoryDriftLine({ drift })),
  ];
  // Below MISSING and above everything else. A row that does not exist at all is strictly worse than one
  // that exists and cannot be reached, and both outrank a per-row line: a reader who scrolls to find either
  // has already been failed, which is what `./strandedResync.ts` measured.
  const stranded = report.stranded.length === 0 ? [] : [strandedResyncLine({ recipeIds: report.stranded })];
  const rejected = report.rejected.map((problem) => `!! ${problem}`);
  const section = rowSection({ report, shown });
  const tally = tallyLine({ broken: section.broken, report, unownedCount: section.unowned });
  if (report.rows.length === 0 && rejected.length === 0) {
    return [
      ...missing,
      ...stranded,
      "automation due · no definitions — nothing is scheduled on this install",
      ...registry.informational,
      ...retired.informational,
      tally,
    ];
  }
  return [
    ...missing,
    ...stranded,
    ...rejected,
    ...section.lines,
    ...registry.informational,
    ...retired.informational,
    tally,
  ];
}

/**
 * The retirement registry's two possible lines: one leading every other problem, one naming every retired row.
 *
 * A retired row has no definition, so it has no row line — this is the one line that keeps a retirement from being
 * the silence `./standingRowAbsence.ts` exists to break. An unreadable registry leads even the MISSING lines: the
 * declaration is unknown, so nothing was compared.
 */
function retirementLines({ retirements }: { readonly retirements: DueAskReport["retirements"] }): {
  readonly leading: readonly string[];
  readonly informational: readonly string[];
} {
  if (retirements === undefined || retirements.kind === "none") {
    return { informational: [], leading: [] };
  }
  if (retirements.kind === "unreadable") {
    const line = `!! retirements · ${retirements.error.message} — no declared row was compared`;
    return { informational: [], leading: [line] };
  }
  const line =
    `automation due · RETIRED on this install: ${retirements.recipeIds.join(", ")} — ` +
    "`slopweaver automation retire --undo <id>` restores one";
  return { informational: [line], leading: [] };
}

/**
 * The team registry's two possible lines: one leading every other problem, one informational above the tally.
 *
 * An unreadable registry leads even the MISSING lines: the declaration it feeds is unknown, so the empty MISSING
 * and SUPERSEDED lists under it mean nothing was compared, never that nothing is missing. No registry at all is
 * informational, not a finding: a fresh install declares no team repository, and saying so is what tells a reader
 * the team rows are absent by registration rather than by deletion.
 */
function teamRepositoryLines({ registry }: { readonly registry: DueAskReport["teamRepositories"] }): {
  readonly leading: readonly string[];
  readonly informational: readonly string[];
} {
  if (registry === undefined || registry.kind === "configured") {
    return { informational: [], leading: [] };
  }
  if (registry.kind === "unreadable") {
    return { informational: [], leading: [`!! team repositories · ${registry.error.message}`] };
  }
  return { informational: ["automation due · no team repositories configured on this install"], leading: [] };
}

/** The own repository's one leading line, or nothing when it resolved. */
function ownRepositoryLines({ state }: { readonly state: DueAskReport["ownRepository"] }): readonly string[] {
  if (state === undefined || state.kind === "resolved") {
    return [];
  }
  if (state.kind === "history-unreadable") {
    return [`!! own repositories · ${state.message}`];
  }
  return [`!! ${ownRepositoryUnresolvedLine({ state })}`];
}

/** The tally line closing every report, counted over the WHOLE report whatever `--brief` hid. */
function tallyLine({
  broken,
  report,
  unownedCount,
}: {
  readonly broken: number;
  readonly report: DueAskReport;
  readonly unownedCount: number;
}): string {
  const actionable = report.rows.filter((row) => row.actionable);
  const wantSession = actionable.filter((row) => row.shape === "spawn");
  const claimed = report.rows.filter((row) => row.claim !== undefined);
  const brokenTally = broken === 0 ? "" : ` · ${String(broken)} BROKEN, held on a failure finding`;
  const unownedTally =
    unownedCount === 0 ? "" : ` · ${String(unownedCount)} UNOWNED, owner hold lacks the owner's naming words`;
  const absent = report.missing.length === 0 ? "" : ` · ${String(report.missing.length)} DECLARED row(s) MISSING`;
  const unreachable = report.stranded.length === 0 ? "" : ` · ${String(report.stranded.length)} STRANDED`;
  const superseded =
    report.superseded.length === 0 ? "" : ` · ${String(report.superseded.length)} DECLARED row(s) SUPERSEDED`;
  const drifted =
    report.repositoryDrift.length === 0 ? "" : ` · ${String(report.repositoryDrift.length)} REPOSITORY DRIFT`;
  let retiredTally = "";
  if (report.retirements?.kind === "configured") {
    retiredTally = ` · ${String(report.retirements.recipeIds.length)} RETIRED on this install`;
  }
  return (
    `${String(actionable.length)} actionable · ${String(wantSession.length)} want a session · ` +
    `${String(claimed.length)} claimed · ${String(report.rows.length)} row(s) read${brokenTally}${unownedTally}${absent}${superseded}${drifted}${unreachable}${retiredTally}`
  );
}

/**
 * Whether a tick decides anything on this row, written as the QUIET set so a problem state this function has
 * never heard of is kept rather than folded away (an UNSCHEDULABLE row is one). Quiet is exactly
 * three shapes of a not-due row with an executor and a readable cadence: one between firings with no firing
 * since its watermark, one disabled, and one on a hold carrying the owner's words. Everything else is kept — a DUE row
 * whether or not a claim holds it, since a held firing that vanished would read as a broken read, a slot the due
 * judgement DEFERRED to its successor, and every BROKEN, UNOWNED, no-executor or cadence-UNREADABLE row.
 */
function decidesOn({ row }: { readonly row: DueAskRow }): boolean {
  const readable = !row.due && row.shape !== "no-executor" && row.tolerance.band !== "unschedulable";
  const betweenFirings = row.offReason === undefined && row.firingsSinceWatermark === 0;
  const ownerHold = row.offReason === "held" && row.heldOnFinding === undefined && !unowned({ row });
  const quiet = readable && (betweenFirings || row.offReason === "disabled" || ownerHold);
  return !quiet;
}

/** The `automation due --json --brief` document: the report with its quiet rows left out and counted. */
export type BriefDueAskReport = Omit<DueAskReport, "rows"> & {
  readonly rows: readonly DueAskRow[];
  /** How many rows were quiet and left out — drop `--brief` to list them. */
  readonly omittedQuiet: number;
};

/**
 * Reduce a report to the rows a tick decides on — `automation due --json --brief`. Missing, superseded, stranded
 * and rejected entries are kept whole.
 *
 * @param report the composed report
 * @returns the same report with only its decided-on rows, and the count of quiet ones it left out
 */
export function briefDueAskReport({ report }: { readonly report: DueAskReport }): BriefDueAskReport {
  const rows = report.rows.filter((row) => decidesOn({ row }));
  return { ...report, omittedQuiet: report.rows.length - rows.length, rows };
}

/**
 * The report as lines with its quiet rows replaced by ONE line counting them — `automation due --brief`. The
 * tally is the whole report's, byte for byte, so a quiet tick still reads as a full read rather than an empty one.
 *
 * @param report the composed report
 * @returns the lines to print, in order
 */
export function briefDueAskLines({ report }: { readonly report: DueAskReport }): readonly string[] {
  return reportLines({ report, shown: briefDueAskReport({ report }).rows });
}
