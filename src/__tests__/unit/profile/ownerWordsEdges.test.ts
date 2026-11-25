/**
 * One end of a record's words from the two facts it carries about that end: lost, kept, or never said.
 */
import { describe, expect, it } from "vitest";

import { ownerWordsEdge } from "../../../profile/ownerWordsEdges.js";

describe("ownerWordsEdge", () => {
  it("reads lost before known, kept only when the record says so, and unknown otherwise", () => {
    expect([
      ownerWordsEdge({ known: true, lost: true }),
      ownerWordsEdge({ known: false, lost: true }),
      ownerWordsEdge({ known: true, lost: false }),
      ownerWordsEdge({ known: false, lost: false }),
    ]).toEqual(["lost", "lost", "kept", "unknown"]);
  });
});
