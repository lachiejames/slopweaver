/**
 * THE PRIVATE-WORDS REVIEW, the one function every write guard asks (`./types.ts`): given what the privacy check
 * found in a write, is it sent, refused, or held for a review in context.
 *
 * A guard passes a {@link PrivateTermReviewPort} when the review can run for it; without one a match on a row
 * carrying the owner's meaning refuses outright, exactly as every match did before the review existed, so a
 * guard nobody wired is closed rather than open. The port reads the environment's visible session, the clock and
 * fresh ids, and nothing else; the store is `./store.ts`.
 */
import { err, type Result } from "#lib/result.js";

import type { PrivateTerm } from "../../hygiene/privateTerms.js";
import {
  detectSupervisorSession,
  parseVisibleSession,
  type VisibleSupervisorSession,
} from "../../supervisor/session.js";
import type { PrivacyDestination, PrivacyFinding, PrivacyPolicy } from "../privacyCheck.js";
import { printedUnderTerms, writePrivacyRefusal } from "../writePrivacyLeaves.js";
import type { PrivateTermReviewError } from "./errors.js";
import { decidePrivateTermWrite, heldWriteLines, type PrivateTermWriteInput, unmeantRowsReason } from "./hold.js";
import { mintHoldId, releaseOrHold } from "./store.js";
import type { PrivateTermGateOutcome, PrivateTermWriteDraft } from "./types.js";

/** What a guard holds when a held write can be reviewed: the home its records live in, and the one store call. */
export interface PrivateTermReviewPort {
  readonly home: string;
  readonly releaseOrHold: (args: {
    readonly draft: PrivateTermWriteDraft;
  }) => Result<PrivateTermGateOutcome, PrivateTermReviewError>;
}

/**
 * The visible session an environment names, only when it is one a record can carry and read back.
 *
 * @param env the process environment
 * @returns the session, or null when there is none, two, or one whose id is not bare
 */
export function visibleSessionNow({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): VisibleSupervisorSession | null {
  const detected = detectSupervisorSession({ env });
  if (detected.kind !== "active") {
    return null;
  }
  const parsed = parseVisibleSession({ value: detected.session });
  if (parsed === undefined) {
    return null;
  }
  return parsed;
}

/**
 * The production port for one home: this process's visible session, the wall clock and random hold ids.
 *
 * @param home the state home the review's records live in
 * @returns the port
 */
export function privateTermReviewPort({ home }: { home: string }): PrivateTermReviewPort {
  return {
    home,
    releaseOrHold: ({ draft }) =>
      releaseOrHold({
        draft,
        heldBy: visibleSessionNow({ env: process.env }),
        home,
        newHoldId: mintHoldId,
        nowIso: new Date().toISOString(),
      }),
  };
}

/**
 * Decide one write a guard judged: undefined to send it, or the text it is refused or held with.
 *
 * @param write the write as its guard hands it over
 * @param findings every finding the check made on its contents
 * @param privacyDestination the facts the check judged against, so the matches are the ones it counted
 * @param policy the policy the findings were made under
 * @param review the port that holds and releases, absent when this guard's writes cannot be reviewed
 * @returns undefined when the write may go; otherwise every line, judged against the private terms
 */
export function privateTermWriteRefusal({
  write,
  findings,
  privacyDestination,
  policy,
  review,
}: {
  write: PrivateTermWriteInput;
  findings: readonly PrivacyFinding[];
  privacyDestination: PrivacyDestination;
  policy: PrivacyPolicy;
  review: PrivateTermReviewPort | undefined;
}): string | undefined {
  const terms: readonly PrivateTerm[] = policy.privateTerms;
  const reasons = findings.map((finding) => finding.message);
  const decision = decidePrivateTermWrite({ findings, policy, privacyDestination, write });
  if (decision.kind === "send") {
    return undefined;
  }
  if (decision.kind === "refuse") {
    return writePrivacyRefusal({ command: write.command, reasons, terms });
  }
  if (decision.kind === "refuse-unmeant") {
    const why = unmeantRowsReason({ termIds: decision.termIds });
    return writePrivacyRefusal({ command: write.command, reasons: [...reasons, why], terms });
  }
  if (review === undefined) {
    const why = "this write's door cannot hold a write for a review, so a match refuses outright";
    return writePrivacyRefusal({ command: write.command, reasons: [...reasons, why], terms });
  }
  const outcome = guarded({ draft: decision.draft, review });
  if (outcome.isErr()) {
    const why = `the review store could not hold it, so it is refused: ${outcome.error.message}`;
    return writePrivacyRefusal({ command: write.command, reasons: [...reasons, why], terms });
  }
  if (outcome.value.kind === "released") {
    return undefined;
  }
  const lines = heldWriteLines({
    brokenReceipts: outcome.value.broken.map((receipt) => receipt.receiptId),
    command: write.command,
    holdId: outcome.value.holdId,
    home: review.home,
    reasons,
  });
  return printedUnderTerms({ lines, terms });
}

/** The port's answer, a throw inside it read as a refusal rather than a send. */
function guarded({
  draft,
  review,
}: {
  draft: PrivateTermWriteDraft;
  review: PrivateTermReviewPort;
}): Result<PrivateTermGateOutcome, PrivateTermReviewError | { readonly message: string }> {
  try {
    return review.releaseOrHold({ draft });
  } catch (error: unknown) {
    return err({ message: error instanceof Error ? error.message : "the review store threw" });
  }
}
