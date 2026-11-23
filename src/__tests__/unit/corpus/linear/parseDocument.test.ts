import { describe, expect, it } from "vitest";
import { parseDocumentNode } from "../../../../corpus/linear/parseDocument.js";

describe("parseDocumentNode", () => {
  it("answers undefined for a node that is not a record", () => {
    expect(parseDocumentNode({ node: "d1" })).toBeUndefined();
  });

  it("omits every parent binding the node does not carry", () => {
    const node = { archivedAt: "2026-05-02", content: "the spec", id: "d1", title: "Retrieval spec" };
    expect(parseDocumentNode({ node })).toEqual({
      archivedAtIso: "2026-05-02",
      content: "the spec",
      id: "d1",
      raw: node,
      title: "Retrieval spec",
      tsIso: "",
      url: "",
    });
  });
});
