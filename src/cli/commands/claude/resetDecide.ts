/**
 * The decision half of `slopweaver claude reset --claim`: given a fresh status read and the claims journal, which
 * claim this run sends and under which request id — or the exit it ends on without sending. `./resetRun.ts` reads
 * the status first and `./resetSend.ts` sends what this returns.
 *
 * A run that CLOSES an open attempt sends nothing: the evidence that closes one — the grant's count down, the limit
 * gone, a cooldown — is exactly what a lost-but-spent claim leaves behind, so a fresh id minted in the same run
 * could spend a second reset for the one redemption asked for.
 */
import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import { type ClaudeResetIntentRow, claimAttemptOverReason, openClaimAttempt } from "../../../claude/resetAttempt.js";
import { chooseResetGrant, freshClaimRefusal, resetClaimBody, resetClaimUrl } from "../../../claude/resetClaim.js";
import type { ClaudeResetError } from "../../../claude/resetErrors.js";
import { appendClaudeResetJournal, readClaudeResetJournal } from "../../../claude/resetJournalStore.js";
import type { ClaudeResetBlock } from "../../../claude/resetStatus.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { type ClaimToSend, refuse } from "./resetSend.js";

/** Everything the claim decision reads. */
export interface ClaimContext {
  readonly alias: string;
  readonly home: string;
  /** The grant `--grant` named, if any. */
  readonly requestedGrant: string | undefined;
  /** The plan's enrollment, whose organisation the claim URL names. */
  readonly assertion: ClaudeIdentityAssertion;
  /** Whether the `early-claude-reset` hatch is open for this run. */
  readonly earlyAllowed: boolean;
  readonly newRequestId: () => string;
  /** The instant the status was read, stamped on every row this run journals. */
  readonly readAtIso: string;
  readonly block: ClaudeResetBlock;
}

/** A grant that cannot be claimed, as the exit it ends on: a cooldown is not yet, anything else nothing to redeem. */
function grantRefusal({ alias, error }: { alias: string; error: ClaudeResetError }): number {
  const code = error.code === "COOLDOWN" ? EXIT_DEFERRED : EXIT_EXPECTED_EMPTY;
  return refuse({ code, lines: [`claude reset: ${alias} — ${error.message}`] });
}

/** The URL, body and ids for one claim, or the exit code a malformed id ends on. */
function claimRequest({
  context,
  grantId,
  requestId,
  resend,
}: {
  context: ClaimContext;
  grantId: string;
  requestId: string;
  resend: boolean;
}): number | ClaimToSend {
  const url = resetClaimUrl({ organizationId: context.assertion.organizationId });
  if (url.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`claude reset: ${url.error.message}`] });
  }
  const body = resetClaimBody({ grantId, requestId });
  if (body.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`claude reset: ${body.error.message}`] });
  }
  return { body: body.value, grantId, requestId, resend, url: url.value };
}

/** Resend the open attempt when the status shows it unsettled, else close it and send nothing. */
function settleOpenAttempt({
  context,
  open,
}: {
  context: ClaimContext;
  open: ClaudeResetIntentRow;
}): number | ClaimToSend {
  const { alias, block, home, readAtIso, requestedGrant } = context;
  const over = claimAttemptOverReason({ attempt: open, block, nowIso: readAtIso });
  if (over === undefined) {
    if (requestedGrant !== undefined && requestedGrant !== open.grantId) {
      logger.error({
        msg: `claude reset: ignoring --grant ${requestedGrant} — the open claim ${open.requestId} is resent as it was`,
      });
    }
    logger.error({
      msg: `claude reset: settling the earlier claim ${open.requestId} on ${alias} rather than starting another`,
    });
    return claimRequest({ context, grantId: open.grantId, requestId: open.requestId, resend: true });
  }
  const closed = appendClaudeResetJournal({
    home,
    row: { alias, atIso: readAtIso, kind: "closed", reason: over, requestId: open.requestId, v: 1 },
  });
  if (closed.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`claude reset: ${closed.error.message}`] });
  }
  logger.out({
    line:
      `claude reset: ${alias} — the earlier claim ${open.requestId} is settled (${over}), so it most likely reset ` +
      "already; nothing was sent this run — run again for a NEW claim if the plan is still at a limit",
  });
  return EXIT_OK;
}

/** Start a fresh claim: refuse one the provider would not honour or that would spend early, then journal its intent. */
function freshClaim({ context }: { context: ClaimContext }): number | ClaimToSend {
  const { alias, block, earlyAllowed, home, readAtIso, requestedGrant } = context;
  const chosen = chooseResetGrant({ block, requestedGrant });
  if (chosen.isErr()) {
    return grantRefusal({ alias, error: chosen.error });
  }
  const grant = chosen.value;
  const refusal = freshClaimRefusal({ block, grant, nowIso: readAtIso });
  if (refusal !== undefined) {
    return grantRefusal({ alias, error: refusal });
  }
  if (!block.atLimit && !earlyAllowed) {
    const hatch = hatchFor({ id: "early-claude-reset" });
    const detail = `${alias}'s status read finds no window at its limit`;
    return refuse({ code: EXIT_ERROR, lines: [hatchRefusal({ detail, hatch })] });
  }
  const request = claimRequest({ context, grantId: grant.id, requestId: context.newRequestId(), resend: false });
  if (typeof request === "number") {
    return request;
  }
  const intent = appendClaudeResetJournal({
    home,
    row: {
      alias,
      atIso: readAtIso,
      atLimitAtIntent: block.atLimit,
      grantId: grant.id,
      kind: "intent",
      requestId: request.requestId,
      resetsLeftAtIntent: grant.resetsLeft,
      v: 1,
    },
  });
  if (intent.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`claude reset: ${intent.error.message}`] });
  }
  return request;
}

/**
 * The claim this run sends — the open attempt resent under its own id, or a fresh one journalled — or the exit code
 * it ends on without sending, a close included.
 *
 * @param context the status read, the plan and what the flags ask for
 * @returns the claim to send, or an exit code
 */
export function claimToSend({ context }: { context: ClaimContext }): number | ClaimToSend {
  const journal = readClaudeResetJournal({ home: context.home });
  if (journal.isErr()) {
    return refuse({ code: EXIT_ERROR, lines: [`claude reset: ${journal.error.message}`] });
  }
  const open = openClaimAttempt({ alias: context.alias, rows: journal.value });
  if (open !== undefined) {
    return settleOpenAttempt({ context, open });
  }
  return freshClaim({ context });
}
