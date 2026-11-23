/*
 * `prRuleZero`: whether a row is shown, suppressed or chased — on a stack, where the reason names the bottom it
 * waits on, and against the silence threshold for a named reviewer.
 */
import { describe, expect, it } from "vitest";

import { githubLeg, prRuleZero } from "../../../../sessionStart/githubLeg.js";
import { prReadings } from "../../../../sessionStart/githubLegReadings.js";
import { BOT_IDS, bottomOfSix, mention, NAMES, NOW, sixthOfSix, state } from "./fixtures.js";

describe("prRuleZero on a stack", () => {
  it("suppresses a stacked pull request, and the reason names the bottom it waits on", () => {
    const whose = { ownerAlreadyActed: true, party: "nobody" } as const;
    const decision = prRuleZero({ botIds: BOT_IDS, nowIso: NOW, state: sixthOfSix(), whose });
    expect(decision.verdict).toBe("suppress");
    expect(decision.reason).toBe(
      "stacked — waiting on acme/widgets#16415, the bottom of its stack, landing; never a review ask until it targets staging",
    );
  });

  it("scores a stacked pull request furthest from done, because nothing on it can move yet", () => {
    const whose = { ownerAlreadyActed: true, party: "nobody" } as const;
    expect(prReadings({ nowIso: NOW, state: sixthOfSix(), whose }).distanceToDone).toBe(1);
  });

  it("drops the stacked row from the leg's inputs as suppressed, and keeps the bottom row as shown", () => {
    const inputs = githubLeg({ botIds: BOT_IDS, namesById: NAMES, nowIso: NOW, states: [sixthOfSix(), bottomOfSix()] });
    expect(inputs.map((input) => [input.item.nativeId, input.ruleZero.verdict])).toEqual([
      ["acme/widgets#16355", "suppress"],
      ["acme/widgets#16415", "show"],
    ]);
    expect(inputs[0]!.item.state).toBe("stacked");
  });
});

describe("prRuleZero", () => {
  it("shows a pull request nobody has been asked about", () => {
    const noAsks = state({ slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" } });
    const decision = prRuleZero({
      botIds: BOT_IDS,
      nowIso: NOW,
      state: noAsks,
      whose: { ownerAlreadyActed: false, party: "nobody" },
    });
    expect(decision.verdict).toBe("show");
    expect(decision.reason).toBe("nobody has been asked yet");
  });

  it("suppresses one a named reviewer has had for less than the threshold", () => {
    const asked = mention({ atIso: "2026-08-31T12:00:00.000Z" });
    const recent = state({
      slack: { asked: "yes", asks: [asked], bounded: true, mentioned: "yes", mentions: [asked], why: "" },
    });
    const decision = prRuleZero({
      botIds: BOT_IDS,
      nowIso: NOW,
      state: recent,
      whose: { party: "other", who: "A Colleague" },
    });
    expect(decision.verdict).toBe("suppress");
  });

  it("chases once the named reviewer has been silent past the threshold", () => {
    const asked = mention({ atIso: "2026-08-25T00:00:00.000Z" });
    const stale = state({
      slack: { asked: "yes", asks: [asked], bounded: true, mentioned: "yes", mentions: [asked], why: "" },
    });
    const decision = prRuleZero({
      botIds: BOT_IDS,
      nowIso: NOW,
      state: stale,
      whose: { party: "other", who: "A Colleague" },
    });
    expect(decision.verdict).toBe("chase");
    expect(decision.chase).toBe("A Colleague");
  });
});
