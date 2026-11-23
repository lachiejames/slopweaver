/**
 * The judging brief's fixed blocks: each opens on its own heading and ends on a blank line, so the renderer
 * can concatenate them without a separator of its own.
 */
import { describe, expect, it } from "vitest";

import { decisionShapeLines, measuredFigureLines, truthModeLines } from "../../../../live/turn/briefFixedLines.js";

describe("briefFixedLines", () => {
  it("opens the decision shape on the JUDGE line and ends it blank", () => {
    const lines = decisionShapeLines();
    expect(lines[0]).toBe("JUDGE THIS ASK — respond, or not — and write ONE `RoutingDecision` JSON to a file:");
    expect(lines.at(-1)).toBe("");
  });

  it("prints the for-a-human shape, so a judging session can author the fourth ending", () => {
    expect(decisionShapeLines()).toContain(
      '  {"schemaVersion": 1, "response": "for-a-human", "confidence": "high", "rationale": "why a person should answer"}',
    );
  });

  it("names all three truth modes", () => {
    const lines = truthModeLines();
    expect(lines.filter((line) => /^ {2}- "(current|history|none)"/u.test(line))).toHaveLength(3);
    expect(lines.at(-1)).toBe("");
  });

  it("opens the measurement rule on the repro sentence and ends it blank", () => {
    const lines = measuredFigureLines();
    expect(lines[0]).toBe(
      "EVERY FIGURE YOU ASSERT CARRIES ITS OWN REPRO. A measured comment in this repo's CODE already has to",
    );
    expect(lines.at(-1)).toBe("");
  });
});
