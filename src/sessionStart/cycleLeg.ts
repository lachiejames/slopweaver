/**
 * The cycle leg — `slopweaver cycle reconcile`'s proposals, turned into ranked items.
 *
 * ## It consumes a verb rather than rebuilding one, and that is the design
 *
 * Everything this leg needs already exists behind `slopweaver cycle reconcile`: the proposals, the
 * evidence that decided each one, `wrote: false` and `proposalsOnly: true` asserted rather than promised,
 * and a `--verify` leg that re-reads the unresolved pull requests live. Re-deriving any of that here would
 * be a second opinion about the same tickets, and two rankings of one cycle is exactly the fourth-board
 * failure the board leg's header names.
 *
 * ## What it adds that the board leg structurally could not: drift
 *
 * `drift` is the second-highest signal in {@link ./rank.SIGNAL_CAPS} and it is the owner's own signal — *what
 * the system says about the work stopped matching what is true*. The board leg reads zero for it, honestly,
 * because a run journal cannot deviate from itself. A cycle proposal IS a drift measurement: it exists only
 * because a ticket's stated position and its real one came apart. So drift is read from the proposal class
 * rather than left at zero, and {@link DRIFT_BY_ACTION} is the whole of that reading.
 *
 * ## The two proposal classes map onto the two trace verdicts, and neither mapping is a shortcut
 *
 * `close-with-comment` is raised on a field the provider owns that settles the question — Linear's own
 * workflow state, or a pull request GitHub says is merged — so it grades `provider-fact`, shows resolved,
 * and reaches {@link ../silver/traceBeforeRanking} as a close proposal.
 *
 * `trace` grades `machine-account`, and the reason is written in the proposals' own words rather than
 * inferred. A closed-unmerged pull request "is not evidence the work happened, only that somebody closed
 * it"; an attachment the corpus never saw means "how it ended is UNKNOWN here rather than absent"; a ticket
 * with nothing attached leaves "where it came from the only way to know". All three say plainly that what
 * they hold does NOT settle whether the work is outstanding. Passing that through as a provider fact would
 * make the trace read "traced, and still open where it came from" and rank a go-and-look as work to do —
 * this system's own reading wearing the provider's authority, which is the failure the grades exist for.
 *
 * `project-update` is the ordinary case: Linear owns the date of the last status update, it shows the work
 * NOT resolved, and the item ranks as work.
 *
 * Pure — no I/O, no clock. `nowIso` is supplied by the caller so a frozen fixture judges its own time.
 */

import { absentAs, absentAsNumber } from "#lib/absent.js";
import type { CycleProposal, ProposalAction } from "../cycle/types.js";
import type { RuleZeroDecision } from "../silver/ruleZero.js";
import { applyRuleZero } from "../silver/ruleZero.js";
import type { EvidenceGrade, TraceEvidence } from "../silver/traceBeforeRanking.js";
import { traceBeforeRanking } from "../silver/traceBeforeRanking.js";
import type { Item } from "./item.js";
import { asItem } from "./item.js";
import type { RankInput, SignalReadings } from "./rank.js";

/**
 * How much drift each proposal class reports, before the ranker's cap.
 *
 * Ordered by how far the system's story has demonstrably come apart from the world, which is what drift
 * means here rather than how urgent the row feels:
 *
 * - `close-with-comment` is drift at its cap. The deviation is established rather than suspected — the
 *   ticket reads as live work and a field the provider owns says the work is over. Nothing else in the
 *   system surfaces that.
 * - `trace` is one below. Something about the ticket stopped adding up, but how far it has drifted is
 *   precisely what could not be established — that is why it is a `trace` and not a close.
 * - `project-update` is lower again and deliberately so. A project whose last update has aged out has
 *   drifted in the reader's mind rather than in its own records: nothing about it is stated wrongly, it is
 *   simply no longer stated recently.
 *
 * One table in one file, exactly as {@link ./rank.SIGNAL_CAPS} is, so changing the order
 * costs an edit.
 */
export const DRIFT_BY_ACTION: Readonly<Record<ProposalAction, number>> = {
  "close-with-comment": 4,
  "project-update": 2,
  trace: 3,
};

/**
 * How each proposal class's evidence is graded, and whether it shows the work already resolved.
 *
 * Keyed by class rather than sniffed per piece of evidence, because the class is what the reconcile pass
 * DECIDED after weighing that evidence, and re-deciding it here from the same facts would be two opinions
 * where the whole point of consuming the verb is one.
 */
const TRACE_BY_ACTION: Readonly<Record<ProposalAction, { grade: EvidenceGrade; showsResolved: boolean }>> = {
  "close-with-comment": { grade: "provider-fact", showsResolved: true },
  "project-update": { grade: "provider-fact", showsResolved: false },
  trace: { grade: "machine-account", showsResolved: false },
};

/**
 * The state a row shows, in the source's own terms.
 *
 * Plain words rather than the action's slug: `close-with-comment` is a name for a proposal kind, not
 * something a reader should have to translate at seven in the morning.
 */
const STATE_BY_ACTION: Readonly<Record<ProposalAction, string>> = {
  "close-with-comment": "open, but the work is done",
  "project-update": "status update overdue",
  trace: "needs a look before anything is decided",
};

/**
 * Linear's own priority labels that this leg reads as urgency, and what each is worth.
 *
 * The two names are Linear's, taken from the same vocabulary {@link ../cycle/render} already maps to card
 * severity, so the card and the list agree about what "urgent" means. Every other label — `Medium`, `Low`,
 * `No priority` — contributes nothing rather than a small invented amount: the owner's ordering puts
 * explicit priority second-last, and spreading the middle of a scale the owner did not set would be inventing the
 * ranking rather than reading it.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const PRIORITY_READINGS: Readonly<Record<string, number>> = { High: 1, Urgent: 2 };

/**
 * When the subject last moved, taken from the proposal rather than reconstructed from its day count.
 *
 * ## This is the fix for a defect a live run caught, and it is worth stating rather than rediscovering
 *
 * The obvious build derives the instant as `now - daysSinceMoved`. It reads correctly and it is wrong in a
 * way nothing on the card shows: the run's own instant moves every time the verb runs, so a row's `whenIso`
 * drifts forward minute by minute while the ticket behind it has not moved at all. Everything keyed on that
 * instant then breaks, most sharply {@link ./lockIn}, whose whole design is that a resolution the owner gave
 * governs an item UNTIL IT MOVES. Every answer given would have lapsed on the next run, silently.
 *
 * So the proposal carries the subject's own `updatedAt` and this reads it. A `daysSinceMoved` on its own is
 * a rounded measurement of a distance; only the source's instant is a fact about the subject.
 *
 * A proposal with no instant returns undefined rather than a fabricated one — a project with neither a
 * status update nor a creation date, which is exactly the case `daysSinceMoved` reports as
 * `Number.MAX_SAFE_INTEGER` to say it does not know. {@link ./item.asItem} then drops the row, which is the
 * mandatory-fields contract working: a list promising that every row says when it last moved cannot carry
 * one that does not.
 *
 * @param proposal the reconcile proposal being mapped
 * @returns the subject's own last-moved instant, or undefined when its source states none
 */
export function movedAtIso({ proposal }: { proposal: CycleProposal }): string | undefined {
  const stated = proposal.movedAtIso;
  if (stated === undefined || Number.isNaN(Date.parse(stated))) {
    return undefined;
  }
  return stated;
}

/**
 * Who a row names as the person it came from.
 *
 * Nobody asked for any of these, which is the honest answer and worth stating rather than resolving to a
 * human the ask did not come from — the board leg names a session for the same reason. A close proposal
 * comes from the owner's own cycle; an overdue update is owed by a project the owner leads.
 *
 * @param action which class of proposal this is
 * @returns the words the row puts in its `who` column
 */
export function cycleWho({ action }: { action: ProposalAction }): string {
  return action === "project-update" ? "a project you lead" : "your own cycle";
}

/**
 * The evidence one proposal carries into the trace.
 *
 * Every piece is forwarded — a close proposal has to arrive with the facts that closed it, and dropping any
 * of them would leave the owner a row they cannot argue with. The url is the evidence's own where it has one and
 * the subject's otherwise, so a reader always lands on something in one click.
 *
 * @param proposal the reconcile proposal being mapped
 * @returns the evidence, in the order the reconcile pass found it
 */
export function cycleEvidence({ proposal }: { proposal: CycleProposal }): readonly TraceEvidence[] {
  const { grade, showsResolved } = TRACE_BY_ACTION[proposal.action];
  return proposal.evidence.map((piece) => ({
    grade,
    showsResolved,
    source: absentAs({ value: piece.url, whenAbsent: proposal.url }),
    what: piece.fact,
  }));
}

/**
 * What this leg measures for one proposal.
 *
 * `stoppedOnOwner` is zero across the whole leg, and that is a reading rather than a gap. Nobody is stopped
 * waiting on any of these: a ticket that reads wrongly is not blocking a person, and the slice where
 * somebody is literally stopped is the board leg's. Inflating it here would push cycle hygiene above a
 * session that has actually halted, inverting the owner's own ordering.
 *
 * `distanceToDone` is at its cap only when one word genuinely finishes the row — a close, or an update
 * whose body the reconcile pass has already drafted. An update with no draft, and every `trace`, needs a
 * decision first, so it reads one.
 *
 * `age` is passed through uncapped because a detector reports what it saw and never what it is worth; the
 * ranker's cap is the only place that magnitude is decided.
 *
 * @param proposal the reconcile proposal being mapped
 * @returns the readings, with drift carrying what only this leg can see
 */
export function cycleReadings({ proposal }: { proposal: CycleProposal }): SignalReadings {
  const oneWordFinishes = proposal.action === "close-with-comment" || proposal.draft !== undefined;
  return {
    age: proposal.daysSinceMoved,
    directness: 3,
    distanceToDone: oneWordFinishes ? 3 : 1,
    drift: DRIFT_BY_ACTION[proposal.action],
    explicitPriority:
      proposal.priority === undefined
        ? 0
        : absentAsNumber({ value: PRIORITY_READINGS[proposal.priority], whenAbsent: 0 }),
    stoppedOnOwner: 0,
  };
}

/**
 * What a cycle proposal's subject IS, before anything about its state.
 *
 * A ticket key on its own is unreadable — the owner opened every link on a real card to find out what each
 * row was about, which is why {@link ./item.Item.title} exists. This puts the same title into a sentence
 * that names the KIND of thing as well, because "INFR-1513" and "Vulnerability management" are a ticket and
 * a project and the action on each is different.
 *
 * @param proposal the proposal to describe
 * @returns the background
 */
export function cycleBackground({ proposal }: { proposal: CycleProposal }): string {
  const named = proposal.title === undefined ? proposal.subject : `${proposal.subject}, "${proposal.title}"`;
  if (proposal.action === "project-update") {
    return `A Linear project you lead: ${named}. Its status update is what tells everyone else where it stands.`;
  }
  return `A Linear ticket of yours: ${named}. It has been sitting in your cycle for ${String(proposal.daysSinceMoved)} day(s) without moving.`;
}

/**
 * The item one proposal produces, or undefined when its instant cannot be derived.
 *
 * `doneWhen` is the proposal's headline, which is already one concrete sentence naming the subject and what
 * is wrong with it — the shape {@link ./item.Item} demands, written by the pass that found it.
 *
 * @param proposal the reconcile proposal being mapped
 * @returns the item, or undefined when a mandatory field cannot be filled
 */
export function cycleItem({ proposal }: { proposal: CycleProposal }): Item | undefined {
  const whenIso = movedAtIso({ proposal });
  if (whenIso === undefined) {
    return undefined;
  }
  return asItem({
    candidate: {
      background: cycleBackground({ proposal }),
      doneWhen: proposal.headline,
      nativeId: proposal.subject,
      provenance: "cycle leg — slopweaver cycle reconcile",
      source: "linear",
      state: STATE_BY_ACTION[proposal.action],
      whenIso,
      where: proposal.url,
      who: cycleWho({ action: proposal.action }),
      ...(proposal.title === undefined ? {} : { title: proposal.title }),
    },
  });
}

/**
 * Rule zero for a cycle proposal.
 *
 * Always the owner's move, and unlike the board leg's slice that is a property of the pass rather than of the
 * proposal: `cycle reconcile` filters to the issues assigned to the owner and the projects the owner leads before it
 * proposes anything, so there is no third party whose move this could be. Kept as a real call so the reason
 * on the row is produced the same way every other row's is.
 *
 * @param whenIso when the subject last moved
 * @param nowIso the run's own instant
 * @returns the decision, which is always `show`
 */
function cycleRuleZero({ whenIso, nowIso }: { whenIso: string; nowIso: string }): RuleZeroDecision {
  return applyRuleZero({ lastMovedIso: whenIso, move: { party: "owner" }, nowIso });
}

/**
 * Turn a whole reconcile proposal set into ranker input.
 *
 * `finishesInFlight` is true throughout, and it is true by construction rather than by assertion: every
 * proposal is raised about a ticket in the CURRENT cycle or a project already running. That is the
 * tiebreak carrying the north star of wrapping up in-flight work rather than chasing new shiny things —
 * and this is the leg it was written for.
 *
 * `unverified` is the whole leg's, not each row's, because it reports the one freshness fact the leg can
 * actually establish: whether the pass re-read its unresolved pull requests live. A ticket's own Linear row
 * is the corpus's copy either way, which the verb states plainly rather than encoding as a per-row flag it
 * has no way to vary.
 *
 * @param proposals every proposal the reconcile pass produced
 * @param nowIso the run's own instant, supplied rather than read
 * @param verified whether the pass re-read its pull requests live, which is the default and what `--no-verify` turns off
 * @returns one rank input per proposal whose instant could be derived, in the order given
 */
export function cycleLeg({
  proposals,
  nowIso,
  verified,
}: {
  proposals: readonly CycleProposal[];
  nowIso: string;
  verified: boolean;
}): readonly RankInput[] {
  const inputs: RankInput[] = [];
  for (const proposal of proposals) {
    const item = cycleItem({ proposal });
    if (item === undefined) {
      continue;
    }
    inputs.push({
      finishesInFlight: true,
      item,
      readings: cycleReadings({ proposal }),
      ruleZero: cycleRuleZero({ nowIso, whenIso: item.whenIso }),
      trace: traceBeforeRanking({ evidence: cycleEvidence({ proposal }) }),
      unverified: !verified,
    });
  }
  return inputs;
}
