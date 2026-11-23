import { describe, expect, it } from "vitest";

import { missingSearchClause } from "../../../../live/github/reviewStateMissingSearch.js";

describe("missingSearchClause", () => {
  it("names a response that is not an object, without calling null or an array an object", () => {
    expect(missingSearchClause({ data: null })).toBe("the response was null, not an object");
    expect(missingSearchClause({ data: [] })).toBe("the response was an array, not an object");
    expect(missingSearchClause({ data: "x" })).toBe("the response was string, not an object");
  });

  it("names an object with no search key, listing the keys it did carry", () => {
    expect(missingSearchClause({ data: { rateLimit: 1, viewer: 2 } })).toBe(
      "the response object carries no `search` key at all (keys: rateLimit, viewer)",
    );
  });

  it("names GitHub declining the query apart from a scalar search", () => {
    expect(missingSearchClause({ data: { search: null } })).toBe(
      "GitHub answered `search: null`, which is how it declines a query it could not complete",
    );
    expect(missingSearchClause({ data: { search: 3 } })).toBe("`search` came back as number, not a connection");
  });
});
