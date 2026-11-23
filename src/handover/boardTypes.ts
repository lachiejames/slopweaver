/*
 * The board's vocabulary, and the one derivation that needs nothing but the run journal.
 *
 * Everything here is what the layers above AGREE on: the sections a row can print under, the closure a
 * dependency walk reports, the composed model every consumer reads, and the own-evidence verdict the rule
 * family below hands back. It imports no other module of this family, which is what lets the rules, the
 * dependency pass and the refusals each import it without any of them seeing the others.
 *
 * {@link runDisposition} sits here rather than with the rules because it reads the journal alone and
 * nothing else in the family: it is the vocabulary's own constructor, not a placement rule.
 */

import type { HandShot } from "../hand/shot.js";

import type { AskAction } from "./askAction.js";
import type { AskExampleSet } from "./askExamples.js";
import type { AskShape } from "./askShape.js";
import { type Consistency } from "./consistency.js";
import { type DerivedRowState } from "./derivedRowState.js";
import { type ClosedNotShippedStatus, type DocProbeState, type HandoverDoc } from "./doc.js";
import { heldQuestion, rulingsAfterRestatement } from "./heldQuestion.js";
import { currentCycle, type RunEvent } from "./ledger.js";
import type { Reconfirmation } from "./openQuestion.js";
import { parkAsItWaits } from "./parked.js";
import type { ParkedEvent } from "./parkedEvent.js";
import type { RowTags } from "./rowTagFold.js";
import type { RulingIdentity } from "./ruling.js";
import { type StandingSessionRuling, standingSessionRuling } from "./standingSession.js";

/** Where a doc's current run cycle has got to, distinguishing `finished` from `abandoned` unlike `RunState`. */
export type RunDisposition =
  | { readonly kind: "never-started" }
  | {
      readonly kind: "active";
      /**
       * The seat closed at rest BETWEEN turns, absent while a seat is open on the run — a parked seat leaves
       * the fleet, its state kept here for the reseat.
       */
      readonly parked?: ParkedEvent;
      /** Where that park sits in the decoded journal: with the slug, the park's identity, as `handover wake` reports it. */
      readonly parkIndex?: number;
      /**
       * The owner's latest live standing-session ruling on the row, in force or not, absent when they never made one — what the
       * chair's reconcile reads to seat a parked standing row again on sight (`./standingSession.ts`). Judged against
       * the reader's own clock, never here.
       */
      readonly standingSession?: StandingSessionRuling;
    }
  /**
   * Parked on the owner, with the instant the question was ASKED — the one number a reader needs to tell a
   * three-minute-old ask from a three-week-old one.
   */
  | {
      readonly kind: "waiting-on-owner";
      readonly question: string;
      readonly askedIso: string;
      /**
       * The problem/options/lean it was recorded with, absent on every ask written free-text before the
       * shape was required — which is what a card renders its "needs rewriting" mark from
       * (`./askShape.ts`).
       */
      readonly shape: AskShape | undefined;
      /** When the shape was recorded, so its still-real check has an age — `./openQuestion.ts` says why. */
      readonly shapeIso: string | undefined;
      /**
       * The concrete Slack ACTION the ask offers — the drafted message, who it tags and where it could go
       * (`./askAction.ts`). Absent on every ask that is a decision about work
       * rather than about a message, which is most of them; a card says so rather than drawing an empty
       * preview.
       */
      readonly action: AskAction | undefined;
      /**
       * True when the ask DID offer a draft and it would not read — distinct from the absence above,
       * because a row with no draft legitimately falls back to its doc's own front-matter options and a
       * row with a broken one must not. `./openQuestion.ts`'s field carries the whole reason.
       */
      readonly actionUnreadable: boolean;
      /** The last reconfirm that it still stands, absent until one lands — `./openQuestion.ts` says why. */
      readonly reconfirmed?: Reconfirmation;
      /** The concrete examples recorded for it, absent until one lands — `./openQuestion.ts` says why. */
      readonly illustration?: AskExampleSet;
      /** The boxed picture recorded for it, absent until one lands — `./openQuestion.ts` says why. */
      readonly shot?: HandShot;
      /**
       * The rulings journalled after a correction, reshape or offer last restated the question, absent when none
       * did — the only ones that can answer what is asked now (`./heldQuestion.ts`, `rulingsAfterRestatement`).
       */
      readonly ruledAfterRestatement?: readonly RulingIdentity[];
      /**
       * The seat that was parked and CLOSED, absent while a seat is still open on the run — the worktree,
       * branch, drafts and last screen a reseat reopens from (`./parked.ts`).
       */
      readonly parked?: ParkedEvent;
      /** Where that park sits in the decoded journal: with the slug, the park's identity, as `handover wake` reports it. */
      readonly parkIndex?: number;
      /** The owner's latest live standing-session ruling on the row — the `active` arm's field, read the same way. */
      readonly standingSession?: StandingSessionRuling;
    }
  | { readonly kind: "finished"; readonly atIso: string; readonly residue: readonly string[] }
  /** The work SHIPPED — the `closed` event, which is stronger evidence than `finished` and never awaits it. */
  | { readonly kind: "closed"; readonly atIso: string; readonly summary: string }
  | { readonly kind: "abandoned"; readonly why: string }
  | { readonly kind: "orphaned"; readonly deadSessionId: string; readonly lastEventIso: string }
  | { readonly kind: "unreadable"; readonly reason: string };

/** The board's rendered groupings, in the order they should print. */
export type BoardSection =
  | "CONTRADICTION"
  | "LOOKS SHIPPED"
  | "RUN NOW"
  | "WAITING ON OWNER"
  | "IN FLIGHT"
  | "PAUSED"
  | "NOT YET"
  | "AWAITING SHIP"
  | "CLOSED — NOT SHIPPED"
  | "DONE";

/** A terminal-not-shipped prerequisite reached directly or transitively through `blockedBy`. */
export interface DependencyClosure {
  readonly leaf: string;
  readonly status: ClosedNotShippedStatus;
  readonly reason: string | undefined;
  /** The path from the dependent to the leaf, dependent first, leaf last. */
  readonly via: readonly string[];
}

/** One doc's composed placement — the single answer every consumer should read instead of re-deriving one. */
export interface BoardModel {
  readonly doc: HandoverDoc;
  /**
   * The row's state as its REGISTER gives it — what every rule below reads instead of the `status:` line.
   * See {@link ./derivedRowState.ts} for the precedence and for why the authored line is still the fallback.
   */
  readonly derived: DerivedRowState;
  readonly probe: DocProbeState | undefined;
  readonly run: RunDisposition;
  /**
   * When the row last MOVED: the instant of its run journal's last event, in journal order, and absent when it
   * has no journal. The console's workstream band reads it to call an in-flight row slipping.
   */
  readonly movedIso: string | undefined;
  readonly consistency: Consistency;
  readonly dependencyClosures: readonly DependencyClosure[];
  readonly section: BoardSection;
  readonly reason: string;
  /** True only when this doc's own evidence would let it satisfy another doc's `blockedBy` edge. */
  readonly satisfiesDependency: boolean;
  /** The row's tags: what sessions declared in its journal, then what its own fields derive (`rowTagFold.ts`). */
  readonly tags: RowTags;
  /**
   * Whether the row's journal could not be completely read — an undecodable line, or the whole file unreadable —
   * so its declared tags and its `reply` tag may be incomplete. Its cause is not claimed: the reader folds both.
   */
  readonly tagsIncomplete: boolean;
}

/** A doc's own-evidence placement, computed WITHOUT consulting `blockedBy` — see the module header for why. */
export interface OwnEvidence {
  readonly section: BoardSection | "dependency-pending";
  readonly reason: string;
}

/** The four dispositions that say the cycle is over, as one name the fold below can accumulate into. */
type RunClosure = Extract<RunDisposition, { kind: "finished" | "closed" | "abandoned" | "orphaned" }>;

/**
 * The closing event this cycle ended on, if it ended.
 *
 * Folded separately from the open-question pass beside it because it reads nothing that pass writes: each
 * closing kind simply overwrites the one before it, so the LAST closing event in the cycle wins.
 *
 * @param cycle the current cycle's events, in order
 * @returns the closure, or undefined while the run is still open
 */
function closureIn({ cycle }: { cycle: readonly RunEvent[] }): RunClosure | undefined {
  let closure: RunClosure | undefined;
  for (const event of cycle) {
    if (event.kind === "finished") {
      closure = { atIso: event.atIso, kind: "finished", residue: event.residue };
    } else if (event.kind === "closed") {
      closure = { atIso: event.atIso, kind: "closed", summary: event.summary };
    } else if (event.kind === "abandoned") {
      closure = { kind: "abandoned", why: event.why };
    } else if (event.kind === "orphaned") {
      closure = { deadSessionId: event.deadSessionId, kind: "orphaned", lastEventIso: event.lastEventIso };
    }
  }
  return closure;
}

/**
 * A doc's current-cycle run disposition, distinguishing a `finished` closure from an `abandoned` one — the
 * distinction `RunState.phase` collapses to `closed` and this precedence engine cannot do without.
 *
 * @param events the journal's events, in order
 * @param unreadableLines line numbers the journal reader could not decode
 * @returns the derived disposition
 */
export function runDisposition({
  events,
  unreadableLines,
}: {
  events: readonly RunEvent[];
  unreadableLines: readonly number[];
}): RunDisposition {
  if (unreadableLines.length > 0) {
    return {
      kind: "unreadable",
      reason: `${String(unreadableLines.length)} journal line(s) could not be read`,
    };
  }
  const cycle = currentCycle({ events });
  if (cycle.length === 0) {
    return { kind: "never-started" };
  }
  const open = heldQuestion({ events });
  const closure = closureIn({ cycle });
  if (closure !== undefined) {
    return closure;
  }
  // As it WAITS: a wake suspended on the owner's open question is no wake, so the row never reads as parked on CI.
  const parked = parkAsItWaits({ events })?.parked;
  const standingSession = standingSessionRuling({ events });
  const standing = standingSession === undefined ? {} : { standingSession };
  if (open === undefined) {
    if (parked === undefined) {
      return { kind: "active", ...standing };
    }
    return { kind: "active", parkIndex: events.indexOf(parked), parked, ...standing };
  }
  return {
    action: open.action,
    actionUnreadable: open.actionUnreadable,
    askedIso: open.askedIso,
    kind: "waiting-on-owner",
    question: open.question,
    shape: open.shape,
    shapeIso: open.shapeIso,
    ...(open.reconfirmed === undefined ? {} : { reconfirmed: open.reconfirmed }),
    ...(open.illustration === undefined ? {} : { illustration: open.illustration }),
    ...(open.shot === undefined ? {} : { shot: open.shot }),
    ...(parked === undefined ? {} : { parkIndex: events.indexOf(parked), parked }),
    ...standing,
    ...(open.restatedBy === undefined
      ? {}
      : { ruledAfterRestatement: rulingsAfterRestatement({ events, restatement: open.restatedBy }) }),
  };
}

/**
 * Whether the run is waiting on an ask that offered a Slack draft AT ALL — what `list --json` suppresses the doc's
 * own options on, and what the derived `reply` tag reads. Present-and-readable and present-and-broken are one
 * answer, deliberately: both mean the options belong to the draft's own destinations, so the doc's front matter —
 * written before any draft existed — has nothing true to say about them, and a broken draft is still a draft.
 *
 * @param run the row's run disposition
 * @returns true only for a waiting run whose ask carries an action, readable or not
 */
export function offeredADraft({ run }: { run: RunDisposition }): boolean {
  return run.kind === "waiting-on-owner" && (run.action !== undefined || run.actionUnreadable);
}
