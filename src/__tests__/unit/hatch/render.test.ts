import { describe, expect, it } from "vitest";
import { hatchFor } from "../../../hatch/lookup.js";
import { exceptionClause, hatchRefusal, hatchRefusalLines, JUDGEMENT_NOTE } from "../../../hatch/render.js";
import type { EscapeHatch } from "../../../hatch/types.js";

const HATCH: EscapeHatch = {
  caught: "the same target was polled 12s ago",
  command: "reading that log again",
  exceptions: ["the first read was truncated", "an external system changed in between"],
  id: "poll",
  key: { kind: "env", variable: "SLOPWEAVER_ALLOW_POLL" },
  lane: "ambient",
  reader: "src/admit/pollGate.ts",
  standing: "proposed",
};

describe("the refusal shape", () => {
  it("emits the owner's four lines, in their order", () => {
    expect(hatchRefusalLines({ hatch: HATCH })).toEqual([
      "reading that log again blocked because the same target was polled 12s ago.",
      "Legitimate exceptions may include the first read was truncated; an external system changed in between.",
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_POLL=1 reading that log again.",
      JUDGEMENT_NOTE,
    ]);
  });

  it("prints an ambient command key's incantation alone, since it is already the whole command", () => {
    const hatch: EscapeHatch = {
      ...HATCH,
      command: "slopweaver claude signin",
      key: { incantation: "slopweaver claude signin --reenroll <alias>", kind: "command" },
    };

    expect(hatchRefusalLines({ hatch })[2]).toBe(
      "To override use the designated escape hatch slopweaver claude signin --reenroll <alias>.",
    );
  });

  it("puts a door token in front of the command it waives", () => {
    const hatch: EscapeHatch = { ...HATCH, command: "posting it", key: { kind: "door-token", token: "stub.warn:v2" } };

    expect(hatchRefusalLines({ hatch })[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_DOOR_OVERRIDE=stub.warn:v2 posting it.",
    );
  });

  it("folds this invocation's detail into the reason", () => {
    expect(hatchRefusal({ detail: "3 seconds ago", hatch: HATCH }).split("\n")[0]).toBe(
      "reading that log again blocked because the same target was polled 12s ago (3 seconds ago).",
    );
  });

  it("leaves the reason alone when the detail is empty", () => {
    expect(hatchRefusal({ detail: "", hatch: HATCH }).split("\n")[0]).toBe(
      "reading that log again blocked because the same target was polled 12s ago.",
    );
  });

  it("joins exceptions with semicolons, so an exception may contain a comma", () => {
    expect(exceptionClause({ exceptions: ["a deliberate revert, done on purpose", "a rebase"] })).toBe(
      "a deliberate revert, done on purpose; a rebase",
    );
  });

  it("carries the judgement note on a registered hatch too", () => {
    expect(hatchRefusalLines({ hatch: hatchFor({ id: "wall" }) }).at(-1)).toBe(JUDGEMENT_NOTE);
  });

  it("names the designated hatch on every registered row", () => {
    const missing = ESCAPE_HATCH_IDS.filter(
      (id) => !hatchRefusal({ hatch: hatchFor({ id }) }).includes("designated escape hatch"),
    );
    expect(missing).toEqual([]);
  });
});

const ESCAPE_HATCH_IDS = ["wall", "poll", "raw", "skill-load", "slack-duplicate-send"] as const;
