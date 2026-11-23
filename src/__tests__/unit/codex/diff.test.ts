import { describe, expect, it } from "vitest";
import {
  binaryPathsIn,
  checkDiff,
  diffSha256,
  gitCommitDiffCommand,
  gitCommitMergeBaseCommand,
  gitMergeBaseCommand,
  gitTrackedDiffCommand,
  gitUnmergedCommand,
  gitUntrackedCommand,
  gitUntrackedDiffCommand,
  nullDevice,
  refusalMessage,
  submodulePathsIn,
} from "../../../codex/diff.js";
import { unwrap } from "../../../lib/result.js";

const SIMPLE_DIFF = [
  "diff --git a/src/x.ts b/src/x.ts",
  "index 111..222 100644",
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

describe("git command construction", () => {
  it("uses merge-base, not a two-dot range, so the diff is what THIS branch changed", () => {
    expect(gitMergeBaseCommand({ base: "origin/main" }).args).toEqual(["merge-base", "origin/main", "HEAD"]);
  });

  it("disables colour, external diff drivers and textconv, and finds renames", () => {
    expect(gitTrackedDiffCommand({ mergeBase: "abc123" }).args).toEqual([
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "abc123",
      "--",
    ]);
  });

  it("lists untracked files NUL-separated so odd filenames survive", () => {
    expect(gitUntrackedCommand().args).toEqual(["ls-files", "--others", "--exclude-standard", "-z"]);
  });

  it("detects unmerged paths with a U filter", () => {
    expect(gitUnmergedCommand().args).toEqual(["diff", "--name-only", "--diff-filter=U"]);
  });

  it("diffs an untracked file against the platform null device", () => {
    expect(gitUntrackedDiffCommand({ path: "new.ts" }).args).toEqual([
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-index",
      "--",
      nullDevice(),
      "new.ts",
    ]);
  });

  it("never builds a shell string — every command is an argv array", () => {
    expect(Array.isArray(gitTrackedDiffCommand({ mergeBase: "x" }).args)).toBe(true);
  });

  it("diffs a commit with exactly the worktree diff's flags, so the two hash alike on a clean checkout", () => {
    expect(gitCommitDiffCommand({ commit: "def456", mergeBase: "abc123" }).args).toEqual([
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "abc123",
      "def456",
      "--",
    ]);
  });

  /** The base ref is read back off disk, so a value beginning with `-` must reach git as a revision. */
  it("ends options before a commit merge base's revisions", () => {
    expect(gitCommitMergeBaseCommand({ base: "origin/main", commit: "def456" }).args).toEqual([
      "merge-base",
      "--end-of-options",
      "origin/main",
      "def456",
    ]);
  });
});

describe("binaryPathsIn", () => {
  it("names the file a `Binary files` marker belongs to", () => {
    const diff = ["diff --git a/img.png b/img.png", "Binary files a/img.png and b/img.png differ"].join("\n");
    expect(binaryPathsIn({ diff })).toEqual(["img.png"]);
  });

  it("names the file a `GIT binary patch` belongs to", () => {
    const diff = ["diff --git a/blob.bin b/blob.bin", "GIT binary patch", "literal 4"].join("\n");
    expect(binaryPathsIn({ diff })).toEqual(["blob.bin"]);
  });

  it("finds nothing in a normal text diff", () => {
    expect(binaryPathsIn({ diff: SIMPLE_DIFF })).toEqual([]);
  });
});

describe("submodulePathsIn", () => {
  it("names a submodule pointer change", () => {
    const diff = [
      "diff --git a/vendor/lib b/vendor/lib",
      "-Subproject commit 1111111111111111111111111111111111111111",
      "+Subproject commit 2222222222222222222222222222222222222222",
    ].join("\n");
    expect(submodulePathsIn({ diff })).toEqual(["vendor/lib"]);
  });
});

describe("diffSha256", () => {
  it("is stable for the same bytes", () => {
    expect(diffSha256({ diff: SIMPLE_DIFF })).toBe(diffSha256({ diff: SIMPLE_DIFF }));
  });

  it("changes when a single character changes", () => {
    expect(diffSha256({ diff: SIMPLE_DIFF })).not.toBe(diffSha256({ diff: `${SIMPLE_DIFF} ` }));
  });
});

describe("checkDiff — refusals happen BEFORE any model call", () => {
  it("accepts a normal diff and reports its size and hash", () => {
    const check = checkDiff({ maxBytes: 1000, text: SIMPLE_DIFF, unmergedPaths: [] });
    expect(check.isOk()).toBe(true);
    expect(unwrap(check).bytes).toBe(Buffer.byteLength(SIMPLE_DIFF, "utf8"));
    expect(unwrap(check).sha256).toBe(diffSha256({ diff: SIMPLE_DIFF }));
  });

  it("refuses an unmerged tree first — it explains an odd diff better than a size complaint", () => {
    const check = checkDiff({ maxBytes: 10, text: SIMPLE_DIFF, unmergedPaths: ["src/x.ts"] });
    expect(check.isOk()).toBe(false);
    expect(check.isErr() ? check.error.kind : "").toBe("unmerged");
  });

  it("refuses an empty diff — a CLEAN over no changes means nothing", () => {
    const check = checkDiff({ maxBytes: 1000, text: "   \n  ", unmergedPaths: [] });
    expect(check.isOk()).toBe(false);
    expect(check.isErr() ? check.error.kind : "").toBe("empty");
  });

  it("refuses a binary change rather than sending encoded blobs", () => {
    const diff = ["diff --git a/i.png b/i.png", "Binary files a/i.png and b/i.png differ"].join("\n");
    const check = checkDiff({ maxBytes: 100_000, text: diff, unmergedPaths: [] });
    expect(check.isOk()).toBe(false);
    expect(check.isErr() ? check.error.kind : "").toBe("binary");
  });

  it("reviews a deleted binary — the patch already says everything there is to judge", () => {
    const diff = [
      "diff --git a/i.png b/i.png",
      "deleted file mode 100644",
      "Binary files a/i.png and /dev/null differ",
    ].join("\n");
    expect(binaryPathsIn({ diff })).toEqual([]);
  });

  it("still refuses an ADDED binary — its content would be omitted", () => {
    const diff = [
      "diff --git a/i.png b/i.png",
      "new file mode 100644",
      "Binary files /dev/null and b/i.png differ",
    ].join("\n");
    expect(binaryPathsIn({ diff })).toEqual(["i.png"]);
  });

  it("refuses a submodule pointer change — a pointer sha is not the submodule's change", () => {
    const diff = [
      "diff --git a/v/l b/v/l",
      "-Subproject commit 1111111111111111111111111111111111111111",
      "+Subproject commit 2222222222222222222222222222222222222222",
    ].join("\n");
    const check = checkDiff({ maxBytes: 100_000, text: diff, unmergedPaths: [] });
    expect(check.isOk()).toBe(false);
    expect(check.isErr() ? check.error.kind : "").toBe("submodule");
  });

  it("refuses an oversized diff and reports BOTH numbers, never truncating", () => {
    const check = checkDiff({ maxBytes: 10, text: SIMPLE_DIFF, unmergedPaths: [] });
    expect(check.isOk()).toBe(false);
    expect(check.isErr() && check.error.kind === "too-large" ? check.error.maxBytes : 0).toBe(10);
    expect(check.isErr() && check.error.kind === "too-large" ? check.error.bytes : 0).toBe(
      Buffer.byteLength(SIMPLE_DIFF, "utf8"),
    );
  });

  it("accepts a diff exactly at the cap", () => {
    const bytes = Buffer.byteLength(SIMPLE_DIFF, "utf8");
    expect(checkDiff({ maxBytes: bytes, text: SIMPLE_DIFF, unmergedPaths: [] }).isOk()).toBe(true);
  });
});

describe("refusalMessage", () => {
  it("explains an oversized diff as a deliberate refusal, not a bug", () => {
    const message = refusalMessage({ refusal: { bytes: 900, kind: "too-large", maxBytes: 100 } });
    expect(message).toContain("900 bytes");
    expect(message).toContain("--max-diff-bytes cap of 100");
    expect(message).toContain("Refusing rather than truncating");
  });

  it("names the offending paths for a binary refusal", () => {
    expect(refusalMessage({ refusal: { kind: "binary", paths: ["a.png", "b.bin"] } })).toContain("a.png, b.bin");
  });

  it("explains why an empty diff is refused", () => {
    expect(refusalMessage({ refusal: { kind: "empty" } })).toContain("a CLEAN over no changes means nothing");
  });

  it("tells the caller to resolve a conflict first", () => {
    expect(refusalMessage({ refusal: { kind: "unmerged", paths: ["x"] } })).toContain(
      "resolve the conflict before reviewing",
    );
  });
});
