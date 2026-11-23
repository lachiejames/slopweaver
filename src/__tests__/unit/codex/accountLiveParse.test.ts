/**
 * The live Codex account read's pure half: one store's app-server lines in, its signed-in / signed-out /
 * unreadable state out, and the quota evidence and observations the fleet read folds from it.
 *
 * Every wire line here is the SHAPE codex-cli 0.155.1 and 0.153.4 returned, with synthetic
 * addresses and ids — never a captured response.
 */
import { describe, expect, it } from "vitest";

import {
  type CodexAccountLive,
  effectiveGauge,
  evidenceFromLive,
  linesByStore,
  parseCodexAccountLive,
  quotaObservationsFromLive,
  routingGaugeFromLive,
} from "../../../codex/accountLiveParse.js";
import { survivingEvidence } from "../../../codex/quotaGate.js";

const HOME = "/stores/codex-a";
const READ_AT = "2026-09-25T13:00:00.000Z";

/** A `codex` bucket as the wire carries it: one window at `usedPercent`, resetting at `resetsAt` (unix s). */
function bucket({
  limitId = "codex",
  primary,
  secondary = null,
}: {
  limitId?: string;
  primary: { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
  secondary?: { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
}): Record<string, unknown> {
  return {
    credits: { balance: "0", hasCredits: false, unlimited: false },
    individualLimit: null,
    limitId,
    limitName: null,
    planType: "prolite",
    primary,
    rateLimitReachedType: null,
    secondary,
    spendControlReached: false,
  };
}

const WEEKLY_OPEN = { resetsAt: 1790944998, usedPercent: 0, windowDurationMins: 10080 };
const WEEKLY_FULL = { resetsAt: 1790736653, usedPercent: 100, windowDurationMins: 10080 };

/** The rate-limit answer, with the given buckets keyed by their own ids. */
function rateLimitsLine({
  buckets,
  extra = {},
}: {
  buckets: readonly Record<string, unknown>[];
  extra?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    id: 2,
    result: {
      accountId: "acct-1",
      rateLimitResetCredits: { availableCount: 0, credits: [] },
      rateLimits: buckets[0],
      rateLimitsByLimitId: Object.fromEntries(buckets.map((entry) => [entry["limitId"], entry])),
      rateLimitUpsell: null,
      ...extra,
    },
  });
}

const ACCOUNT_LINE = JSON.stringify({
  id: 3,
  result: { account: { email: "someone@example.com", planType: "prolite", type: "chatgpt" }, requiresOpenaiAuth: true },
});
const SIGNED_OUT_ACCOUNT = JSON.stringify({ id: 3, result: { account: null, requiresOpenaiAuth: true } });
const AUTH_REQUIRED = JSON.stringify({
  error: { code: -32600, message: "codex account authentication required to read rate limits" },
  id: 2,
});
const INITIALIZE = JSON.stringify({ id: 1, result: { codexHome: HOME, platformOs: "macos" } });
const NOTIFICATION = JSON.stringify({ method: "remoteControl/status/changed", params: { status: "disabled" } });

function parse({ lines }: { lines: readonly string[] }): CodexAccountLive {
  return parseCodexAccountLive({ codexHome: HOME, lines, readAtIso: READ_AT });
}

/** The signed-in arm, or a thrown error naming what arrived instead. */
function signedIn({ live }: { live: CodexAccountLive }): Extract<CodexAccountLive, { kind: "signed-in" }> {
  if (live.kind !== "signed-in") {
    throw new Error(`expected a signed-in read, got ${live.kind}`);
  }
  return live;
}

describe("parseCodexAccountLive", () => {
  it("reads a signed-in store whichever answer arrives first", () => {
    const forward = parse({
      lines: [INITIALIZE, rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })] }), ACCOUNT_LINE],
    });
    const reversed = parse({
      lines: [ACCOUNT_LINE, NOTIFICATION, rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })] })],
    });
    expect(reversed).toEqual(forward);
    expect(forward).toEqual({
      accountId: "acct-1",
      codexHome: HOME,
      email: "someone@example.com",
      gauges: [
        {
          credits: { balance: null, hasCredits: false, unlimited: false },
          limitId: "codex",
          observedAtIso: READ_AT,
          planType: "prolite",
          reached: undefined,
          reachedType: undefined,
          windows: [
            {
              label: "weekly",
              resetAtIso: "2026-10-02T12:43:18.000Z",
              slot: "primary",
              usedPercent: 0,
              windowMinutes: 10080,
            },
          ],
        },
      ],
      kind: "signed-in",
      ordinaryUsageAllowed: undefined,
      planType: "prolite",
      readAtIso: READ_AT,
      resetCreditsAvailable: 0,
      resetCreditsListed: [],
    });
  });

  it("reads account: null as signed-out", () => {
    expect(parse({ lines: [INITIALIZE, AUTH_REQUIRED, SIGNED_OUT_ACCOUNT] })).toEqual({
      codexHome: HOME,
      kind: "signed-out",
      readAtIso: READ_AT,
    });
  });

  it("counts the free usage-limit resets the account holds", () => {
    const live = parse({
      lines: [
        rateLimitsLine({
          buckets: [bucket({ primary: WEEKLY_FULL })],
          extra: { rateLimitResetCredits: { availableCount: 2, credits: null } },
        }),
        ACCOUNT_LINE,
      ],
    });
    expect(signedIn({ live }).resetCreditsAvailable).toBe(2);
    expect(signedIn({ live }).resetCreditsListed).toBeUndefined();
  });

  it("itemises each reset the provider listed, with its expiry as an instant", () => {
    const live = parse({
      lines: [
        rateLimitsLine({
          buckets: [bucket({ primary: WEEKLY_FULL })],
          extra: {
            rateLimitResetCredits: {
              availableCount: 1,
              credits: [
                {
                  description: null,
                  expiresAt: 1791072000,
                  grantedAt: 1790467200,
                  id: "credit-1",
                  resetType: "codexRateLimits",
                  status: "available",
                  title: "Usage limit reset",
                },
                { expiresAt: null, grantedAt: 1790000000, id: "credit-0", status: "redeemed", title: null },
              ],
            },
          },
        }),
        ACCOUNT_LINE,
      ],
    });
    expect(signedIn({ live }).resetCreditsListed).toEqual([
      { expiresAtIso: "2026-10-04T00:00:00.000Z", id: "credit-1", status: "available", title: "Usage limit reset" },
      { id: "credit-0", status: "redeemed" },
    ]);
  });

  it("names the reader's own marker when an answer never came", () => {
    expect(parse({ lines: [ACCOUNT_LINE, "!deadline"] })).toEqual({
      codexHome: HOME,
      kind: "unreadable",
      readAtIso: READ_AT,
      reason: "the app-server did not answer both requests before the per-store deadline",
    });
  });

  it("refuses a partial answer rather than manufacturing a healthy one", () => {
    expect(parse({ lines: [ACCOUNT_LINE] })).toEqual({
      codexHome: HOME,
      kind: "unreadable",
      readAtIso: READ_AT,
      reason: "no well-formed answer to account/rateLimits/read",
    });
  });

  it("refuses an answer given twice", () => {
    const line = rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })] });
    expect(parse({ lines: [line, line, ACCOUNT_LINE] })).toEqual({
      codexHome: HOME,
      kind: "unreadable",
      readAtIso: READ_AT,
      reason: "the app-server answered request 2 twice",
    });
  });

  it("refuses an answer carrying both an error and a result", () => {
    const both = JSON.stringify({
      ...JSON.parse(rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })] })),
      error: { code: -32000, message: "failed" },
    });
    expect(parse({ lines: [both, ACCOUNT_LINE] })).toEqual({
      codexHome: HOME,
      kind: "unreadable",
      readAtIso: READ_AT,
      reason: "the app-server answered request 2 with both an error and a result",
    });
  });

  it("refuses a line that is not JSON", () => {
    expect(parse({ lines: ["{not json", ACCOUNT_LINE] })).toEqual({
      codexHome: HOME,
      kind: "unreadable",
      readAtIso: READ_AT,
      reason: "the app-server wrote a line that is not JSON",
    });
  });

  it("refuses a bucket whose key disagrees with the id inside it", () => {
    const line = JSON.stringify({
      id: 2,
      result: {
        rateLimits: bucket({ primary: WEEKLY_OPEN }),
        rateLimitsByLimitId: { premium: bucket({ primary: WEEKLY_OPEN }) },
      },
    });
    expect(parse({ lines: [line, ACCOUNT_LINE] })).toEqual({
      codexHome: HOME,
      kind: "unreadable",
      readAtIso: READ_AT,
      reason: "the rate-limit bucket keyed premium names itself codex",
    });
  });
});

describe("evidenceFromLive", () => {
  it("names the exhausted window that reopens LAST, not the latest reset of any window", () => {
    const fiveHourFull = { resetsAt: 1790400000, usedPercent: 100, windowDurationMins: 300 };
    const weeklyHealthyLater = { resetsAt: 1790900000, usedPercent: 40, windowDurationMins: 10080 };
    const live = parse({
      lines: [
        rateLimitsLine({ buckets: [bucket({ primary: weeklyHealthyLater, secondary: fiveHourFull })] }),
        ACCOUNT_LINE,
      ],
    });
    expect(evidenceFromLive({ live })).toEqual([
      {
        kind: "window-limit",
        limitId: "codex",
        observedAtIso: READ_AT,
        resetAtIso: "2026-09-26T05:20:00.000Z",
        windowMinutes: 300,
      },
    ]);
  });

  it("reads ordinaryUsageAllowed false as an unscoped usage limit", () => {
    const live = parse({
      lines: [
        rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })], extra: { ordinaryUsageAllowed: false } }),
        ACCOUNT_LINE,
      ],
    });
    expect(evidenceFromLive({ live })).toEqual([{ kind: "usage-limit", observedAtIso: READ_AT }]);
  });

  it("establishes nothing for a signed-out store", () => {
    expect(evidenceFromLive({ live: parse({ lines: [AUTH_REQUIRED, SIGNED_OUT_ACCOUNT] }) })).toEqual([]);
  });
});

describe("quotaObservationsFromLive", () => {
  it("clears a stale same-scope cap with a strictly later healthy reading, and nothing else", () => {
    const live = parse({ lines: [rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })] }), ACCOUNT_LINE] });
    const staleCodex = { kind: "window-limit" as const, limitId: "codex", observedAtIso: "2026-09-23T10:47:50.411Z" };
    const stalePremium = {
      kind: "window-limit" as const,
      limitId: "premium",
      observedAtIso: "2026-09-23T10:47:50.411Z",
    };
    const sameInstant = { kind: "window-limit" as const, limitId: "codex", observedAtIso: READ_AT };
    expect(
      survivingEvidence({
        candidates: [staleCodex, stalePremium, sameInstant],
        observations: quotaObservationsFromLive({ live }),
      }),
    ).toEqual([sameInstant, stalePremium]);
  });

  it("observes nothing for an unreadable store", () => {
    expect(quotaObservationsFromLive({ live: parse({ lines: ["!eof"] }) })).toEqual([]);
  });
});

describe("routingGaugeFromLive", () => {
  it("keeps the top-level bucket when the per-limit map leaves its limit out", () => {
    const live = parse({
      lines: [
        JSON.stringify({
          id: 2,
          result: {
            accountId: "acct-1",
            rateLimitResetCredits: { availableCount: 0, credits: [] },
            rateLimits: bucket({ primary: { ...WEEKLY_OPEN, usedPercent: 25 } }),
            rateLimitsByLimitId: { premium: bucket({ limitId: "premium", primary: WEEKLY_OPEN }) },
          },
        }),
        ACCOUNT_LINE,
      ],
    });
    expect(signedIn({ live }).gauges.map((gauge) => gauge.limitId)).toEqual(["premium", "codex"]);
    expect(routingGaugeFromLive({ live })!.windows[0]!.usedPercent).toBe(25);
  });

  it("reads a top-level bucket naming no limit as unscoped evidence when a per-limit map is present", () => {
    const live = parse({
      lines: [
        JSON.stringify({
          id: 2,
          result: {
            accountId: "acct-1",
            rateLimitResetCredits: { availableCount: 0, credits: [] },
            rateLimits: {
              ...bucket({ primary: null }),
              limitId: null,
              rateLimitReachedType: "workspace_member_usage_limit_reached",
            },
            rateLimitsByLimitId: {},
          },
        }),
        ACCOUNT_LINE,
      ],
    });
    expect(evidenceFromLive({ live })).toEqual([{ kind: "usage-limit", observedAtIso: READ_AT }]);
  });

  it("takes the codex bucket and ignores any other", () => {
    const live = parse({
      lines: [
        rateLimitsLine({
          buckets: [bucket({ limitId: "premium", primary: WEEKLY_FULL }), bucket({ primary: WEEKLY_OPEN })],
        }),
        ACCOUNT_LINE,
      ],
    });
    expect(routingGaugeFromLive({ live })!.windows[0]!.usedPercent).toBe(0);
  });
});

describe("effectiveGauge", () => {
  const rollout = {
    credits: undefined,
    limitId: "codex",
    observedAtIso: "2026-09-22T10:00:00.000Z",
    planType: "prolite",
    reached: undefined,
    reachedType: undefined,
    windows: [
      {
        label: "weekly" as const,
        resetAtIso: undefined,
        slot: "primary" as const,
        usedPercent: 100,
        windowMinutes: 10080,
      },
    ],
  };

  it("takes the live codex bucket over a rollout line of any age", () => {
    const live = parse({ lines: [rateLimitsLine({ buckets: [bucket({ primary: WEEKLY_OPEN })] }), ACCOUNT_LINE] });
    const effective = effectiveGauge({ live, rolloutGauge: rollout });
    expect(effective.source).toBe("live");
    expect(effective.gauge!.windows[0]!.usedPercent).toBe(0);
  });

  it("gives a signed-out store no reading at all, never the rollout number beside it", () => {
    expect(
      effectiveGauge({ live: parse({ lines: [AUTH_REQUIRED, SIGNED_OUT_ACCOUNT] }), rolloutGauge: rollout }),
    ).toEqual({
      gauge: undefined,
      source: "none",
    });
  });

  it("falls back to the rollout scan for a signed-in store whose answer carries no codex bucket", () => {
    const live = parse({
      lines: [rateLimitsLine({ buckets: [bucket({ limitId: "premium", primary: WEEKLY_OPEN })] }), ACCOUNT_LINE],
    });
    expect(effectiveGauge({ live, rolloutGauge: rollout })).toEqual({ gauge: rollout, source: "rollout" });
  });

  it("reads a live codex bucket that measured no window as no reading, falling back to the rollout scan", () => {
    const live = parse({ lines: [rateLimitsLine({ buckets: [bucket({ primary: null })] }), ACCOUNT_LINE] });
    expect(live.kind).toBe("signed-in");
    expect(effectiveGauge({ live, rolloutGauge: rollout })).toEqual({ gauge: rollout, source: "rollout" });
    expect(effectiveGauge({ live, rolloutGauge: undefined })).toEqual({ gauge: undefined, source: "none" });
    expect(quotaObservationsFromLive({ live })).toEqual([]);
  });

  it("keeps a live reached type nobody has classified as the store's gauge, and lets it clear nothing", () => {
    const live = parse({
      lines: [
        rateLimitsLine({
          buckets: [{ ...bucket({ primary: WEEKLY_OPEN }), rateLimitReachedType: "some_new_wording" }],
        }),
        ACCOUNT_LINE,
      ],
    });
    const effective = effectiveGauge({ live, rolloutGauge: rollout });
    expect(effective.source).toBe("live");
    expect(effective.gauge!.reachedType).toBe("some_new_wording");
    expect(quotaObservationsFromLive({ live })).toEqual([]);
  });

  it("keeps a windowless live bucket whose only signal is an unclassified reached type, over the rollout", () => {
    const live = parse({
      lines: [
        rateLimitsLine({ buckets: [{ ...bucket({ primary: null }), rateLimitReachedType: "some_new_wording" }] }),
        ACCOUNT_LINE,
      ],
    });
    expect(effectiveGauge({ live, rolloutGauge: rollout }).source).toBe("live");
  });

  it("reads a NUMERIC spent live balance as current credits-out, never falling back to the rollout", () => {
    const live = parse({
      lines: [
        rateLimitsLine({
          buckets: [{ ...bucket({ primary: null }), credits: { balance: 0, hasCredits: true, unlimited: false } }],
        }),
        ACCOUNT_LINE,
      ],
    });
    expect(effectiveGauge({ live, rolloutGauge: rollout }).source).toBe("live");
    expect(evidenceFromLive({ live })).toEqual([{ kind: "credits-out", limitId: "codex", observedAtIso: READ_AT }]);
  });

  it("reads a negative live percentage as a malformed answer, keeping the rollout reading", () => {
    const live = parse({
      lines: [rateLimitsLine({ buckets: [bucket({ primary: { ...WEEKLY_OPEN, usedPercent: -1 } })] }), ACCOUNT_LINE],
    });
    expect(live.kind).toBe("unreadable");
    expect(effectiveGauge({ live, rolloutGauge: rollout })).toEqual({ gauge: rollout, source: "rollout" });
    expect(quotaObservationsFromLive({ live })).toEqual([]);
  });

  it("falls back to the rollout scan when the live read could not happen", () => {
    expect(effectiveGauge({ live: parse({ lines: ["!deadline"] }), rolloutGauge: rollout })).toEqual({
      gauge: rollout,
      source: "rollout",
    });
    expect(effectiveGauge({ live: parse({ lines: ["!deadline"] }), rolloutGauge: undefined })).toEqual({
      gauge: undefined,
      source: "none",
    });
  });
});

describe("linesByStore", () => {
  it("splits the tagged stream by store and drops a line no store owns", () => {
    expect(linesByStore({ stdout: "1\tb\n0\ta\n7\tstray\nuntagged\n0\t!eof\n", storeCount: 2 })).toEqual([
      ["a", "!eof"],
      ["b"],
    ]);
  });
});
