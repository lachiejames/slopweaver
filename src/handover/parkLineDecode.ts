/**
 * Decoding the journal lines a park writes: the `parked` checkpoint itself, the `park-cleared` that retires one no
 * wake can reseat, and the `park-wake-suspended` that keeps one standing while its wake waits on the owner's question.
 *
 * Its own module, beside `./rulingLineDecode.ts` and `./questionLineDecode.ts`, because `./ledgerDecode.ts`
 * sits at the file-size ratchet's cap and these two are one seam a reader would draw anyway.
 */
import type { RunEvent } from "./ledger.js";
import { optionalCount, optionalText, text } from "./ledgerFields.js";
import { decodeParkedDrafts } from "./parkedEvent.js";
import { decodeParkWake } from "./parkWake.js";

/**
 * Decode a parked seat; like a release, one naming no session cannot safely clear anybody's claim.
 *
 * @param payload the journal line's fields
 * @returns the checkpoint, or `undefined` when the line names no session
 */
export function parkedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const sessionId = optionalText({ key: "sessionId", payload });
  if (sessionId === undefined) {
    return undefined;
  }
  const question = optionalText({ key: "question", payload });
  const drafts = decodeParkedDrafts({ raw: payload["drafts"] });
  const wake = decodeParkWake({ raw: payload["wake"] });
  return {
    atIso,
    branch: text({ key: "branch", payload }),
    kind: "parked",
    ...(question === undefined ? {} : { question }),
    ...(drafts === undefined ? {} : { drafts }),
    ...(wake === undefined ? {} : { wake }),
    screenTail: text({ key: "screenTail", payload }),
    sessionId,
    workspaceRef: text({ key: "workspaceRef", payload }),
    worktree: text({ key: "worktree", payload }),
  };
}

/**
 * Decode a retired park; one naming no park position is unreadable, because a defaulted index would clear
 * whichever park happened to sit there.
 *
 * @param payload the journal line's fields
 * @returns the clear, or `undefined` when the line names no whole, non-negative position
 */
export function parkClearedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const parkIndex = optionalCount({ key: "parkIndex", payload });
  if (parkIndex === undefined || !Number.isInteger(parkIndex) || parkIndex < 0) {
    return undefined;
  }
  return { atIso, kind: "park-cleared", parkIndex, why: text({ key: "why", payload }) };
}

/**
 * Decode a park's wake suspended on the owner's question. Unreadable when it names no whole, non-negative position, no
 * question, no asked instant, or no judged length past the park: each is what binds the suspension, and a defaulted
 * one would bind it to whatever park or question happened to match.
 *
 * @param payload the journal line's fields
 * @returns the suspension, or `undefined` when a binding field is missing or malformed
 */
export function parkWakeSuspendedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const parkIndex = optionalCount({ key: "parkIndex", payload });
  const question = optionalText({ key: "question", payload });
  const questionAskedIso = optionalText({ key: "questionAskedIso", payload });
  const judgedLength = optionalCount({ key: "judgedLength", payload });
  if (parkIndex === undefined || !Number.isInteger(parkIndex) || parkIndex < 0) {
    return undefined;
  }
  if (judgedLength === undefined || !Number.isInteger(judgedLength) || judgedLength <= parkIndex) {
    return undefined;
  }
  if (question === undefined || question === "" || questionAskedIso === undefined || questionAskedIso === "") {
    return undefined;
  }
  return {
    atIso,
    judgedLength,
    kind: "park-wake-suspended",
    parkIndex,
    question,
    questionAskedIso,
    why: text({ key: "why", payload }),
  };
}
