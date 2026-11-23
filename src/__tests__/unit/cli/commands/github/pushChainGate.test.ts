/**
 * `github push`'s chained-not-natively-stacked gate — the door that stops a chain nobody registered from
 * being kept alive by the next push to it.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { pushChainGateRefused } from "../../../../../cli/commands/github/pushChainGate.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };
const TOKEN = "fake-test-token";

/** One open pull request, addressed by its head branch. */
function pr({
  baseRef,
  headRef,
  number,
  stack,
}: {
  baseRef: string;
  headRef: string;
  number: number;
  stack?: WrittenPr["stack"];
}): WrittenPr {
  return {
    authorId: 1,
    baseRef,
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: `o:${headRef}`, ref: headRef, repoFullName: "o/r", sha: "a".repeat(40) },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack,
    state: "open",
    title: "t",
    updatedAtIso: "2026-09-08T00:00:00Z",
  };
}

/** A `findOpenPrByHead` that answers from a fixed branch table, and errors for nothing else. */
function apiOver({ byHead }: { byHead: ReadonlyMap<string, WrittenPr> }): Pick<GithubWriteApi, "findOpenPrByHead"> {
  return { findOpenPrByHead: ({ head }) => okAsync(byHead.get(head)) };
}

/** The push deps this gate reads, with a collected output sink. */
function depsOver({
  api,
  lines,
  token,
}: {
  api: Pick<GithubWriteApi, "findOpenPrByHead">;
  lines: string[];
  /** Explicit at every call site — a default here would swallow the `undefined` the no-token case passes. */
  token: string | undefined;
}): GithubPushDeps {
  return {
    cwd: () => "/repo",
    doorLedger: memoryDoorLedger().port,
    out: ({ line }) => lines.push(line),
    readGit: () => {
      throw new Error("the chain gate touches no git");
    },
    stackCarry: {
      isAncestor: () => {
        throw new Error("the chain gate asks no ancestry question");
      },
      makeApi: () => api as GithubWriteApi,
      token: () => token,
    },
    writeGit: () => {
      throw new Error("the chain gate writes no git");
    },
  };
}

describe("pushChainGateRefused", () => {
  it("lets an ordinary branch based on the default branch through", async () => {
    const lines: string[] = [];
    const api = apiOver({ byHead: new Map([["feature", pr({ baseRef: "main", headRef: "feature", number: 1 })]]) });

    const refused = await pushChainGateRefused({
      branch: "feature",
      defaultBranch: "main",
      deps: depsOver({ api, lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(false);
    expect(lines).toEqual([]);
  });

  it("lets a branch with no open pull request through", async () => {
    const lines: string[] = [];
    const refused = await pushChainGateRefused({
      branch: "feature",
      defaultBranch: "main",
      deps: depsOver({ api: apiOver({ byHead: new Map() }), lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(false);
  });

  it("lets a base branch that nobody has opened a pull request for through", async () => {
    const lines: string[] = [];
    const api = apiOver({ byHead: new Map([["upper", pr({ baseRef: "lower", headRef: "upper", number: 2 })]]) });

    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: depsOver({ api, lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(false);
  });

  it("lets a properly formed native stack entry through", async () => {
    const lines: string[] = [];
    const stack = { id: 9, number: 16958, position: 2, size: 2 };
    const api = apiOver({
      byHead: new Map([
        ["upper", pr({ baseRef: "lower", headRef: "upper", number: 2, stack })],
        ["lower", pr({ baseRef: "main", headRef: "lower", number: 1, stack: { ...stack, position: 1 } })],
      ]),
    });

    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: depsOver({ api, lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(false);
    expect(lines).toEqual([]);
  });

  it("refuses a chain that carries no native stack, naming the pair", async () => {
    const lines: string[] = [];
    const api = apiOver({
      byHead: new Map([
        ["upper", pr({ baseRef: "lower", headRef: "upper", number: 16676 })],
        ["lower", pr({ baseRef: "main", headRef: "lower", number: 16672 })],
      ]),
    });

    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: depsOver({ api, lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(true);
    expect(lines[0]).toBe(
      "refused: pushing upper, whose open pull request #16676 is based on lower would leave a chained pull request that GitHub does not know is a stack.",
    );
    expect(lines[3]).toBe("  there is no native stack yet, so one must be formed from the pair.");
  });

  it("refuses a child that never joined the stack its parent is in, and names that stack", async () => {
    const lines: string[] = [];
    const api = apiOver({
      byHead: new Map([
        ["upper", pr({ baseRef: "lower", headRef: "upper", number: 16355 })],
        [
          "lower",
          pr({
            baseRef: "main",
            headRef: "lower",
            number: 16339,
            stack: { id: 9, number: 16958, position: 1, size: 3 },
          }),
        ],
      ]),
    });

    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: depsOver({ api, lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(true);
    expect(lines[3]).toBe("  it must join native stack #16958.");
  });

  it("refuses rather than pushing blind when no token resolves", async () => {
    const lines: string[] = [];
    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: depsOver({ api: apiOver({ byHead: new Map() }), lines, token: undefined }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(true);
    expect(lines[0]).toContain("refusing rather than pushing blind");
  });

  it("refuses rather than pushing blind when the pull request cannot be read", async () => {
    const lines: string[] = [];
    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: depsOver({ api: { findOpenPrByHead: () => errAsync(HTTP_ERROR) }, lines, token: TOKEN }),
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(true);
    expect(lines[0]).toBe("refused: could not read the open pull request for upper: unreachable");
  });

  it("passes a driver that has no GitHub surface at all, exactly as the carry gate does", async () => {
    const lines: string[] = [];
    const deps = depsOver({ api: apiOver({ byHead: new Map() }), lines, token: TOKEN });
    const { stackCarry, ...withoutCarry } = deps;

    const refused = await pushChainGateRefused({
      branch: "upper",
      defaultBranch: "main",
      deps: withoutCarry,
      home: "/home",
      repo: "o/r",
    });

    expect(refused).toBe(false);
    expect(stackCarry === undefined).toBe(false);
  });
});
