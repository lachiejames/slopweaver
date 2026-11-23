/**
 * Which of the owner's standing rules took which check-ins off their queue, counted in the cards they would otherwise
 * have read.
 *
 * Applying every standing approval rule already given cut a page showing 353 check-ins down to 100, the ones where
 * there is value in the owner looking. A rule already given is recorded as a class steer (`skills/autonomy/reference/class-steers.md`);
 * an act it settles leaves the list and is named here, under the rule, with the rule's own words and where the owner
 * said them as the witness. Nothing leaves the ledger — this is a read of it.
 *
 * Counted in CARDS, not acts: one card stands for every act of one kind on one subject (`./actGroups.ts`), so a
 * rule that settled three presses on one pull request took one card off the owner's list, and says one.
 */
import type { Board } from "../components/live/read";
import type { AutonomyRow, StandingRuleWitness } from "../components/live/readAutonomy";
import type { LandingReading } from "../components/live/readLanding";
import type { LiveState } from "../components/live/useLive";
import { type ActGroup, actReadsOf, groupActs, placementApart } from "./actGroups";
import { withBriefingPages } from "./cardBriefingPages";
import { actRowOf } from "./queueActRow";
import { withCardTags } from "./queueCardTags";
import type { QueueRow } from "./queueRows";
import { placementWaits } from "./registerPlacement";
import type { WorkspacePlacer } from "./workspacePlacement";

/** One standing rule, and the cards it took off the owner's list. */
export interface StandingRuleSettlement extends StandingRuleWitness {
  /** The cards it took off the owner's list — cards, never ledger rows. */
  readonly count: number;
  /** Those cards, in the order the page would have drawn them. */
  readonly rows: readonly QueueRow[];
}

/**
 * The groups a standing rule settled: those whose NEWEST act reads as settled by one of the owner's class steers.
 *
 * The newest governs, exactly as it does for the check-in list — a rule on an earlier act alone settles nothing,
 * and a word the owner gave on the newest act itself is theirs, never attributed to a rule (`readAutonomy`'s `standing`).
 *
 * @param acts every act the ledger read holds, newest first
 * @param apart what else keeps two acts apart, as the check-in list's fold is given it — each act's workspace
 * @returns the groups a standing rule settled, in the register's order
 */
export function standingGroups({
  acts,
  apart,
}: {
  acts: readonly AutonomyRow[];
  apart?: (act: AutonomyRow) => string;
}): readonly ActGroup[] {
  return groupActs({ acts, ...(apart === undefined ? {} : { apart }) }).filter(
    (group) => group.act.standing !== undefined,
  );
}

/**
 * The cards the owner's standing rules took off the check-in list, built by the builder those check-ins use — the same hint,
 * the same inherited tags — so the page filters them by work context and tag the way it filters the list they left,
 * and the two figures side by side count one list.
 *
 * Never part of `rowsOf`: a settled card is an account of what the owner's rules already answered, not a row to act on. Its
 * links are drawn against no other queue row, since it opens no panel.
 *
 * @param acts the autonomy ledger read
 * @param board the board read, which a card's tags and a finding's links come from
 * @param landing the owner's open pull requests, which an act's links come from
 * @param placer the organisation's address readers, which place each act
 * @returns one card per kind and subject whose newest act a standing rule settled, in the register's order
 */
export function settledActRowsOf({
  acts,
  board,
  landing,
  placer,
}: {
  acts: LiveState<readonly AutonomyRow[]>;
  board: LiveState<Board>;
  landing: LiveState<LandingReading>;
  placer: WorkspacePlacer;
}): readonly QueueRow[] {
  if (acts.phase !== "ready") {
    return [];
  }
  const reads = actReadsOf({ board, landing, placer });
  const rows = standingGroups({ acts: acts.value, apart: placementApart({ reads }) })
    .map((group) => actRowOf({ group, observedAtIso: acts.observedAtIso, queueKeys: new Set(), reads }))
    // An act's workspace joins the board row it names, so until the board reads it is drawn and counted nowhere —
    // exactly as the check-in it replaced would wait (`./queueLayout.ts` `standingRows`).
    .filter((row) => !placementWaits({ board, row }));
  return withCardTags({ board, rows }).map((row) => withBriefingPages({ row }));
}

/**
 * Tally the cards each standing rule took off the owner's list, largest first, the class name breaking a tie.
 *
 * Takes the settled cards as QUEUE ROWS — built and then filtered by work context and tag exactly as a check-in
 * card is — so the figure beside the check-ins count covers the same list it does.
 *
 * @param rows the settled act cards the page would have drawn, already filtered as the check-ins are
 * @returns one entry per rule that settled at least one of them
 */
export function settledByStandingRules({ rows }: { rows: readonly QueueRow[] }): readonly StandingRuleSettlement[] {
  const byRule = new Map<string, { witness: StandingRuleWitness; rows: QueueRow[] }>();
  for (const row of rows) {
    if (row.record.kind !== "act") {
      continue;
    }
    const witness = row.record.act.standing;
    if (witness === undefined) {
      continue;
    }
    const held = byRule.get(witness.classId);
    if (held === undefined) {
      byRule.set(witness.classId, { rows: [row], witness });
      continue;
    }
    held.rows.push(row);
  }
  return [...byRule.values()]
    .map(({ witness, rows: settled }) => ({ ...witness, count: settled.length, rows: settled }))
    .toSorted((a, b) => b.count - a.count || a.classId.localeCompare(b.classId));
}
