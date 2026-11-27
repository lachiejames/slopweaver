/**
 * The Codex half of a session's recorded plan choice — `codex/seatPlanChoice.ts`, and the route that carries it
 * (`cmux/seatRoute.ts`). Rankings are literal, as in `unit/cmux/codexSeatRouting.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { routeCodexSeat } from "../../../cmux/seatRoute.js";
import type { CodexDestination } from "../../../codex/destinations.js";
import type { CodexPlanRanking, CodexRouteExclusion } from "../../../codex/fleetTypes.js";
import { rankedCodexChoice, resumedCodexChoice } from "../../../codex/seatPlanChoice.js";
import { unwrap } from "../../../lib/result.js";
import { planChoiceLine } from "../../../sessions/planChoice.js";

const ALTERNATIVE = "--plan <alias> names another Codex plan; omit --plan to take the ranked best";

function destination({ alias }: { alias: string }): CodexDestination {
  return { alias, codexHome: `/tmp/${alias}/.codex` };
}

/** An exclusion whose free-text reason carries a home path and an address, as a signed-out row's can. */
function exclusion({ alias, kind }: { alias: string; kind: CodexRouteExclusion["kind"] }): CodexRouteExclusion {
  return {
    destination: destination({ alias }),
    kind,
    reason: `run CODEX_HOME=/tmp/${alias}/.codex codex login as seat-1@example.test`,
  };
}

const RANKING: CodexPlanRanking = {
  basis: "weekly",
  deferredUnmeasured: [],
  excluded: [
    exclusion({ alias: "plan-eight", kind: "paused" }),
    exclusion({ alias: "plan-nine", kind: "quota-refused" }),
  ],
  ranked: [destination({ alias: "plan-six" }), destination({ alias: "plan-seven" })],
};

describe("rankedCodexChoice", () => {
  it("records the ranked best, the other eligible plan and every exclusion by its kind, each once", () => {
    expect(rankedCodexChoice({ alias: "plan-six", basis: "routed", forced: false, ranking: RANKING })).toStrictEqual({
      alias: "plan-six",
      basis: "routed",
      kind: "named",
      alternative: ALTERNATIVE,
      readings: [
        { alias: "plan-six", reading: "ranked 1 of 2 eligible, on weekly", state: "chosen" },
        { alias: "plan-seven", reading: "ranked 2 of 2 eligible, on weekly", state: "eligible" },
        { alias: "plan-eight", reading: "paused", state: "excluded" },
        { alias: "plan-nine", reading: "quota-refused", state: "excluded" },
      ],
      reason: "ranked first of 2 eligible destination(s), on weekly",
      vendor: "codex",
    });
  });

  it("marks a forced plan chosen among the exclusions and says --force crossed it", () => {
    const choice = rankedCodexChoice({ alias: "plan-nine", basis: "requested", forced: true, ranking: RANKING });
    expect(planChoiceLine({ choice })).toBe(
      "plan: plan-nine (codex, requested) — --plan named it; --force put the seat past its own exclusion; readings: " +
        "plan-six eligible (ranked 1 of 2 eligible, on weekly), plan-seven eligible (ranked 2 of 2 eligible, on weekly), " +
        "plan-eight excluded (paused), plan-nine chosen (quota-refused, crossed by --force); " +
        `alternative: ${ALTERNATIVE}`,
    );
  });

  it("never copies an exclusion's free-text reason, which can carry a home path or an address", () => {
    const json = JSON.stringify(
      rankedCodexChoice({ alias: "plan-six", basis: "routed", forced: false, ranking: RANKING }),
    );
    // The witness: the input carries both.
    expect(RANKING.excluded[0]!.reason).toContain("/tmp/plan-eight/.codex");
    expect(RANKING.excluded[0]!.reason).toContain("seat-1@example.test");
    expect(json).not.toContain("/tmp/");
    expect(json).not.toContain("seat-1@example.test");
  });
});

describe("resumedCodexChoice", () => {
  it("records a resume as kept on its recorded plan, never ranked", () => {
    expect(planChoiceLine({ choice: resumedCodexChoice({ alias: "plan-seven" }) })).toBe(
      "plan: plan-seven (codex, resumed) — the session resumes on the plan it was opened on, since its transcript " +
        "lives under that home; readings: plan-seven chosen (the plan its session was opened on, admitted by the seat " +
        "preflight); alternative: a resume stays on its recorded plan; open a fresh session to route again",
    );
  });
});

describe("routeCodexSeat carries the choice it decided on", () => {
  it("records a routed seat as routed", () => {
    const routed = unwrap(routeCodexSeat({ allowRefusing: false, ranking: RANKING, requestedAlias: undefined }));
    expect(routed.choice).toStrictEqual(
      rankedCodexChoice({ alias: "plan-six", basis: "routed", forced: false, ranking: RANKING }),
    );
  });

  it("records a --plan seat as requested", () => {
    const routed = unwrap(routeCodexSeat({ allowRefusing: false, ranking: RANKING, requestedAlias: "plan-seven" }));
    expect(routed.choice).toStrictEqual(
      rankedCodexChoice({ alias: "plan-seven", basis: "requested", forced: false, ranking: RANKING }),
    );
  });

  it("records a --plan seat --force re-admitted as requested and forced", () => {
    const routed = unwrap(routeCodexSeat({ allowRefusing: true, ranking: RANKING, requestedAlias: "plan-nine" }));
    expect(routed.destination.alias).toBe("plan-nine");
    expect(routed.choice).toStrictEqual(
      rankedCodexChoice({ alias: "plan-nine", basis: "requested", forced: true, ranking: RANKING }),
    );
  });
});
