/**
 * The shapes `slopweaver cycle reconcile` produces. Layout-free by design: this module says WHAT was found
 * and what is being proposed, and `./form.ts` is the only thing that decides how any of it looks.
 *
 * The invariant every consumer relies on: a report is a PROPOSAL SET and nothing else. There is no field on
 * it that records a write, because the verb performs none — the owner answers a proposal with one word and a
 * separate, explicitly-invoked door does the writing.
 */

/** What is being proposed about one subject. */
export type ProposalAction = "close-with-comment" | "trace" | "project-update";

/** One checkable fact behind a proposal, with the thing a reader clicks to verify it. */
export interface ProposalEvidence {
  /** The fact, in plain words, stated so it can be falsified rather than merely believed. */
  readonly fact: string;
  /** Where the fact came from — a pull request, a ticket, a project. */
  readonly url?: string;
}

/** One thing the owner is being asked about. */
export interface CycleProposal {
  readonly action: ProposalAction;
  /** The ticket identifier or project name this is about. */
  readonly subject: string;
  /**
   * The subject's own title, carried so a row can say WHAT it is without the reader opening the link.
   *
   * On the first real card (36 rows), a key alone made the owner open every link to find out what they are being asked about. Absent on a `project-update`, whose `subject` is already the
   * project's name and would otherwise repeat itself.
   */
  readonly title?: string;
  readonly url: string;
  /** One plain sentence saying what is being proposed and why. */
  readonly headline: string;
  /** Never empty: a proposal with no evidence is an assertion, and the schema refuses one. */
  readonly evidence: readonly ProposalEvidence[];
  /** Never empty: the words that resolve this line. */
  readonly oneWordReplies: readonly string[];
  /** Days since the subject last moved, for ranking and for the reader. */
  readonly daysSinceMoved: number;
  /**
   * When the subject last moved, by its own source's clock.
   *
   * Carried BESIDE `daysSinceMoved` rather than left to be reconstructed from it, and the reason is a defect
   * a live run caught: a whole-day count reconstructed against the run's own instant drifts forward every
   * time the verb runs, so anything keyed on it changes minute to minute while the subject has not moved at
   * all. `slopweaver session-start`'s lock-in ledger keys on exactly this, and every resolution the owner gave
   * would have lapsed on the next run.
   *
   * Absent only when the source states none — a project with neither a status update nor a creation date,
   * which is the same case `daysSinceMoved` reports as `Number.MAX_SAFE_INTEGER`.
   */
  readonly movedAtIso?: string;
  /** Linear's own stated priority, carried rather than inferred from the title. */
  readonly priority?: string;
  /** The composed body a `project-update` proposal would post, if the owner answers with the word that posts it. */
  readonly draft?: string;
}

/** What one reconcile pass looked at. */
interface CycleScan {
  readonly teamsWithCurrentCycle: number;
  readonly assignedEver: number;
  readonly openInCurrentCycle: number;
  readonly staleInCurrentCycle: number;
  readonly liveProjectsLed: number;
}

/** One reconcile pass, whole. */
export interface CycleReconcileReport {
  readonly generatedAtIso: string;
  readonly home: string;
  readonly owner: string;
  /**
   * Always `false` and always `true` respectively, and asserted rather than assumed: they are the machine
   * statement of the rail, so a caller (and a probe) can check the property instead of trusting a doc.
   */
  readonly wrote: false;
  readonly proposalsOnly: true;
  readonly scan: CycleScan;
  readonly proposals: readonly CycleProposal[];
  /** What this pass could not see, stated rather than silently omitted. */
  readonly couldNotSee: readonly string[];
}

/**
 * What a reconcile pass cannot measure, stated on EVERY report rather than silently omitted — the report's
 * standing bounds, as opposed to a hole one particular pass hit.
 *
 * These are facts about the corpus, not caveats about the code: a ticket's origin conversation is not
 * joined here, and a pull request's state is the corpus's copy rather than a live read. Exported so a reader
 * of the persisted report (the Fleet Briefing's "Nothing stale" section) can tell these lines from a real
 * gap by identity with this list, never by reading the prose.
 */
export const CYCLE_STANDING_BOUNDS: readonly string[] = [
  "a ticket's origin conversation is not read here — a `trace` proposal says to go and look, it does not claim to have looked",
  "pull-request state is the corpus's own copy; re-read it live with `slopweaver github read <url>` before acting on a close",
];
