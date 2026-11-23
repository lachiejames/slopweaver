/**
 * `codex reset`'s pure half — `codex/resetConsume.ts`: which reset a store may spend, the
 * exchange that spends it, the provider's answer, and which earlier attempt a retry settles.
 *
 * The retry property is the one that costs a reset when it is wrong: an intent row with no outcome must hand its
 * key back, or a killed run mints a second key and the provider spends a second reset. Whether a store is at its
 * limit is `codex/resetEvidence.ts`'s, tested beside it.
 */
import { describe, expect, it } from "vitest";

import { type CodexAccountLive, parseCodexAccountLive } from "../../../codex/accountLiveParse.js";
import {
  attemptOverReason,
  CONSUME_REQUEST_ID,
  type CodexResetIntentRow,
  type CodexResetJournalRow,
  chooseResetCredit,
  consumeRequests,
  openResetAttempt,
  parseCodexResetJournalLine,
  readConsumeAnswer,
} from "../../../codex/resetConsume.js";
import { CodexResetErrors } from "../../../codex/resetErrors.js";
import { resetReadingOf } from "../../../codex/resetEvidence.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const HOME = "/stores/codex-a";
const READ_AT = "2026-09-25T13:00:00.000Z";
const WEEKLY_OPEN = { resetsAt: 1790944998, usedPercent: 0, windowDurationMins: 10080 };
const WEEKLY_FULL = { resetsAt: 1790736653, usedPercent: 100, windowDurationMins: 10080 };

/** A signed-in live read with one weekly window and the given reset credits, built through the real parser. */
function live({
  bucketExtra = {},
  credits,
  resultExtra = {},
  window,
}: {
  bucketExtra?: Record<string, unknown>;
  credits: { availableCount: number; credits: readonly Record<string, unknown>[] | null };
  resultExtra?: Record<string, unknown>;
  window: typeof WEEKLY_OPEN;
}): CodexAccountLive {
  const bucket = {
    credits: { balance: "0", hasCredits: false, unlimited: false },
    limitId: "codex",
    planType: "pro",
    primary: window,
    secondary: null,
    ...bucketExtra,
  };
  return parseCodexAccountLive({
    codexHome: HOME,
    lines: [
      JSON.stringify({
        id: 2,
        result: {
          rateLimitResetCredits: credits,
          rateLimits: bucket,
          rateLimitsByLimitId: { codex: bucket },
          ...resultExtra,
        },
      }),
      JSON.stringify({ id: 3, result: { account: { email: "a@example.com", planType: "pro", type: "chatgpt" } } }),
    ],
    readAtIso: READ_AT,
  });
}

const HELD = live({
  credits: { availableCount: 1, credits: [{ id: "credit-1", status: "available" }] },
  window: WEEKLY_FULL,
});

describe("chooseResetCredit", () => {
  it("leaves the pick to the provider when no credit was named", () => {
    expect(unwrap(chooseResetCredit({ alias: "plan-two", creditId: undefined, live: HELD }))).toEqual({
      creditId: undefined,
    });
  });

  it("sends a named credit the store lists as available", () => {
    expect(unwrap(chooseResetCredit({ alias: "plan-two", creditId: "credit-1", live: HELD }))).toEqual({
      creditId: "credit-1",
    });
  });

  it("refuses a named credit the store does not list as available", () => {
    const spent = live({
      credits: { availableCount: 1, credits: [{ id: "credit-1", status: "redeemed" }] },
      window: WEEKLY_FULL,
    });
    expect(unwrapErr(chooseResetCredit({ alias: "plan-two", creditId: "credit-1", live: spent }))).toEqual(
      CodexResetErrors.creditNotHeld({ alias: "plan-two", creditId: "credit-1" }),
    );
  });

  it("refuses a store that holds no reset", () => {
    const none = live({ credits: { availableCount: 0, credits: [] }, window: WEEKLY_FULL });
    expect(unwrapErr(chooseResetCredit({ alias: "plan-two", creditId: undefined, live: none })).code).toBe(
      "NO_RESET_HELD",
    );
  });

  it("refuses a store nothing is signed into, naming why", () => {
    const signedOut: CodexAccountLive = { codexHome: HOME, kind: "signed-out", readAtIso: READ_AT };
    expect(unwrapErr(chooseResetCredit({ alias: "plan-two", creditId: undefined, live: signedOut }))).toEqual(
      CodexResetErrors.storeNotReadable({ alias: "plan-two", reason: "nothing is signed into this store" }),
    );
  });
});

describe("consumeRequests", () => {
  it("sends the handshake then the consume, with the credit only when one was named", () => {
    const [, , picked] = consumeRequests({ creditId: undefined, idempotencyKey: "k-1" });
    const [, , named] = consumeRequests({ creditId: "credit-1", idempotencyKey: "k-1" });
    expect(JSON.parse(picked!)).toEqual({
      id: CONSUME_REQUEST_ID,
      method: "account/rateLimitResetCredit/consume",
      params: { idempotencyKey: "k-1" },
    });
    expect(JSON.parse(named!)["params"]).toEqual({ creditId: "credit-1", idempotencyKey: "k-1" });
  });
});

describe("readConsumeAnswer", () => {
  it("reads the outcome past the handshake answer and a notification", () => {
    const lines = [
      JSON.stringify({ id: 1, result: { codexHome: HOME } }),
      JSON.stringify({ method: "account/rateLimits/updated", params: {} }),
      JSON.stringify({ id: CONSUME_REQUEST_ID, result: { outcome: "reset" } }),
    ];
    expect(unwrap(readConsumeAnswer({ lines }))).toBe("reset");
  });

  it("treats a JSON-RPC error as no outcome, because the reset may or may not have spent", () => {
    const lines = [JSON.stringify({ error: { code: -32600, message: "rate limited" }, id: CONSUME_REQUEST_ID })];
    expect(unwrapErr(readConsumeAnswer({ lines })).message).toBe("the app-server refused the call: rate limited");
  });

  it("names the reader's own marker when the answer never came", () => {
    expect(unwrapErr(readConsumeAnswer({ lines: ["!deadline"] })).message).toBe("the exchange ended early (deadline)");
  });

  it("names the missing answer when the exchange closed without one", () => {
    expect(unwrapErr(readConsumeAnswer({ lines: [] })).message).toBe(
      "no answer to account/rateLimitResetCredit/consume came back",
    );
  });
});

const intent = ({
  alias = "plan-two",
  creditId,
  early,
  key,
}: {
  alias?: string;
  creditId?: string;
  early?: true;
  key: string;
}): CodexResetIntentRow => ({
  alias,
  atIso: READ_AT,
  idempotencyKey: key,
  kind: "intent",
  v: 1,
  ...(creditId === undefined ? {} : { creditId }),
  ...(early === undefined ? {} : { early }),
});

describe("openResetAttempt", () => {
  const outcome = ({ key }: { key: string }): CodexResetJournalRow => ({
    alias: "plan-two",
    atIso: READ_AT,
    idempotencyKey: key,
    kind: "outcome",
    outcome: "reset",
    v: 1,
  });

  it("hands back this store's open attempt, credit and all, so a retry settles it rather than spending again", () => {
    const rows = [intent({ key: "k-1" }), outcome({ key: "k-1" }), intent({ creditId: "credit-2", key: "k-2" })];
    expect(openResetAttempt({ alias: "plan-two", rows })).toEqual(intent({ creditId: "credit-2", key: "k-2" }));
  });

  it("mints fresh once every attempt has an outcome or was closed, and ignores another store's open one", () => {
    const rows: CodexResetJournalRow[] = [
      intent({ key: "k-1" }),
      outcome({ key: "k-1" }),
      intent({ key: "k-2" }),
      { alias: "plan-two", atIso: READ_AT, idempotencyKey: "k-2", kind: "closed", reason: "over", v: 1 },
      intent({ alias: "plan-three", key: "k-9" }),
    ];
    expect(openResetAttempt({ alias: "plan-two", rows })).toBeUndefined();
  });

  it("never lets another store's outcome settle this store's attempt under the same key", () => {
    const rows: CodexResetJournalRow[] = [
      intent({ alias: "plan-three", key: "k-1" }),
      { ...outcome({ key: "k-1" }), alias: "plan-three" },
      intent({ key: "k-1" }),
    ];
    expect(openResetAttempt({ alias: "plan-two", rows })).toEqual(intent({ key: "k-1" }));
  });
});

describe("attemptOverReason", () => {
  const listed = [{ id: "credit-1", status: "available" }];
  const thresholds = DEFAULT_THRESHOLDS.codex;

  it("keeps an attempt open while the store is still at a limit and still holds its credit", () => {
    expect(
      attemptOverReason({ attempt: intent({ creditId: "credit-1", key: "k" }), live: HELD, thresholds }),
    ).toBeUndefined();
  });

  it("closes an attempt once the store is no longer at a limit — the lost answer was a reset, or the window rolled", () => {
    const refilled = live({ credits: { availableCount: 1, credits: listed }, window: WEEKLY_OPEN });
    expect(attemptOverReason({ attempt: intent({ key: "k" }), live: refilled, thresholds })).toBe(
      "the store is no longer at a limit",
    );
  });

  it("closes an attempt over exhaustion that is not a full window — a credit balance, a reached type, ordinary usage off", () => {
    const credits = { availableCount: 1, credits: listed };
    const depleted = live({
      bucketExtra: { rateLimitReachedType: "workspace_member_credits_depleted" },
      credits,
      window: WEEKLY_OPEN,
    });
    const noBalance = live({
      bucketExtra: { credits: { balance: 0, hasCredits: false, unlimited: false } },
      credits,
      window: WEEKLY_OPEN,
    });
    const ordinaryOff = live({ credits, resultExtra: { ordinaryUsageAllowed: false }, window: WEEKLY_OPEN });
    expect(
      [depleted, noBalance, ordinaryOff].map((read) =>
        attemptOverReason({ attempt: intent({ key: "k" }), live: read, thresholds }),
      ),
    ).toEqual([
      "the store is no longer at a limit",
      "the store is no longer at a limit",
      "the store is no longer at a limit",
    ]);
  });

  it("never closes an EARLY attempt for being below a limit — it never was at one", () => {
    const open = live({ credits: { availableCount: 1, credits: listed }, window: WEEKLY_OPEN });
    expect(attemptOverReason({ attempt: intent({ early: true, key: "k" }), live: open, thresholds })).toBeUndefined();
  });

  it("closes an attempt when the store holds no reset, or no longer lists the attempt's own credit", () => {
    const none = live({ credits: { availableCount: 0, credits: [] }, window: WEEKLY_FULL });
    const other = live({
      credits: { availableCount: 1, credits: [{ id: "credit-2", status: "available" }] },
      window: WEEKLY_FULL,
    });
    expect(attemptOverReason({ attempt: intent({ key: "k" }), live: none, thresholds })).toBe(
      "the store holds no reset",
    );
    expect(attemptOverReason({ attempt: intent({ creditId: "credit-1", key: "k" }), live: other, thresholds })).toBe(
      "the store no longer lists credit-1 as available",
    );
  });
});

describe("parseCodexResetJournalLine", () => {
  it("round-trips an intent row with and without a credit", () => {
    const named: CodexResetJournalRow = {
      alias: "plan-two",
      atIso: READ_AT,
      creditId: "credit-1",
      idempotencyKey: "k-1",
      kind: "intent",
      v: 1,
    };
    const picked: CodexResetJournalRow = {
      alias: "plan-two",
      atIso: READ_AT,
      idempotencyKey: "k-2",
      kind: "intent",
      v: 1,
    };
    expect(unwrap(parseCodexResetJournalLine({ line: JSON.stringify(named) }))).toEqual(named);
    expect(unwrap(parseCodexResetJournalLine({ line: JSON.stringify(picked) }))).toEqual(picked);
  });

  it("round-trips an early intent and a closed row", () => {
    const early = intent({ early: true, key: "k-3" });
    const closed: CodexResetJournalRow = {
      alias: "plan-two",
      atIso: READ_AT,
      idempotencyKey: "k-3",
      kind: "closed",
      reason: "the store holds no reset",
      v: 1,
    };
    expect(unwrap(parseCodexResetJournalLine({ line: JSON.stringify(early) }))).toEqual(early);
    expect(unwrap(parseCodexResetJournalLine({ line: JSON.stringify(closed) }))).toEqual(closed);
  });

  it("round-trips an intent carrying its before reading and an outcome carrying its after reading", () => {
    const thresholds = DEFAULT_THRESHOLDS.codex;
    const before = resetReadingOf({ live: HELD, thresholds })!;
    const after = resetReadingOf({
      live: live({ credits: { availableCount: 0, credits: [] }, window: WEEKLY_OPEN }),
      thresholds,
    })!;
    const withBefore: CodexResetJournalRow = { ...intent({ creditId: "credit-1", key: "k-4" }), before };
    const withAfter: CodexResetJournalRow = {
      after,
      alias: "plan-two",
      atIso: READ_AT,
      idempotencyKey: "k-4",
      kind: "outcome",
      outcome: "reset",
      v: 1,
    };
    expect(unwrap(parseCodexResetJournalLine({ line: JSON.stringify(withBefore) }))).toEqual(withBefore);
    expect(unwrap(parseCodexResetJournalLine({ line: JSON.stringify(withAfter) }))).toEqual(withAfter);
  });

  it("refuses a line that is not JSON", () => {
    expect(unwrapErr(parseCodexResetJournalLine({ line: "{nope" }))).toEqual(
      CodexResetErrors.journalLineInvalid({ detail: "is not JSON" }),
    );
  });

  it("refuses an outcome the provider never answers with", () => {
    const line = JSON.stringify({
      alias: "a",
      atIso: READ_AT,
      idempotencyKey: "k",
      kind: "outcome",
      outcome: "maybe",
      v: 1,
    });
    expect(unwrapErr(parseCodexResetJournalLine({ line })).message).toContain("a claims journal line is not a row");
  });
});
