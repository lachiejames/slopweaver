/**
 * One claim attempt, however many runs it takes: the claims journal's rows, the open attempt a retry must settle,
 * and when the status read shows that attempt is over. Pure; `./resetJournalStore.ts` reads and appends the file.
 *
 * ## Judged before it is resent, never blindly
 *
 * An attempt's `request_id` is journalled BEFORE the claim is sent and resent while that attempt has no answer, so
 * a run killed mid-request re-asks about the SAME attempt. But whether the provider dedupes a resent `request_id`,
 * and for how long, is unmeasured, and the owner's own Claude Code can claim on the same login with an id this journal
 * never sees. So every run reads the status FIRST and CLOSES an open attempt the status shows is over
 * ({@link claimAttemptOverReason}); a run that closes one sends nothing, because the evidence that closes it is
 * exactly what a lost-but-spent claim leaves behind (the `codex reset` fallback has the same shape).
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { CLAIM_RESULTS, type ClaudeClaimResult } from "./resetClaim.js";
import { ClaudeResetErrors, type ClaudeResetJournalLineInvalidError } from "./resetErrors.js";
import type { ClaudeResetBlock } from "./resetStatus.js";

/** A claim about to be sent — journalled first, with the witnesses its closing is judged on. */
export interface ClaudeResetIntentRow {
  readonly v: 1;
  readonly kind: "intent";
  readonly alias: string;
  readonly grantId: string;
  readonly requestId: string;
  readonly atIso: string;
  /** The grant's `resets_left` when the intent was taken; a lower count later means the spend landed. */
  readonly resetsLeftAtIntent: number;
  /** Whether a window was at its limit when the intent was taken. */
  readonly atLimitAtIntent: boolean;
}

/** One row of the claims journal: an intent, the answer it got, or an intent closed because it is over. */
export type ClaudeResetJournalRow =
  | ClaudeResetIntentRow
  | {
      readonly v: 1;
      readonly kind: "outcome";
      readonly alias: string;
      readonly requestId: string;
      readonly atIso: string;
      readonly result: ClaudeClaimResult;
    }
  | {
      readonly v: 1;
      readonly kind: "closed";
      readonly alias: string;
      readonly requestId: string;
      readonly atIso: string;
      readonly reason: string;
    };

const journalRowWire = z.discriminatedUnion("kind", [
  z.object({
    alias: z.string().min(1),
    atIso: z.string().min(1),
    atLimitAtIntent: z.boolean(),
    grantId: z.string().min(1),
    kind: z.literal("intent"),
    requestId: z.string().min(1),
    resetsLeftAtIntent: z.number().int().min(0),
    v: z.literal(1),
  }),
  z.object({
    alias: z.string().min(1),
    atIso: z.string().min(1),
    kind: z.literal("outcome"),
    requestId: z.string().min(1),
    result: z.enum(CLAIM_RESULTS),
    v: z.literal(1),
  }),
  z.object({
    alias: z.string().min(1),
    atIso: z.string().min(1),
    kind: z.literal("closed"),
    reason: z.string().min(1),
    requestId: z.string().min(1),
    v: z.literal(1),
  }),
]);

/**
 * Read one journal line.
 *
 * @param line one line of the claims journal
 * @returns the row, or why it is not one
 */
export function parseClaudeResetJournalLine({
  line,
}: {
  line: string;
}): Result<ClaudeResetJournalRow, ClaudeResetJournalLineInvalidError> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return err(ClaudeResetErrors.journalLineInvalid({ detail: "is not JSON" }));
  }
  const parsed = journalRowWire.safeParse(value);
  if (!parsed.success) {
    return err(ClaudeResetErrors.journalLineInvalid({ detail: `is not a row: ${parsed.error.message}` }));
  }
  return ok(parsed.data);
}

/**
 * This plan's newest intent with no outcome and not closed — the attempt a retry must settle — or undefined.
 *
 * @param alias the plan being claimed on
 * @param rows the claims journal, in file order
 * @returns the open intent, or undefined to start a fresh attempt
 */
export function openClaimAttempt({
  alias,
  rows,
}: {
  alias: string;
  rows: readonly ClaudeResetJournalRow[];
}): ClaudeResetIntentRow | undefined {
  const settled = new Set(rows.filter((row) => row.kind !== "intent").map((row) => row.requestId));
  const open = rows.filter(
    (row): row is ClaudeResetIntentRow => row.kind === "intent" && row.alias === alias && !settled.has(row.requestId),
  );
  return open.at(-1);
}

/**
 * Why an open attempt is over, judged by the fresh status read alone, or undefined when a resend may settle it.
 *
 * Over means the lost answer no longer matters: the attempt's grant is gone or holds fewer resets than when the
 * intent was taken (the spend landed), the window that justified it is no longer at a limit, or a cooldown runs —
 * the mark a reset is expected to leave, which is unmeasured and so named as such in the reason.
 *
 * @param attempt the open intent
 * @param block the fresh status
 * @param nowIso the instant the status was read
 * @returns the reason to close it, or undefined to resend it
 */
export function claimAttemptOverReason({
  attempt,
  block,
  nowIso,
}: {
  attempt: ClaudeResetIntentRow;
  block: ClaudeResetBlock;
  nowIso: string;
}): string | undefined {
  const grant = block.grants.find((entry) => entry.id === attempt.grantId);
  if (grant === undefined) {
    return `grant ${attempt.grantId} is no longer listed`;
  }
  if (grant.resetsLeft < attempt.resetsLeftAtIntent) {
    return `grant ${attempt.grantId} holds ${String(grant.resetsLeft)} reset(s), down from ${String(attempt.resetsLeftAtIntent)}`;
  }
  if (attempt.atLimitAtIntent && !block.atLimit) {
    return "no window is at its limit any more";
  }
  const cooldown = block.cooldownUntilIso;
  if (cooldown !== undefined && Date.parse(cooldown) > Date.parse(nowIso)) {
    return `a cooldown runs until ${cooldown} (read as a reset's mark, which is unmeasured)`;
  }
  return undefined;
}
