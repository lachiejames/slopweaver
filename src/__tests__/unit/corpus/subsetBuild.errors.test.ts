/**
 * `SubsetBuildErrors`: each factory's literal code, the field a caller prints beside it, and its exact message
 * — including how `copyFailed` renders an `Error` cause and a non-Error one, and that it keeps the cause.
 */
import { describe, expect, it } from "vitest";

import { SubsetBuildErrors } from "../../../corpus/subsetBuild.errors.js";

describe("SubsetBuildErrors", () => {
  it("noSourceCorpus is NO_SOURCE_CORPUS and names the empty source home", () => {
    const error = SubsetBuildErrors.noSourceCorpus({ sourceHome: "/homes/real" });
    expect(error).toEqual({
      code: "NO_SOURCE_CORPUS",
      message: "no bronze corpus under /homes/real — run `slopweaver refresh` before slicing a subset out of it",
      sourceHome: "/homes/real",
    });
  });

  it("destinationOccupied is DESTINATION_OCCUPIED and names the occupied --out", () => {
    const error = SubsetBuildErrors.destinationOccupied({ outHome: "/homes/subset" });
    expect(error).toEqual({
      code: "DESTINATION_OCCUPIED",
      message: "--out /homes/subset already holds a corpus — delete it or pick an empty directory (a rebuild is cheap)",
      outHome: "/homes/subset",
    });
  });

  it("destinationIsSource is DESTINATION_IS_SOURCE and names the home it would overwrite", () => {
    const error = SubsetBuildErrors.destinationIsSource({ home: "/homes/real" });
    expect(error).toEqual({
      code: "DESTINATION_IS_SOURCE",
      home: "/homes/real",
      message: "--out /homes/real is the source home itself — a subset build would overwrite the corpus it is slicing",
    });
  });

  it("copyFailed is COPY_FAILED, carries an Error cause's message and keeps the cause itself", () => {
    const cause = new Error("ENOSPC: no space left on device");
    const error = SubsetBuildErrors.copyFailed({ cause, path: "/homes/subset/bronze/slack/a.jsonl" });
    expect(error.code).toBe("COPY_FAILED");
    expect(error.path).toBe("/homes/subset/bronze/slack/a.jsonl");
    expect(error.message).toBe(
      "subset build failed on /homes/subset/bronze/slack/a.jsonl: ENOSPC: no space left on device",
    );
    expect(error.cause).toBe(cause);
  });

  it("copyFailed is COPY_FAILED and stringifies a non-Error cause", () => {
    const error = SubsetBuildErrors.copyFailed({ cause: "disk vanished", path: "/homes/subset/x" });
    expect(error.code).toBe("COPY_FAILED");
    expect(error.message).toBe("subset build failed on /homes/subset/x: disk vanished");
    expect(error.cause).toBe("disk vanished");
  });
});
