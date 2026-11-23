import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { placementFor, reasonFor } from "../../../cli/commands/workstreams/reactPlacement.js";
import { endingFor } from "../../../workstreams/placePick.js";
import { emptyPlan, marksOn } from "../../../workstreams/planSoFar.js";

import { registerWorkstreams } from "./registerWorkstreamsFixture.js";

const YES = { candidate: "c-001", reaction: "yes" } as const;
const ABANDONED = { candidate: "c-002", reaction: "abandoned" } as const;

describe("reasonFor", () => {
  it("takes the one abandoned pick's reason, and refuses one without its anchor or with a second abandoned", () => {
    expect(unwrap(reasonFor({ anchorFlag: "talk:x", picks: [ABANDONED], reasonFlag: "previews died" }))).toBe(
      "previews died",
    );
    expect(unwrapErr(reasonFor({ anchorFlag: undefined, picks: [ABANDONED], reasonFlag: "why" })).line).toBe(
      "an abandoned word needs --anchor: where the owner said it",
    );
    const two = [ABANDONED, { candidate: "c-003", reaction: "abandoned" } as const];
    expect(unwrapErr(reasonFor({ anchorFlag: "a", picks: two, reasonFlag: "r" })).line).toBe(
      "one abandoned candidate per call, so its reason is its own — got c-002, c-003",
    );
  });

  it("refuses a reason on a word that carries none", () => {
    expect(unwrapErr(reasonFor({ anchorFlag: undefined, picks: [YES], reasonFlag: "because" })).line).toBe(
      "--reason goes with one abandoned, done, milestone-of, outcome-of, superseded or no word, so the reason is its own",
    );
  });
});

describe("placementFor", () => {
  it("keeps a steer on one yes, and refuses a placing flag shared by two picks or a naming word with no target", () => {
    expect(unwrap(placementFor({ picks: [YES], values: { steer: "ratchet everything" } })).steer).toBe(
      "ratchet everything",
    );
    const twoYes = [YES, { candidate: "c-002", reaction: "yes" } as const];
    expect(unwrapErr(placementFor({ picks: twoYes, values: { steer: "s" } })).line).toBe(
      "--steer goes with one yes word, so what it names is its own",
    );
    const sameAs = [{ candidate: "c-001", reaction: "same-as" } as const];
    expect(unwrapErr(placementFor({ picks: sameAs, values: {} })).line).toBe(
      "a same-as word needs --same-as <register id>: the workstream it names",
    );
  });
});

describe("the plan accumulator", () => {
  it("starts with every register id taken, and starts one workstream's marks once", () => {
    const so = emptyPlan({ workstreams: registerWorkstreams() });
    expect([...so.taken]).toEqual(["merge-gate", "logs-scrub", "deps", "iso-controls", "the-tool", "old-thing"]);
    const first = marksOn({ id: "x", so });
    expect([marksOn({ id: "x", so }) === first, so.marks.size]).toEqual([true, 1]);
  });
});

describe("endingFor", () => {
  it("dates an abandoned word's ending by its day, writes none for another word, and refuses a gap", () => {
    const asked = { anchor: "talk:y", candidate: "c-002", nowIso: "2026-10-03T05:00:00.000Z", reason: "dead" };
    expect(unwrap(endingFor({ ...asked, reaction: "abandoned" }))).toEqual({
      anchor: "talk:y",
      kind: "abandoned",
      on: "2026-10-03",
      reason: "dead",
    });
    expect(unwrap(endingFor({ ...asked, reaction: "yes" }))).toBe(null);
    expect(unwrapErr(endingFor({ ...asked, anchor: null, reaction: "abandoned" })).message).toContain(
      "c-002 is abandoned, which needs why (--reason) and where the owner said it (--anchor)",
    );
  });
});
