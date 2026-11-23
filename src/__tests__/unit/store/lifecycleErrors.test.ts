/**
 * The store lifecycle's typed failures print exactly what the `readonly string[]` they replaced printed: a
 * generate's heading and output tail, a failed statement and its SQL, each catalog disagreement — one line each —
 * and the message otherwise.
 */
import { describe, expect, it } from "vitest";
import { StoreErrors, storeErrorLines } from "../../../store/errors.js";
import { StoreLifecycleErrors } from "../../../store/lifecycleErrors.js";

describe("storeErrorLines", () => {
  it("keeps a generate's exit status first and the tail of what it printed after it", () => {
    expect(storeErrorLines({ error: StoreErrors.generateExited({ status: 1, tail: ["Error: x", "at y"] }) })).toEqual([
      "drizzle-kit generate exited 1",
      "Error: x",
      "at y",
    ]);
  });

  it("keeps a failed statement's reason first and the statement itself after it", () => {
    expect(
      storeErrorLines({
        error: StoreErrors.migrationStatementFailed({
          detail: "role exists",
          index: 2,
          phase: "role",
          statement: "CREATE ROLE x",
        }),
      }),
    ).toEqual(["role statement 2 failed: role exists", "CREATE ROLE x"]);
  });

  it("gives every catalog disagreement its own line under the refusal", () => {
    expect(
      storeErrorLines({ error: StoreErrors.catalogDisagrees({ problems: ["a is missing", "b is extra"] }) }),
    ).toEqual(["refusing to baseline: the catalog disagrees with --through", "a is missing", "b is extra"]);
  });

  it("gives a single-message variant its message", () => {
    expect(storeErrorLines({ error: StoreErrors.journalMismatch({ entries: 3, files: 2 }) })).toEqual([
      "the journal lists 3 entries and drizzle read 2 files",
    ]);
  });
});

describe("StoreErrors — the lifecycle", () => {
  it("names every bronze file a --from-file could have named", () => {
    const error = StoreErrors.fromFileUnknown({ available: ["a.jsonl", "b.jsonl"], fromFile: "c.jsonl" });
    expect(error.code).toBe("FROM_FILE_UNKNOWN");
    expect(error.message).toBe("--from-file c.jsonl names no bronze file here — this source has a.jsonl, b.jsonl");
  });

  it("says a source has none rather than listing an empty set", () => {
    expect(StoreErrors.fromFileUnknown({ available: [], fromFile: "c.jsonl" }).message).toBe(
      "--from-file c.jsonl names no bronze file here — this source has none",
    );
  });

  it("says what a push would have done to an unrecorded database", () => {
    const error = StoreErrors.pushStateRefused({ state: "unrecorded", stateLine: "state: unrecorded" });
    expect(error.code).toBe("STATE_REFUSED");
    expect(storeErrorLines({ error })).toEqual([
      "refusing to push: unrecorded — the migrator would replay 0000 onto tables that already exist",
      "state: unrecorded",
    ]);
  });
});

describe("StoreLifecycleErrors", () => {
  it("is what StoreErrors raises for a lifecycle refusal, so either spelling builds the same value", () => {
    const expected = {
      code: "LIFECYCLE_REFUSED",
      message: "refusing to baseline: the catalog disagrees with --through; 0003 is recorded but absent",
      reasons: ["refusing to baseline: the catalog disagrees with --through", "0003 is recorded but absent"],
    };
    expect(StoreLifecycleErrors.catalogDisagrees({ problems: ["0003 is recorded but absent"] })).toEqual(expected);
    expect(StoreErrors.catalogDisagrees({ problems: ["0003 is recorded but absent"] })).toEqual(expected);
  });
});
