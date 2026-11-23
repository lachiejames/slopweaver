/**
 * Whether a routed Codex account may be spent — the preflight every consumer shares (`codex/seatDecision.ts`) and
 * the exhaustion a booted seat records (`cli/commands/cmux/codexQuotaSeat.ts`) — over a real throwaway home, per
 * testing.md's fixture allowance.
 *
 * What these hold down is the PAIR: the record a caught exhaustion writes must be the one the next
 * preflight reads, and it must be keyed to the DESTINATION that hit it. Split across two call sites they
 * could drift onto different accounts — a seat would then boot straight into an account it had just watched
 * refuse, or refuse an account that never hit anything.
 *
 * The owner's own settings — a usage limit, an unmeasured monthly allowance — are checked BEFORE
 * `allowRefusing`'s early return, so these cases also hold down that no flag crosses either one.
 *
 * The old preflight's "a Claude seat is never refused on a Codex exhaustion" case went with its `resolvedDriver`
 * parameter: the shared preflight is asked only for a Codex seat, so it has no driver to branch on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { codexQuotaDecision, recordCodexSeatExhaustion } from "../../../cli/commands/cmux/codexQuotaSeat.js";
import type { CodexDestination } from "../../../codex/destinations.js";
import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import { codexSeatPreflightRefusal } from "../../../codex/seatDecision.js";
import {
  CODEX_MONTHLY_SPEND_NOT_MEASURED,
  type PlanAllowanceKind,
  type UsageLimitPercent,
} from "../../../plans/usageLimit.js";
import { unreadableLive } from "../../codexLiveFake.js";

const NOW = "2026-09-22T12:00:00.000Z";
const WEEK_RESETS = "2026-09-25T12:00:00.000Z";

/** The live read that did not happen — these cases decide exactly as they did before it existed. */
const NO_LIVE = unreadableLive({ codexHome: "/stores/unread", readAtIso: NOW });
const CAUGHT_AT = "2026-09-22T11:30:00.000Z";

const homes: string[] = [];

/**
 * A destination on an empty throwaway `$CODEX_HOME`, so no case here reads the operator's real rollout log —
 * a verdict that depended on whether THIS machine is capped would be a different test on every run.
 */
function quietDestination({ alias }: { alias: string }): CodexDestination {
  const dir = mkdtempSync(join(tmpdir(), "codex-seat-rollout-"));
  homes.push(dir);
  return { alias, codexHome: dir };
}

/** A throwaway state home this file removes after every test. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "codex-seat-"));
  homes.push(home);
  return home;
}

/** A reading whose weekly window stands at the given percentage, observed before {@link NOW}. */
function weeklyGauge({ usedPercent }: { usedPercent: number }): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso: CAUGHT_AT,
    planType: "pro",
    reached: undefined,
    reachedType: undefined,
    windows: [{ label: "weekly", resetAtIso: WEEK_RESETS, slot: "primary", usedPercent, windowMinutes: 10080 }],
  };
}

/** The selected destination's observation: a weekly-window row at the house bar, unless told otherwise. */
function observationOf({
  allowance = "weekly-window",
  destination,
  gauge,
  usageLimitPercent = 100,
}: {
  allowance?: PlanAllowanceKind;
  destination: CodexDestination;
  gauge?: CodexGauge;
  usageLimitPercent?: UsageLimitPercent;
}): CodexPlanObservation {
  return {
    destination,
    gauge,
    gaugeSource: gauge === undefined ? "none" : "live",
    live: NO_LIVE,
    plan: {
      alias: destination.alias,
      allowance: { kind: allowance },
      provider: "codex",
      storeDir: destination.codexHome,
      usageLimitPercent,
    },
    quota: { refuse: false },
    scan: { filesRead: 0, filesSkipped: 0, filesUnreadable: 0, gauge },
  };
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("the codex seat's quota gate", () => {
  it("passes a home where nothing has ever been recorded", () => {
    const decision = codexQuotaDecision({
      destination: quietDestination({ alias: "plan-six" }),
      home: tempHome(),
      live: NO_LIVE,
      nowIso: NOW,
    });

    expect(decision.refuse).toBe(false);
  });

  it("refuses the next preflight on the exhaustion a booted seat just caught", () => {
    const home = tempHome();
    const destination = quietDestination({ alias: "plan-six" });

    expect(recordCodexSeatExhaustion({ destination, home, kind: "credits-out", observedAtIso: CAUGHT_AT })).toBe(true);

    const refusal = codexSeatPreflightRefusal({
      allowRefusing: false,
      home,
      nowIso: NOW,
      observation: observationOf({ destination }),
    });
    expect(refusal).toContain("credits");
  });

  it("refuses only the destination that hit the cap, never its neighbour on the same register", () => {
    const home = tempHome();
    const capped = quietDestination({ alias: "plan-six" });
    const untouched = quietDestination({ alias: "plan-seven" });
    recordCodexSeatExhaustion({ destination: capped, home, kind: "credits-out", observedAtIso: CAUGHT_AT });

    // The capped one is the witness: without it, an empty home would answer `false` for both and this case
    // would pass against code that ignored the destination entirely.
    expect(codexQuotaDecision({ destination: capped, home, live: NO_LIVE, nowIso: NOW }).refuse).toBe(true);
    expect(codexQuotaDecision({ destination: untouched, home, live: NO_LIVE, nowIso: NOW }).refuse).toBe(false);
  });

  it("lets allowRefusing (a spawn's --force) through the same standing exhaustion, once", () => {
    const home = tempHome();
    const destination = quietDestination({ alias: "plan-six" });
    recordCodexSeatExhaustion({ destination, home, kind: "credits-out", observedAtIso: CAUGHT_AT });

    const forced = codexSeatPreflightRefusal({
      allowRefusing: true,
      home,
      nowIso: NOW,
      observation: observationOf({ destination }),
    });
    // The same destination and the same record: only the flag differs, so the refusal above is what makes
    // this absence evidence rather than an empty home answering.
    expect(forced).toBeUndefined();
    expect(codexQuotaDecision({ destination, home, live: NO_LIVE, nowIso: NOW }).refuse).toBe(true);
  });
});

// An owner ruling: a limit the owner sets is respected even if it means taking the fleet down. The forced
// case above is the falsifier — the same flag that passes a provider exhaustion passes neither of these.
describe("the owner's own settings, which no --force crosses", () => {
  it("refuses a weekly row standing at its usage limit, forced and not", () => {
    const destination = quietDestination({ alias: "plan-six" });
    const observation = observationOf({ destination, gauge: weeklyGauge({ usedPercent: 30 }), usageLimitPercent: 30 });

    const refusals = [false, true].map((allowRefusing) =>
      codexSeatPreflightRefusal({ allowRefusing, home: tempHome(), nowIso: NOW, observation }),
    );

    const expected =
      `plan-six is excluded (usage-limit): weekly window at 30% used, at this plan's 30% usage limit ` +
      `(it resets ${WEEK_RESETS}) — the owner's own limit, not provider cap evidence, and no --force crosses it`;
    expect(refusals).toEqual([expected, expected]);
  });

  it("passes the same reading on a row whose limit sits above it", () => {
    const destination = quietDestination({ alias: "plan-six" });

    const refusal = codexSeatPreflightRefusal({
      allowRefusing: false,
      home: tempHome(),
      nowIso: NOW,
      observation: observationOf({ destination, gauge: weeklyGauge({ usedPercent: 30 }), usageLimitPercent: 40 }),
    });

    expect(refusal).toBeUndefined();
  });

  // A limit set above a lowered pause bar is still the owner's, so --force crosses
  // the bar (85%) and never the limit (92%). The 85% case is the falsifier: the same flag on the same row passes.
  it("refuses a forced 92% week on a 90 row and passes a forced 85% one, whatever the pause bar", () => {
    const destination = quietDestination({ alias: "plan-six" });
    const forced = ({ usedPercent }: { usedPercent: number }): string | undefined =>
      codexSeatPreflightRefusal({
        allowRefusing: true,
        home: tempHome(),
        nowIso: NOW,
        observation: observationOf({ destination, gauge: weeklyGauge({ usedPercent }), usageLimitPercent: 90 }),
      });

    expect(forced({ usedPercent: 92 })).toBe(
      `plan-six is excluded (usage-limit): weekly window at 92% used, at this plan's 90% usage limit ` +
        `(it resets ${WEEK_RESETS}) — the owner's own limit, not provider cap evidence, and no --force crosses it`,
    );
    expect(forced({ usedPercent: 85 })).toBeUndefined();
  });

  it("refuses a monthly-spend row as NOT MEASURED, forced and not, even on an empty gauge", () => {
    const destination = quietDestination({ alias: "plan-six" });
    const observation = observationOf({ allowance: "monthly-spend", destination });

    const refusals = [false, true].map((allowRefusing) =>
      codexSeatPreflightRefusal({ allowRefusing, home: tempHome(), nowIso: NOW, observation }),
    );

    const expected = `plan-six is excluded (not-measured): ${CODEX_MONTHLY_SPEND_NOT_MEASURED}`;
    expect(refusals).toEqual([expected, expected]);
  });
});
