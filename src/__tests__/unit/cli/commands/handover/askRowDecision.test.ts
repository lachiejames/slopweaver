/**
 * Which `handover register` rows must carry a concrete scene: every row that heads the owner's card does, a row that does
 * not is read only when it passed one, and either way a scene is judged by the one shared reader.
 */
import { describe, expect, it } from "vitest";

import { registerExamples } from "../../../../../cli/commands/handover/askRowDecision.js";

/** A scene that passes the shape. */
const SCENE = "You open the card and see the fleet merged its own fix. Was that right?";

describe("registerExamples", () => {
  it("records nothing on a row that neither heads the owner's card nor passed a scene — a plain finding", () => {
    expect(registerExamples({ headsOwnerCard: false, rest: [], values: {} })).toEqual({
      kind: "admitted",
      set: undefined,
    });
  });

  it("refuses a row that heads the owner's card and carries no scene", () => {
    expect(registerExamples({ headsOwnerCard: true, rest: ["--ask", "x"], values: {} })).toMatchObject({
      kind: "refused",
      lines: expect.arrayContaining([expect.stringContaining("handover register: no concrete example")]),
    });
  });

  it("admits the scene a card-heading row passed, read off the argv tail", () => {
    const rest = ["--ask", "x", "--example", SCENE];
    expect(registerExamples({ headsOwnerCard: true, rest, values: { example: SCENE } })).toEqual({
      kind: "admitted",
      set: { examples: [SCENE], kind: "examples" },
    });
  });

  it("still judges a scene a finding chose to pass, so a bad one is refused rather than written", () => {
    const rest = ["--finding", "--example", "The fleet merged its fix. It was fine."];
    expect(registerExamples({ headsOwnerCard: false, rest, values: { example: "x" } })).toMatchObject({
      kind: "refused",
      lines: expect.arrayContaining([
        expect.stringContaining("handover register: example 1 never addresses the owner"),
      ]),
    });
  });

  it("admits a gap in place of a scene", () => {
    expect(registerExamples({ headsOwnerCard: true, rest: [], values: { "example-gap": "no row" } })).toEqual({
      kind: "admitted",
      set: { gap: "no row", kind: "gap" },
    });
  });
});
