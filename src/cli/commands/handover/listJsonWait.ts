/**
 * What a published board row says about waiting on the owner — the verdict, the question and when the owner was
 * asked — read off the composed row once, so the three can never disagree.
 *
 * Split out of `./listJson.ts` (the file-size ratchet) when a second source of the question arrived: a RUN
 * parked on the owner records one in its journal, and a registered ask carrying its whole shape is one with no run
 * behind it (`../../../handover/registeredAsk.ts`).
 */

import type { BoardModel } from "../../../handover/boardTypes.js";
import { type OwnerWait, ownerWaitOf } from "../../../handover/ownerWait.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";
import { type RegisteredAsk, registeredAskOf } from "../../../handover/registeredAsk.js";

/** The owner-wait fields one published row carries. */
export interface PublishedWait {
  readonly wait: OwnerWait;
  /** The question a run recorded, or a registered ask's summary — absent when the row is not waiting on the owner. */
  readonly question: string | undefined;
  /** When that question was asked, off the same source as {@link question}. */
  readonly questionAskedIso: string | undefined;
}

/**
 * The registered ask the board placed in `WAITING ON OWNER` with no run behind it, or `undefined`.
 *
 * Read only when the board's own section says so, so the published question can never disagree with the
 * placement — the dependency pass may have held the same row in `NOT YET`, and it is not the owner's then.
 */
function registeredAskFor({ model }: { model: BoardModel }): RegisteredAsk | undefined {
  if (model.section !== "WAITING ON OWNER") {
    return undefined;
  }
  return registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run });
}

/**
 * The owner-wait verdict, question and asked instant a board row publishes.
 *
 * The question and its instant are read off the `waiting-on-owner` arm by discriminant rather than by an
 * optional-chained property read, because `RunDisposition`'s other arms carry a `summary`, a `why`, a `reason`
 * and an `atIso`, and none of them is the question or when the owner was asked — reaching for whichever exists would
 * report an abandonment as an ask.
 *
 * @param model the composed row
 * @returns the verdict with the question and instant it rests on
 */
export function publishedWaitOf({ model }: { model: BoardModel }): PublishedWait {
  const registered = registeredAskFor({ model });
  const wait = ownerWaitOf({ derived: model.derived, registered, run: model.run });
  if (model.run.kind === "waiting-on-owner") {
    return { question: model.run.question, questionAskedIso: model.run.askedIso, wait };
  }
  return { question: registered?.question, questionAskedIso: registered?.askedIso, wait };
}

/**
 * When the owner ruled, on a row whose ruling landed after its question.
 *
 * @param wait the row's owner-wait verdict
 * @returns the decision instant, present only on the `already-ruled` arm
 */
export function ruledSinceQuestionIsoOf({ wait }: { wait: OwnerWait }): string | undefined {
  if (wait.kind === "already-ruled") {
    return wait.ruledIso;
  }
  return undefined;
}

/**
 * The seat parked on a row and CLOSED — where it stood, so a reseat resumes rather than starting over
 * (`../../../handover/parked.ts`). An open question rides on the row's own `question`; `drafts` is absent on a
 * checkpoint older than the field, and `wake` on one that waits on the owner rather than on a clock or CI.
 */
export type PublishedParked = Pick<ParkedEvent, "atIso" | "branch" | "screenTail" | "workspaceRef" | "worktree"> &
  Pick<ParkedEvent, "drafts" | "wake"> & {
    /** The park's position in the decoded journal — with the slug, the identity `handover wake --json` reports. */
    readonly parkIndex: number;
  };

/**
 * The parked checkpoint a row publishes, read off whichever open arm carries it — waiting on the owner, or
 * stopped between turns.
 *
 * @param model the composed row
 * @returns the checkpoint, or `undefined` unless a seat is parked on the row now
 */
export function publishedParkedOf({ model }: { model: BoardModel }): PublishedParked | undefined {
  const { run } = model;
  if ((run.kind !== "waiting-on-owner" && run.kind !== "active") || run.parked === undefined) {
    return undefined;
  }
  const { atIso, branch, drafts, screenTail, wake, workspaceRef, worktree } = run.parked;
  return {
    atIso,
    branch,
    ...(drafts === undefined ? {} : { drafts }),
    // Set beside every `parked` the disposition carries (`../../../handover/boardTypes.ts`): an invariant.
    parkIndex: run.parkIndex!,
    ...(wake === undefined ? {} : { wake }),
    screenTail,
    workspaceRef,
    worktree,
  };
}
