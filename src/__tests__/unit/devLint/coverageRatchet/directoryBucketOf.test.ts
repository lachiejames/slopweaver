/*
 * `directoryBucketOf`: the first directory under `src` a file's statements count towards, or none.
 */
import { describe, expect, it } from "vitest";

import { directoryBucketOf } from "../../../../devLint/coverageFloor.js";

describe("directoryBucketOf", () => {
  it("buckets a nested file by its first directory under src", () => {
    expect(directoryBucketOf({ relativePath: "src/cli/commands/github/merge.ts" })).toBe("src/cli");
  });

  it("buckets a file directly under src as src itself", () => {
    expect(directoryBucketOf({ relativePath: "src/version.ts" })).toBe("src");
  });

  it("leaves a file outside src unbucketed", () => {
    expect(directoryBucketOf({ relativePath: "eval/run.ts" })).toBe(undefined);
  });

  it("leaves a bare src with no file unbucketed", () => {
    expect(directoryBucketOf({ relativePath: "src" })).toBe(undefined);
  });
});
