/**
 * Composing a bounded, human-readable clause for a pass outcome that isn't a clean first-try answer.
 *
 * A first-try `READY`/`CLEAN` prints nothing extra — today's terse line already says everything there is
 * to say. Everything else (`BLOCKED`, `BROKEN`, a no-verdict, a fatal transport failure, or a clean answer
 * that only arrived after a recovery turn) already carries the reason in `CodexArtifactRecord`; it is just
 * scattered across `outcome`, `attempts` and `salvage`, and never composed into one line at the point a
 * human actually reads it. This module does that composition and nothing else — no new field, no history
 * scan, no confidence concept.
 *
 * Deliberately excludes any model-authored prose (summary, blockers, evidence, counterexample, salvaged
 * agent message, raw response): those are unbounded free text and can themselves be the alarmist narration
 * this is meant to contain. The durable artifact stays the one place that prose lives.
 */

import { formatTransportCause } from "./transportCause.js";
import type { CodexArtifactRecord, CodexAttempt, PassSalvage, PlanAnswer, ReviewAnswer } from "./types.js";

/**
 * The `kind=status` chain for every recorded attempt, oldest first.
 *
 * @param attempts the pass's recorded attempts
 * @returns e.g. `initial=aborted, conclusion=answered`
 */
function attemptChain({ attempts }: { attempts: readonly CodexAttempt[] }): string {
  return attempts.map((attempt) => `${attempt.kind}=${attempt.status}`).join(", ");
}

/**
 * A bounded summary of what was observed before a no-verdict stop — counts only, never the salvaged prose.
 *
 * `salvage` is typed as required on `CodexPassOutcome`, but a real sidecar written before that field existed
 * has no such guarantee at runtime — `scanPassRecords`' decoder only checks shallow fields, so `codex status`
 * scanning one of those legacy records would otherwise dereference a missing property and crash the whole
 * command (found by an adversarial review of this diff, against a real reachable disk shape).
 *
 * @param salvage what the pass had done when it stopped — `null` when nothing was observed, or `undefined`
 *   on a record that predates this field entirely
 * @returns one clause describing the salvage, or the absence of it
 */
function salvageClause({ salvage }: { salvage: PassSalvage | null | undefined }): string {
  if (salvage === undefined) {
    return "no salvage recorded (this record predates that field)";
  }
  if (salvage === null) {
    return "nothing was observed before the stop";
  }
  const writes = `${String(salvage.fileChanges)} write${salvage.fileChanges === 1 ? "" : "s"}`;
  const message = salvage.lastAgentMessage === null ? "no message preserved" : "a message was preserved";
  return (
    `salvaged ${String(salvage.commands)} command${salvage.commands === 1 ? "" : "s"} ` +
    `(${String(salvage.failedCommands)} failed), ${String(salvage.searches)} search${salvage.searches === 1 ? "" : "es"}, ` +
    `${writes}, ${message}`
  );
}

/**
 * The clause for an outcome that reached a validated answer — `READY`, `BLOCKED`, `CLEAN` or `BROKEN`.
 *
 * Every field this reads (`answer.blockers`, `answer.propertyId`) is trusted per its type — an array, a
 * string equal to the caller-validated, path-safe property id `parseReviewAnswer` already checked before
 * `writeCodexArtifact` ever persisted the record. `safeOutcomeContext` (ledger.ts) degrades any THROW this
 * produces against a legacy disk record missing a field entirely. A field present but actively wrong —
 * wrong-typed, or content that could never have passed that write-time check — requires a record.json
 * hand-edited outside any real path here, and defending against that is the general decoder-hardening
 * project `scanPassRecords`/`ledgerStore.ts` would need, not a fix that belongs in this formatter.
 *
 * @param answer the validated plan or review answer
 * @param attempts the pass's recorded attempts, for the READY/CLEAN recovery check
 * @returns the composed clause, or `undefined` for a clean first-try result
 */
function answeredClause({
  answer,
  attempts,
}: {
  answer: PlanAnswer | ReviewAnswer;
  attempts: readonly CodexAttempt[];
}): string | undefined {
  if (answer.verdict === "BLOCKED") {
    const count = answer.blockers.length;
    return `answer recorded ${String(count)} blocker${count === 1 ? "" : "s"}`;
  }
  if (answer.verdict === "BROKEN") {
    // A finding reached only on the policy retry still says so: the refusal before it is part of the record.
    const retried = attempts.some((attempt) => attempt.kind === "policy-retry");
    const retriedClause = retried ? ` after ${attemptChain({ attempts })}` : "";
    return `counterexample and diff evidence recorded for ${answer.propertyId}${retriedClause}`;
  }
  // READY or CLEAN: nothing to add unless there's a recorded recovery — no attempt data recorded at all
  // (an older record, or a bare test fixture) is NOT evidence of recovery and must not be read as one.
  const recovered = attempts.length >= 2 || (attempts.length === 1 && attempts[0]?.status !== "answered");
  return recovered ? `recovered after ${attemptChain({ attempts })}` : undefined;
}

/**
 * The clause for an outcome that never reached a validated answer — a typed no-verdict reason, or a fatal
 * transport failure.
 *
 * @param outcome the pass's no-verdict or fatal outcome
 * @param attempts the pass's recorded attempts
 * @returns the composed clause
 */
function unansweredClause({
  outcome,
  attempts,
}: {
  outcome: Exclude<CodexArtifactRecord["outcome"], { kind: "answered" }>;
  attempts: readonly CodexAttempt[];
}): string {
  const chain = attemptChain({ attempts });
  const attemptsClause = chain === "" ? "" : `; attempts ${chain}`;
  if (outcome.kind === "fatal") {
    // The cause is the provider's or the boundary's words, never the model's, and `formatTransportCause`
    // bounds it to one line — so it clears this module's no-unbounded-prose rule. A record written before the
    // field existed has none at runtime; the formatter's parameter admits that, the same way `salvageClause`'s does.
    return `transport failed: ${formatTransportCause({ cause: outcome.cause })}${attemptsClause}`;
  }
  const reasonClause: Record<typeof outcome.reason, string> = {
    "invalid-output": "response failed validation",
    "unrecoverable-abort": "initial attempt aborted before a thread id was available",
    "no-conclusion-in-bound": "no valid conclusion before the bound expired",
    "off-track": "tripwire stopped the pass as off-track",
  };
  return `${reasonClause[outcome.reason]}${attemptsClause}; ${salvageClause({ salvage: outcome.salvage })}`;
}

/**
 * Compose the bounded, single-line outcome context for one pass, or `undefined` when today's terse line
 * already says everything (a first-try `READY`/`CLEAN` with no recovery).
 *
 * @param record the completed pass record
 * @returns the composed clause, or `undefined` when nothing needs adding
 */
export function formatPassOutcomeContext({ record }: { record: CodexArtifactRecord }): string | undefined {
  const { outcome, attempts } = record;
  return outcome.kind === "answered"
    ? answeredClause({ answer: outcome.answer, attempts })
    : unansweredClause({ attempts, outcome });
}
