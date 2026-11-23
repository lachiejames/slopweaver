/**
 * The fresh-cut error factory: each failure carries its code and a message naming a SHA, a path or a git step, never
 * a file's content.
 */
import { describe, expect, it } from "vitest";

import { FreshCutErrors } from "../../../freshCut/errors.js";

describe("FreshCutErrors", () => {
  it("names the commit that is not on main, and carries its SHA", () => {
    expect(FreshCutErrors.commitNotOnMain({ sha: "7adba73" })).toEqual({
      code: "COMMIT_NOT_ON_MAIN",
      message: "commit 7adba73 is not reachable from the source repository's local main — cut only from main",
      sha: "7adba73",
    });
  });

  it("names the refused destination and why, and carries the destination", () => {
    expect(FreshCutErrors.destinationRefused({ destination: "/src/acme/cut", why: "it is inside a checkout" })).toEqual(
      {
        code: "DESTINATION_REFUSED",
        destination: "/src/acme/cut",
        message: "destination /src/acme/cut refused: it is inside a checkout",
      },
    );
  });

  it("names the git step that failed on each side of the cut", () => {
    expect([
      FreshCutErrors.sourceUnreadable({ cause: "fatal: bad object", step: "ls-tree" }).message,
      FreshCutErrors.cutWriteFailed({ cause: "fatal: unable to write", step: "commit-tree" }).message,
    ]).toEqual([
      "git ls-tree in the source repository failed: fatal: bad object",
      "git commit-tree in the new repository failed: fatal: unable to write",
    ]);
  });

  it("names a submodule's path as the reason a tree cannot be scanned", () => {
    expect(FreshCutErrors.gitlinkInTree({ path: "vendor/lib" }).code).toBe("GITLINK_IN_TREE");
  });
});
