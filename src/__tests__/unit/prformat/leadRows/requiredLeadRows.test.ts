/*
 * `requiredLeadRowsError`: the form-path rule that the first two rows above Problem are exactly Risk then Blast
 * radius, each saying something.
 */
import { describe, expect, it } from "vitest";

import { REQUIRED_LEAD_LABELS, requiredLeadRowsError } from "../../../../prformat/leadRows.js";
import { PAIR } from "./harness.js";

describe("requiredLeadRowsError", () => {
  it("requires exactly the two labels the owner named, in order", () => {
    expect(REQUIRED_LEAD_LABELS).toStrictEqual(["Risk", "Blast radius"]);
  });

  it("accepts the pair", () => {
    expect(requiredLeadRowsError({ rows: PAIR })).toBe(undefined);
  });

  it("accepts further rows after the pair", () => {
    expect(requiredLeadRowsError({ rows: [...PAIR, { label: "Rollback", text: "Revert it." }] })).toBe(undefined);
  });

  it("refuses an absent lead, naming none", () => {
    expect(requiredLeadRowsError({ rows: undefined })).toContain("the rows above Problem here are none");
  });

  it("refuses the pair reversed, naming what it found", () => {
    expect(requiredLeadRowsError({ rows: [PAIR[1]!, PAIR[0]!] })).toContain('are "Blast radius", "Risk"');
  });

  it("refuses a lone Risk row", () => {
    expect(requiredLeadRowsError({ rows: [PAIR[0]!] })).toContain('are "Risk".');
  });

  it("refuses a label in the wrong case, since the gate compares exactly", () => {
    expect(requiredLeadRowsError({ rows: [{ label: "risk", text: "x" }, PAIR[1]!] })).toContain('"risk"');
  });

  it("refuses an empty Blast radius cell, naming the row", () => {
    expect(requiredLeadRowsError({ rows: [PAIR[0]!, { label: "Blast radius", text: "" }] })).toBe(
      "the **Blast radius** row is empty. Say what it asks, plainly.",
    );
  });
});
