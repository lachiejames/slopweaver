/**
 * The live-read stamp's and the single-file repair's typed failures: each factory renders the exact text the
 * `readonly string[]` it replaced carried, and {@link atlasSidecarErrorLines} prints it as before.
 */
import { describe, expect, it } from "vitest";

import { AtlasSidecarErrors, atlasSidecarErrorLines } from "../../../../atlas/kit/sidecarErrors.js";

describe("AtlasSidecarErrors", () => {
  it("names a foreign stamp version without the word version before what this build writes", () => {
    const error = AtlasSidecarErrors.stampSchemaForeign({ found: 99, path: "/a/live-read.json", writes: 1 });
    expect(error.code).toBe("STAMP_SCHEMA_FOREIGN");
    expect(error.message).toBe("/a/live-read.json declares schema version 99, and this build writes 1");
  });

  it("prints the whole thrown value, Error prefix included, when a legacy file cannot be archived", () => {
    const error = AtlasSidecarErrors.singleFileNotArchived({
      cause: new Error("EACCES: permission denied"),
      singleFilePath: "/a/users.json",
      path: "/a/users.jsonl",
    });
    expect(error.code).toBe("SINGLE_FILE_NOT_ARCHIVED");
    expect(error.message).toBe(
      "/a/users.jsonl was rewritten but /a/users.json could not be archived: Error: EACCES: permission denied",
    );
  });

  it("prefixes a refused legacy document's reason with its path", () => {
    const error = AtlasSidecarErrors.singleFileRefused({
      cause: AtlasSidecarErrors.singleFileNotObject(),
      path: "/a/users.json",
    });
    expect(error.code).toBe("SINGLE_FILE_REFUSED");
    expect(atlasSidecarErrorLines({ error })).toEqual([
      "/a/users.json: the legacy kind file is not a JSON object, so it is not a kind file this repair can split",
    ]);
  });

  it("forwards an upstream failure's lines one per entry", () => {
    const error = AtlasSidecarErrors.upstreamFailed({ reasons: ["first", "second"] });
    expect(error.message).toBe("first; second");
    expect(atlasSidecarErrorLines({ error })).toEqual(["first", "second"]);
  });

  it("names the kind whose manifest cell is missing", () => {
    const error = AtlasSidecarErrors.manifestCellMissing({ kind: "user" });
    expect(atlasSidecarErrorLines({ error })).toEqual([
      "the manifest has no cell for user, so the repair cannot restamp it",
    ]);
  });
});
