/**
 * `resolvePushSelfReview` decodes a `--self-review` form before `github push` reads or writes anything, and
 * answers no form at all when the push asked for no round.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { resolvePushSelfReview } from "../../../../../cli/commands/github/pushSelfReview.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { absentPrivateTermsRefusal, homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Push edges whose Git and GitHub halves throw, so a resolver that reached past decoding fails loudly. */
function harness(): { deps: GithubPushDeps; lines: string[]; writes: string[][] } {
  const lines: string[] = [];
  const writes: string[][] = [];
  const deps: GithubPushDeps = {
    cwd: () => "/unused",
    doorLedger: memoryDoorLedger().port,
    out: ({ line }) => lines.push(line),
    readGit: ({ args }) => {
      throw new Error(`unexpected Git read: ${args.join(" ")}`);
    },
    selfReview: {
      makeApi: () => {
        throw new Error("resolving a form must not construct a GitHub client");
      },
      now: () => new Date("2026-08-14T00:00:00Z"),
      readForm: ({ source }) => source,
    },
    writeGit: ({ args }) => {
      writes.push([...args]);
      return ok(undefined);
    },
  };
  return { deps, lines, writes };
}

describe("resolvePushSelfReview", () => {
  it("decodes a --self-review form before anything is read or pushed", () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-review-home-" });
    fixtureDirs.push(home);
    const comments = [
      { body: "This keeps the current diff easy to enter.", kind: "explanation", line: 9, path: "src/a.ts" },
    ];
    const resolved = resolvePushSelfReview({
      args: { selfReviewSource: JSON.stringify({ comments }) },
      deps: test.deps,
      home,
    });
    expect(unwrap(resolved)).toEqual({ comments });
    expect(test.writes).toEqual([]);
    expect(test.lines).toEqual([]);
  });

  it("refuses a --self-review form when the home holds no private-terms file, pushing nothing", () => {
    const test = harness();
    const home = mkdtempSync(join(tmpdir(), "github-push-review-no-terms-"));
    fixtureDirs.push(home);
    const comments = [
      { body: "This keeps the current diff easy to enter.", kind: "explanation", line: 9, path: "src/a.ts" },
    ];
    const resolved = resolvePushSelfReview({
      args: { selfReviewSource: JSON.stringify({ comments }) },
      deps: test.deps,
      home,
    });
    expect(unwrapErr(resolved)).toBe(EXIT_ERROR);
    expect(test.lines).toEqual([
      `refused: ${absentPrivateTermsRefusal({ home })} nothing was pushed and no review was posted.`,
    ]);
    expect(test.writes).toEqual([]);
  });

  it("answers no form at all when the push asked for no round", () => {
    const test = harness();
    const resolved = resolvePushSelfReview({ args: { selfReviewSource: undefined }, deps: test.deps, home: "/unused" });
    expect(unwrap(resolved)).toBe(undefined);
  });
});
