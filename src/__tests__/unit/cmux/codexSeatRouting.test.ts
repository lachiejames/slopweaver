/**
 * Which registered Codex account a visible seat boots against — `cmux/seatRoute.ts`, pure, over literal
 * rankings.
 *
 * The rankings here are built by hand rather than run through `codex/rank.ts`, on purpose: the ordering is
 * already held down by `unit/codex/rank.test.ts`, and what this file tests is the seat's own three levers —
 * the ranking's first choice, an explicit `--plan`, and what `--force` may and may not re-admit.
 */
import { describe, expect, it } from "vitest";

import { codexHomePrefix, codexSeatModelNote, routeCodexSeat } from "../../../cmux/seatRoute.js";
import { CodexSeatRouteErrors } from "../../../cmux/seatRouteErrors.js";
import type { CodexDestination } from "../../../codex/destinations.js";
import type { CodexPlanRanking, CodexRouteExclusion } from "../../../codex/fleetTypes.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** A destination, named the way the register names one. */
function destination({ alias }: { alias: string }): CodexDestination {
  return { alias, codexHome: `/tmp/${alias}/.codex` };
}

/** An exclusion of one kind, carrying the reason a reader would be shown. */
function exclusion({ alias, kind }: { alias: string; kind: CodexRouteExclusion["kind"] }): CodexRouteExclusion {
  return { destination: destination({ alias }), kind, reason: `${kind} because the test said so` };
}

/** A ranking, with everything the seat does not read defaulted. */
function ranking({
  excluded = [],
  ranked = [],
}: {
  excluded?: readonly CodexRouteExclusion[];
  ranked?: readonly CodexDestination[];
}): CodexPlanRanking {
  return { basis: "weekly", deferredUnmeasured: [], excluded, ranked };
}

describe("routing a visible Codex seat", () => {
  it("takes the ranking's first choice and says so", () => {
    const routed = routeCodexSeat({
      allowRefusing: false,
      ranking: ranking({ ranked: [destination({ alias: "plan-six" }), destination({ alias: "plan-seven" })] }),
      requestedAlias: undefined,
    });

    expect(unwrap(routed).destination.alias).toBe("plan-six");
    expect(unwrap(routed).destination.codexHome).toBe("/tmp/plan-six/.codex");
    expect(unwrap(routed).why).toBe("ranked first of 2 eligible destination(s), on weekly");
  });

  it("honours an explicit --plan over the ranking's own first choice", () => {
    const routed = routeCodexSeat({
      allowRefusing: false,
      ranking: ranking({ ranked: [destination({ alias: "plan-six" }), destination({ alias: "plan-seven" })] }),
      requestedAlias: "plan-seven",
    });

    expect(unwrap(routed).destination.alias).toBe("plan-seven");
    expect(unwrap(routed).why).toBe("--plan plan-seven named it explicitly");
  });

  it("refuses a --plan no Codex row carries, and names every alias that IS registered", () => {
    const routed = routeCodexSeat({
      allowRefusing: false,
      ranking: ranking({
        excluded: [exclusion({ alias: "plan-eight", kind: "paused" })],
        ranked: [destination({ alias: "plan-six" })],
      }),
      requestedAlias: "plan-nine",
    });

    expect(unwrapErr(routed).code).toBe("PLAN_NOT_REGISTERED");
    expect(unwrapErr(routed).message).toContain("plan-six, plan-eight");
  });

  it("refuses a --plan that names a PAUSED row, and --force does not re-admit it", () => {
    const paused = ranking({ excluded: [exclusion({ alias: "plan-eight", kind: "paused" })] });

    const plain = routeCodexSeat({ allowRefusing: false, ranking: paused, requestedAlias: "plan-eight" });
    const forced = routeCodexSeat({ allowRefusing: true, ranking: paused, requestedAlias: "plan-eight" });

    expect(unwrapErr(plain).code).toBe("PLAN_UNAVAILABLE");
    // The owner's own standing decision, and `--force`'s documented job is the quota fast-fail, not this.
    expect(unwrapErr(forced).code).toBe("PLAN_UNAVAILABLE");
    expect(unwrapErr(forced).message).toContain("paused");
  });

  it("re-admits a REFUSING destination under --force, and never without it", () => {
    const refusing = ranking({ excluded: [exclusion({ alias: "plan-six", kind: "quota-refused" })] });

    const plain = routeCodexSeat({ allowRefusing: false, ranking: refusing, requestedAlias: undefined });
    const forced = routeCodexSeat({ allowRefusing: true, ranking: refusing, requestedAlias: undefined });

    expect(unwrapErr(plain).code).toBe("EVERY_DESTINATION_UNAVAILABLE");
    expect(unwrap(forced).destination.alias).toBe("plan-six");
    expect(unwrap(forced).why).toContain("--force put this seat on plan-six past its own quota-refused exclusion");
  });

  it("re-admits a NEAR-CAP destination under --force, by name and as the fallback, never without it", () => {
    const nearCap = ranking({ excluded: [exclusion({ alias: "plan-six", kind: "near-cap" })] });

    const plain = routeCodexSeat({ allowRefusing: false, ranking: nearCap, requestedAlias: "plan-six" });
    const named = routeCodexSeat({ allowRefusing: true, ranking: nearCap, requestedAlias: "plan-six" });
    const fallback = routeCodexSeat({ allowRefusing: true, ranking: nearCap, requestedAlias: undefined });

    expect(unwrapErr(plain).code).toBe("PLAN_UNAVAILABLE");
    expect(unwrap(named).destination.alias).toBe("plan-six");
    expect(unwrap(fallback).why).toContain("--force put this seat on plan-six past its own near-cap exclusion");
  });

  it("refuses when every destination is paused, even under --force", () => {
    const allPaused = ranking({
      excluded: [exclusion({ alias: "plan-six", kind: "paused" }), exclusion({ alias: "plan-seven", kind: "paused" })],
    });

    const forced = routeCodexSeat({ allowRefusing: true, ranking: allPaused, requestedAlias: undefined });

    expect(unwrapErr(forced).code).toBe("EVERY_DESTINATION_UNAVAILABLE");
    expect(unwrapErr(forced).message).toContain("plan-six (paused:");
    expect(unwrapErr(forced).message).toContain("plan-seven (paused:");
  });

  // A limit the owner sets is respected even if it means taking the fleet down. Both owner
  // settings behave exactly as a pause does — the near-cap case above, with --force re-admitting, is the falsifier.
  it.each(["usage-limit", "not-measured"] as const)(
    "never re-admits a %s row, by --plan or as the --force fallback",
    (kind) => {
      const held = ranking({ excluded: [exclusion({ alias: "plan-six", kind })] });

      const named = routeCodexSeat({ allowRefusing: false, ranking: held, requestedAlias: "plan-six" });
      const namedForced = routeCodexSeat({ allowRefusing: true, ranking: held, requestedAlias: "plan-six" });
      const fallbackForced = routeCodexSeat({ allowRefusing: true, ranking: held, requestedAlias: undefined });

      expect(unwrapErr(named)).toEqual(CodexSeatRouteErrors.planUnavailable({ exclusion: held.excluded[0]! }));
      expect(unwrapErr(namedForced)).toEqual(CodexSeatRouteErrors.planUnavailable({ exclusion: held.excluded[0]! }));
      expect(unwrapErr(fallbackForced)).toEqual(
        CodexSeatRouteErrors.everyDestinationUnavailable({ exclusions: held.excluded }),
      );
    },
  );

  it("refuses an empty register with the verb that fixes it, not with a stand-in destination", () => {
    const routed = routeCodexSeat({ allowRefusing: true, ranking: ranking({}), requestedAlias: undefined });

    expect(unwrapErr(routed).code).toBe("NO_CODEX_DESTINATION");
    expect(unwrapErr(routed).message).toContain("slopweaver plans add --provider codex");
  });

  // `error-handling.md` § Tests: a fixture is built by the domain's own factory, so a factory that stops
  // matching the union the router returns reddens here rather than in whatever reads `.code` next.
  it("returns exactly what the domain's own factory builds, field for field", () => {
    const excluded = [exclusion({ alias: "plan-six", kind: "paused" })];

    const routed = routeCodexSeat({ allowRefusing: true, ranking: ranking({ excluded }), requestedAlias: undefined });

    expect(unwrapErr(routed)).toEqual(CodexSeatRouteErrors.everyDestinationUnavailable({ exclusions: excluded }));
  });

  it("carries the excluded destination on the typed error, not only inside its message", () => {
    const registered = ["plan-six"];

    const built = CodexSeatRouteErrors.planNotRegistered({ alias: "plan-nine", registered });

    expect(built.alias).toBe("plan-nine");
    expect(built.registered).toEqual(registered);
    expect(built.code).toBe("PLAN_NOT_REGISTERED");
  });
});

describe("what a routed seat's boot line carries", () => {
  it("names the routed home as an environment prefix", () => {
    expect(codexHomePrefix({ codexHome: "/Users/x/.codex-six" })).toBe("CODEX_HOME=/Users/x/.codex-six ");
  });

  it("quotes a home carrying a space, so the prefix cannot become the command", () => {
    expect(codexHomePrefix({ codexHome: "/Users/x/my codex" })).toBe("CODEX_HOME='/Users/x/my codex' ");
  });

  it("carries no prefix at all when nothing routed the seat", () => {
    expect(codexHomePrefix({ codexHome: undefined })).toBe("");
  });

  it("says out loud that a Claude tier does not reach the Codex boot line", () => {
    const note = codexSeatModelNote({ requestedModel: "opus" });

    expect(note).toContain("--model opus names a Claude tier");
    expect(note).toContain(CODEX_MODEL);
  });

  it("says nothing when the pinned model names no Claude tier", () => {
    expect(codexSeatModelNote({ requestedModel: CODEX_MODEL })).toBeUndefined();
  });
});
