/**
 * The Linear projection's text primitives: absent and empty parts drop out of a joined body and a summary
 * line without reordering what stays, an issue sits under its team's container only when the team is known,
 * an attrs map keeps `false`, `0` and `""` but drops absent values and empty lists, a zero still renders as a
 * clause, and a set-valued list clause is deduplicated and sorted.
 */
import { describe, expect, it } from "vitest";

import {
  definedAttrs,
  issueContainer,
  joinDefined,
  labelled,
  listClause,
  summaryLineOf,
} from "../../../../corpus/linear/recordText.js";

describe("joinDefined", () => {
  it("joins the defined, non-empty parts with newlines, in order", () => {
    expect(joinDefined({ parts: ["title", undefined, "", "body", "footer"] })).toBe("title\nbody\nfooter");
  });

  it("is empty when no part is defined", () => {
    expect(joinDefined({ parts: [undefined, ""] })).toBe("");
  });
});

describe("issueContainer", () => {
  it("is linear/<team> for a known team and linear for an absent or empty one", () => {
    expect(issueContainer({ team: "ENG" })).toBe("linear/ENG");
    expect(issueContainer({ team: undefined })).toBe("linear");
    expect(issueContainer({ team: "" })).toBe("linear");
  });
});

describe("definedAttrs", () => {
  it("drops absent values and empty lists but keeps false, zero, empty strings and non-empty lists", () => {
    expect(
      definedAttrs({
        entries: [
          ["state", "Todo"],
          ["assignee", undefined],
          ["labels", []],
          ["archived", false],
          ["estimate", 0],
          ["description", ""],
          ["teams", ["ENG", "OPS"]],
        ],
      }),
    ).toEqual({ archived: false, description: "", estimate: 0, state: "Todo", teams: ["ENG", "OPS"] });
  });
});

describe("labelled", () => {
  it("renders a Label: value clause, a zero included, and nothing for an absent value", () => {
    expect(labelled({ label: "Priority", value: 0 })).toBe("Priority: 0");
    expect(labelled({ label: "State", value: "Done" })).toBe("State: Done");
    expect(labelled({ label: "State", value: undefined })).toBeUndefined();
  });
});

describe("summaryLineOf", () => {
  it("joins the defined, non-empty clauses with the house separator", () => {
    expect(summaryLineOf({ parts: ["State: Done", undefined, "", "Priority: 2"] })).toBe("State: Done · Priority: 2");
  });
});

describe("listClause", () => {
  it("deduplicates and sorts a set-valued list into one clause", () => {
    expect(listClause({ label: "Labels", values: ["bug", "api", "bug", "Zeta"] })).toBe("Labels: Zeta, api, bug");
  });

  it("renders no clause for an absent or empty list", () => {
    expect(listClause({ label: "Labels", values: undefined })).toBeUndefined();
    expect(listClause({ label: "Labels", values: [] })).toBeUndefined();
  });
});
