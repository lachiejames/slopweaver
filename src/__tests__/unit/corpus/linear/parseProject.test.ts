import { describe, expect, it } from "vitest";
import { parseProject } from "../../../../corpus/linear/parseProject.js";

describe("parseProject", () => {
  it("answers undefined for a node that is not a record", () => {
    expect(parseProject({ nested: {}, node: "p1", updates: [] })).toBeUndefined();
  });

  it("omits the updates key when there are none and carries them when there are", () => {
    const node = { id: "p1", name: "Search quality" };
    const update = { body: "on track", id: "u1", raw: {}, tsIso: "2026-05-03T00:00:00.000Z", url: "u" };
    expect(parseProject({ nested: {}, node, updates: [] })).toEqual({
      id: "p1",
      name: "Search quality",
      raw: node,
      tsIso: "",
      url: "",
    });
    expect(parseProject({ nested: {}, node, updates: [update] })!.updates).toEqual([update]);
  });
});
