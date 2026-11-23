/*
 * The pure node readers a Linear verification pass shapes its live facts with.
 */
import { describe, expect, it } from "vitest";

import type { LinearLiveFacts } from "../../../../live/linear/verifyDocument.js";
import {
  factsByIdentifier,
  fieldString,
  type LinearNameIndex,
  NO_NAMES,
  nestedId,
} from "../../../../live/linear/verifyNodes.js";

/** A shaper that keys on `identifier` and drops a node without one, as the real issue shaper does. */
const shapeByIdentifier = ({ node }: { node: Record<string, unknown>; names: LinearNameIndex }) => {
  const identifier = fieldString({ key: "identifier", node });
  if (identifier === undefined) {
    return undefined;
  }
  const facts: LinearLiveFacts = { archived: false, identifier, owner: undefined, state: undefined, title: identifier };
  return facts;
};

describe("fieldString", () => {
  it("reads a non-empty string", () => {
    expect(fieldString({ key: "title", node: { title: "Fix the pool" } })).toBe("Fix the pool");
  });

  it("answers undefined for an empty string", () => {
    expect(fieldString({ key: "title", node: { title: "" } })).toBe(undefined);
  });

  it("answers undefined for a value that is not a string", () => {
    expect(fieldString({ key: "title", node: { title: 7 } })).toBe(undefined);
  });
});

describe("nestedId", () => {
  it("reads the id under a bare relation reference", () => {
    expect(nestedId({ key: "assignee", node: { assignee: { id: "u-kim" } } })).toBe("u-kim");
  });

  it("answers undefined for a null relation", () => {
    expect(nestedId({ key: "assignee", node: { assignee: null } })).toBe(undefined);
  });

  it("answers undefined for a relation that carries no id", () => {
    expect(nestedId({ key: "assignee", node: { assignee: { name: "kim.lee" } } })).toBe(undefined);
  });
});

describe("factsByIdentifier", () => {
  it("keys every shaped node by its identifier and drops the one the shaper refused", () => {
    const index = factsByIdentifier({
      names: NO_NAMES,
      nodes: [{ identifier: "ABC-1" }, { title: "no identifier" }, { identifier: "ABC-2" }],
      shape: shapeByIdentifier,
    });
    expect([...index.keys()]).toEqual(["ABC-1", "ABC-2"]);
    expect(index.get("ABC-2")).toEqual({
      archived: false,
      identifier: "ABC-2",
      owner: undefined,
      state: undefined,
      title: "ABC-2",
    });
  });

  it("answers an empty index for no nodes", () => {
    const nodes: readonly Record<string, unknown>[] = [];
    expect(factsByIdentifier({ names: NO_NAMES, nodes, shape: shapeByIdentifier }).size).toBe(0);
  });
});

describe("NO_NAMES", () => {
  it("holds three empty maps", () => {
    expect([NO_NAMES.users.size, NO_NAMES.states.size, NO_NAMES.projectStatuses.size]).toEqual([0, 0, 0]);
  });
});
