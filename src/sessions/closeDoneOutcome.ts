/**
 * How one `session close-done` sweep ended for each row, and the lines and counts it prints — pure.
 *
 * The planning half is `./closeDone.ts`; this is what happened after the screens were read. A run seat with no
 * done evidence is PARKED here when it is at rest (a parked session leaves the fleet
 * immediately), so the summary counts parked seats beside closed ones
 * and keeps printing nothing for the working fleet.
 */
import type { CloseDonePlanItem, KeepReason, ScreenVerdict } from "./closeDone.js";
import type { DoneEvidence } from "./dispatchDoneEvidence.js";
import { type ParkKeepReason, QUIET_PARK_KEEPS } from "./parkSeat.js";
import type { SessionItem } from "./session.js";

/** A run seat with no done evidence, live in cmux — parked when it proves at rest. */
type ParkCandidate = CloseDonePlanItem & { readonly kind: "park-candidate" };

/** How one sweep ended for one row — what the verb prints per line and folds into its summary. */
export type CloseDoneOutcome =
  /**
   * Closed. `keepAlive` names the keep-alive it retired, when the screen's only background shell was one another
   * watch covers (`./keepAliveSeatClose.ts`) — the screen read `busy`, so "screen idle" would be untrue.
   */
  | {
      readonly kind: "closed";
      readonly item: CloseDonePlanItem & { readonly kind: "candidate" };
      readonly keepAlive?: string;
    }
  /** Held. `keepAlive` says why a screen busy with a keep-alive shell was not closed as one. */
  | {
      readonly kind: "held";
      readonly item: CloseDonePlanItem & { readonly kind: "candidate" };
      readonly verdict: Exclude<ScreenVerdict, "idle">;
      readonly keepAlive?: string;
    }
  | {
      readonly kind: "close-failed";
      readonly item: CloseDonePlanItem & { readonly kind: "candidate" };
      readonly reason: string;
    }
  | { readonly kind: "drift-closed"; readonly item: CloseDonePlanItem & { readonly kind: "drifted" } }
  | { readonly kind: "kept"; readonly item: CloseDonePlanItem & { readonly kind: "kept" } }
  /**
   * At rest and closed. `recorded` journalled its checkpoint first, its drafts included; `predecessor` was the
   * seat a park already journalled, left open, so nothing new was written.
   */
  | {
      readonly kind: "parked";
      readonly item: ParkCandidate;
      readonly how: "recorded" | "predecessor";
      readonly drafts: number;
    }
  /** Left open, and why — `why` carries the detail a reason alone does not, such as which identity check failed. */
  | {
      readonly kind: "park-kept";
      readonly item: ParkCandidate;
      readonly reason: ParkKeepReason;
      readonly why?: string;
    }
  /** The park failed part-way; `journalled` says whether its checkpoint was written before the close failed. */
  | {
      readonly kind: "park-failed";
      readonly item: ParkCandidate;
      readonly reason: string;
      readonly journalled: boolean;
    };

/** One line of evidence, for a row's own report line. */
function describeEvidence({ evidence }: { evidence: DoneEvidence }): string {
  switch (evidence.kind) {
    case "run-closed":
      return "run finished";
    case "ask-settled":
      return `ask settled (${evidence.settlement})`;
    case "doc-terminal":
      return `doc ${evidence.status}`;
    case "turn-finalised":
      return evidence.terminal === "answered"
        ? `${evidence.role} child, answer posted`
        : `${evidence.role} child, turn ${evidence.terminal}`;
    case "parent-lease-expired":
      return "review child, parent lease expired";
    case "parent-worker-gone":
      return "review child, parent worker workspace gone";
    default: {
      const exhaustive: never = evidence;
      return exhaustive;
    }
  }
}

/** Whether one outcome is a dispatch child this sweep reaped — what the summary names one by one. */
function reapedChild({
  outcome,
}: {
  outcome: CloseDoneOutcome;
}): { readonly ref: string; readonly name: string; readonly why: string } | undefined {
  if (outcome.kind !== "closed" || !DISPATCH_EVIDENCE_KINDS.has(outcome.item.evidence.kind)) {
    return undefined;
  }
  return {
    name: rowName({ row: outcome.item.row }),
    ref: outcome.item.workspace.workspaceRef,
    why: describeEvidence({ evidence: outcome.item.evidence }),
  };
}

/** The evidence kinds that only a bot-turn dispatch child can carry. */
const DISPATCH_EVIDENCE_KINDS: ReadonlySet<DoneEvidence["kind"]> = new Set([
  "turn-finalised",
  "parent-lease-expired",
  "parent-worker-gone",
]);

/** The name a row is reported under: its slug, else its key. */
function rowName({ row }: { row: SessionItem }): string {
  if (row.slug === undefined) {
    return row.sessionKey;
  }
  return row.slug;
}

/** The keep reasons that render no line at all — see {@link renderCloseDoneOutcome}. */
const QUIET_KEEP_REASONS: ReadonlySet<KeepReason> = new Set<KeepReason>(["dispatch-open"]);

/** One parked seat's line. */
function parkedLine({
  dryRun,
  outcome,
}: {
  dryRun: boolean;
  outcome: CloseDoneOutcome & { readonly kind: "parked" };
}): string {
  const head = `${dryRun ? "would park" : "parked"} ${outcome.item.workspace.workspaceRef} ${rowName({ row: outcome.item.row })}`;
  if (outcome.how === "predecessor") {
    return `${head} — parked already, its seat was left open; nothing new journalled`;
  }
  return `${head} — at rest, no shell running; checkpoint journalled with ${String(outcome.drafts)} unsent draft(s)`;
}

/** One kept-at-park seat's line, or `undefined` when it is simply working. */
function parkKeptLine({ outcome }: { outcome: CloseDoneOutcome & { readonly kind: "park-kept" } }): string | undefined {
  if (QUIET_PARK_KEEPS.has(outcome.reason)) {
    return undefined;
  }
  const detail = outcome.why === undefined ? "" : `: ${outcome.why}`;
  return `kept ${outcome.item.workspace.workspaceRef} ${rowName({ row: outcome.item.row })} — ${outcome.reason}${detail}`;
}

/**
 * One line describing what happened to one row. A dispatch child mid-turn and a run seat that is working render
 * nothing: they are the ordinary working fleet, and listing them every tick is the wall doctrine rule 7 refuses.
 *
 * @param outcome one row's outcome
 * @param dryRun whether the sweep only reported what it would do
 * @returns the line, or `undefined` for a row not worth a line
 */
export function renderCloseDoneOutcome({
  outcome,
  dryRun,
}: {
  outcome: CloseDoneOutcome;
  dryRun: boolean;
}): string | undefined {
  const verb = dryRun ? "would close" : "closed";
  switch (outcome.kind) {
    case "closed": {
      // The screen read `busy` when a keep-alive close forced it, so "screen idle" is said only when no note was.
      let why = "screen idle";
      if (outcome.keepAlive !== undefined) {
        why = outcome.keepAlive;
      }
      return `${verb} ${outcome.item.workspace.workspaceRef} ${rowName({ row: outcome.item.row })} — ${describeEvidence({ evidence: outcome.item.evidence })}, ${why}`;
    }
    case "held":
      return `held ${outcome.item.workspace.workspaceRef} ${rowName({ row: outcome.item.row })} — ${describeEvidence({ evidence: outcome.item.evidence })}, but screen ${outcome.verdict}${outcome.keepAlive === undefined ? "" : ` (${outcome.keepAlive})`}`;
    case "close-failed":
      return `FAILED to close ${outcome.item.workspace.workspaceRef} ${rowName({ row: outcome.item.row })} — ${outcome.reason}`;
    case "drift-closed":
      return `${verb} ledger row ${outcome.item.workspaceRef} ${rowName({ row: outcome.item.row })} — workspace already gone`;
    case "kept":
      return QUIET_KEEP_REASONS.has(outcome.item.reason)
        ? undefined
        : `kept ${rowName({ row: outcome.item.row })} — ${outcome.item.reason}`;
    case "parked":
      return parkedLine({ dryRun, outcome });
    case "park-kept":
      return parkKeptLine({ outcome });
    case "park-failed":
      return `FAILED to park ${outcome.item.workspace.workspaceRef} ${rowName({ row: outcome.item.row })} — ${outcome.reason}${outcome.journalled ? " (its checkpoint IS journalled; the seat is still open)" : ""}`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/**
 * The counts a summary line and the briefing fold carry.
 *
 * @internal — `countCloseDone`'s return shape; callers read its fields, never its name.
 */
export interface CloseDoneCounts {
  readonly closed: number;
  readonly parked: number;
  readonly held: number;
  readonly failed: number;
  readonly driftClosed: number;
  readonly kept: number;
}

/**
 * Fold outcomes into the counts the summary prints. A failed park counts as failed and a kept one as kept.
 *
 * @param outcomes every row's outcome
 * @returns the counts
 */
export function countCloseDone({ outcomes }: { outcomes: readonly CloseDoneOutcome[] }): CloseDoneCounts {
  const count = ({ kinds }: { kinds: readonly CloseDoneOutcome["kind"][] }): number =>
    outcomes.filter((outcome) => kinds.includes(outcome.kind)).length;
  return {
    closed: count({ kinds: ["closed"] }),
    driftClosed: count({ kinds: ["drift-closed"] }),
    failed: count({ kinds: ["close-failed", "park-failed"] }),
    held: count({ kinds: ["held"] }),
    kept: count({ kinds: ["kept", "park-kept"] }),
    parked: count({ kinds: ["parked"] }),
  };
}

/**
 * The one-line summary — the line the sweep contract folds into the briefing, so the count is printed rather
 * than remembered.
 *
 * It takes the OUTCOMES rather than the counts, and folds them itself, so a summary can never name a number
 * the outcomes beside it do not support. Every reaped bot-turn dispatch child is then named individually,
 * with its evidence: those are the workspaces the owner watched pile up, so a bare count would be the line
 * the owner has to go and check by hand. A held, failed or kept child is NOT listed here — its own outcome line
 * already says so, and the counts cover it.
 *
 * @param dryRun whether the sweep only reported what it would do
 * @param outcomes every placed row's outcome
 * @returns the summary line
 */
export function renderCloseDoneSummary({
  dryRun,
  outcomes,
}: {
  dryRun: boolean;
  outcomes: readonly CloseDoneOutcome[];
}): string {
  const counts = countCloseDone({ outcomes });
  const verb = dryRun ? "would close" : "closed";
  const parts = [
    `${verb} ${String(counts.closed)} done chat(s)`,
    `${dryRun ? "would park" : "parked"} ${String(counts.parked)} at-rest seat(s)`,
    `${String(counts.driftClosed)} drifted ledger row(s)`,
    `held ${String(counts.held)} done-but-busy`,
    `kept ${String(counts.kept)} row(s)`,
  ];
  if (counts.failed > 0) {
    parts.push(`${String(counts.failed)} FAILED`);
  }
  const reaped = outcomes.map((outcome) => reapedChild({ outcome })).filter((child) => child !== undefined);
  const summary = `session close-done: ${parts.join(", ")}`;
  if (reaped.length === 0) {
    return summary;
  }
  const listed = reaped.map((child) => `${child.ref} ${child.name} [${child.why}]`).join("; ");
  const reapVerb = dryRun ? "would reap" : "reaped";
  return `${summary} — ${reapVerb} ${String(reaped.length)} dispatch child(ren): ${listed}`;
}
