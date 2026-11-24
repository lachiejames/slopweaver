/**
 * The owner's yes or no to ONE waiting private-term proposal, kept beside that proposal as `<proposal-id>.answer`.
 *
 * The owner answers on the Queue card that shows them the word (`site/components/console/PrivateTermProposals.tsx`),
 * one press per item; the press runs `slopweaver private-terms answer`, which writes here and nothing else. The
 * fleet then lands a yes with `private-terms confirm`, and `confirm` refuses a proposal answered no
 * (`./privateTermsStore.ts`). The answer carries the proposal id, the word, who recorded it and when — never a
 * pattern, a meaning or a source — so nothing private is copied by recording it.
 *
 * One file per proposal rather than a ledger: a second press replaces the first, which is what changing their mind on
 * the card means, and a confirm that lands the proposal removes its answer with it.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";

import { stateHomePaths } from "../stateHome.js";

/** The two answers a card press records. */
const PRIVATE_TERM_ANSWERS = ["yes", "no"] as const;

/** One of {@link PRIVATE_TERM_ANSWERS}. */
type PrivateTermAnswerWord = (typeof PRIVATE_TERM_ANSWERS)[number];

/**
 * Where an answer can have been given: `console` for a Queue card press, `word` for one the owner said or typed. A closed
 * set rather than free text, because the value is printed back and free text could carry the word itself.
 */
export const PRIVATE_TERM_ANSWER_VIAS = ["console", "word"] as const;

/** One of {@link PRIVATE_TERM_ANSWER_VIAS}. */
export type PrivateTermAnswerVia = (typeof PRIVATE_TERM_ANSWER_VIAS)[number];

/** One recorded answer. */
export interface PrivateTermAnswer {
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly answer: PrivateTermAnswerWord;
  readonly via: PrivateTermAnswerVia;
  readonly bySession: string;
  readonly answeredAtIso: string;
}

/**
 * Where one proposal's answer is kept: beside the proposal, under the same owner-only directory.
 *
 * @param home the state home
 * @param proposalId an id already checked against the proposal shape
 * @returns the path
 */
export function privateTermAnswerPath({ home, proposalId }: { home: string; proposalId: string }): string {
  return join(stateHomePaths({ home }).privateTermProposals, `${proposalId}.answer`);
}

/**
 * The bytes one answer is kept as. The write itself is the store's (`./privateTermsStore.ts`
 * `answerPrivateTermsProposal`), under the lock a confirm takes, so an answer and a confirm never interleave.
 *
 * @param answer what was answered
 * @returns the file's contents
 */
export function privateTermAnswerContents({ answer }: { answer: PrivateTermAnswer }): string {
  return `${safeJsonStringify({ label: "private term answer", space: 2, value: answer })}\n`;
}

/** Whether anything, a link included, sits at a path; one whose lstat fails for another reason counts as there. */
function entryExists({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error: unknown) {
    return !(isRecord(error) && error["code"] === "ENOENT");
  }
}

/** A parsed value as an answer this module wrote for that proposal, or `undefined` for any other shape. */
function answerFor({ value, proposalId }: { value: unknown; proposalId: string }): PrivateTermAnswer | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== 1 || value["proposalId"] !== proposalId) {
    return undefined;
  }
  const answer = PRIVATE_TERM_ANSWERS.find((word) => word === value["answer"]);
  const via = PRIVATE_TERM_ANSWER_VIAS.find((known) => known === value["via"]);
  const { bySession, answeredAtIso } = value;
  if (answer === undefined || via === undefined || typeof bySession !== "string" || typeof answeredAtIso !== "string") {
    return undefined;
  }
  return { answer, answeredAtIso, bySession, proposalId, schemaVersion: 1, via };
}

/**
 * The answer recorded for one proposal: none yet, the answer, or a file there that does not read as one.
 *
 * @param home the state home
 * @param proposalId an id already checked against the proposal shape
 * @returns what is recorded
 */
export function readPrivateTermAnswer({
  home,
  proposalId,
}: {
  home: string;
  proposalId: string;
}):
  | { readonly kind: "none" }
  | { readonly kind: "answered"; readonly answer: PrivateTermAnswer }
  | { readonly kind: "unreadable"; readonly path: string } {
  const path = privateTermAnswerPath({ home, proposalId });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    // ENOENT is "no answer" only when nothing at all sits at the path: a dangling link raises it too, and an
    // entry that is there but does not read may have held a no.
    if (isRecord(error) && error["code"] === "ENOENT" && !entryExists({ path })) {
      return { kind: "none" };
    }
    return { kind: "unreadable", path };
  }
  try {
    const answer = answerFor({ proposalId, value: safeJsonParse({ label: "private term answer", text }) });
    if (answer !== undefined) {
      return { answer, kind: "answered" };
    }
  } catch {
    // A file that is not JSON is reported as unreadable, exactly like one of the wrong shape.
  }
  return { kind: "unreadable", path };
}
