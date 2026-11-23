/**
 * The half of `slopweaver claude reset` that spends: send the claim through the door under the attempt's request id and
 * journal what came back. `./resetRun.ts` decides WHETHER and UNDER WHICH ID before anything reaches here; this file
 * never mints an id and never judges the status, so a resend and a fresh attempt send exactly the same way.
 *
 * The door ledger records the artifact `claude-reset:<requestId>` with the plan and grant — never the organisation
 * the URL carries, and never a token.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type ClaudeClaimAnswer, readClaimAnswer } from "../../../claude/resetClaim.js";
import type { ResetLogin } from "../../../claude/resetCredential.js";
import type { ClaudeResetError } from "../../../claude/resetErrors.js";
import type { ResetResponse } from "../../../claude/resetExchange.js";
import { appendClaudeResetJournal } from "../../../claude/resetJournalStore.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/** The claim a run sends: which grant, under which request id, and whether it resends an open attempt. */
export interface ClaimToSend {
  readonly grantId: string;
  readonly requestId: string;
  readonly resend: boolean;
  /** The claim URL and body, built and validated before the intent was journalled. */
  readonly url: string;
  readonly body: string;
}

/** The plan and state home a run acts on, and the claim request seam. */
export interface ClaimTarget {
  readonly alias: string;
  readonly home: string;
  /** The door ledger the claim's decision is recorded through. */
  readonly ledger: DoorLedgerPort;
  readonly login: ResetLogin;
  readonly requestClaim: (options: { accessToken: string; body: string; url: string }) => Promise<ResetResponse>;
  readonly nowIso: () => string;
}

/**
 * Print lines to stderr and return the code.
 *
 * @param code the exit code to end on
 * @param lines what to print, one stderr line each
 * @returns the code, unchanged
 */
export function refuse({ code, lines }: { code: number; lines: readonly string[] }): number {
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return code;
}

/**
 * What a claim answer means for the run: its exit code and the one line that says so. Pure.
 *
 * `already_used` on a RESEND is success — the attempt this run settles most likely reset on the send whose answer
 * was lost; on a fresh claim it is nothing to redeem. A cooldown is not yet; every other result is nothing to redeem.
 *
 * @param alias the plan
 * @param answer what the provider answered
 * @param claim the claim that was sent
 * @returns the exit code and the line
 */
export function claimAnswerReport({
  alias,
  answer,
  claim,
}: {
  alias: string;
  answer: ClaudeClaimAnswer;
  claim: ClaimToSend;
}): { readonly code: number; readonly line: string } {
  const { result } = answer;
  const left = answer.resetsLeft === undefined ? "" : `, ${String(answer.resetsLeft)} reset(s) left`;
  const cleared = answer.cleared.length === 0 ? "" : `, cleared ${answer.cleared.join("/")}`;
  const reason = answer.reason === undefined ? "" : ` (${answer.reason})`;
  const line = `claude reset: ${alias} — ${result}${reason} on grant ${claim.grantId}${cleared}${left} (claim ${claim.requestId})`;
  const settledEarlier = result === "already_used" && claim.resend;
  if (result === "reset" || settledEarlier) {
    return { code: EXIT_OK, line };
  }
  return { code: result === "cooldown" ? EXIT_DEFERRED : EXIT_EXPECTED_EMPTY, line };
}

/** A claim with no answer the provider stands behind: a refused call is closed, anything else left open to resend. */
function settleWithoutAnswer({
  error,
  home,
  row,
}: {
  error: ClaudeResetError;
  home: string;
  row: { alias: string; atIso: string; requestId: string; v: 1 };
}): number {
  const line = `claude reset: ${row.alias} — ${error.message}`;
  if (error.code !== "CLAIM_REFUSED") {
    return refuse({ code: EXIT_DEFERRED, lines: [line] });
  }
  const closed = appendClaudeResetJournal({ home, row: { ...row, kind: "closed", reason: error.message } });
  const note = closed.isErr() ? [`claude reset: and closing it failed: ${closed.error.message}`] : [];
  return refuse({ code: EXIT_ERROR, lines: [line, ...note] });
}

/**
 * Send the claim through the door and journal what came back. A lost answer leaves the intent open and exits
 * {@link EXIT_DEFERRED}, so the next run re-judges it and, if it is not over, resends the SAME request id.
 *
 * @param claim the grant, request id, URL and body to send
 * @param target the plan, state home, login and request seam
 * @returns the process exit code
 */
export async function sendAndSettle({ claim, target }: { claim: ClaimToSend; target: ClaimTarget }): Promise<number> {
  const { alias, home, login } = target;
  const { body, grantId, requestId, resend, url } = claim;
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: target.ledger,
    perform: () => login.withBearer(({ accessToken }) => target.requestClaim({ accessToken, body, url })),
    request: {
      action: { kind: "verb", noun: "claude", verb: "reset" },
      artifact: { alias, grantId, id: `claude-reset:${requestId}`, resend },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  });
  if (!routed.performed) {
    // A store that could not record the claim is an error, not a policy refusal: nothing was sent either way.
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      lines: notPerformedLines({ command: "slopweaver claude reset", through: routed }),
    });
  }
  const response = routed.result;
  if ("reason" in response) {
    return refuse({
      code: EXIT_DEFERRED,
      lines: [`claude reset: ${alias} — ${response.reason}; re-run to settle claim ${requestId}`],
    });
  }
  const answer = readClaimAnswer({ bodyText: response.bodyText, requestId, status: response.status });
  const base = { alias, atIso: target.nowIso(), requestId, v: 1 as const };
  if (answer.isErr()) {
    return settleWithoutAnswer({ error: answer.error, home, row: base });
  }
  const settled = appendClaudeResetJournal({ home, row: { ...base, kind: "outcome", result: answer.value.result } });
  if (settled.isErr()) {
    logger.error({ msg: `claude reset: the answer was ${answer.value.result}, but ${settled.error.message}` });
  }
  const report = claimAnswerReport({ alias, answer: answer.value, claim });
  if (report.code === EXIT_OK) {
    logger.out({ line: report.line });
    return EXIT_OK;
  }
  return refuse({ code: report.code, lines: [report.line] });
}
