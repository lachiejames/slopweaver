import { describe, expect, it } from "vitest";

import { StoreBrowseErrors } from "../../../../store/browse/errors.js";

describe("StoreBrowseErrors", () => {
  it("says a timeout in whole seconds and how to get under it", () => {
    expect(StoreBrowseErrors.timedOut({ budgetMs: 5000 })).toEqual({
      code: "QUERY_TIMED_OUT",
      message: "the store read ran past its 5s statement timeout; narrow the filter or pick a smaller page",
    });
  });

  it("names the table and column a refused name was asked of", () => {
    expect(StoreBrowseErrors.columnUnknown({ column: "acme_missing", table: "acme_note" })).toEqual({
      code: "COLUMN_UNKNOWN",
      column: "acme_missing",
      message: "acme_note has no column named acme_missing",
    });
    expect(StoreBrowseErrors.tableUnknown({ table: "acme_missing" }).message).toBe(
      "acme_missing is not a table in the store's public schema",
    );
  });

  it("carries a thrown error's own message and a thrown non-error as text", () => {
    expect(StoreBrowseErrors.queryFailed({ cause: new Error("relation is locked") }).message).toBe(
      "the store read failed: relation is locked",
    );
    expect(StoreBrowseErrors.queryFailed({ cause: 42 }).message).toBe("the store read failed: 42");
  });
});
