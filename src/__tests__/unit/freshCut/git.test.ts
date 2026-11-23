/**
 * How a failed fresh-cut git run is reported: its exit status and only the first line of stderr, so a long stderr
 * never reaches a message whole.
 */
import { describe, expect, it } from "vitest";

import { gitRunFailure } from "../../../freshCut/git.js";

/**
 * A thrown value shaped like `execFileSync`'s error.
 *
 * @param status the exit status, or null when the child never exited normally
 * @param stderr what the child wrote to stderr
 * @returns an Error carrying both
 */
function execError({ status, stderr }: { status: number | null; stderr: string }): Error {
  return Object.assign(new Error("Command failed: git"), { status, stderr: Buffer.from(stderr) });
}

describe("gitRunFailure", () => {
  it("keeps the exit status and only the first stderr line", () => {
    expect(
      gitRunFailure({ error: execError({ status: 128, stderr: "fatal: not a git repository\nhint: second line\n" }) }),
    ).toEqual({ cause: "fatal: not a git repository", status: 128 });
  });

  it("falls back to the error's own message when stderr is empty, with no status when the child was killed", () => {
    expect(gitRunFailure({ error: execError({ status: null, stderr: "" }) })).toEqual({
      cause: "Command failed: git",
      status: null,
    });
  });

  it("reports a thrown non-object as its string", () => {
    expect(gitRunFailure({ error: "spawn git ENOENT" })).toEqual({ cause: "spawn git ENOENT", status: null });
  });
});
