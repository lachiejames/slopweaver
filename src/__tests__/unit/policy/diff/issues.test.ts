import { describe, expect, it } from "vitest";

import { DocDiffIssues } from "../../../../policy/diff/issues.js";

describe("DocDiffIssues", () => {
  it("quotes a short line whole, and names the side a missing reason belongs to", () => {
    const issue = DocDiffIssues.uncoveredRow({ document: "network", side: "before", text: "Staging is separate." });
    expect(issue.code).toBe("UNCOVERED_ROW");
    expect(issue.excerpt).toBe("Staging is separate.");
    expect(issue.message).toBe(
      'network: a material change says nothing about why — add a change whose match is a substring of this before line: "Staging is separate."',
    );
  });

  it("cuts a long line to 120 characters, the last an ellipsis", () => {
    const issue = DocDiffIssues.ambiguousRow({ document: "network", ids: ["c1", "c2"], text: "x".repeat(200) });
    expect(issue.excerpt).toBe(`${"x".repeat(119)}…`);
    expect(issue.message).toContain("is matched by changes c1, c2");
  });

  it("says what to do about an address it refuses and an identifier it could not link", () => {
    expect(DocDiffIssues.unsafeLink({ url: "javascript:x", why: "it could run as script" }).message).toBe(
      "the address javascript:x is refused: it could run as script",
    );
    expect(DocDiffIssues.unlinkedIdentifier({ identifier: "NET-38" }).identifier).toBe("NET-38");
  });
});
