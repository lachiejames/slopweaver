/** A seat's constants: written once, validated both ways, and refused in a directory they do not belong to. */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { handoffOfDir, newTickSeat, parseTickSeat } from "../../../supervisor/tickSeat.js";

const SEAT = {
  handoff: "handoff-9292",
  landingRepos: ["lachiejames/slopweaver"],
  loopSessionKey: "live-loop-a",
  model: "fable",
  pinnedAtIso: "2026-09-23T14:36:00Z",
  workspace: "workspace:93",
};

describe("handoffOfDir", () => {
  it("reads the handoff off a directory named for one", () => {
    expect(handoffOfDir({ dir: "/s/supervisor-scratch/handoff-9292" })).toBe("handoff-9292");
  });

  it("says nothing for a directory that is not", () => {
    expect(handoffOfDir({ dir: "/s/supervisor-scratch/scratch" })).toBe(undefined);
  });
});

describe("newTickSeat / parseTickSeat", () => {
  it("writes a document that reads back", () => {
    const seat = unwrap(newTickSeat({ dir: "/s/handoff-9292", path: "/s/handoff-9292/seat.json", seat: SEAT }));

    expect(unwrap(parseTickSeat({ dir: "/s/handoff-9292", path: "p", value: seat }))).toEqual({
      ...SEAT,
      schemaVersion: 1,
    });
  });

  it("refuses a seat file carried into another seat's directory", () => {
    const seat = unwrap(newTickSeat({ dir: "/s/handoff-9292", path: "p", seat: SEAT }));

    const parsed = parseTickSeat({ dir: "/s/handoff-9293", path: "/s/handoff-9293/seat.json", value: seat });

    expect(parsed._unsafeUnwrapErr().message).toContain("names handoff-9292 but sits in handoff-9293's directory");
  });

  it("names every bad field", () => {
    const parsed = newTickSeat({ dir: "/s/x", path: "p", seat: { ...SEAT, landingRepos: ["nope"], workspace: "93" } });

    expect(parsed._unsafeUnwrapErr().message).toContain(
      "landingRepos.0: must be an owner/name slug; workspace: must be workspace:<digits>",
    );
  });
});
