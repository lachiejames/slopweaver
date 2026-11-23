/**
 * The snapshot `github stack restack` publishes: one row per in-scope pull request, each with its observed
 * base, its local branch read through the injected git, and its preparation arm.
 */
import { describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import type { RestackOutcome } from "../../../../../cli/commands/github/restackExec.js";
import type { RestackForest, RestackPullRequest } from "../../../../../cli/commands/github/restackForestCore.js";
import { restackSnapshot } from "../../../../../cli/commands/github/restackSnapshot.js";
import type { StackVerbDeps } from "../../../../../cli/commands/github/stackVerbDeps.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** A dependency the snapshot must never reach. */
function unused(): never {
  throw new Error("restackSnapshot reached an edge it must not use");
}

const LOCAL_SHAS: ReadonlyMap<string, string> = new Map([
  ["refs/heads/feat-a", "aaaa111"],
  ["refs/heads/feat-b", "bbbb222"],
  ["refs/heads/feat-d", "dddd444"],
]);

/** Every `readGit` call, recorded so the test can see the exact argv and cwd. */
const reads: { args: readonly string[]; cwd: string }[] = [];

const readGit: GithubPushDeps["readGit"] = ({ args, cwd }) => {
  reads.push({ args, cwd });
  const ref = args[1]!;
  const sha = LOCAL_SHAS.get(ref);
  if (sha === undefined) {
    throw new Error(`fatal: ambiguous argument '${ref}'`);
  }
  return sha;
};

const DEPS: StackVerbDeps = {
  git: { cwd: unused, doorLedger: memoryDoorLedger().port, out: unused, readGit, writeGit: unused },
  makeApi: unused,
  now: unused,
  out: unused,
  token: unused,
};

/** One open pull request on the named branches. */
function pr({ number, headRef, baseRef }: { number: number; headRef: string; baseRef: string }): RestackPullRequest {
  return { baseIsAncestorOfHead: false, baseRef, headRef, headSha: `remote-${headRef}`, number };
}

const IN_SCOPE: readonly RestackPullRequest[] = [
  pr({ baseRef: "main", headRef: "feat-a", number: 10 }),
  pr({ baseRef: "feat-a", headRef: "feat-b", number: 11 }),
  pr({ baseRef: "feat-b", headRef: "feat-c", number: 12 }),
  pr({ baseRef: "gone-base", headRef: "feat-d", number: 13 }),
];

const FOREST: RestackForest = {
  residue: [],
  trees: [
    {
      nodes: [
        {
          baseBranch: "main",
          branch: "feat-a",
          depth: 0,
          headSha: "remote-feat-a",
          pullRequestNumber: 10,
          reason: "base-moved",
        },
        {
          baseBranch: "feat-a",
          branch: "feat-b",
          depth: 1,
          headSha: "remote-feat-b",
          pullRequestNumber: 11,
          reason: "propagated",
        },
        {
          baseBranch: "feat-b",
          branch: "feat-c",
          depth: 2,
          headSha: "remote-feat-c",
          pullRequestNumber: 12,
          reason: "propagated",
        },
        {
          baseBranch: "gone-base",
          branch: "feat-d",
          depth: 0,
          headSha: "remote-feat-d",
          pullRequestNumber: 13,
          reason: undefined,
        },
      ],
      rootBranch: "feat-a",
    },
  ],
};

const OUTCOMES: readonly RestackOutcome[] = [
  { branch: "feat-a", fromSha: "remote-feat-a", kind: "restacked", toSha: "a-replayed" },
  { branch: "feat-b", kind: "conflict", reason: "conflict in src/index.ts" },
];

describe("restackSnapshot", () => {
  it("builds one complete row per in-scope pull request across every preparation arm", () => {
    reads.length = 0;
    const snapshot = restackSnapshot({
      baseTips: new Map([
        ["main", "main-tip"],
        ["feat-a", "a-tip"],
        ["feat-b", "b-tip"],
      ]),
      deps: DEPS,
      forest: FOREST,
      generationId: "gen-7",
      inScope: IN_SCOPE,
      nowIso: "2026-10-13T09:30:00.000Z",
      outcomes: OUTCOMES,
      repo: "Acme/Widget",
      repoRoot: "/repo/root",
    });
    expect(snapshot).toEqual({
      entries: [
        {
          baseRef: "main",
          headRef: "feat-a",
          kind: "pull-request",
          localBranchSha: "aaaa111",
          number: 10,
          observedBaseSha: "main-tip",
          preparation: {
            kind: "ready",
            preparedRef: "refs/slopweaver/restack/gen-7/feat-a",
            preparedSha: "a-replayed",
          },
          remoteHeadSha: "remote-feat-a",
        },
        {
          baseRef: "feat-a",
          headRef: "feat-b",
          kind: "pull-request",
          localBranchSha: "bbbb222",
          number: 11,
          observedBaseSha: "a-tip",
          preparation: { kind: "blocked", reason: "conflict in src/index.ts" },
          remoteHeadSha: "remote-feat-b",
        },
        {
          baseRef: "feat-b",
          headRef: "feat-c",
          kind: "pull-request",
          localBranchSha: null,
          number: 12,
          observedBaseSha: "b-tip",
          preparation: {
            kind: "blocked",
            reason: "its tree stopped below it, so this run never attempted its replay",
          },
          remoteHeadSha: "remote-feat-c",
        },
        {
          baseRef: "gone-base",
          headRef: "feat-d",
          kind: "pull-request",
          localBranchSha: "dddd444",
          number: 13,
          observedBaseSha: null,
          preparation: { kind: "unchanged" },
          remoteHeadSha: "remote-feat-d",
        },
      ],
      header: {
        generationId: "gen-7",
        kind: "header",
        recordedAtIso: "2026-10-13T09:30:00.000Z",
        repo: "acme/widget",
        version: 1,
      },
    });
  });

  it("reads each local branch with rev-parse of its full ref, from the repository root, in scope order", () => {
    reads.length = 0;
    restackSnapshot({
      baseTips: new Map(),
      deps: DEPS,
      forest: FOREST,
      generationId: "gen-7",
      inScope: IN_SCOPE,
      nowIso: "2026-10-13T09:30:00.000Z",
      outcomes: [],
      repo: "acme/widget",
      repoRoot: "/repo/root",
    });
    expect(reads).toEqual([
      { args: ["rev-parse", "refs/heads/feat-a"], cwd: "/repo/root" },
      { args: ["rev-parse", "refs/heads/feat-b"], cwd: "/repo/root" },
      { args: ["rev-parse", "refs/heads/feat-c"], cwd: "/repo/root" },
      { args: ["rev-parse", "refs/heads/feat-d"], cwd: "/repo/root" },
    ]);
  });

  it("records a null local SHA whenever the git read throws, whatever the failure", () => {
    const failing: GithubPushDeps["readGit"] = () => {
      throw new Error("fatal: not a git repository");
    };
    const snapshot = restackSnapshot({
      baseTips: new Map(),
      deps: { ...DEPS, git: { ...DEPS.git, readGit: failing } },
      forest: { residue: [], trees: [] },
      generationId: "gen-8",
      inScope: [pr({ baseRef: "main", headRef: "feat-a", number: 10 })],
      nowIso: "2026-10-13T09:30:00.000Z",
      outcomes: [],
      repo: "acme/widget",
      repoRoot: "/repo/root",
    });
    expect(snapshot.entries).toEqual([
      {
        baseRef: "main",
        headRef: "feat-a",
        kind: "pull-request",
        localBranchSha: null,
        number: 10,
        observedBaseSha: null,
        preparation: { kind: "unchanged" },
        remoteHeadSha: "remote-feat-a",
      },
    ]);
  });

  it("publishes an empty inventory with its header when nothing is in scope", () => {
    expect(
      restackSnapshot({
        baseTips: new Map(),
        deps: DEPS,
        forest: { residue: [], trees: [] },
        generationId: "gen-9",
        inScope: [],
        nowIso: "2026-10-13T10:00:00.000Z",
        outcomes: [],
        repo: "ACME/WIDGET",
        repoRoot: "/repo/root",
      }),
    ).toEqual({
      entries: [],
      header: {
        generationId: "gen-9",
        kind: "header",
        recordedAtIso: "2026-10-13T10:00:00.000Z",
        repo: "acme/widget",
        version: 1,
      },
    });
  });
});
