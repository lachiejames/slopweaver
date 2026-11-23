/** One `workspace.list` row's decoder, shared by the lossy inventory read and the strict one. */
import { describe, expect, it } from "vitest";

import { nonEmptyString, parseWorkspaceRow } from "../../../cmux/workspaceRow.js";

describe("nonEmptyString", () => {
  it("reads a non-empty string field", () => {
    expect(nonEmptyString({ field: "id", value: { id: "A" } })).toBe("A");
  });

  it("reads an emptied, null, non-string or absent field as unset", () => {
    const value = { blank: "", nulled: null, numeric: 7 };

    expect(["blank", "nulled", "numeric", "absent"].map((field) => nonEmptyString({ field, value }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads a value that is not a record as unset", () => {
    expect(nonEmptyString({ field: "id", value: "A" })).toBe(undefined);
  });
});

describe("parseWorkspaceRow", () => {
  it("decodes a row, tagging it with the window that listed it", () => {
    const entry = {
      current_directory: "/repo/a-doc",
      description: "spawned session",
      id: "A",
      pinned: true,
      ref: "workspace:1",
      title: "Terminal",
    };

    expect(parseWorkspaceRow({ entry, windowId: "W1" })).toEqual({
      currentDirectory: "/repo/a-doc",
      description: "spawned session",
      latestConversationMessage: undefined,
      latestSubmittedAtIso: undefined,
      latestSubmittedMessage: undefined,
      pinned: true,
      selected: false,
      title: "Terminal",
      windowId: "W1",
      workspaceId: "A",
      workspaceRef: "workspace:1",
    });
  });

  it("answers undefined for a row missing its id, its ref or its directory", () => {
    const whole = { current_directory: "/repo/a-doc", id: "A", ref: "workspace:1" };

    expect(
      ["id", "ref", "current_directory"].map((dropped) =>
        parseWorkspaceRow({ entry: { ...whole, [dropped]: undefined }, windowId: "W1" }),
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});
