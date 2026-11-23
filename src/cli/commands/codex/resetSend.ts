/**
 * The half of `codex reset` that spends: send the consume through the door under the attempt's key, re-read THAT
 * store, and journal what came back together with the re-read. `./resetOne.ts` decides WHETHER and UNDER WHICH KEY
 * before anything reaches here; this file never mints a key and never judges a store, so a retry and a fresh attempt
 * send exactly the same way. It returns a typed result (`../../../codex/resetResult.ts`); the one line it prints is the fleet re-read after a refill.
 *
 * The re-read comes BEFORE the outcome row is written so the row carries it: the before reading on the intent and
 * the after reading here are the whole measurement of what a reset does to the week (`../../../codex/resetEvidence.ts`).
 * An outcome that cannot be journalled is a FAILED claim, never a success — the intent stays open, so the next run
 * re-asks under the same key and the provider answers it once.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { exchangeWithCodexStores, readCodexAccountsLive } from "../../../codex/accountLive.js";
import { currentCodexFleetCap } from "../../../codex/fleetCap.js";
import type { CodexFleetCapPort } from "../../../codex/fleetCapPort.js";
import {
  CONSUME_REQUEST_ID,
  type CodexConsumeOutcome,
  consumeRequests,
  readConsumeAnswer,
} from "../../../codex/resetConsume.js";
import { CodexResetErrors } from "../../../codex/resetErrors.js";
import { type CodexResetReading, resetReadingOf } from "../../../codex/resetEvidence.js";
import { appendCodexResetJournal } from "../../../codex/resetJournalStore.js";
import type { CodexResetRunResult } from "../../../codex/resetResult.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { logger } from "../../../lib/logger.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import type { CodexThresholds } from "../../../plans/thresholds.js";

/** How long the consume exchange may take — a network write, given more room than the 8s live read. */
const CONSUME_DEADLINE_MS = 20_000;

/** The attempt a run sends: its idempotency key, and the credit it names or none for the provider's pick. */
export interface AttemptToSend {
  readonly creditId: string | undefined;
  readonly idempotencyKey: string;
}

/** The store and state home a run acts on. */
export interface ResetTarget {
  readonly alias: string;
  readonly codexHome: string;
  readonly home: string;
  /** When the run holding the reset lock took it, in epoch milliseconds — a fresh claim past the budget is not started. */
  readonly startedMs: number;
  /** The register's Codex bars, read with the alias, so every reading this run journals judges `atLimit` by them. */
  readonly thresholds: CodexThresholds;
}

/** What the door is handed for the one consume exchange: the request it judges, and the send it performs on a pass. */
function consumeDoorCall({
  attempt,
  ledger,
  target,
}: {
  attempt: AttemptToSend;
  ledger: DoorLedgerPort;
  target: ResetTarget;
}): Parameters<typeof throughDoor<ReturnType<typeof exchangeWithCodexStores>>>[0] {
  const { alias, codexHome, home } = target;
  const { creditId, idempotencyKey } = attempt;
  return {
    gates: DEFAULT_GATES,
    home,
    ledger,
    perform: () =>
      exchangeWithCodexStores({
        answerIds: [CONSUME_REQUEST_ID],
        codexHomes: [codexHome],
        deadlineMs: CONSUME_DEADLINE_MS,
        requests: consumeRequests({ creditId, idempotencyKey }),
        scope: "account",
      }),
    request: {
      action: { kind: "verb", noun: "codex", verb: "reset" },
      artifact: { alias, id: `codex-reset:${idempotencyKey}` },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  };
}

/** A consume whose answer was lost: deferred, so the next run re-sends the SAME key. */
function deferOutcomeUnknown({
  alias,
  idempotencyKey,
  reason,
}: {
  alias: string;
  idempotencyKey: string;
  reason: string;
}): CodexResetRunResult {
  const unknown = CodexResetErrors.outcomeUnknown({ alias, idempotencyKey, reason });
  return { alias, kind: "deferred", reason: unknown.message };
}

/**
 * Re-read the one store the consume went to, straight after the answer.
 *
 * @param codexHome the store
 * @param thresholds the register's Codex bars the after reading's `atLimit` is judged by
 * @returns its reading, or undefined when the re-read found no usable sign-in
 */
function readAfter({
  codexHome,
  thresholds,
}: {
  codexHome: string;
  thresholds: CodexThresholds;
}): CodexResetReading | undefined {
  const [live] = readCodexAccountsLive({ codexHomes: [codexHome], readAtIso: new Date().toISOString() });
  return resetReadingOf({ live: live!, thresholds });
}

/**
 * Journal the provider's answer with the store's re-read.
 *
 * @param target the store and state home
 * @param idempotencyKey the attempt the answer settles
 * @param outcome what the provider answered
 * @param after the store re-read straight after, or undefined when it could not be read
 * @returns the settled result, or a failed one when the row could not be written
 */
function journalOutcome({
  after,
  idempotencyKey,
  outcome,
  target,
}: {
  after: CodexResetReading | undefined;
  idempotencyKey: string;
  outcome: CodexConsumeOutcome;
  target: ResetTarget;
}): CodexResetRunResult {
  const { alias, home } = target;
  const settled = appendCodexResetJournal({
    home,
    row: {
      alias,
      atIso: new Date().toISOString(),
      idempotencyKey,
      kind: "outcome",
      outcome,
      v: 1,
      ...(after === undefined ? {} : { after }),
    },
  });
  if (settled.isErr()) {
    return {
      alias,
      claimStarted: true,
      kind: "failed",
      reason: `the provider answered ${outcome} to ${idempotencyKey}, but ${settled.error.message} — re-run to settle it`,
    };
  }
  return { after, alias, idempotencyKey, kind: "settled", outcome };
}

/**
 * Send the consume through the door, re-read the store, and journal what came back with the re-read. A lost answer
 * leaves the intent open and returns deferred, so the next run re-sends the SAME key.
 *
 * @param attempt the key and credit to send
 * @param ledger the door ledger the consume's decision is recorded through
 * @param port where the plan register the post-reset fleet re-read takes is reached — the same port the alias
 *   was resolved through, so the refiled cap record describes the register the reset was aimed at
 * @param fleetCap where that re-read files the refilled window, so the monitor lane and routing read it next
 * @param signInPort where that re-read files each store's sign-in observation
 * @param target the store and state home
 * @returns what the claim came to
 */
export async function sendAndSettle({
  attempt,
  fleetCap,
  ledger,
  port,
  signInPort,
  target,
}: {
  attempt: AttemptToSend;
  fleetCap: CodexFleetCapPort;
  ledger: DoorLedgerPort;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
  target: ResetTarget;
}): Promise<CodexResetRunResult> {
  const { alias, codexHome, home } = target;
  const { idempotencyKey } = attempt;
  const routed = await throughDoor(consumeDoorCall({ attempt, ledger, target }));
  if (!routed.performed) {
    // Nothing was sent either way, and the open intent is re-sent under the same key on the next run. A store that
    // could not record the consume is a failure; a policy refusal is nothing redeemed.
    const reason = notPerformedLines({ command: "slopweaver codex reset", through: routed }).join("\n");
    if (routed.kind === "recording-refused") {
      return { alias, claimStarted: true, kind: "failed", reason };
    }
    return { alias, kind: "empty", reason };
  }
  const exchanged = routed.result;
  if ("reason" in exchanged) {
    return deferOutcomeUnknown({ alias, idempotencyKey, reason: exchanged.reason });
  }
  const answer = readConsumeAnswer({ lines: exchanged.linesByStore[0]! });
  if (answer.isErr()) {
    return deferOutcomeUnknown({ alias, idempotencyKey, reason: answer.error.message });
  }
  const settled = journalOutcome({
    after: readAfter({ codexHome, thresholds: target.thresholds }),
    idempotencyKey,
    outcome: answer.value,
    target,
  });
  if (settled.kind === "settled" && answer.value !== "noCredit" && answer.value !== "nothingToReset") {
    // A fresh fleet read re-files the store's `codex_fleet_cap` row, so the monitor lane and routing see the
    // refilled window on their next read instead of the cap this run just cleared.
    const fleet = await currentCodexFleetCap({
      fleetCap,
      home,
      nowIso: new Date().toISOString(),
      port,
      readLive: readCodexAccountsLive,
      signInPort,
    });
    logger.out({ line: `codex fleet now: ${fleet.why}` });
  }
  return settled;
}
