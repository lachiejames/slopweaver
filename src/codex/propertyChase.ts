/**
 * The property-chase reading: one review property id that has come back `BROKEN` run after run on one branch,
 * each run after a fix, so every round bought a NEW counterexample rather than a verdict.
 *
 * It exists because the marginal-yield reading (`./marginalYield.ts`) is keyed on a DIFF, and a chase
 * is invisible there by construction: a re-check after a fix runs on a new diff (an exact re-run on the same
 * one is refused by `./duplicate.ts`), so every round reads as invocation #1. The spend the owner cares about
 * sits exactly in that blind spot — see
 * `skills/codex/reference/when-a-pass-earns-its-cost.md` § A property chase for the measurement.
 *
 * Nothing here decides anything, per the same rule: good judgment plus visibility is the best heuristic.
 * It cannot refuse a pass and changes no floor. It prints what the branch's own
 * ledger already holds, at the two moments a session decides whether to spend another run — `codex status`,
 * and `codex review` before its first model call.
 *
 * Pure. The caller supplies the ledger rows; every rule here is testable without a filesystem.
 */

import type { LedgerEntry } from "./ledger.js";
import type { CodexPassId } from "./types.js";

/**
 * The BROKEN streak at which a chase is printed. A display threshold, never a refusal.
 *
 * Three means the property was fixed twice and is still broken. Two would fire on nearly every re-check, so
 * the line would be noise exactly where it needs to be read — MEASURED over a week of records: a re-check of the same property after a fix came back BROKEN again 367 of 424 times. Repro: the
 * jq pipeline in `skills/codex/reference/when-a-pass-earns-its-cost.md` § A property chase.
 */
export const CHASE_DISPLAY_STREAK = 3;

/** One property id's run history on a branch, as far as a chase needs it. */
export interface PropertyChase {
  readonly propertyId: string;
  /** The review arm of the newest run — a property id is normally only ever run under one. */
  readonly pass: CodexPassId;
  /** Every conclusive, unretired run of this property on the branch. */
  readonly runs: number;
  /** Consecutive `BROKEN` verdicts counting back from the newest run. */
  readonly brokenStreak: number;
}

/** A review verdict that says something about the property; a fault or `NO_VERDICT` says nothing. */
const PROPERTY_VERDICTS: ReadonlySet<string> = new Set(["CLEAN", "BROKEN"]);

/**
 * Every property on the branch whose newest runs form a `BROKEN` streak of at least {@link CHASE_DISPLAY_STREAK}.
 *
 * A fatal or `NO_VERDICT` run is skipped rather than breaking the streak — it concluded nothing about the
 * property. A superseded run is skipped too: its wording was retired on the record, so it is no longer the
 * question being chased.
 *
 * @param entries the branch's ledger rows, in any order
 * @returns the chases, longest streak first, then by property id
 */
export function propertyChases({ entries }: { entries: readonly LedgerEntry[] }): readonly PropertyChase[] {
  const byProperty = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (
      entry.mode !== "review" ||
      entry.propertyId === undefined ||
      entry.superseded !== undefined ||
      !PROPERTY_VERDICTS.has(entry.verdict)
    ) {
      continue;
    }
    const rows = byProperty.get(entry.propertyId);
    if (rows === undefined) {
      byProperty.set(entry.propertyId, [entry]);
    } else {
      rows.push(entry);
    }
  }
  const chases: PropertyChase[] = [];
  for (const [propertyId, rows] of byProperty) {
    const newestFirst = rows.toSorted(
      (a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId),
    );
    const firstClean = newestFirst.findIndex((row) => row.verdict !== "BROKEN");
    const brokenStreak = firstClean === -1 ? newestFirst.length : firstClean;
    if (brokenStreak >= CHASE_DISPLAY_STREAK) {
      chases.push({ brokenStreak, pass: newestFirst[0]!.pass, propertyId, runs: newestFirst.length });
    }
  }
  return chases.toSorted((a, b) => b.brokenStreak - a.brokenStreak || a.propertyId.localeCompare(b.propertyId));
}

/**
 * The lines a reader sees for a set of chases — one per property, then one saying what to weigh.
 *
 * @returns the lines to print, or none when there is no chase
 */
export function chaseLines({ chases }: { chases: readonly PropertyChase[] }): readonly string[] {
  if (chases.length === 0) {
    return [];
  }
  return [
    ...chases.map(
      (chase) =>
        `CHASE: ${chase.propertyId} (${chase.pass}) came back BROKEN on its last ${String(chase.brokenStreak)} ` +
        `of ${String(chase.runs)} run(s) on this branch — each fix met a new counterexample`,
    ),
    "  before buying another run, judge the newest finding: take it, narrow the property, or retire the wording " +
      "(codex supersede) — skills/codex/reference/when-a-pass-earns-its-cost.md § A property chase",
  ];
}
