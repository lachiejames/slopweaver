/**
 * Whether a Claude fallback pass may be prepared at all — `codex/fallbackCap.ts`.
 *
 * The property under test: `prepare` takes the fleet's own verdict (`codex/fleetCap.ts`), the one `codex
 * review` routes on, and never a second judgement. A receipt saying "Codex was capped" minted while a
 * destination could take the pass would be a false claim on the landing floor; a refusal while the pass has
 * nowhere to go and a cap was read is a deadlock. So the open-destination case and the
 * capped case are each other's falsifier, and the verdict-to-decision mapping is asserted exactly.
 */
import { describe, expect, it } from "vitest";

import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { decideFallbackCap, type FallbackCapDecision } from "../../../codex/fallbackCap.js";
import { type CodexFleetCap, decideCodexFleetCap } from "../../../codex/fleetCap.js";
import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import type { CodexQuotaDecision } from "../../../codex/quotaGate.js";
import { rankCodexPlans } from "../../../codex/rank.js";
import { codexLoginCommand } from "../../../plans/login.js";
import { type CodexThresholds, DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const HATCH_ENV = "SLOPWEAVER_ALLOW_FALLBACK_REVIEW_UNCAPPED";
const NOW = "2026-09-23T06:00:00.000Z";
const SIX = { alias: "plan-six", codexHome: "/state/plan-six/.codex" };

/** A fleet verdict with nothing for the owner to do, overriding only the fields a case is about. */
function fleet(over: Partial<CodexFleetCap>): CodexFleetCap {
  return {
    advisories: [],
    capEvidence: undefined,
    destination: undefined,
    providerUnregistered: undefined,
    routingPause: undefined,
    why: "",
    ...over,
  };
}

const CAPPED = fleet({
  capEvidence: { kind: "usage-limit", limitId: "premium", observedAtIso: "2026-09-23T05:00:00.000Z" },
  why:
    "all 2 registered Codex destination(s) are unavailable and 1 refusing — " +
    "codex-four: usage limit reached, observed 2026-09-23T05:00:00.000Z",
});

describe("deciding whether a Claude fallback may stand in for a Codex pass", () => {
  it("CAPS on the fleet's own evidence, citing the fleet's own sentence", () => {
    const decision = decideFallbackCap({ fleet: CAPPED, hatchEnv: HATCH_ENV, hatchOpen: false, nowIso: NOW });

    expect(decision).toEqual({
      evidence: {
        blockedBy:
          "all 2 registered Codex destination(s) are unavailable and 1 refusing — " +
          "codex-four: usage limit reached, observed 2026-09-23T05:00:00.000Z",
        limitId: "premium",
        observedAtIso: "2026-09-23T05:00:00.000Z",
        reachedType: null,
      },
      kind: "capped",
    });
  });

  it("records a null limit id when the fleet's evidence named none", () => {
    const decision = decideFallbackCap({
      fleet: fleet({ capEvidence: { kind: "credits-out", observedAtIso: NOW }, why: "capped" }),
      hatchEnv: HATCH_ENV,
      hatchOpen: false,
      nowIso: NOW,
    });

    expect(decision).toEqual({
      evidence: { blockedBy: "capped", limitId: null, observedAtIso: NOW, reachedType: null },
      kind: "capped",
    });
  });

  it("REFUSES while the fleet names a destination that can take the pass, and says to route there", () => {
    const decision = decideFallbackCap({
      fleet: fleet({ destination: SIX, why: "plan-six can take a pass — ranked first of 1 on weekly" }),
      hatchEnv: HATCH_ENV,
      hatchOpen: false,
      nowIso: NOW,
    });

    expect(decision).toEqual({
      detail:
        "plan-six can take a pass — ranked first of 1 on weekly — route the pass there instead of spending a " +
        "Claude fallback",
      kind: "refused",
    });
  });

  it("STANDS IN for a fleet held at the routing pause, recording the pause's own sentence and no limit", () => {
    const decision = decideFallbackCap({
      fleet: fleet({
        routingPause: { observedAtIso: "2026-09-23T05:30:00.000Z", why: "the fleet sits at the routing pause" },
        why: "not a cap",
      }),
      hatchEnv: HATCH_ENV,
      hatchOpen: false,
      nowIso: NOW,
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy: "the fleet sits at the routing pause",
        limitId: null,
        observedAtIso: "2026-09-23T05:30:00.000Z",
        reachedType: null,
      },
      kind: "capped",
    });
  });

  // Nothing can take the pass, nothing is refusing and nothing is near-cap — every row paused or signed out.
  // `codex review` refuses too, and that is the designed state: no capacity to cite, the hatch the way past.
  it("REFUSES a fleet that is unavailable but not capped, with the fleet's own reason", () => {
    const why =
      "no Codex destination can take a pass and none of the 1 excluded is refusing, so this is not a cap — " +
      "codex-one (signed-out: nothing is signed in there)";

    const decision = decideFallbackCap({ fleet: fleet({ why }), hatchEnv: HATCH_ENV, hatchOpen: false, nowIso: NOW });

    expect(decision).toEqual({ detail: why, kind: "refused" });
  });

  it("records the hatch by name when an uncapped fleet is overridden, so the request says who opened it", () => {
    const decision = decideFallbackCap({
      fleet: fleet({ destination: SIX, why: "plan-six can take a pass" }),
      hatchEnv: HATCH_ENV,
      hatchOpen: true,
      nowIso: NOW,
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy: `no fleet-wide cap was read; prepared under ${HATCH_ENV}=1`,
        limitId: null,
        observedAtIso: NOW,
        reachedType: null,
      },
      kind: "overridden",
    });
  });

  it("records the real cap, not an override, when the hatch is set over a capped fleet", () => {
    const decision = decideFallbackCap({ fleet: CAPPED, hatchEnv: HATCH_ENV, hatchOpen: true, nowIso: NOW });

    expect(decision.kind).toBe("capped");
  });
});

/** A refusing quota decision, observed at {@link NOW}. */
const REFUSING: CodexQuotaDecision = {
  evidence: { kind: "usage-limit", limitId: "premium", observedAtIso: NOW },
  reason: `usage limit reached, observed ${NOW}`,
  refuse: true,
};

/** A reading whose weekly window reads the given percentage, by default observed an hour before and resetting a week after {@link NOW}. */
function weeklyAt({
  observedAtIso = "2026-09-23T05:00:00.000Z",
  resetAtIso = "2026-09-30T06:00:00.000Z",
  usedPercent,
}: {
  observedAtIso?: string;
  resetAtIso?: string;
  usedPercent: number;
}): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso,
    planType: "team",
    reached: undefined,
    reachedType: undefined,
    windows: [{ label: "weekly", resetAtIso, slot: "primary", usedPercent, windowMinutes: 10080 }],
  };
}

/** The reason `./rank.ts` gives a row whose weekly window is at {@link usedPercent}, resetting a week out. */
function nearCapClause({
  alias,
  pauseAtPercent = 99,
  usedPercent,
}: {
  alias: string;
  pauseAtPercent?: number;
  usedPercent: number;
}): string {
  return (
    `${alias} (near-cap: weekly window at ${String(usedPercent)}% used, resets 2026-09-30T06:00:00.000Z — ` +
    `paused for new work at ${String(pauseAtPercent)}% (about ${String(100 - pauseAtPercent)} percent left))`
  );
}

/** One registered destination's evidence, with only what the ranking and the fleet verdict read set. */
function observation({
  alias,
  gauge,
  live,
  paused = false,
  quota,
}: {
  alias: string;
  gauge?: CodexGauge;
  live?: CodexAccountLive["kind"];
  paused?: boolean;
  quota: CodexQuotaDecision;
}): CodexPlanObservation {
  const codexHome = `/state/${alias}/.codex`;
  const liveAnswer: CodexAccountLive =
    live === "signed-out"
      ? { codexHome, kind: "signed-out", readAtIso: NOW }
      : { codexHome, kind: "unreadable", readAtIso: NOW, reason: "no live read" };
  return {
    destination: { alias, codexHome },
    gauge,
    gaugeSource: gauge === undefined ? "none" : "rollout",
    live: liveAnswer,
    plan: {
      alias,
      allowance: { kind: "weekly-window" },
      provider: "codex",
      storeDir: codexHome,
      usageLimitPercent: 100,
      ...(paused ? { paused: { reason: "out of the fleet", sinceIso: "2026-09-20T00:00:00.000Z" } } : {}),
    },
    quota,
    scan: { filesRead: 0, filesSkipped: 0, filesUnreadable: 0, gauge },
  };
}

/** What `prepare` decides over a fleet, through the REAL ranking and fleet verdict `codex review` routes on. */
function prepareOver({
  observations,
  thresholds = DEFAULT_THRESHOLDS.codex,
}: {
  observations: readonly CodexPlanObservation[];
  thresholds?: CodexThresholds;
}): FallbackCapDecision {
  const verdict = decideCodexFleetCap({
    observations,
    ranking: rankCodexPlans({ nowIso: NOW, observations, thresholds }),
  });
  return decideFallbackCap({ fleet: verdict, hatchEnv: HATCH_ENV, hatchOpen: false, nowIso: NOW });
}

// Each case is a fleet on which `codex review` refuses "no registered destination can take this pass" while
// a real refusal was read — so `prepare` refusing it too is the deadlock this file exists to hold shut.
describe("prepare agrees with codex review over the real ranking", () => {
  it("CAPS a fleet whose other row is SIGNED OUT, the codex-two incident", () => {
    const decision = prepareOver({
      observations: [
        observation({ alias: "codex-ambient", quota: REFUSING }),
        observation({ alias: "codex-two", live: "signed-out", quota: { refuse: false } }),
      ],
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy:
          "all 2 registered Codex destination(s) are unavailable and 1 refusing — " +
          `codex-ambient: usage limit reached, observed ${NOW}`,
        limitId: "premium",
        observedAtIso: NOW,
        reachedType: null,
      },
      kind: "capped",
    });
  });

  it("CAPS a fleet whose other rows sit past the 99% routing pause, a measured reading", () => {
    const decision = prepareOver({
      observations: [
        observation({ alias: "codex-four", gauge: weeklyAt({ usedPercent: 100 }), quota: REFUSING }),
        observation({ alias: "codex-one", gauge: weeklyAt({ usedPercent: 99.5 }), quota: { refuse: false } }),
      ],
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy:
          "all 2 registered Codex destination(s) are unavailable and 1 refusing — " +
          `codex-four: usage limit reached, observed ${NOW}`,
        limitId: "premium",
        observedAtIso: NOW,
        reachedType: null,
      },
      kind: "capped",
    });
  });

  // The falsifier for both: the same second row, now able to take the pass, must still refuse the fallback.
  it("REFUSES once that row can take the pass, naming it", () => {
    const decision = prepareOver({
      observations: [
        observation({ alias: "codex-four", quota: REFUSING }),
        observation({ alias: "codex-one", gauge: weeklyAt({ usedPercent: 40 }), quota: { refuse: false } }),
      ],
    });

    expect(decision).toEqual({
      detail:
        "codex-one can take a pass — ranked first of 1 on weekly — route the pass there instead of spending a " +
        "Claude fallback",
      kind: "refused",
    });
  });

  it("REFUSES a fleet out only for the owner's settings and a login, the PAUSED row's refusal never laundered into a cap", () => {
    const decision = prepareOver({
      observations: [
        observation({ alias: "codex-two", paused: true, quota: REFUSING }),
        observation({ alias: "codex-one", live: "signed-out", quota: { refuse: false } }),
      ],
    });

    expect(decision).toEqual({
      detail:
        "no Codex destination can take a pass and none of the 2 excluded is refusing, so this is not a cap — " +
        "codex-two (paused: out of the fleet); codex-one (signed-out: nothing is signed in there — run " +
        `${codexLoginCommand({ codexHome: "/state/codex-one/.codex" })})`,
      kind: "refused",
    });
  });
});

// A signed-out store can still carry a cached exhaustion record. The row is out for a login
// before its quota is asked, so that refusal is not the fleet's and licenses no fallback.
describe("a signed-out row's cached refusal is not a cap", () => {
  it("REFUSES a fleet whose only row is signed out, even though its cached quota refuses", () => {
    const decision = prepareOver({
      observations: [observation({ alias: "codex-one", live: "signed-out", quota: REFUSING })],
    });

    expect(decision).toEqual({
      detail:
        "no Codex destination can take a pass and none of the 1 excluded is refusing, so this is not a cap — " +
        "codex-one (signed-out: nothing is signed in there — run " +
        `${codexLoginCommand({ codexHome: "/state/codex-one/.codex" })})`,
      kind: "refused",
    });
  });
});

// The incident: every account at 99% weekly, so `codex review` had nowhere to go, and the
// fallback refused too because 99% is a routing pause rather than a provider cap — no review route at all.
describe("prepare stands in for a fleet held at the routing pause", () => {
  it("STANDS IN when every row is near-cap, citing the pause and the FRESHEST near-cap reading", () => {
    const decision = prepareOver({
      observations: [
        observation({
          alias: "codex-ambient",
          gauge: weeklyAt({ observedAtIso: "2026-09-23T04:00:00.000Z", usedPercent: 99 }),
          quota: { refuse: false },
        }),
        observation({
          alias: "codex-one",
          gauge: weeklyAt({ observedAtIso: "2026-09-23T05:40:00.000Z", usedPercent: 99.4 }),
          quota: { refuse: false },
        }),
        observation({
          alias: "codex-two",
          gauge: weeklyAt({ observedAtIso: "2026-09-23T05:10:00.000Z", usedPercent: 99.8 }),
          quota: { refuse: false },
        }),
      ],
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy:
          "no Codex destination can take a pass and none is refusing; 3 of 3 excluded sit at the routing " +
          "pause, which is not a provider cap — " +
          `${nearCapClause({ alias: "codex-ambient", usedPercent: 99 })}; ` +
          `${nearCapClause({ alias: "codex-one", usedPercent: 99.4 })}; ` +
          nearCapClause({ alias: "codex-two", usedPercent: 99.8 }),
        limitId: null,
        observedAtIso: "2026-09-23T05:40:00.000Z",
        reachedType: null,
      },
      kind: "capped",
    });
  });

  it("STANDS IN beside a paused row, naming that row as paused rather than as capacity", () => {
    const decision = prepareOver({
      observations: [
        observation({ alias: "codex-two", paused: true, quota: REFUSING }),
        observation({ alias: "codex-one", gauge: weeklyAt({ usedPercent: 99.5 }), quota: { refuse: false } }),
      ],
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy:
          "no Codex destination can take a pass and none is refusing; 1 of 2 excluded sit at the routing " +
          "pause, which is not a provider cap — codex-two (paused: out of the fleet); " +
          nearCapClause({ alias: "codex-one", usedPercent: 99.5 }),
        limitId: null,
        observedAtIso: "2026-09-23T05:00:00.000Z",
        reachedType: null,
      },
      kind: "capped",
    });
  });

  // The bar is the register's `pauseAtPercent` (`plans set-thresholds`), not a constant: a fleet held at a
  // lowered bar stands in exactly as one at 99 does, and its sentence names the bar it was judged against.
  it("STANDS IN at the register's own pause bar when the owner has lowered it below 99", () => {
    const decision = prepareOver({
      observations: [
        observation({ alias: "codex-one", gauge: weeklyAt({ usedPercent: 95 }), quota: { refuse: false } }),
      ],
      thresholds: { alertAtPercent: 75, pauseAtPercent: 90 },
    });

    expect(decision).toEqual({
      evidence: {
        blockedBy:
          "no Codex destination can take a pass and none is refusing; 1 of 1 excluded sit at the routing " +
          "pause, which is not a provider cap — " +
          nearCapClause({ alias: "codex-one", pauseAtPercent: 90, usedPercent: 95 }),
        limitId: null,
        observedAtIso: "2026-09-23T05:00:00.000Z",
        reachedType: null,
      },
      kind: "capped",
    });
  });

  // A near-cap row beside a REFUSING one cites the refusal, not the pause: "CAPS a fleet whose other rows sit
  // past the 99% routing pause", above. The falsifier: the same 99% reading whose window has already reset is no pause, so the row routes.
  it("REFUSES once the 99% window's reset has passed, because that row can take the pass again", () => {
    const decision = prepareOver({
      observations: [
        observation({
          alias: "codex-one",
          gauge: weeklyAt({ resetAtIso: "2026-09-23T05:30:00.000Z", usedPercent: 99.5 }),
          quota: { refuse: false },
        }),
      ],
    });

    expect(decision).toEqual({
      detail:
        "codex-one can take a pass — ranked first of 1 on weekly-unmeasured — route the pass there instead of " +
        "spending a Claude fallback",
      kind: "refused",
    });
  });
});
