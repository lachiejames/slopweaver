/*
 * `githubLeg`: one ranked input per pull request — in flight, unverified exactly when its recommendation was
 * unbounded, and shown or suppressed by whether its ask reached a real person.
 */
import { describe, expect, it } from "vitest";

import { githubLeg, SELF_ORIGIN } from "../../../../sessionStart/githubLeg.js";
import { BOT_IDS, mention, NAMES, NOW, REVIEWER, state } from "./fixtures.js";

describe("githubLeg", () => {
  it("produces one input per pull request", () => {
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [state()] });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.item.nativeId).toBe("acme/widgets#7");
  });

  it("marks every row as finishing work already in flight", () => {
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [state()] });
    expect(inputs[0]!.finishesInFlight).toBe(true);
  });

  it("marks a row unverified exactly when its own recommendation was unbounded", () => {
    const unbounded = state({ recommendation: "unknown" });
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [state(), unbounded] });
    expect(inputs[0]!.unverified).toBe(false);
    expect(inputs[1]!.unverified).toBe(true);
  });

  it("shows a pull request whose only ask reached nobody, rather than suppressing it", () => {
    const unreachable = mention({ counterpartId: "", isDirectMessage: true, tagged: [] });
    const withUnreachable = state({
      slack: { asked: "yes", asks: [unreachable], bounded: true, mentioned: "yes", mentions: [unreachable], why: "" },
    });
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [withUnreachable] });
    expect(inputs[0]!.ruleZero.verdict).toBe("show");
    expect(inputs[0]!.item.doneWhen).toBe(
      "Ask a named reviewer in Slack to review acme/widgets#7 — nobody has been asked yet",
    );
  });

  it("suppresses the same pull request once the ask reaches a real person", () => {
    // Falsifies the case above: the only difference is a counterpart a bump could actually be sent to.
    const reachable = mention({
      atIso: "2026-08-31T12:00:00.000Z",
      counterpartId: REVIEWER,
      isDirectMessage: true,
      tagged: [],
    });
    const withReachable = state({
      slack: { asked: "yes", asks: [reachable], bounded: true, mentioned: "yes", mentions: [reachable], why: "" },
    });
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [withReachable] });
    expect(inputs[0]!.ruleZero.verdict).toBe("suppress");
  });

  it("keeps a pull request nobody is ever asked to review on the list as the owner's own move", () => {
    const own = state({ recommendation: "self-merges" });
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [own] });
    expect(inputs[0]!.ruleZero.verdict).toBe("show");
    expect(inputs[0]!.item.who).toBe(SELF_ORIGIN);
  });

  it("reads no pull requests as no inputs rather than as an error", () => {
    expect(githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [] })).toEqual([]);
  });
});
