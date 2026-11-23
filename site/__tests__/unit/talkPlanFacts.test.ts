import { describe, expect, it } from "vitest";

import { planModelWords, planReadWords, planWindowWords, readPlanLeft } from "../../lib/talkPlanFacts";

/** A `codex quota show` document, its live arm replaced by `live`. */
function quotaDocument({ live }: { live: unknown }): unknown {
  return {
    alias: "codex-ambient",
    decision: { refuse: true, reason: "a stale cached refusal the plan-left row must not read" },
    live,
  };
}

const SIGNED_IN = {
  gauges: [
    {
      limitId: "codex",
      observedAtIso: "2026-10-02T15:44:20.775Z",
      planType: "self_serve_business_prolite",
      windows: [
        {
          label: "weekly",
          resetAtIso: "2026-10-07T02:44:08.000Z",
          slot: "primary",
          usedPercent: 51,
          windowMinutes: 10080,
        },
      ],
    },
  ],
  kind: "signed-in",
  ordinaryUsageAllowed: true,
  planType: "self_serve_business_prolite",
  readAtIso: "2026-10-02T15:44:20.775Z",
};

describe("readPlanLeft", () => {
  it("reads every window of a signed-in store as percent left, ignoring the cached refusal beside it", () => {
    expect(readPlanLeft({ payload: quotaDocument({ live: SIGNED_IN }) })).toEqual({
      allowed: true,
      kind: "read",
      planType: "self_serve_business_prolite",
      windows: [{ label: "weekly", leftPercent: 49, limitId: "codex", resetAtIso: "2026-10-07T02:44:08.000Z" }],
    });
  });

  it("never reports less than nothing left when a window is over its limit", () => {
    const over = {
      ...SIGNED_IN,
      gauges: [{ ...SIGNED_IN.gauges[0], windows: [{ ...SIGNED_IN.gauges[0].windows[0], usedPercent: 104 }] }],
    };
    const read = readPlanLeft({ payload: quotaDocument({ live: over }) });
    expect(read).toEqual({
      allowed: true,
      kind: "read",
      planType: "self_serve_business_prolite",
      windows: [{ label: "weekly", leftPercent: 0, limitId: "codex", resetAtIso: "2026-10-07T02:44:08.000Z" }],
    });
  });

  it("names why a signed-out store could not be read", () => {
    const live = { codexHome: "/h/.codex", kind: "signed-out", readAtIso: "2026-10-02T15:44:20.775Z" };
    expect(readPlanLeft({ payload: quotaDocument({ live }) })).toEqual({
      kind: "not-read",
      why: "Codex is signed out on this machine",
    });
  });

  it("carries an unreadable store's own reason", () => {
    const live = {
      codexHome: "/h/.codex",
      kind: "unreadable",
      readAtIso: "2026-10-02T15:44:20.775Z",
      reason: "deadline",
    };
    expect(readPlanLeft({ payload: quotaDocument({ live }) })).toEqual({ kind: "not-read", why: "deadline" });
  });

  it("refuses a window missing its used percent rather than drawing a guess", () => {
    const broken = {
      ...SIGNED_IN,
      gauges: [{ limitId: "codex", windows: [{ label: "weekly", resetAtIso: "2026-10-07T02:44:08.000Z" }] }],
    };
    expect(readPlanLeft({ payload: quotaDocument({ live: broken }) })).toBe(undefined);
  });

  it("rounds a fractional used percent to a whole one left", () => {
    const gauge = SIGNED_IN.gauges[0];
    const fractional = { ...SIGNED_IN, gauges: [{ ...gauge, windows: [{ ...gauge.windows[0], usedPercent: 51.6 }] }] };
    const read = readPlanLeft({ payload: quotaDocument({ live: fractional }) });
    expect(read).toEqual({
      allowed: true,
      kind: "read",
      planType: "self_serve_business_prolite",
      windows: [{ label: "weekly", leftPercent: 48, limitId: "codex", resetAtIso: "2026-10-07T02:44:08.000Z" }],
    });
  });

  it("refuses a reset time that is not a date, rather than throwing while the page draws it", () => {
    const gauge = SIGNED_IN.gauges[0];
    const badReset = { ...SIGNED_IN, gauges: [{ ...gauge, windows: [{ ...gauge.windows[0], resetAtIso: "soon" }] }] };
    expect(readPlanLeft({ payload: quotaDocument({ live: badReset }) })).toBe(undefined);
  });

  it("refuses a document with no live read, and a store kind it does not know", () => {
    expect(readPlanLeft({ payload: { alias: "codex-ambient" } })).toBe(undefined);
    expect(readPlanLeft({ payload: quotaDocument({ live: { kind: "mystery" } }) })).toBe(undefined);
  });
});

describe("planWindowWords", () => {
  it("says what is left and when it resets, in the zone it is given", () => {
    const window = { label: "weekly", leftPercent: 49, limitId: "codex", resetAtIso: "2026-10-07T02:44:08.000Z" };
    expect(planWindowWords({ timeZone: "Australia/Sydney", window })).toBe(
      "49% of weekly left · resets Wed, 7 Oct, 1:44 pm",
    );
  });

  it("names the allowance when it is not the ordinary one", () => {
    const window = { label: "5h", leftPercent: 100, limitId: "premium", resetAtIso: "2026-10-07T02:44:08.000Z" };
    expect(planWindowWords({ timeZone: "UTC", window })).toBe("100% of premium 5h left · resets Wed, 7 Oct, 2:44 am");
  });
});

describe("planReadWords", () => {
  it("states when the plan was read", () => {
    expect(planReadWords({ observedAtIso: "2026-10-02T15:44:20.775Z", timeZone: "Australia/Sydney" })).toBe(
      "read 1:44 am",
    );
  });

  it("draws the clock in the zone it is given", () => {
    expect(planReadWords({ observedAtIso: "2026-10-02T15:44:20.775Z", timeZone: "UTC" })).toBe("read 3:44 pm");
  });
});

describe("planModelWords", () => {
  it("names both models of the open call", () => {
    expect(planModelWords({ live: { backendModel: "gpt-6-astra", model: "realtime-v3" } })).toEqual({
      known: true,
      words: "realtime-v3, thinking on gpt-6-astra",
    });
  });

  it("says the model is unknown with no call open, never a guess at the next mint", () => {
    expect(planModelWords({ live: undefined })).toEqual({
      known: false,
      words: "unknown until a call opens; the call names its model when it is minted",
    });
  });
});
