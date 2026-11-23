/**
 * `github push`'s base-freshness gate, driven directly through injected freshness and hold edges: a fresh
 * base admits the push and names the base it measured, a moved one refuses before anything is written.
 */
import { describe, expect, it } from "vitest";

import type { GithubPushPlan } from "../../../../../admit/githubPush.js";
import { pushBaseFreshness } from "../../../../../cli/commands/github/pushBaseFreshness.js";
import { NO_BASE_FRESHNESS_ACKNOWLEDGEMENT } from "../../../../../cli/commands/github/pushCore.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import { ok } from "../../../../../lib/result.js";
import { unmeasurable } from "../../../../../measurement/status.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const LOCAL_SHA = "1".repeat(40);
const BASE_TIP_SHA = "3".repeat(40);
const PRIVATE_REF = "refs/slopweaver/fetch/test";

const PLAN: GithubPushPlan = {
  branch: "feature",
  defaultBranch: "main",
  forceWithLease: false,
  gitArgs: ["push", "origin", `${LOCAL_SHA}^{commit}:refs/heads/feature`],
  localSha: LOCAL_SHA,
  purpose: "pull-request-head",
  remote: "origin",
  remoteBranchSha: undefined,
  repo: "owner/repo",
  repoRoot: "/repo",
};

/** Plain fake edges: the base is fresh iff `baseIsFresh`, and every printed line and Git write is captured. */
function harness({ baseIsFresh }: { baseIsFresh: boolean }): {
  deps: GithubPushDeps;
  lines: string[];
  writes: string[][];
} {
  const lines: string[] = [];
  const writes: string[][] = [];
  const git: GithubPushDeps = {
    cwd: () => "/unused",
    doorLedger: memoryDoorLedger().port,
    out: ({ line }) => lines.push(line),
    readGit: ({ args }) => {
      const command = args.join(" ");
      if (command === `rev-parse ${PRIVATE_REF}^{commit}`) return BASE_TIP_SHA;
      throw new Error(`unexpected Git read: ${command}`);
    },
    readPatchId: () => ok(null),
    selfReview: {
      makeApi: () => {
        throw new Error("the freshness gate must not construct a GitHub client");
      },
      now: () => new Date("2026-08-14T00:00:00Z"),
      readForm: ({ source }) => source,
    },
    writeGit: ({ args }) => {
      writes.push([...args]);
      return ok(undefined);
    },
  };
  return {
    deps: {
      ...git,
      baseFreshness: {
        countCommitsAhead: () => ok(2),
        git,
        isAncestor: () => ok(baseIsFresh),
        measureReverted: () => [],
        newPrivateRef: () => PRIVATE_REF,
      },
      hold: {
        appendLedgerRow: () => ok(undefined),
        holderLive: () => unmeasurable<boolean>({ why: "this fake asks no registry" }),
        nowIso: () => "2026-09-03T00:10:00.000Z",
        out: ({ line }) => lines.push(line),
        publish: () => undefined,
        readHolds: () => [],
        readLedgerRows: () => [],
        sessionId: () => "this-session",
        writeHolds: () => ok(undefined),
      },
    },
    lines,
    writes,
  };
}

describe("pushBaseFreshness", () => {
  it("admits a push whose head already contains the fresh base, naming the base it measured", async () => {
    const test = harness({ baseIsFresh: true });
    const verdict = await pushBaseFreshness({
      acknowledgement: NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
      deps: test.deps,
      home: "/unused-home",
      plan: PLAN,
    });
    expect(verdict).toEqual({ baseSha: BASE_TIP_SHA, refused: false });
    expect(test.writes).toEqual([
      ["fetch", "origin", `refs/heads/main:${PRIVATE_REF}`],
      ["update-ref", "-d", PRIVATE_REF],
    ]);
  });

  it("refuses a push its base has moved past when nothing was acknowledged", async () => {
    const test = harness({ baseIsFresh: false });
    const verdict = await pushBaseFreshness({
      acknowledgement: NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
      deps: test.deps,
      home: "/unused-home",
      plan: PLAN,
    });
    expect(verdict).toEqual({ baseSha: BASE_TIP_SHA, refused: true });
    expect(test.lines.slice(0, 2)).toEqual([
      "⚠ this branch is 2 commits behind origin/main",
      `refused: base-moved: main has moved to ${BASE_TIP_SHA}, which is not an ancestor of the checked head ` +
        `${LOCAL_SHA} — your diff and any CI run were computed against a base that has since advanced ` +
        "(or this is a shallow clone's false negative)",
    ]);
  });
});
