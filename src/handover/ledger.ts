/**
 * The run ledger: what a run has done, on disk, so a context window losing itself cannot lose the run.
 *
 * ## The defect this exists for
 *
 * Executing a doc today means pasting its text into a fresh chat. Everything governing the run — the
 * checkpoint, the completion gate, what the doc actually asked for, what was decided along the way — lives
 * only in that context window. A single compaction erases all of it and nothing notices.
 *
 * Sorted by how durable each home is: a file on disk survives compaction AND session death; a hook or the
 * project instructions survive because the harness re-injects them rather than the model remembering; prose in
 * a doc survives only while it is in the window. `skills/orchestrate/SKILL.md` was entirely the third kind. This
 * is the first kind.
 *
 * ## A recorded question is a legitimate ending
 *
 * `waiting-on-owner` is a real terminal-ish phase, and reaching it is success rather than failure. That is
 * what separates this from a goal-loop that wakes forever to report it still cannot proceed: the run writes
 * down what it needs, and stops. The escape from every gate in this feature is to record the question, which
 * is cheap and is itself the artifact the owner wanted.
 *
 * ## Append-only, and the doc hash is why
 *
 * `started` and `amended` carry the content hash of the doc as it was when the entry was written — those are
 * the two moments the brief is established or deliberately changed, so no other kind needs it. A later session
 * comparing that hash against the doc on disk detects that the brief changed underneath a live run, which is
 * the amendment case. Without it, an evolved plan silently invalidates its own probes, reintroducing the exact
 * defect this whole feature removes.
 *
 * ## An undecodable line is not free — it disarms every gate reading the journal
 *
 * `byKind` returns `undefined` for a kind it does not recognise, and the reader counts that as an UNREADABLE
 * line. That is the honest report, but it has teeth downstream: `runsOnDisk` treats a journal with any
 * unreadable line as ambiguous and refuses to resolve the run, so the stop gate cannot fire on it at all.
 *
 * Measured on the live board: 14 of 18 journals carried a `launched` line and others carried `said` or
 * `resumed`. Before the drive kinds below were typed here, every one of those counted as unreadable, so the stop
 * gate was inert across almost the whole board for a reason nobody had noticed — on top of being switched off.
 *
 * Which is why the same lever is now pulled DELIBERATELY in one place: a `launched` or `resumed` line whose
 * `sessionId` is missing stays unreadable rather than decoding into an empty identity. A gate that cannot name a
 * run's writer must stand off rather than guess, and those two kinds are the only place the writer is named.
 *
 * ## A word this build has never heard is not a corrupt file
 *
 * `slopweaver` resolves to the checkout you are standing in, and every one of them writes into the one
 * `$SLOPWEAVER_HOME`. So `runs/*.jsonl` is a single shared, forward-evolving format read by as many vintages of
 * this decoder as there are worktrees — and the paragraph above put a NEWER build's ordinary write in the same
 * bucket as truncated JSON. MEASURED: nine kinds had landed, each retroactively
 * breaking every checkout cut before it; 251 of 560 checkouts on this machine could not fully read part of the
 * board, 92 lost 300+ of 1,734 journals, and the worst lost 1,556. `handover ask` is one of the verbs that
 * refusal wedges, so a stale session blocked on the owner could not record its own question — rule 6's exact
 * failure mode, manufactured by the guard meant to prevent it. Reproduce:
 * `cat ~/.slopweaver/runs/*.jsonl | grep -o '"kind":"[^"]*"' | sort | uniq -c | sort -rn`.
 *
 * {@link parseLedger} therefore reports such a line TWICE: in {@link ParsedLedger.unreadable}, whose meaning is
 * unchanged and which every phase-sensitive and correctness gate still reads whole, and additionally in
 * {@link ParsedLedger.unknownKind}. `./unknownKind.ts` holds the mechanism, and its `ownershipAmbiguousLines`
 * is the derived set the OWNERSHIP guards switch to. The test that makes that safe needs no knowledge of the
 * kind at all: ownership is folded only from lines carrying a `sessionId` (`./runOwner.ts`'s `foldOwnership`,
 * over the identity kinds and `parked`), so a well-formed line that declares none cannot change who owns a run
 * whatever word it carries.
 *
 * The residue is stated rather than discovered: a future kind that OPENS a cycle or is TERMINAL still folds
 * wrongly on an old build, which is why the phase half keeps standing off (an owner ruling).
 *
 * Pure: no filesystem, no clock. The caller supplies text to parse and the timestamp to stamp.
 */

import type { SupervisorHost } from "../supervisor/session.js";
import type { AskAction } from "./askAction.js";
import type { QuestionExamplesEvent } from "./askExamples.js";
import type { AskOption, AskStakes } from "./askShape.js";
import type { QuestionShotEvent } from "./askShot.js";
import type { SteerRiskEvent } from "./explicitSteerTypes.js";
import type { QuestionShapedEvent } from "./heldQuestion.js";
import { decodeLedgerLine } from "./ledgerLineDecode.js";
import { inheritedOpen, inheritedQuestion, openQuestionAfter, reshapeBinds } from "./openQuestion.js";
import type { ParkedEvent, ParkWakeSuspendedEvent } from "./parkedEvent.js";
import { type QuestionPost, questionPostOf } from "./questionPost.js";
import type { RulingEvent } from "./rulingEventTypes.js";
import { type UnknownKindLine, unknownKindOf } from "./unknownKind.js";

// Re-exported so the two dozen modules that already read this file keep one import, and so the split below
// stays an implementation detail rather than a second name every caller has to learn.
export { ownershipAmbiguousLines, type UnknownKindLine } from "./unknownKind.js";

/** One thing that happened during a run. */
export type RunEvent =
  /** A run opened. Carries the branch so `in-flight` is an exact fact rather than a name guess. */
  | { readonly kind: "started"; readonly atIso: string; readonly branch: string; readonly docHash: string }
  /** A probe snapshot at a moment, so a later reader sees what was true when a decision was taken. */
  | { readonly kind: "probed"; readonly atIso: string; readonly passed: number; readonly failed: number }
  /** The doc changed mid-run, deliberately and with a reason. */
  | { readonly kind: "amended"; readonly atIso: string; readonly docHash: string; readonly why: string }
  /**
   * The run needs something only the owner can settle. A legitimate ending, not a failure.
   *
   * `problem`, `options` and `lean` are the SHAPE an owner ruling requires of every ask
   * waiting on the owner's word — see `./askShape.ts`. They are OPTIONAL here and REQUIRED at the verb, and the
   * asymmetry is deliberate: 43 questions were already journalled free-text when the rule landed and an
   * older reader has to keep reading them. A card renders their absence as a visible mark, never as a gap.
   */
  | {
      readonly kind: "question";
      readonly atIso: string;
      readonly question: string;
      readonly problem?: string;
      readonly options?: readonly AskOption[];
      readonly lean?: string;
      /**
       * The risk, blast radius and still-real check — optional here and required at the verb, for the same
       * reason the shape is: every question journalled before the shape was required carries none. The instant they
       * were confirmed is this event's own `atIso`, never a typed field.
       */
      readonly stakes?: AskStakes;
      /**
       * The concrete Slack ACTION the ask offers, when it offers one — `./askAction.ts`. Optional for the
       * same reason the shape is: every question journalled before actions existed carries none, and most
       * asks are a decision about work rather than about a message.
       */
      readonly action?: AskAction;
      /**
       * Set when the line DID carry an action and it would not read, which is a third state rather than
       * the absence above.
       *
       * The distinction is load-bearing all the way to the card: a row with no draft legitimately falls
       * back to the options its doc's front matter carries, and a row whose draft is broken must not,
       * because those options were written to describe the destinations that just failed to decode.
       * Erasing the action and leaving nothing behind is exactly how "DM Tobias" reached a card about a draft
       * addressed to a channel .
       */
      readonly actionUnreadable?: true;
      /**
       * The concrete scenes the card leads with, or the one line saying why there is none (`./askExamples.ts`)
       * — written on the SAME line as the question so an ask can never land without them, and
       * optional for the shape's reason: every question journalled before carries neither. `question-examples`
       * replaces them later without re-asking.
       */
      readonly examples?: readonly string[];
      readonly exampleGap?: string;
    }
  /**
   * An ACTION attached to a question already waiting on the owner — `handover offer`.
   *
   * Its own kind rather than a second `question`, because the question is unchanged: re-asking it would
   * reset the instant `openQuestionAfter` carries and report a three-week-old ask as fresh, which is
   * exactly the defect `question-corrected` exists to avoid on the other axis. It replaces the action and
   * the shape WHOLE — a partial offer is not a decision — and binds to the question it names, so an offer
   * landing after an answer and a new question attaches to nothing.
   */
  | {
      readonly kind: "question-offered";
      readonly atIso: string;
      readonly question: string;
      readonly action: AskAction;
      readonly problem: string;
      readonly options: readonly AskOption[];
      readonly lean: string;
      /** Optional for the reason `question`'s is: offers journalled before the shape was required carry none. */
      readonly stakes?: AskStakes;
    }
  /** A shape given to a question recorded without one, keeping its asked instant — `./heldQuestion.ts`. */
  | QuestionShapedEvent
  /**
   * Where the open question was POSTED — the owner's DM channel and the message ts. READ-ONLY: no verb writes
   * one, because a question belongs on the owner's Queue card and never a DM; journals in the shared home
   * still carry the lines a delivering build wrote (`./questionPost.ts`). `question` is the text that was
   * posted, so a handle landing after an answer and a NEW question binds to nothing. Its `permalink` lets a card
   * LINK the question rather than say "check your DM" — no verb lists DM history.
   */
  | (QuestionPost & { readonly kind: "question-posted"; readonly atIso: string; readonly question: string })
  /**
   * The open question's text, corrected while it waits. Not a second question — `handover ask` refuses that,
   * because an answer must bind to one — but the SAME question stated truly, so the Queue card, the board
   * and `resume` read the corrected text rather than the stale one. Nothing is posted.
   */
  | { readonly kind: "question-corrected"; readonly atIso: string; readonly question: string; readonly why: string }
  /**
   * The open question RE-CONFIRMED as still standing — `handover reconfirm`, a refresh pass having re-run the
   * check that it is still the owner's to answer. Not a re-ask: nothing is posted and the asked instant stays where it
   * was, so a three-week-old ask stays three weeks old; what moves is the instant its still-real check was last
   * true, which is the one date the console ages a card by. Bound to the question it names, as an offer is.
   */
  | {
      readonly kind: "question-reconfirmed";
      readonly atIso: string;
      readonly question: string;
      /** The check that was just re-run, in one line — printed where the card says why it still stands. */
      readonly stillReal: string;
    }
  /** The open question's CONCRETE EXAMPLES — `handover example`; the shape lives beside its rules. */
  | QuestionExamplesEvent
  /** The open question's PICTURE, boxed where the owner should read — `handover shot`; the shape lives beside its rules. */
  | QuestionShotEvent
  /**
   * The open question WITHDRAWN by the run's holder — `handover withdraw`, the fact it waited on having resolved
   * itself. Not an answer: the owner said nothing, so nothing reading `answered` as the owner's words (`./ruling.ts`,
   * `./rulingAudit.ts`) sees one. It settles the question exactly as an answer does, bound to the text it names.
   * `why` is the one-line check that showed the premise resolved.
   */
  | { readonly kind: "question-withdrawn"; readonly atIso: string; readonly question: string; readonly why: string }
  /** The owner answered. The run may proceed. */
  | { readonly kind: "answered"; readonly atIso: string; readonly answer: string }
  /** The run finished. `residue` is non-empty when probes still failed and it was forced through. */
  | { readonly kind: "finished"; readonly atIso: string; readonly residue: readonly string[] }
  /**
   * The work SHIPPED — the terminal `abandoned` could never say, and `finished` does not claim.
   *
   * `finished` closes a RUN CYCLE: the session stopped working, its probes were weighed, and whether the
   * change is live is a separate question the doc's `status:` was left to answer by hand. This is that
   * answer, in the one register, so nothing has to be hand-edited to record it.
   *
   * MEASURED: 44 rows were terminal in their doc with the run still open, because the honest word
   * did not exist. A second session independently refused to write `abandoned` on 40 of them rather than say
   * work that landed had been given up on — the strongest available evidence that this terminal was missing
   * rather than merely convenient.
   *
   * `summary` is what {@link HandoverDoc.statusSummary} carried by hand: one line saying what shipped.
   */
  | {
      readonly kind: "closed";
      readonly atIso: string;
      readonly residue: readonly string[];
      readonly summary: string;
    }
  /**
   * Where this row's answer was published — a recorded value a later event may SUPERSEDE rather than only
   * extend, and once the only one.
   *
   * `ruling` below is the second, and the two supersede differently on purpose: an artifact is superseded by
   * the last event WRITTEN, a ruling by the latest DECISION. Both facts follow from what the value is.
   *
   * Every other kind here is a fact about a moment, so superseding one would be a lie about history. An
   * artifact URL is a POINTER, and a pointer to a page that was republished elsewhere is simply wrong. The
   * front-matter half could never fix that: `../handover/frontmatter.ts`'s `addFrontMatterFields` is add-only
   * and REFUSES a key the doc already declares, so no code in this repository could correct a settled row's
   * witness — a sweep re-flagged a page repaired hours earlier, every time. Superseding by append fixes that
   * class while every earlier value stays queryable.
   */
  | { readonly kind: "artifact"; readonly atIso: string; readonly url: string }
  /** The owner ruled on this row — their words, where they said them, and any halves it carries (`./rulingEventTypes.ts`). */
  | RulingEvent
  /** The run was given up on, explicitly. Also a legitimate ending. */
  | { readonly kind: "abandoned"; readonly atIso: string; readonly why: string }
  /**
   * The session holding this run DIED without ending it — a typed closure written by the reaper, never by the
   * session itself, because the session that owed the ending is gone.
   *
   * Deliberately not `abandoned`, and the distinction is the whole reason this kind exists rather than reusing
   * one. `abandoned` means a session considered the work and gave up on it, which is a judgement about the WORK.
   * This is a statement about the SESSION, carries no judgement about the work at all, and leaves the row
   * runnable — the next session may pick it straight back up. Writing `abandoned` on a row whose session merely
   * crashed would mislabel live work as declined, which is the same class of lie as writing it on work that
   * shipped.
   *
   * MEASURED: 63 of 84 open cycles were held by a session the live-session registry proved dead, the
   * oldest for 17 days, and nothing in the repository could close one — {@link ../handover/writerLiveness.ts}
   * already returned `dead` and every caller only RENDERED it.
   */
  | {
      readonly kind: "orphaned";
      readonly atIso: string;
      /** The session the journal named as writer, which the registry proved gone. */
      readonly deadSessionId: string;
      /** The last event the dead session wrote, so a reader can judge how much was lost. */
      readonly lastEventIso: string;
      /**
       * How many events the cycle held when the reap was decided — what the write door compares against.
       *
       * Optional because journals written before this field exist and must still parse. A timestamp alone
       * is not an identity: two valid events may share one, so a cycle that gained an event in the same
       * millisecond would look untouched. The count cannot, because the journal only ever grows.
       */
      readonly cycleEvents?: number;
    }
  /**
   * A session took this run — `handover start` records the interactive session that opened it, and this is the
   * one place a run's WRITER is named. What scopes the stop gate.
   *
   * A now-removed headless driver also wrote this kind, for the first turn of an unattended drive it launched
   * (AGENTS.md rule 2 is why that driver is gone); the journal shape survived because old journals must keep
   * decoding, and because a run opened by a visible session still needs to name it the same way.
   *
   * `sessionId` was generated by that driver and handed to `claude --session-id`, never read back out of the
   * envelope. Measured: resuming needs the full session UUID and a truncated one fails instantly, so
   * the id was chosen before the launch rather than parsed from output that may never arrive.
   *
   * `pid` and `worktree` are what let a refusal say WHERE the other session is rather than only that one exists.
   * Both are optional because only `sessionId` is load-bearing: journals on disk predate this repo's own driver,
   * and a line that names the session but not the checkout still identifies the owner.
   */
  | {
      readonly kind: "launched";
      readonly atIso: string;
      readonly sessionId: string;
      /** The visible host that opened it. Absent on journals written before cross-host ownership existed. */
      readonly host?: SupervisorHost;
      readonly pid: number | undefined;
      readonly worktree: string | undefined;
    }
  /**
   * One bounded resume of an existing session. Re-states the writer, so it counts for ownership too.
   *
   * `attempt` counts turns, so an exhausted bound is visible. Optional for the same reason as `pid` above — a
   * resume that records the session but not its turn number is still a usable identity claim.
   *
   * `pid` is the pid of THIS turn's process, and it is here because a resume spawns a NEW child: `claude -p` is
   * one turn, so turn three is a different process from turn one. Without it the only recorded pid was the
   * first turn's, dead by construction from turn two onwards — so a running drive's liveness probe answered NO
   * about a turn that was still working. Optional because journals written before this field exists must keep
   * decoding; a reader falls back to the launch pid and is therefore no worse off than it was, never wrong in a
   * new way.
   */
  | {
      readonly kind: "resumed";
      readonly atIso: string;
      readonly sessionId: string;
      readonly attempt: number | undefined;
      readonly pid: number | undefined;
    }
  /** A visible session deliberately took ownership, including the reason for an exceptional takeover. */
  | {
      readonly kind: "claimed";
      readonly atIso: string;
      readonly sessionId: string;
      readonly host: SupervisorHost;
      readonly pid: number | undefined;
      readonly worktree: string | undefined;
      readonly why: string;
      /**
       * Present ONLY when `--force` actually bypassed the hold guard — a foreign holder not proven dead.
       * Absent on every ordinary claim and on every journal written before the field existed, so old lines
       * keep decoding and a redundant `--force` against a dead holder is never journalled as a takeover.
       */
      readonly forced?: true;
    }
  /** The current writer deliberately made the run available to another visible session. */
  | { readonly kind: "released"; readonly atIso: string; readonly sessionId: string; readonly why: string }
  | ParkedEvent
  /**
   * One park's wake RETIRED without a reseat — `handover wake`, finding the row settled or closed so `cmux spawn`
   * would refuse it on every tick. Bound to the park it clears by `parkIndex`, its position in the journal (two
   * parks may share every field), so a stale line never clears a later park.
   *
   * None of the existing endings was honest: `closed` says the work shipped, `abandoned` that it was given up,
   * `orphaned` that a session died, `finished` that a cycle ended, and the seat-opening kinds that a seat came
   * up. The wake is not the run's writer and claims none of those; it names no session and moves no phase.
   * MEASURED: two settled asks spent two of every wake's three spawns on a refused `cmux spawn`,
   * deferring nine live parks behind them (`supervisor-scratch/handoff-<n>/tick-29/handover-wake.json`).
   */
  | { readonly kind: "park-cleared"; readonly atIso: string; readonly parkIndex: number; readonly why: string }
  /** One park's WAKE suspended while the owner's question stays open; the park stands (`./parkedEvent.ts`). */
  | ParkWakeSuspendedEvent
  /** A session named the uncertainty on a steered deliverable, or said it passed (`./explicitSteerTypes.ts`). */
  | SteerRiskEvent
  /**
   * A supervisor dispatched a session at this doc.
   *
   * The FIRST event here written by the supervisor rather than by the session doing the work, and that is the
   * whole point of it. Measured: `cmux spawn` READ a run journal to choose start-versus-resume and
   * never wrote to one, and the only writer of {@link RunEvent} `launched` is `handover start` — run by the
   * dispatched session. So a session that booted and never started left the journal EMPTY, and its doc sat in
   * `RUN NOW` indistinguishable from one nobody had ever been sent to. A supervisor could not tell "I never
   * dispatched this" from "I dispatched it and it died silently", which is exactly what happened.
   *
   * `by` is the dispatching session as it named itself. It is **attributable, not authenticated** — this CLI
   * authenticates no human and no session, so treat the field as a signature on a note, not a credential. The
   * load-bearing fact is that a dispatch HAPPENED at an instant; who claims to have sent it is context.
   */
  | {
      readonly kind: "dispatched";
      readonly atIso: string;
      readonly by: string;
      /** The workspace the dispatch opened, when one was named — so a no-show says WHERE to go looking. */
      readonly target: string | undefined;
    }
  /**
   * A second party signed off on this run — the counterweight to a session closing its own work.
   *
   * Its value is that an UNSIGNED closure becomes visible as unsigned, not that the signature proves anything:
   * same attributable-not-authenticated property as {@link RunEvent} `dispatched`. Recording it separately from
   * `finished` is deliberate — folding a flag into the closure would let the closing session assert its own
   * sign-off in the same write, which is the self-certification this exists to expose.
   */
  | {
      readonly kind: "signed-off";
      readonly atIso: string;
      readonly by: string;
      readonly note: string;
    }
  /**
   * Tags written onto the row — `handover tag`, or a registering verb's `--tag`. A fact ABOUT the row, never a
   * transition of its run, so the phase fold passes over it; `./rowTagFold.ts` folds the sequence into the row's
   * current tags, a later event winning. `drop` names a whole key, or `key=value` for one value of a key that
   * holds several.
   */
  | {
      readonly kind: "tagged";
      readonly atIso: string;
      readonly set: readonly { readonly key: string; readonly value: string }[];
      readonly drop: readonly string[];
      readonly why: string;
    }
  /**
   * This run answered whether it learned anything, and the answer was NOTHING.
   *
   * Recorded rather than inferred, because "no lesson" and "never asked" are the two states this whole
   * mechanism exists to separate. Owner ruling: a run cannot settle without answering, and an
   * explicit nothing is a legitimate answer. A run that recorded an actual lesson writes no event here —
   * the register row itself is that answer, and `../knowledge/declared.ts` reads both.
   *
   * `forced` marks a settle that went through the break-glass instead of answering, so an override is
   * findable afterwards rather than looking identical to an honest nothing.
   */
  | { readonly kind: "lessons"; readonly atIso: string; readonly lessons: string; readonly forced: boolean }
  /** The owner queued a message for a live drive's next turn. Recorded at ENQUEUE so a lost delivery is provable. */
  | { readonly kind: "said"; readonly atIso: string; readonly message: string }
  /** The driver drained the inbox into a turn's prompt. The other half of the `said` pair. */
  | { readonly kind: "delivered"; readonly atIso: string; readonly count: number }
  /** A drive stopped, with the measured reason. Never a silent kill. */
  | { readonly kind: "drive-ended"; readonly atIso: string; readonly why: string; readonly attempts: number }
  /**
   * The stop gate looked at this run, and what it saw when it did.
   *
   * This is the ONLY reason the gate writes to a journal, and it is what makes "say what changed since last
   * time" possible at all: without a recorded baseline, every firing can only restate the present, which is how
   * the gate came to say the same sentence nine times in one session. The tally here is always a re-check, never
   * a copy of a `probed` entry.
   */
  | {
      readonly kind: "gated";
      readonly atIso: string;
      readonly passed: number;
      readonly failed: number;
      readonly notEvaluated: number;
      /** The branch head at that moment, so "gained a commit" is an exact comparison rather than a guess. */
      readonly head: string | undefined;
      /** Which session the gate fired in, so a journal shows who was being interrupted. */
      readonly sessionId: string | undefined;
    };

/** One recorded owner ruling, named so every reader of one can say so in its own signature. */
export type { RulingEvent };

/**
 * Where a run has got to.
 *
 * `waiting-on-owner` is deliberately distinct from `open`: the gates in this feature refuse an `open` run that
 * tries to end, and allow a `waiting-on-owner` one, because the question has been written down.
 */
export type RunPhase = "open" | "waiting-on-owner" | "closed";

/** The run's current state, derived from its whole journal rather than stored. */
export interface RunState {
  readonly phase: RunPhase;
  /** The branch recorded when the run opened, so commits can be counted exactly. */
  readonly branch: string | undefined;
  /** The doc's content hash as of the most recent `started` or `amended` entry. */
  readonly docHash: string | undefined;
  /** The question awaiting an answer, when the run is `waiting-on-owner`. */
  readonly openQuestion: string | undefined;
  /**
   * Where the open question was posted, when a delivery recorded it. Cleared on EVERY edge that clears
   * {@link RunState.openQuestion}, and on a fresh question, so a handle never outlives the question it names.
   */
  readonly openQuestionPost: QuestionPost | undefined;
  /**
   * How many entries the current run cycle holds, for a reader deciding how much history to print.
   *
   * NOT what bounds the stop gate: that uses the harness's own `stop_hook_active`, deliberately, because a
   * counter of ours could desync from what the harness believes.
   */
  readonly entries: number;
  /** When the most recent entry was written. */
  readonly lastIso: string | undefined;
}

/** A run that never started at all: the phase a machine defaults to, so nothing is ever assumed open. */
export const NO_RUN: RunState = {
  branch: undefined,
  docHash: undefined,
  entries: 0,
  lastIso: undefined,
  openQuestion: undefined,
  openQuestionPost: undefined,
  phase: "closed",
};

/** What reading a journal produced, including the lines it could not read. */
export interface ParsedLedger {
  readonly events: readonly RunEvent[];
  /**
   * Line numbers that did not decode, never dropped.
   *
   * A journal is the durable half of this design, so a line silently skipped is a decision silently forgotten.
   * A truncated final line is the normal case — a process killed mid-append — and it must be visible.
   *
   * Its meaning is UNCHANGED by the unknown-kind split: every line below is still here, including the ones
   * {@link unknownKind} also names. That is what lets forty-odd existing consumers keep counting the same
   * total, and what keeps the phase-sensitive and correctness gates standing off where the header says they
   * must. The ownership guards take {@link ownershipAmbiguousLines} instead.
   */
  readonly unreadable: readonly number[];
  /**
   * The SUBSET of {@link unreadable} that is a well-formed event this build simply has no case for.
   *
   * A known kind that refused its own line — a `ruling` with no anchor, a `launched` with no `sessionId` —
   * is deliberately NOT here: those refusals are this build's own field rules working, not a vintage gap.
   */
  readonly unknownKind: readonly UnknownKindLine[];
}

/**
 * Read a whole journal.
 *
 * @param text the journal file's contents, one JSON object per line
 * @returns the events in order, plus the 1-indexed line numbers that could not be decoded
 */
export function parseLedger({ text: contents }: { text: string }): ParsedLedger {
  const events: RunEvent[] = [];
  const unreadable: number[] = [];
  const unknownKind: UnknownKindLine[] = [];
  contents.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    const event = decodeLedgerLine({ line });
    if (event === undefined) {
      const lineNumber = index + 1;
      unreadable.push(lineNumber);
      const unknown = unknownKindOf({ line, lineNumber });
      if (unknown !== undefined) {
        unknownKind.push(unknown);
      }
      return;
    }
    events.push(event);
  });
  return { events, unknownKind, unreadable };
}

/**
 * Serialise one event as a journal line, newline included.
 *
 * @param event the event to record
 * @returns one JSON line, newline-terminated so appends cannot run together
 */
export function ledgerLine({ event }: { event: RunEvent }): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * The events belonging to the run's most recent cycle — everything from the last `started` onwards.
 *
 * Shared rather than re-derived, because every reader of a journal needs the same slice and two copies of
 * "where does the current cycle begin" would eventually disagree about which run they were describing.
 *
 * @param events the journal's events, in order
 * @returns the current cycle's events, empty when nothing has ever started
 */
export function currentCycle({ events }: { events: readonly RunEvent[] }): readonly RunEvent[] {
  const lastStart = events.map((event) => event.kind).lastIndexOf("started");
  return lastStart === -1 ? [] : events.slice(lastStart);
}

/**
 * Derive a run's state from its journal.
 *
 * Only the MOST RECENT cycle counts — everything before the last `started` is history. A doc may legitimately
 * be run more than once (a follow-up, a re-run after an amendment), and folding old cycles in would leave a
 * finished run looking permanently open. The one thing history hands forward is a question the previous
 * cycle closed still holding, reaped or started over ({@link inheritedQuestion}): the new cycle opens waiting on it.
 *
 * @param events the journal's events, in order
 * @returns the derived state, or {@link NO_RUN} when nothing has ever started
 */
export function runStateOf({ events }: { events: readonly RunEvent[] }): RunState {
  const cycle = currentCycle({ events });
  if (cycle.length === 0) {
    return NO_RUN;
  }
  const started = cycle[0];
  const inherited = inheritedQuestion({ events });
  let state: RunState = {
    branch: started?.kind === "started" ? started.branch : undefined,
    docHash: started?.kind === "started" ? started.docHash : undefined,
    entries: cycle.length,
    lastIso: cycle[cycle.length - 1]?.atIso,
    openQuestion: inherited?.question,
    openQuestionPost: inherited?.post,
    phase: inherited === undefined ? "open" : "waiting-on-owner",
  };
  // The held question's SHAPE rides beside the phase fold, because one kind — `question-shaped` — moves the text only
  // when the question it names carries none, and `RunState` holds the text alone. Folding the same
  // `openQuestionAfter` the board folds keeps the two readers from ever disagreeing about which text is waiting.
  // A reshape never moves the phase, and the post handle (bound to the old text) stays as a correction's does.
  let held = inherited === undefined ? undefined : inheritedOpen({ inherited });
  for (const event of cycle) {
    state = applyEvent({ event, state });
    const binds = event.kind === "question-shaped" && held !== undefined && reshapeBinds({ event, held });
    if (binds && state.phase === "waiting-on-owner") {
      state = { ...state, openQuestion: event.question };
    }
    held = openQuestionAfter({ event, open: held });
  }
  return state;
}

/**
 * Fold one event into the derived state.
 *
 * The drive and ownership kinds — `launched`, `resumed`, `claimed`, `released`, `said`, `delivered`,
 * `drive-ended` — and the gate's own
 * `gated` deliberately change NOTHING. They record what a SESSION or an OBSERVER did, never where the run got to:
 * a launch is not progress, a stopped drive is not a closed run, and being looked at is neither. The phase still
 * moves only on the typed lifecycle verbs, so neither `handover start` nor the stop hook can make a run look
 * settled without someone recording a question, a finish or an abandonment. A drive's own state is derived
 * separately by `measurement/runState.ts`'s `driveStateOf`, identity by {@link ./runOwner} and the gate's
 * observations by {@link ./gateReport} — all three off the same events this fold walks.
 *
 * `question-withdrawn` reopens the run as `answered` does, but only over the text it names — `./openQuestion.ts`
 * binds it the same way, so a withdrawal of a question since replaced cannot clear the new one.
 */
function applyEvent({ state, event }: { state: RunState; event: RunEvent }): RunState {
  switch (event.kind) {
    case "amended":
      return { ...state, docHash: event.docHash };
    case "question":
    case "question-posted":
    case "question-corrected":
    case "question-offered":
    case "question-reconfirmed":
      return applyQuestionEvent({ event, state });
    case "question-withdrawn":
    case "answered":
      return event.kind === "answered" || state.openQuestion === event.question
        ? { ...state, openQuestion: undefined, openQuestionPost: undefined, phase: "open" }
        : state;
    case "finished":
    case "closed":
    case "abandoned":
    case "orphaned":
      return { ...state, openQuestion: undefined, openQuestionPost: undefined, phase: "closed" };
    // Everything below is a fact ABOUT the run rather than a transition OF it, so none moves a phase.
    case "started":
    case "probed":
    case "launched":
    case "resumed":
    case "claimed":
    case "released":
    case "parked":
    case "park-cleared":
    case "park-wake-suspended":
    case "steer-risk":
    case "lessons":
    case "said":
    case "delivered":
    case "drive-ended":
    case "gated":
    case "dispatched":
    case "signed-off":
    case "artifact":
    case "ruling":
    case "tagged":
    case "question-shaped":
    case "question-examples":
    case "question-shot":
      // `question-shaped` moves only the waiting TEXT where `reshapeBinds` says; examples and a shot illustrate it.
      // `artifact` is a fact about the ROW, not a transition OF the run cycle, so `./derivedRowState.ts` reads it:
      // recording where an answer was published, or re-pointing a page that moved, is progress on nothing.
      // `ruling` is inert for the same reason and one sharper one: a ruling is not an ANSWER. `answered` reopens a
      // run because it settles the question that paused it; what the owner decided about the work says nothing about
      // whether a cycle is waiting, so a ruling never unpauses a run still waiting on the owner, nor reopens a closed one.
      //
      // `dispatched` and `signed-off` are inert for a sharper reason than the rest, and it is the point of both:
      // they are written by the SUPERVISOR, and a supervisor must not be able to move a run's phase from outside
      // it. A dispatch is not a start — only the dispatched session running `handover start` opens a run, which
      // is exactly what makes a no-show detectable as a dispatch with no start after it. And a sign-off is not a
      // close: if signing could close a run, the sign-off would become another way to self-certify, which is the
      // hole it exists to expose.
      return state;
  }
}

/**
 * The question lifecycle's own sub-fold — the five kinds that touch `openQuestion` and its post handle.
 *
 * Held apart from {@link applyEvent} because they are the only kinds that read the state they are folding
 * into: four of the five do nothing unless the run is already waiting on the owner, and each says why.
 */
function applyQuestionEvent({
  state,
  event,
}: {
  state: RunState;
  event: Extract<
    RunEvent,
    { kind: "question" | "question-posted" | "question-corrected" | "question-offered" | "question-reconfirmed" }
  >;
}): RunState {
  switch (event.kind) {
    case "question":
      return { ...state, openQuestion: event.question, openQuestionPost: undefined, phase: "waiting-on-owner" };
    case "question-posted":
      // A handle for a question no longer open would link a card to a message nobody is waiting on, so it binds
      // only to the exact question it posted — never to a later one that happens to be waiting.
      return state.phase === "waiting-on-owner" && state.openQuestion === event.question
        ? { ...state, openQuestionPost: questionPostOf({ event }) }
        : state;
    case "question-corrected":
      return state.phase === "waiting-on-owner" ? { ...state, openQuestion: event.question } : state;
    // An offer attaches an ACTION to the question already waiting; it never re-asks one and never opens a
    // run that is not waiting, so it moves no phase and leaves the question's own text alone. What it
    // carries is projected by `./openQuestion.ts`, which is the fold a card reads.
    case "question-offered":
      return state;
    // A reconfirm is a fact ABOUT the waiting question, never a transition: it re-asks nothing and moves no phase.
    case "question-reconfirmed":
      return state;
  }
}

/**
 * Whether a run may end the session without a gate objecting.
 *
 * Both typed endings count, and so does a recorded question. The gate exists to catch a run that simply stops
 * — the compaction case — not to force one to keep going.
 *
 * @param state the derived run state
 * @returns true when the run is in a state a reader could pick up or has deliberately closed
 */
export function isSettled({ state }: { state: RunState }): boolean {
  return state.phase !== "open";
}
