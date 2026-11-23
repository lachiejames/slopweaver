/**
 * "Is Codex capped" as a fact about the FLEET — `codex/fleetCap.ts`.
 *
 * The one property every case here exists for: an exhausted destination beside an OPEN one is not a cap.
 * Three verbs read this answer (`codex status --check`, the landing gates, both fallback verbs) and each of
 * them used to ask the ambient account alone, so the falsifiable partner matters as much as the positive
 * case — a fleet whose every row refuses must still yield evidence, or the rule-9 cap path would never open.
 */
import { describe, expect, it } from "vitest";

import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { codexFleetAdvisories, decideCodexFleetCap } from "../../../codex/fleetCap.js";
import type { CodexPlanObservation, CodexPlanRanking } from "../../../codex/fleetTypes.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import type { CodexQuotaDecision } from "../../../codex/quotaGate.js";
import type { CodexResetCredit } from "../../../codex/resetCreditsParse.js";

const SIX = { alias: "plan-six", codexHome: "/state/plan-six/.codex" };
const SEVEN = { alias: "plan-seven", codexHome: "/state/plan-seven/.codex" };
const EIGHT = { alias: "plan-eight", codexHome: "/state/plan-eight/.codex" };
const NOW = "2026-09-25T13:00:00.000Z";

/** A signed-in live answer for one store, with the given account id and reset count. */
function signedIn({
  accountId,
  codexHome,
  resetCreditsAvailable = 0,
  resetCreditsListed,
}: {
  accountId: string;
  codexHome: string;
  resetCreditsAvailable?: number;
  resetCreditsListed?: readonly CodexResetCredit[];
}): CodexAccountLive {
  return {
    accountId,
    codexHome,
    email: `${accountId}@example.com`,
    gauges: [],
    kind: "signed-in",
    ordinaryUsageAllowed: undefined,
    planType: "pro",
    readAtIso: NOW,
    resetCreditsAvailable,
    ...(resetCreditsListed === undefined ? {} : { resetCreditsListed }),
  };
}

/** A refusing quota decision whose evidence carries a fixed instant. */
function refusing({ observedAtIso }: { observedAtIso: string }): CodexQuotaDecision {
  return {
    evidence: { kind: "usage-limit", limitId: "premium", observedAtIso },
    reason: `usage limit reached, observed ${observedAtIso}`,
    refuse: true,
  };
}

/** One observation, with only the fields this module reads carrying anything meaningful. */
function observation({
  destination,
  live = { codexHome: destination.codexHome, kind: "unreadable", readAtIso: NOW, reason: "no live read" },
  quota,
}: {
  destination: { alias: string; codexHome: string };
  live?: CodexAccountLive;
  quota: CodexQuotaDecision;
}): CodexPlanObservation {
  return {
    destination,
    gauge: undefined,
    gaugeSource: "none",
    live,
    plan: {
      alias: destination.alias,
      allowance: { kind: "weekly-window" },
      provider: "codex",
      storeDir: destination.codexHome,
      usageLimitPercent: 100,
    },
    quota,
    scan: { filesRead: 0, filesSkipped: 0, filesUnreadable: 0, gauge: undefined },
  };
}

/** A gauge observed at the given instant; the ranking is hand-built here, so only its instant is read. */
function gaugeAt({ observedAtIso }: { observedAtIso: string }): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso,
    planType: "pro",
    reached: undefined,
    reachedType: undefined,
    windows: [],
  };
}

/** A ranking with the given eligible destinations and exclusions. */
function ranking({
  excluded = [],
  ranked = [],
}: {
  excluded?: CodexPlanRanking["excluded"];
  ranked?: CodexPlanRanking["ranked"];
}): CodexPlanRanking {
  return {
    basis: ranked.length > 0 ? "weekly" : "no-eligible-destination",
    deferredUnmeasured: [],
    excluded,
    ranked,
  };
}

describe("what the whole registered Codex fleet can do right now", () => {
  it("reports NO cap and names the open destination when one plan refuses and another does not", () => {
    const cap = decideCodexFleetCap({
      observations: [
        observation({ destination: SEVEN, quota: refusing({ observedAtIso: "2026-09-23T01:00:00.000Z" }) }),
        observation({ destination: SIX, quota: { refuse: false } }),
      ],
      ranking: ranking({
        excluded: [{ destination: SEVEN, kind: "quota-refused", reason: "usage limit reached" }],
        ranked: [SIX],
      }),
    });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.destination).toEqual(SIX);
    expect(cap.why).toBe("plan-six can take a pass — ranked first of 1 on weekly");
  });

  // The falsifiable partner: the SAME refusing destination, with nothing left beside it, must produce
  // evidence. Without this case the one above would be green against a module that never reports a cap.
  it("reports the cap when every registered destination is refusing, on the FRESHEST evidence", () => {
    const cap = decideCodexFleetCap({
      observations: [
        observation({ destination: SEVEN, quota: refusing({ observedAtIso: "2026-09-23T01:00:00.000Z" }) }),
        observation({ destination: SIX, quota: refusing({ observedAtIso: "2026-09-23T04:00:00.000Z" }) }),
      ],
      ranking: ranking({
        excluded: [
          { destination: SEVEN, kind: "quota-refused", reason: "usage limit reached" },
          { destination: SIX, kind: "quota-refused", reason: "usage limit reached" },
        ],
      }),
    });

    expect(cap.destination).toBeUndefined();
    expect(cap.capEvidence!.observedAtIso).toBe("2026-09-23T04:00:00.000Z");
    expect(cap.capEvidence!.kind).toBe("usage-limit");
    expect(cap.why).toContain("all 2 registered Codex destination(s) are unavailable and 2 refusing");
    expect(cap.why).toContain("plan-six: usage limit reached, observed 2026-09-23T04:00:00.000Z");
  });

  it("calls a fleet whose every row is PAUSED unavailable and not capped, so no fallback is minted over it", () => {
    const cap = decideCodexFleetCap({
      observations: [observation({ destination: SIX, quota: { refuse: false } })],
      ranking: ranking({
        excluded: [{ destination: SIX, kind: "paused", reason: "the owner took it out of the fleet" }],
      }),
    });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.destination).toBeUndefined();
    expect(cap.routingPause).toBeUndefined();
    expect(cap.why).toBe(
      "no Codex destination can take a pass and none of the 1 excluded is refusing, so this is not a cap — " +
        "plan-six (paused: the owner took it out of the fleet)",
    );
  });

  it("calls a NEAR-CAP fleet not capped, but held at the routing pause on its freshest reading, every row named", () => {
    const cap = decideCodexFleetCap({
      observations: [
        {
          ...observation({ destination: SIX, quota: { refuse: false } }),
          gauge: gaugeAt({ observedAtIso: "2026-09-25T09:00:00.000Z" }),
        },
        {
          ...observation({ destination: SEVEN, quota: { refuse: false } }),
          gauge: gaugeAt({ observedAtIso: "2026-09-25T11:00:00.000Z" }),
        },
        observation({ destination: EIGHT, quota: { refuse: false } }),
      ],
      ranking: ranking({
        excluded: [
          { destination: SIX, kind: "near-cap", reason: "weekly window at 99% used" },
          { destination: SEVEN, kind: "near-cap", reason: "weekly window at 99.6% used" },
          { destination: EIGHT, kind: "paused", reason: "the owner took it out of the fleet" },
        ],
      }),
    });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.destination).toBeUndefined();
    expect(cap.why).toBe(
      "no Codex destination can take a pass and none of the 3 excluded is refusing, so this is not a cap — " +
        "plan-six (near-cap: weekly window at 99% used); plan-seven (near-cap: weekly window at 99.6% used); " +
        "plan-eight (paused: the owner took it out of the fleet)",
    );
    expect(cap.routingPause).toEqual({
      observedAtIso: "2026-09-25T11:00:00.000Z",
      why:
        "no Codex destination can take a pass and none is refusing; 2 of 3 excluded sit at the routing pause, " +
        "which is not a provider cap — plan-six (near-cap: weekly window at 99% used); plan-seven (near-cap: " +
        "weekly window at 99.6% used); plan-eight (paused: the owner took it out of the fleet)",
    });
  });

  it("invents no routing-pause instant for a near-cap row whose observation carries no gauge", () => {
    const cap = decideCodexFleetCap({
      observations: [observation({ destination: SIX, quota: { refuse: false } })],
      ranking: ranking({ excluded: [{ destination: SIX, kind: "near-cap", reason: "weekly window at 99% used" }] }),
    });

    expect(cap.routingPause).toBeUndefined();
  });

  it("carries no routing pause beside a provider refusal, nor over a fleet with a destination open", () => {
    const capped = decideCodexFleetCap({
      observations: [
        observation({ destination: SEVEN, quota: refusing({ observedAtIso: "2026-09-23T01:00:00.000Z" }) }),
        { ...observation({ destination: SIX, quota: { refuse: false } }), gauge: gaugeAt({ observedAtIso: NOW }) },
      ],
      ranking: ranking({
        excluded: [
          { destination: SEVEN, kind: "quota-refused", reason: "usage limit reached" },
          { destination: SIX, kind: "near-cap", reason: "weekly window at 99% used" },
        ],
      }),
    });
    const open = decideCodexFleetCap({
      observations: [
        observation({ destination: SEVEN, quota: { refuse: false } }),
        { ...observation({ destination: SIX, quota: { refuse: false } }), gauge: gaugeAt({ observedAtIso: NOW }) },
      ],
      ranking: ranking({
        excluded: [{ destination: SIX, kind: "near-cap", reason: "weekly window at 99% used" }],
        ranked: [SEVEN],
      }),
    });

    expect(capped.capEvidence!.observedAtIso).toBe("2026-09-23T01:00:00.000Z");
    expect(capped.routingPause).toBeUndefined();
    expect(open.destination).toEqual(SEVEN);
    expect(open.routingPause).toBeUndefined();
  });

  it("reports neither a destination nor a cap over an EMPTY register", () => {
    const cap = decideCodexFleetCap({ observations: [], ranking: ranking({}) });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.destination).toBeUndefined();
    expect(cap.why).toBe(
      "no Codex destination is registered, so nothing here has read a cap — `slopweaver plans list` shows what " +
        "the register carries",
    );
  });

  // A paused row is out by the owner's decision before its quota is asked, so its refusal is not the fleet's: an
  // all-paused fleet is unavailable and not capped even when a paused row happens to be refusing.
  it("mints NO cap from a refusal on a PAUSED row", () => {
    const cap = decideCodexFleetCap({
      observations: [
        {
          ...observation({ destination: SIX, quota: refusing({ observedAtIso: "2026-09-23T04:00:00.000Z" }) }),
          plan: {
            alias: SIX.alias,
            allowance: { kind: "weekly-window" },
            paused: { reason: "the owner took it out of the fleet", sinceIso: "2026-09-20T00:00:00.000Z" },
            provider: "codex",
            storeDir: SIX.codexHome,
            usageLimitPercent: 100,
          },
        },
      ],
      ranking: ranking({
        excluded: [{ destination: SIX, kind: "paused", reason: "the owner took it out of the fleet" }],
      }),
    });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.why).toBe(
      "no Codex destination can take a pass and none of the 1 excluded is refusing, so this is not a cap — " +
        "plan-six (paused: the owner took it out of the fleet)",
    );
  });

  // The falsifier: the same refusal on the same row, unpaused, is a cap.
  it("still mints the cap from that refusal once the row is not paused", () => {
    const cap = decideCodexFleetCap({
      observations: [observation({ destination: SIX, quota: refusing({ observedAtIso: "2026-09-23T04:00:00.000Z" }) })],
      ranking: ranking({ excluded: [{ destination: SIX, kind: "quota-refused", reason: "usage limit reached" }] }),
    });

    expect(cap.capEvidence!.observedAtIso).toBe("2026-09-23T04:00:00.000Z");
  });

  it("calls a fleet held out only by a usage limit and an unmeasured allowance unavailable, NOT capped, and says why", () => {
    const cap = decideCodexFleetCap({
      observations: [
        observation({ destination: SIX, quota: { refuse: false } }),
        observation({ destination: SEVEN, quota: { refuse: false } }),
      ],
      ranking: ranking({
        excluded: [
          { destination: SIX, kind: "usage-limit", reason: "at its 30% usage limit" },
          { destination: SEVEN, kind: "not-measured", reason: "monthly spend is NOT MEASURED" },
        ],
      }),
    });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.destination).toBeUndefined();
    expect(cap.why).toBe(
      "no Codex destination can take a pass and none of the 2 excluded is refusing, so this is not a cap — " +
        "plan-six (usage-limit: at its 30% usage limit); plan-seven (not-measured: monthly spend is NOT MEASURED); " +
        "plan-six, plan-seven held out by the owner's own usage limit or an unmeasured allowance, which is not " +
        "provider cap evidence",
    );
  });

  // Its falsifier rides in the same case: the same refusing row, excluded as quota-refused, DOES mint the cap.
  it("mints NO cap from a refusal on a row the owner's usage limit already held out", () => {
    const quota = refusing({ observedAtIso: "2026-09-23T04:00:00.000Z" });
    const limited = decideCodexFleetCap({
      observations: [observation({ destination: SIX, quota })],
      ranking: ranking({ excluded: [{ destination: SIX, kind: "usage-limit", reason: "at its 30% usage limit" }] }),
    });
    const refused = decideCodexFleetCap({
      observations: [observation({ destination: SIX, quota })],
      ranking: ranking({ excluded: [{ destination: SIX, kind: "quota-refused", reason: "usage limit reached" }] }),
    });

    expect(limited.capEvidence).toBeUndefined();
    expect(refused.capEvidence!.observedAtIso).toBe("2026-09-23T04:00:00.000Z");
  });
});

describe("capacity the fleet is leaving on the table", () => {
  it("names the login for a signed-out or missing store, a held reset's verb, and two homes on one account", () => {
    expect(
      codexFleetAdvisories({
        observations: [
          observation({
            destination: SIX,
            live: { codexHome: SIX.codexHome, kind: "signed-out", readAtIso: NOW },
            quota: { refuse: false },
          }),
          observation({
            destination: SEVEN,
            live: signedIn({ accountId: "acct-a", codexHome: SEVEN.codexHome, resetCreditsAvailable: 2 }),
            quota: { refuse: false },
          }),
          observation({
            destination: EIGHT,
            live: signedIn({ accountId: "acct-a", codexHome: EIGHT.codexHome }),
            quota: { refuse: false },
          }),
          observation({
            destination: { alias: "plan-nine", codexHome: "/state/plan nine" },
            live: { codexHome: "/state/plan nine", kind: "store-missing", readAtIso: NOW },
            quota: { refuse: false },
          }),
        ],
      }),
    ).toEqual([
      "plan-six: not signed in — run mkdir -p /state/plan-six/.codex && CODEX_HOME=/state/plan-six/.codex codex login",
      "plan-seven: 2 free usage-limit reset(s) held — redeem one at a limit with slopweaver codex reset --plan plan-seven",
      "plan-nine: not signed in — run mkdir -p '/state/plan nine' && CODEX_HOME='/state/plan nine' codex login",
      "plan-seven, plan-eight: signed into the same account — two homes add no capacity",
    ]);
  });

  it("names the soonest expiry among the resets still available when the provider listed them", () => {
    const live = signedIn({
      accountId: "acct-a",
      codexHome: SEVEN.codexHome,
      resetCreditsAvailable: 2,
      resetCreditsListed: [
        { expiresAtIso: "2026-10-09T00:00:00.000Z", id: "c-late", status: "available" },
        { expiresAtIso: "2026-10-01T00:00:00.000Z", id: "c-spent", status: "redeemed" },
        { expiresAtIso: "2026-10-04T00:00:00.000Z", id: "c-soon", status: "available" },
      ],
    });

    expect(
      codexFleetAdvisories({ observations: [observation({ destination: SEVEN, live, quota: { refuse: false } })] }),
    ).toEqual([
      "plan-seven: 2 free usage-limit reset(s) held, the soonest expiring 2026-10-04T00:00:00.000Z — " +
        "redeem one at a limit with slopweaver codex reset --plan plan-seven",
    ]);
  });

  it("says nothing when no live read happened, which is the state before the live read existed", () => {
    expect(
      codexFleetAdvisories({ observations: [observation({ destination: SIX, quota: { refuse: false } })] }),
    ).toEqual([]);
  });

  it("calls a fleet whose every row is SIGNED OUT unavailable and not capped", () => {
    const cap = decideCodexFleetCap({
      observations: [
        observation({
          destination: SIX,
          live: { codexHome: SIX.codexHome, kind: "signed-out", readAtIso: NOW },
          quota: { refuse: false },
        }),
      ],
      ranking: ranking({ excluded: [{ destination: SIX, kind: "signed-out", reason: "nothing is signed in there" }] }),
    });

    expect(cap.capEvidence).toBeUndefined();
    expect(cap.destination).toBeUndefined();
    expect(cap.advisories).toEqual([
      "plan-six: not signed in — run mkdir -p /state/plan-six/.codex && CODEX_HOME=/state/plan-six/.codex codex login",
    ]);
  });
});
