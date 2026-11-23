/**
 * The PURE half of `codex reset`: which reset a store may spend, the exchange that spends it, what the provider
 * answered, and which earlier attempt a retry must settle rather than duplicate.
 *
 * ## The provider's own verb, not a page
 *
 * Codex's app-server exposes redemption as `account/rateLimitResetCredit/consume` (`codex app-server
 * generate-ts`, codex-cli 0.157.1): params `{ idempotencyKey, creditId? }`, answer `{ outcome: reset |
 * nothingToReset | noCredit | alreadyRedeemed }`. So a free reset is an account write the fleet makes through the
 * same stdio exchange the live read already holds (`./accountLive.ts`) — no browser, no click in a provider UI.
 *
 * ## Only at a limit
 *
 * A reset refills windows that are full. Spending one on a store with room left buys nothing now and loses the
 * reset for later, so the verb refuses unless the store's own live read shows a WINDOW at routing's pause bar (the
 * register's `pauseAtPercent`, 99 by default) with its reset still ahead (`./resetEvidence.ts`'s `storeAtLimit`) — the only limit a store the fleet drives
 * reaches, since routing stops sending it work there (the owner's rule: take a store all the way up to 99 percent, then
 * do the reset). Whether the provider answers `nothingToReset` at 99%, and whether that still spends the
 * reset, is unmeasured: both sides of every claim are journalled so the first one answers it. Exhaustion of any
 * other kind — a depleted credit balance, a `rateLimitReachedType`, `ordinaryUsageAllowed: false` — is a cap a
 * reset of type `codexRateLimits` is not known to clear, so it does not open the gate.
 *
 * ## One attempt, however many runs
 *
 * The idempotency key is journalled BEFORE the exchange and reused while that attempt has no settled outcome
 * ({@link openResetAttempt}), so a run killed mid-exchange or timed out re-asks about the SAME attempt and the
 * provider answers it once. That is the protocol's own contract: "reuse the same value when retrying that attempt" —
 * so a retry resends the attempt's OWN credit, never whatever `--credit` the retry was given.
 *
 * An open attempt is CLOSED, never left to be replayed weeks later, once the live read shows it is over: the
 * store is no longer at a limit, holds no reset, or no longer lists the attempt's credit as available. Whichever
 * way the lost answer went, the next cap is a new redemption and earns a fresh key ({@link attemptOverReason}).
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import type { CodexThresholds } from "../plans/thresholds.js";

import { type CodexAccountLive, LIVE_MARKER_PREFIX } from "./accountLiveParse.js";
import {
  type CodexResetError,
  CodexResetErrors,
  type JournalLineInvalidError,
  type NoConsumeAnswerError,
} from "./resetErrors.js";
import { type CodexResetReading, resetReadingFromWire, resetReadingWire, storeAtLimit } from "./resetEvidence.js";

/** The request id the consume call is sent under — distinct from the live read's 2 and 3. */
export const CONSUME_REQUEST_ID = 4;

/** What the provider answered a consume with. */
export type CodexConsumeOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";

const consumeAnswerWire = z.object({
  error: z.object({ code: z.number(), message: z.string() }).optional(),
  id: z.literal(CONSUME_REQUEST_ID),
  result: z.object({ outcome: z.enum(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]) }).optional(),
});

/** An attempt about to be made — journalled before the consume is sent. */
export interface CodexResetIntentRow {
  readonly v: 1;
  readonly kind: "intent";
  readonly alias: string;
  readonly idempotencyKey: string;
  readonly atIso: string;
  /** The reset named, or absent when the provider picks the next one. */
  readonly creditId?: string;
  /**
   * Present when the attempt was made through the early-reset hatch, on a store NOT at a limit — so "no longer at
   * a limit" says nothing about whether it spent, and never closes it.
   */
  readonly early?: true;
  /** The store as the live read found it just before this attempt was judged — absent on a row older than it. */
  readonly before?: CodexResetReading;
}

/**
 * What the provider answered one attempt, with the store as a read straight after the answer found it.
 *
 * @internal -- a member of {@link CodexResetJournalRow}, which is what every caller narrows.
 */
export interface CodexResetOutcomeRow {
  readonly v: 1;
  readonly kind: "outcome";
  readonly alias: string;
  readonly idempotencyKey: string;
  readonly atIso: string;
  readonly outcome: CodexConsumeOutcome;
  /** The store re-read after the answer — absent on a row older than it, or when that read found no sign-in. */
  readonly after?: CodexResetReading;
}

/**
 * One row of the claims journal: an attempt about to be made, what the provider said about it, or an attempt
 * whose answer was lost CLOSED because the live read showed it over.
 */
export type CodexResetJournalRow =
  | CodexResetIntentRow
  | {
      readonly v: 1;
      readonly kind: "closed";
      readonly alias: string;
      readonly idempotencyKey: string;
      readonly atIso: string;
      /** What the live read showed that ended the attempt. */
      readonly reason: string;
    }
  | CodexResetOutcomeRow;

const journalRowWire = z.discriminatedUnion("kind", [
  z.object({
    alias: z.string().min(1),
    atIso: z.string().min(1),
    before: resetReadingWire.optional(),
    creditId: z.string().min(1).optional(),
    early: z.literal(true).optional(),
    idempotencyKey: z.string().min(1),
    kind: z.literal("intent"),
    v: z.literal(1),
  }),
  z.object({
    alias: z.string().min(1),
    atIso: z.string().min(1),
    idempotencyKey: z.string().min(1),
    kind: z.literal("closed"),
    reason: z.string().min(1),
    v: z.literal(1),
  }),
  z.object({
    after: resetReadingWire.optional(),
    alias: z.string().min(1),
    atIso: z.string().min(1),
    idempotencyKey: z.string().min(1),
    kind: z.literal("outcome"),
    outcome: z.enum(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]),
    v: z.literal(1),
  }),
]);

/**
 * Read one journal line.
 *
 * @param line one line of the claims journal
 * @returns the row, or why it is not one
 */
export function parseCodexResetJournalLine({
  line,
}: {
  line: string;
}): Result<CodexResetJournalRow, JournalLineInvalidError> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return err(CodexResetErrors.journalLineInvalid({ detail: "is not JSON" }));
  }
  const parsed = journalRowWire.safeParse(value);
  if (!parsed.success) {
    return err(CodexResetErrors.journalLineInvalid({ detail: `is not a row: ${parsed.error.message}` }));
  }
  const row = parsed.data;
  if (row.kind === "closed") {
    return ok(row);
  }
  if (row.kind === "outcome") {
    const { after, ...settled } = row;
    return ok({ ...settled, ...(after === undefined ? {} : { after: resetReadingFromWire({ wire: after }) }) });
  }
  const { before, creditId, early, ...rest } = row;
  return ok({
    ...rest,
    ...(before === undefined ? {} : { before: resetReadingFromWire({ wire: before }) }),
    ...(creditId === undefined ? {} : { creditId }),
    ...(early === undefined ? {} : { early }),
  });
}

/**
 * This store's newest attempt with no outcome and not closed — the one a retry must settle, with its own key and
 * credit — or undefined when every attempt on it has settled.
 *
 * @param rows the claims journal, in file order
 * @param alias the store being redeemed on
 * @returns the open intent, or undefined to mint a fresh attempt
 */
export function openResetAttempt({
  alias,
  rows,
}: {
  alias: string;
  rows: readonly CodexResetJournalRow[];
}): CodexResetIntentRow | undefined {
  // Settled by THIS alias's own outcome or close, never another store's row that happens to carry the same key
  const settled = new Set(
    rows.filter((row) => row.kind !== "intent" && row.alias === alias).map((row) => row.idempotencyKey),
  );
  const open = rows.filter(
    (row): row is CodexResetIntentRow =>
      row.kind === "intent" && row.alias === alias && !settled.has(row.idempotencyKey),
  );
  return open.at(-1);
}

/**
 * Why an open attempt is over, judged by the live read alone, or undefined when it may still be settled by a
 * retry. Over means the lost answer no longer matters: the store is not at a limit, holds no reset, or no longer
 * lists the attempt's own credit as available — so the next cap is a new redemption, never a replay of this key.
 *
 * @param attempt the open intent
 * @param live the store's live state
 * @param thresholds the register's Codex bars, whose pause bar is the limit the attempt was made at
 * @returns the reason to close it, or undefined to retry it
 */
export function attemptOverReason({
  attempt,
  live,
  thresholds,
}: {
  attempt: CodexResetIntentRow;
  live: CodexAccountLive;
  thresholds: CodexThresholds;
}): string | undefined {
  if (live.kind !== "signed-in") {
    return undefined;
  }
  if (attempt.early === undefined && !storeAtLimit({ live, thresholds })) {
    return "the store is no longer at a limit";
  }
  if (live.resetCreditsAvailable === 0) {
    return "the store holds no reset";
  }
  if (attempt.creditId === undefined || live.resetCreditsListed === undefined) {
    return undefined;
  }
  const creditId = attempt.creditId;
  const stillHeld = live.resetCreditsListed.some((credit) => credit.id === creditId && credit.status === "available");
  if (!stillHeld) {
    return `the store no longer lists ${creditId} as available`;
  }
  return undefined;
}

/**
 * Which reset a redemption would spend: the one `--credit` named, which must be listed as available, or the
 * provider's own pick when none was named.
 *
 * @param alias the store being redeemed on, for the failure's wording
 * @param live the store's live state
 * @param creditId the reset `--credit` named, if any
 * @returns the credit id to send (undefined = the provider picks), or why nothing can be redeemed
 */
export function chooseResetCredit({
  alias,
  creditId,
  live,
}: {
  alias: string;
  creditId: string | undefined;
  live: CodexAccountLive;
}): Result<{ readonly creditId: string | undefined }, CodexResetError> {
  if (live.kind === "unreadable") {
    return err(CodexResetErrors.storeNotReadable({ alias, reason: live.reason }));
  }
  if (live.kind !== "signed-in") {
    return err(CodexResetErrors.storeNotReadable({ alias, reason: "nothing is signed into this store" }));
  }
  if (live.resetCreditsAvailable === 0) {
    return err(CodexResetErrors.noResetHeld({ alias }));
  }
  if (creditId === undefined) {
    return ok({ creditId: undefined });
  }
  // A store that sent only the count lists nothing, so no named credit can be confirmed held there.
  const held = live.resetCreditsListed?.some((credit) => credit.id === creditId && credit.status === "available");
  if (held !== true) {
    return err(CodexResetErrors.creditNotHeld({ alias, creditId }));
  }
  return ok({ creditId });
}

/**
 * The lines one consume exchange sends: the handshake, then the consume call.
 *
 * @param idempotencyKey the attempt's key, journalled before this is sent
 * @param creditId the reset to spend, or undefined for the provider's pick
 * @returns the JSON-RPC lines, in send order
 */
export function consumeRequests({
  creditId,
  idempotencyKey,
}: {
  creditId: string | undefined;
  idempotencyKey: string;
}): readonly string[] {
  return [
    JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "slopweaver", version: "0" } } }),
    JSON.stringify({ method: "initialized" }),
    JSON.stringify({
      id: CONSUME_REQUEST_ID,
      method: "account/rateLimitResetCredit/consume",
      params: creditId === undefined ? { idempotencyKey } : { creditId, idempotencyKey },
    }),
  ];
}

/**
 * What the provider answered the consume with, or why no answer it stands behind came back.
 *
 * A JSON-RPC error is an answer about the CALL, not the reset — the reset may or may not have spent — so it is a
 * reason, exactly like a missing line.
 *
 * @param lines the store's own answer lines, markers included
 * @returns the outcome, or the reason there is none
 */
export function readConsumeAnswer({
  lines,
}: {
  lines: readonly string[];
}): Result<CodexConsumeOutcome, NoConsumeAnswerError> {
  for (const line of lines) {
    if (line.startsWith(LIVE_MARKER_PREFIX)) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return err(CodexResetErrors.noConsumeAnswer({ detail: "the app-server wrote a line that is not JSON" }));
    }
    const parsed = consumeAnswerWire.safeParse(value);
    if (!parsed.success) {
      continue;
    }
    if (parsed.data.error !== undefined) {
      const detail = `the app-server refused the call: ${parsed.data.error.message}`;
      return err(CodexResetErrors.noConsumeAnswer({ detail }));
    }
    if (parsed.data.result !== undefined) {
      return ok(parsed.data.result.outcome);
    }
  }
  const marker = lines.find((line) => line.startsWith(LIVE_MARKER_PREFIX));
  if (marker !== undefined) {
    const detail = `the exchange ended early (${marker.slice(LIVE_MARKER_PREFIX.length)})`;
    return err(CodexResetErrors.noConsumeAnswer({ detail }));
  }
  return err(
    CodexResetErrors.noConsumeAnswer({ detail: "no answer to account/rateLimitResetCredit/consume came back" }),
  );
}
