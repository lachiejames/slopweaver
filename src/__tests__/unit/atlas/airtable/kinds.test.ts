import { describe, expect, it } from "vitest";

import { airtableKindFor } from "../../../../atlas/airtable/kinds.js";

describe("airtableKindFor", () => {
  it("places an operation the override table names under the resource, not the tag", () => {
    expect(airtableKindFor({ operationId: "delete-base", tag: "workspace" })).toStrictEqual({
      alsoFeeds: [],
      kind: "base",
    });
  });

  it("carries the fan-out of the one operation whose response fills three kinds", () => {
    expect(airtableKindFor({ operationId: "get-base-schema", tag: "base" })).toStrictEqual({
      alsoFeeds: ["field", "view"],
      kind: "table",
    });
  });

  it("places an operation the override table does not name by its tag, filling its own kind alone", () => {
    expect(airtableKindFor({ operationId: "list-comments", tag: "comment" })).toStrictEqual({
      alsoFeeds: [],
      kind: "comment",
    });
  });

  it("refuses to place an operation neither table names", () => {
    expect(airtableKindFor({ operationId: "list-automations", tag: "automations" })).toBeNull();
  });
});
