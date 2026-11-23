/**
 * One store's run of `codex reset`: decide whether to send and under which key, then send through `./resetSend.ts`.
 * Both forms of the verb reach a store only through here — `--plan` for the one it names, `--at-limit` for each the
 * planner (`../../../codex/resetFleet.ts`) picks — so a retry, a close and a fresh attempt behave identically
 * whichever form asked. The caller holds the reset lock (`../../../codex/resetLock.ts`) around the whole run.
 *
 * The order is the whole design (`../../../codex/resetConsume.ts` carries why each step is there): close an open
 * attempt the live read shows is over, else retry it under its own key and credit; refuse a FRESH attempt unless the
 * store holds a reset and is at its limit; journal the attempt's key with the store's BEFORE reading; send.
 */
import { randomUUID } from "node:crypto";

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import type { CodexFleetCapPort } from "../../../codex/fleetCapPort.js";
import {
  attemptOverReason,
  type CodexResetIntentRow,
  type CodexResetJournalRow,
  chooseResetCredit,
  openResetAttempt,
} from "../../../codex/resetConsume.js";
import type { CodexResetError } from "../../../codex/resetErrors.js";
import { resetReadingOf, soonestExpiringAvailableCredit, storeAtLimit } from "../../../codex/resetEvidence.js";
import { otherOpenAttempts } from "../../../codex/resetFleet.js";
import { appendCodexResetJournal, readCodexResetJournal } from "../../../codex/resetJournalStore.js";
import { RESET_RUN_BUDGET_MS } from "../../../codex/resetLock.js";
import type { CodexResetRunResult } from "../../../codex/resetResult.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { type AttemptToSend, type ResetTarget, sendAndSettle } from "./resetSend.js";

/** The variable that lets a reset spend on a store with room left — the `early-codex-reset` row's key. */
const EARLY_RESET_ENV = "SLOPWEAVER_ALLOW_EARLY_CODEX_RESET";

/** The stores a run reaches: the door ledger, the fleet-cap and sign-in records, and the plan register. */
export interface ResetOneDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly fleetCap: CodexFleetCapPort;
  readonly port: PlanRegisterPort;
  readonly signInPort: CodexSignInPort;
}

/** A credit that cannot be chosen: an unreadable store is a failure, anything else nothing to redeem. */
function creditRefusal({ alias, error }: { alias: string; error: CodexResetError }): CodexResetRunResult {
  if (error.code === "STORE_NOT_READABLE") {
    return { alias, claimStarted: false, kind: "failed", reason: error.message };
  }
  return { alias, kind: "empty", reason: error.message };
}

/**
 * A fresh attempt, or a wait while ANY other plan holds an open attempt. Whether two stores share one provider
 * account is only knowable when both reads name a matching identity — one exposing only an account id and the other
 * only an address cannot be joined — so a fresh key beside any unsettled attempt could spend a second reset on the
 * same refill. Checked against the journal as it stands at THIS claim, so an attempt an earlier
 * claim in the same run left open holds every later one. The tick settles open attempts every pass, so the wait is
 * one tick.
 *
 * @param alias the plan about to claim
 * @param rows the claims journal, read for this claim
 * @returns fresh, or the deferred result naming who it waits on
 */
function freshOrWaiting({
  alias,
  rows,
}: {
  alias: string;
  rows: readonly CodexResetJournalRow[];
}): { readonly kind: "fresh" } | { readonly kind: "result"; readonly result: CodexResetRunResult } {
  const others = otherOpenAttempts({ alias, rows });
  if (others.length === 0) {
    return { kind: "fresh" };
  }
  const reason =
    `${others.join(", ")} still holds an open attempt, which may share ${alias}'s account — nothing was sent; ` +
    "the tick's `codex reset --at-limit` settles it, then re-run";
  return { kind: "result", result: { alias, kind: "deferred", reason } };
}

/**
 * What this run does about the store's open attempt: none is open (a fresh attempt), retry it under its own key
 * and credit, or it was CLOSED because the live read shows it over.
 *
 * A run that closes an attempt SENDS NOTHING. The evidence that closes one — a window
 * refilled, its own credit now redeemed, no reset left — is exactly what a lost-but-spent attempt leaves behind, so
 * a fresh key minted in the same run could spend a second reset for the one redemption asked for.
 *
 * @param target the store and state home
 * @param live the store's live state
 * @param rows the claims journal, in file order
 * @returns what to do, or the failed result when the close could not be journalled
 */
function openAttemptStep({
  live,
  rows,
  target,
}: {
  live: CodexAccountLive;
  rows: readonly CodexResetJournalRow[];
  target: ResetTarget;
}):
  | { readonly kind: "fresh" }
  | { readonly kind: "retry"; readonly intent: CodexResetIntentRow }
  | { readonly kind: "result"; readonly result: CodexResetRunResult } {
  const { alias, home } = target;
  const open = openResetAttempt({ alias, rows });
  if (open === undefined) {
    return freshOrWaiting({ alias, rows });
  }
  const over = attemptOverReason({ attempt: open, live, thresholds: target.thresholds });
  if (over === undefined) {
    return { intent: open, kind: "retry" };
  }
  const { idempotencyKey } = open;
  const closed = appendCodexResetJournal({
    home,
    row: { alias, atIso: new Date().toISOString(), idempotencyKey, kind: "closed", reason: over, v: 1 },
  });
  if (closed.isErr()) {
    return { kind: "result", result: { alias, claimStarted: true, kind: "failed", reason: closed.error.message } };
  }
  return { kind: "result", result: { alias, idempotencyKey, kind: "closed", reason: over } };
}

/**
 * Retry an open attempt under its own key and credit, whatever credit this run names. No spend gate: it was judged
 * when its intent was written, and resending its key can spend nothing new.
 *
 * @param alias the store being redeemed on
 * @param intent the open attempt's intent row
 * @param live the store's live state
 * @param requestedCredit the credit this run named, ignored with a warning when it differs
 * @returns the attempt to send, or the result the run ends on
 */
function retryAttempt({
  alias,
  intent,
  live,
  requestedCredit,
}: {
  alias: string;
  intent: CodexResetIntentRow;
  live: CodexAccountLive;
  requestedCredit: string | undefined;
}): AttemptToSend | CodexResetRunResult {
  if (requestedCredit !== undefined && requestedCredit !== intent.creditId) {
    logger.error({
      msg: `codex reset: ignoring --credit ${requestedCredit} — the open attempt ${intent.idempotencyKey} is retried with its own credit`,
    });
  }
  const chosen = chooseResetCredit({ alias, creditId: intent.creditId, live });
  if (chosen.isErr()) {
    return creditRefusal({ alias, error: chosen.error });
  }
  logger.error({
    msg: `codex reset: settling the earlier attempt ${intent.idempotencyKey} on ${alias} rather than starting another`,
  });
  return { creditId: chosen.value.creditId, idempotencyKey: intent.idempotencyKey };
}

/**
 * The credit a fresh attempt names: the one asked for, else the listed reset that lapses first, else none (the
 * provider picks).
 *
 * @param live the store's live state
 * @param requestedCredit the credit the caller named, if any
 * @returns the credit id to name, or undefined
 */
function freshCreditOf({
  live,
  requestedCredit,
}: {
  live: CodexAccountLive;
  requestedCredit: string | undefined;
}): string | undefined {
  if (requestedCredit !== undefined || live.kind !== "signed-in") {
    return requestedCredit;
  }
  const soonest = soonestExpiringAvailableCredit({ credits: live.resetCreditsListed });
  return soonest === undefined ? undefined : soonest.id;
}

/**
 * Start a fresh attempt: refuse it unless the store holds the credit and is at its limit (or the early hatch is
 * set), then journal its intent, with the store's BEFORE reading, before anything is sent.
 *
 * @param target the store and state home
 * @param live the store's live state
 * @param requestedCredit the credit this run named, or undefined for the soonest-expiring one
 * @returns the attempt to send, or the result the run ends on
 */
function freshAttempt({
  live,
  requestedCredit,
  target,
}: {
  live: CodexAccountLive;
  requestedCredit: string | undefined;
  target: ResetTarget;
}): AttemptToSend | CodexResetRunResult {
  const { alias, home } = target;
  const chosen = chooseResetCredit({ alias, creditId: freshCreditOf({ live, requestedCredit }), live });
  if (chosen.isErr()) {
    return creditRefusal({ alias, error: chosen.error });
  }
  const atLimit = storeAtLimit({ live, thresholds: target.thresholds });
  if (!atLimit && process.env[EARLY_RESET_ENV] !== "1") {
    const reason = hatchRefusal({
      detail: `${alias}'s live read finds no window at its limit`,
      hatch: hatchFor({ id: "early-codex-reset" }),
    });
    return { alias, claimStarted: false, kind: "failed", reason };
  }
  // Checked again here, as the last step before a fresh key is minted, so a run that was suspended past its lock
  // budget — either form — never starts a claim another run may already have made on the same account.
  // Nothing without a fenced lock closes the instant between this check and the send.
  if (Date.now() - target.startedMs > RESET_RUN_BUDGET_MS) {
    return {
      alias,
      kind: "deferred",
      reason: "this run spent its lock budget before the claim — nothing was sent; re-run",
    };
  }
  const idempotencyKey = randomUUID();
  const { creditId } = chosen.value;
  const before = resetReadingOf({ live, thresholds: target.thresholds });
  const intent = appendCodexResetJournal({
    home,
    row: {
      alias,
      atIso: live.readAtIso,
      idempotencyKey,
      kind: "intent",
      v: 1,
      ...(before === undefined ? {} : { before }),
      ...(creditId === undefined ? {} : { creditId }),
      ...(atLimit ? {} : { early: true as const }),
    },
  });
  if (intent.isErr()) {
    return { alias, claimStarted: false, kind: "failed", reason: intent.error.message };
  }
  return { creditId, idempotencyKey };
}

/**
 * Run `codex reset` on one store: settle or close its open attempt, or start a fresh one, and send.
 *
 * @param deps the stores the run reaches
 * @param live the store's live state, read under the caller's reset lock
 * @param requestedCredit the credit named, or undefined for the soonest-expiring one
 * @param target the store and state home
 * @returns what the run came to
 */
export async function resetOne({
  deps,
  live,
  requestedCredit,
  target,
}: {
  deps: ResetOneDeps;
  live: CodexAccountLive;
  requestedCredit: string | undefined;
  target: ResetTarget;
}): Promise<CodexResetRunResult> {
  const { alias, home } = target;
  const journal = readCodexResetJournal({ home });
  if (journal.isErr()) {
    return { alias, claimStarted: false, kind: "failed", reason: journal.error.message };
  }
  const step = openAttemptStep({ live, rows: journal.value, target });
  if (step.kind === "result") {
    return step.result;
  }
  const attempt =
    step.kind === "retry"
      ? retryAttempt({ alias, intent: step.intent, live, requestedCredit })
      : freshAttempt({ live, requestedCredit, target });
  if ("kind" in attempt) {
    return attempt;
  }
  return sendAndSettle({
    attempt,
    fleetCap: deps.fleetCap,
    ledger: deps.doorLedger,
    port: deps.port,
    signInPort: deps.signInPort,
    target,
  });
}
