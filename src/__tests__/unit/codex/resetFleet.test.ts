/**
 * `codex/resetFleet.ts` — which stores `codex reset --at-limit` claims on. The properties that cost a reset when
 * wrong: a store below the limit is never claimed, one account is claimed once however many stores sign into it,
 * and an open attempt is always handed back to be settled rather than shadowed by a fresh key.
 */
import { describe, expect, it } from "vitest";

import { type CodexAccountLive, parseCodexAccountLive } from "../../../codex/accountLiveParse.js";
import type { CodexResetJournalRow } from "../../../codex/resetConsume.js";
import { type CodexResetFleetCandidate, otherOpenAttempts, planCodexResetsAtLimit } from "../../../codex/resetFleet.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const READ_AT = "2026-09-25T13:00:00.000Z";
/** Four and a half days after {@link READ_AT}. */
const RESETS_AHEAD = 1790736653;

/** One store, read signed in at `usedPercent` with `available` resets on account `accountId`. */
function candidate({
  accountId,
  alias,
  available = 2,
  email = `${alias}@example.com`,
  usedPercent,
}: {
  accountId: string | null;
  alias: string;
  available?: number;
  email?: string;
  usedPercent: number;
}): CodexResetFleetCandidate {
  const codexHome = `/stores/${alias}`;
  const bucket = {
    credits: null,
    limitId: "codex",
    planType: "pro",
    primary: { resetsAt: RESETS_AHEAD, usedPercent, windowDurationMins: 10080 },
    secondary: null,
  };
  const credits = [
    { expiresAt: RESETS_AHEAD + 600, id: `${alias}-late`, status: "available" },
    { expiresAt: RESETS_AHEAD, id: `${alias}-soon`, status: "available" },
  ].slice(0, available);
  const live: CodexAccountLive = parseCodexAccountLive({
    codexHome,
    lines: [
      JSON.stringify({
        id: 2,
        result: {
          accountId,
          rateLimitResetCredits: { availableCount: available, credits },
          rateLimits: bucket,
          rateLimitsByLimitId: { codex: bucket },
        },
      }),
      JSON.stringify({
        id: 3,
        result: { account: { email, planType: "pro", type: "chatgpt" } },
      }),
    ],
    readAtIso: READ_AT,
  });
  return { destination: { alias, codexHome }, live };
}

/** The decisions reduced to what a reader checks: each store's verdict, and the credit a run names. */
function verdicts({
  candidates,
  rows = [],
}: {
  candidates: readonly CodexResetFleetCandidate[];
  rows?: readonly CodexResetJournalRow[];
}): readonly string[] {
  return planCodexResetsAtLimit({ candidates, rows, thresholds: DEFAULT_THRESHOLDS.codex }).map((decision) => {
    if (decision.kind === "run") {
      return `${decision.candidate.destination.alias} run ${String(decision.creditId)} retry=${String(decision.retry)}`;
    }
    return `${decision.alias} ${decision.kind}: ${decision.reason}`;
  });
}

describe("planCodexResetsAtLimit", () => {
  it("claims a store at its limit with the reset that lapses first, and leaves one below the bar alone", () => {
    const candidates = [
      candidate({ accountId: "acct-a", alias: "plan-a", usedPercent: 99 }),
      candidate({ accountId: "acct-b", alias: "plan-b", usedPercent: 85 }),
    ];
    expect(verdicts({ candidates })).toEqual([
      "plan-a run plan-a-soon retry=false",
      "plan-b skip: not at its limit (weekly 85% used)",
    ]);
  });

  it("skips a store at its limit that holds no reset, and one nothing is signed into", () => {
    const signedOut: CodexResetFleetCandidate = {
      destination: { alias: "plan-c", codexHome: "/stores/plan-c" },
      live: { codexHome: "/stores/plan-c", kind: "signed-out", readAtIso: READ_AT },
    };
    const candidates = [candidate({ accountId: "acct-a", alias: "plan-a", available: 0, usedPercent: 100 }), signedOut];
    expect(verdicts({ candidates })).toEqual([
      "plan-a skip: at its limit (weekly 100% used) but holds no free reset",
      "plan-c skip: nothing is signed into it (signed-out)",
    ]);
  });

  it("fails a store whose live read failed — this run cannot judge it", () => {
    const unreadable: CodexResetFleetCandidate = {
      destination: { alias: "plan-u", codexHome: "/stores/plan-u" },
      live: { codexHome: "/stores/plan-u", kind: "unreadable", readAtIso: READ_AT, reason: "deadline" },
    };
    expect(verdicts({ candidates: [unreadable] })).toEqual(["plan-u fail: its live read failed (deadline)"]);
  });

  it("claims one account once, however many registered stores sign into it", () => {
    const candidates = [
      candidate({ accountId: "acct-shared", alias: "plan-a", usedPercent: 99 }),
      candidate({ accountId: "acct-shared", alias: "plan-b", usedPercent: 99 }),
    ];
    expect(verdicts({ candidates })).toEqual([
      "plan-a run plan-a-soon retry=false",
      "plan-b skip: shares its account with plan-a, claimed once for both",
    ]);
  });

  it("claims one account once by its signed-in address when the provider omits the account id", () => {
    const candidates = [
      candidate({ accountId: null, alias: "plan-a", email: "Owner@example.com", usedPercent: 99 }),
      candidate({ accountId: null, alias: "plan-b", email: "owner@example.com", usedPercent: 99 }),
    ];
    expect(verdicts({ candidates })).toEqual([
      "plan-a run plan-a-soon retry=false",
      "plan-b skip: shares its account with plan-a, claimed once for both",
    ]);
  });

  it("pairs a store reporting the account id with one reporting only the same address, and sends no fresh claim beside its open attempt", () => {
    const rows: CodexResetJournalRow[] = [
      { alias: "plan-a", atIso: READ_AT, idempotencyKey: "k-open", kind: "intent", v: 1 },
    ];
    const candidates = [
      candidate({ accountId: "acct-shared", alias: "plan-a", email: "owner@example.com", usedPercent: 99 }),
      candidate({ accountId: null, alias: "plan-b", email: "Owner@example.com", usedPercent: 99 }),
    ];
    expect(verdicts({ candidates, rows })).toEqual([
      "plan-a run undefined retry=true",
      "plan-b skip: shares its account with plan-a, whose open attempt runs",
    ]);
  });

  it("hands an open attempt back to be settled even below the bar, and the account's other store waits on it", () => {
    const rows: CodexResetJournalRow[] = [
      { alias: "plan-b", atIso: READ_AT, idempotencyKey: "k-open", kind: "intent", v: 1 },
    ];
    const candidates = [
      candidate({ accountId: "acct-shared", alias: "plan-a", usedPercent: 99 }),
      candidate({ accountId: "acct-shared", alias: "plan-b", usedPercent: 20 }),
    ];
    expect(verdicts({ candidates, rows })).toEqual([
      "plan-a skip: shares its account with plan-b, whose open attempt runs",
      "plan-b run undefined retry=true",
    ]);
  });

  it("sends neither when two stores of one account each hold an open attempt", () => {
    const rows: CodexResetJournalRow[] = [
      { alias: "plan-a", atIso: READ_AT, idempotencyKey: "k-1", kind: "intent", v: 1 },
      { alias: "plan-b", atIso: READ_AT, idempotencyKey: "k-2", kind: "intent", v: 1 },
    ];
    const candidates = [
      candidate({ accountId: "acct-shared", alias: "plan-a", usedPercent: 99 }),
      candidate({ accountId: "acct-shared", alias: "plan-b", usedPercent: 99 }),
    ];
    const reason = "plan-a and plan-b share one account and each holds an open attempt — neither is sent";
    expect(verdicts({ candidates, rows })).toEqual([`plan-a fail: ${reason}`, `plan-b fail: ${reason}`]);
  });

  it("sends no fresh claim while a plan this run cannot read holds an open attempt, but still settles its own", () => {
    const rows: CodexResetJournalRow[] = [
      { alias: "plan-paused", atIso: READ_AT, idempotencyKey: "k-p", kind: "intent", v: 1 },
      { alias: "plan-b", atIso: READ_AT, idempotencyKey: "k-b", kind: "intent", v: 1 },
      { alias: "plan-c", atIso: READ_AT, idempotencyKey: "k-c", kind: "intent", v: 1 },
      { alias: "plan-c", atIso: READ_AT, idempotencyKey: "k-c", kind: "outcome", outcome: "reset", v: 1 },
    ];
    const candidates = [
      candidate({ accountId: "acct-a", alias: "plan-a", usedPercent: 99 }),
      candidate({ accountId: "acct-b", alias: "plan-b", usedPercent: 99 }),
      candidate({ accountId: "acct-c", alias: "plan-c", usedPercent: 50 }),
    ];
    const reason =
      "plan-paused holds an open attempt whose account this run cannot read (paused, unregistered or unreadable), and may share this " +
      "account — no fresh claim is sent while it stands; settle it with codex reset --plan plan-paused, " +
      "re-registering a plan that is gone first";
    expect(verdicts({ candidates, rows })).toEqual([
      `plan-a fail: ${reason}`,
      "plan-b run undefined retry=true",
      "plan-c skip: not at its limit (weekly 50% used)",
    ]);
  });

  it("treats an open attempt on a store read unreadable this pass as stranded, so no fresh claim goes beside it", () => {
    const rows: CodexResetJournalRow[] = [
      { alias: "plan-u", atIso: READ_AT, idempotencyKey: "k-u", kind: "intent", v: 1 },
    ];
    const unreadable: CodexResetFleetCandidate = {
      destination: { alias: "plan-u", codexHome: "/stores/plan-u" },
      live: { codexHome: "/stores/plan-u", kind: "unreadable", readAtIso: READ_AT, reason: "deadline" },
    };
    const decisions = verdicts({
      candidates: [unreadable, candidate({ accountId: "acct-b", alias: "plan-b", usedPercent: 99 })],
      rows,
    });
    expect(decisions[0]).toBe("plan-u run undefined retry=true");
    expect(decisions[1]).toContain("plan-b fail: plan-u holds an open attempt whose account this run cannot read");
  });

  it("decides nothing for an empty register", () => {
    expect(verdicts({ candidates: [] })).toEqual([]);
  });
});

describe("otherOpenAttempts", () => {
  it("names every other plan with an unsettled attempt, never the plan asked about or a settled one", () => {
    const rows: CodexResetJournalRow[] = [
      { alias: "plan-a", atIso: READ_AT, idempotencyKey: "k-a", kind: "intent", v: 1 },
      { alias: "plan-b", atIso: READ_AT, idempotencyKey: "k-b", kind: "intent", v: 1 },
      { alias: "plan-c", atIso: READ_AT, idempotencyKey: "k-c", kind: "intent", v: 1 },
      { alias: "plan-c", atIso: READ_AT, idempotencyKey: "k-c", kind: "outcome", outcome: "reset", v: 1 },
    ];
    expect([otherOpenAttempts({ alias: "plan-a", rows }), otherOpenAttempts({ alias: "plan-c", rows })]).toEqual([
      ["plan-b"],
      ["plan-a", "plan-b"],
    ]);
    expect(otherOpenAttempts({ alias: "plan-a", rows: [] })).toEqual([]);
  });
});
