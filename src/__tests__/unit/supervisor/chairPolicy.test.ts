/**
 * The chair policy — which model a lane read requires of the chair, whether the sweep re-arms on a timer, and how
 * one session's verdict is judged against the requirement. Every lane is synthetic (`../plans/laneFixtures.ts`).
 */
import { describe, expect, it } from "vitest";

import type { LaneShapeRead } from "../../../plans/laneShape.js";
import type { ChairVerdict } from "../../../supervisor/chairModel.js";
import {
  chairModelAlias,
  chairModelLabel,
  chairRequirement,
  FABLE_CHAIR_REQUIREMENT,
  restoreCommandFor,
  sweepArmDecision,
  verdictAgainst,
} from "../../../supervisor/chairPolicy.js";
import { FILL_LANES, FILL_SHAPES, LEAN_LANES, lane } from "../plans/laneFixtures.js";

/** The Claude lane in the given mode, Codex filling. */
function claudeIn({ mode }: { mode: "unavailable" | "unregistered" }): LaneShapeRead {
  return { kind: "current", shapes: { ...FILL_SHAPES, claude: lane({ host: "claude", mode, standingPlans: 0 }) } };
}

const UNREADABLE: LaneShapeRead = { kind: "unreadable", why: "the plan register could not be read (x)" };

const ON_FABLE: ChairVerdict = { atIso: "2026-11-21T09:00:00.000Z", kind: "on-fable", model: "claude-fable-5-1" };
const ON_OPUS: ChairVerdict = {
  atIso: "2026-11-21T09:00:00.000Z",
  fallback: undefined,
  kind: "off-fable",
  model: "claude-opus-4-8",
};
const ON_SONNET: ChairVerdict = {
  atIso: "2026-11-21T09:00:00.000Z",
  fallback: undefined,
  kind: "off-fable",
  model: "claude-sonnet-5",
};

describe("chairRequirement", () => {
  it("holds the chair to Fable while more than one Claude plan stands", () => {
    expect(chairRequirement({ lanes: FILL_LANES })).toStrictEqual(FABLE_CHAIR_REQUIREMENT);
  });

  it("moves the chair to Opus once exactly one Claude plan stands", () => {
    expect(chairRequirement({ lanes: LEAN_LANES })).toStrictEqual({
      kind: "claude",
      model: "opus",
      why: "exactly one Claude plan stands, so the chair runs lean",
    });
  });

  it("names no Claude chair valid when registered Claude plans exist and none stands", () => {
    expect(chairRequirement({ lanes: claudeIn({ mode: "unavailable" }) })).toStrictEqual({
      kind: "claude-unavailable",
      why: "no Claude plan stands, so no Claude chair is valid",
    });
  });

  it("keeps Fable on a lane with no row and on an unreadable register — nothing switches on silence", () => {
    expect(chairRequirement({ lanes: claudeIn({ mode: "unregistered" }) })).toStrictEqual({
      kind: "claude",
      model: "fable",
      why: "no Claude plan is registered, so today's rule holds",
    });
    expect(chairRequirement({ lanes: UNREADABLE })).toStrictEqual({
      kind: "claude",
      model: "fable",
      why: "the plan register is unread, so today's rule holds: the plan register could not be read (x)",
    });
  });
});

describe("sweepArmDecision", () => {
  it("wakes on events only on a lean Claude lane", () => {
    expect(sweepArmDecision({ lanes: LEAN_LANES })).toStrictEqual({
      kind: "event-woken",
      why:
        "exactly one Claude plan stands, so the chair runs lean: no timer sweep is armed, and it wakes on the " +
        "owner's next turn or a seat's message",
    });
  });

  it("arms the timer on fill, an unavailable or unregistered lane, an unreadable register and no read at all", () => {
    const reads = [
      FILL_LANES,
      claudeIn({ mode: "unavailable" }),
      claudeIn({ mode: "unregistered" }),
      UNREADABLE,
      undefined,
    ];

    expect(reads.map((lanes) => sweepArmDecision({ lanes }).kind)).toStrictEqual([
      "armed",
      "armed",
      "armed",
      "armed",
      "armed",
    ]);
  });
});

describe("verdictAgainst", () => {
  it("passes exactly the required family and refuses the other, Fable under lean included", () => {
    expect(verdictAgainst({ model: "fable", verdict: ON_FABLE })).toBe("meets");
    expect(verdictAgainst({ model: "fable", verdict: ON_OPUS })).toBe("violates");
    expect(verdictAgainst({ model: "opus", verdict: ON_OPUS })).toBe("meets");
    expect(verdictAgainst({ model: "opus", verdict: ON_FABLE })).toBe("violates");
  });

  it("refuses a model of neither family under either requirement", () => {
    expect(verdictAgainst({ model: "opus", verdict: ON_SONNET })).toBe("violates");
    expect(verdictAgainst({ model: "fable", verdict: ON_SONNET })).toBe("violates");
  });

  it("reads an unreadable transcript as unread, never as a pass", () => {
    expect(verdictAgainst({ model: "opus", verdict: { kind: "unreadable", why: "no transcript" } })).toBe("unread");
  });
});

describe("the words for a family", () => {
  it("types an alias, labels it, and spawns with the same alias", () => {
    expect(restoreCommandFor({ model: "opus" })).toBe("/model opus");
    expect(chairModelLabel({ model: "opus" })).toBe("Opus");
    expect(chairModelAlias({ model: "opus" })).toBe("opus");
    expect(chairModelLabel({ model: "fable" })).toBe("Fable");
  });
});
