/**
 * The `--example` / `--example-gap` reader both asking verbs share: what it admits off a real argv tail, what it
 * refuses and how the refusal names the verb, and the fields it writes onto the asking line.
 */
import { describe, expect, it } from "vitest";

import { admittedExamples, exampleFields } from "../../../../../cli/commands/handover/askExampleFlags.js";

/** A scene that passes the shape: second person, a scene of six words or more, closing on a real question. */
const SCENE = "You open the card and see the fleet merged its own fix. Was that right?";

describe("admittedExamples", () => {
  it("admits every repeated --example off the argv tail, in the order typed", () => {
    const rest = ["--ask", "x", "--example", SCENE, "--example=" + SCENE.replace("fix", "patch")];
    expect(admittedExamples({ command: "handover ask", env: {}, gap: undefined, rest })).toEqual({
      kind: "admitted",
      set: { examples: [SCENE, SCENE.replace("fix", "patch")], kind: "examples" },
    });
  });

  it("admits a gap in place of a scene", () => {
    expect(admittedExamples({ command: "handover ask", env: {}, gap: "the row names no event", rest: [] })).toEqual({
      kind: "admitted",
      set: { gap: "the row names no event", kind: "gap" },
    });
  });

  it("refuses a scene naming a picture file, numbering the scene and pointing at the verb that attaches it", () => {
    const pictured = "You open the card and see span-profiles-tab.png beside the trace. Was that right?";
    const verdict = admittedExamples({
      command: "handover ask",
      env: {},
      gap: undefined,
      rest: ["--example", pictured],
    });
    expect(verdict.kind).toBe("refused");
    expect(JSON.stringify(verdict)).toContain('example 1 names the picture \\"span-profiles-tab.png\\" as text');
    expect(JSON.stringify(verdict)).toContain("slopweaver handover shot <slug> --shot <png>");
  });

  it("refuses a gap line naming a picture file", () => {
    const verdict = admittedExamples({
      command: "handover ask",
      env: {},
      gap: "only ~/proof/a.jpeg shows it",
      rest: [],
    });
    expect(JSON.stringify(verdict)).toContain('the example gap names the picture \\"~/proof/a.jpeg\\" as text');
  });

  it("admits a pictured scene when the unaligned-card hatch is open", () => {
    const pictured = "You open the card and see span-profiles-tab.png beside the trace. Was that right?";
    const env = { SLOPWEAVER_ALLOW_UNALIGNED_CARD: "1" };
    expect(admittedExamples({ command: "handover ask", env, gap: undefined, rest: ["--example", pictured] })).toEqual({
      kind: "admitted",
      set: { examples: [pictured], kind: "examples" },
    });
  });

  it("refuses an ask carrying neither, naming the verb on every line and saying nothing was recorded", () => {
    expect(admittedExamples({ command: "handover register", env: {}, gap: undefined, rest: ["--ask", "x"] })).toEqual({
      kind: "refused",
      lines: [
        "handover register: no concrete example — pass --example with a second-person scene the owner can picture, ending " +
          "on the question (up to three for related asks), or --example-gap with one line saying why the row cannot " +
          "support a truthful one",
        "handover register: nothing was recorded — every open Queue card leads with a concrete example",
      ],
    });
  });
});

describe("exampleFields", () => {
  it("writes the scenes onto the asking line", () => {
    expect(exampleFields({ set: { examples: [SCENE], kind: "examples" } })).toEqual({ examples: [SCENE] });
  });

  it("writes the gap, and no scene list beside it", () => {
    expect(exampleFields({ set: { gap: "no row", kind: "gap" } })).toEqual({ exampleGap: "no row" });
  });
});
