import { rmSync } from "node:fs";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import { runGithubPush } from "../../../../../cli/commands/github/pushRun.js";
import {
  runStackCarry,
  runStackCarryGate,
  type StackCarryGate,
  type StackCarryRequest,
} from "../../../../../cli/commands/github/stackCarryRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { GithubStack } from "../../../../../corpus/github/stack.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { err, ok } from "../../../../../lib/result.js";
import { unmeasurable } from "../../../../../measurement/status.js";
import { registerStackMember } from "../../../../../outbound/github/stackLedger.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../../../pushRootFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const BOTTOM_SHA = "1111111111111111111111111111111111111111";
const REMOTE_SHA = "2222222222222222222222222222222222222222";
const MID_SHA = "3333333333333333333333333333333333333333";
const TOP_SHA = "4444444444444444444444444444444444444444";
const PARENT_SHA = "5555555555555555555555555555555555555555";
const FRESH_BASE_SHA = "6666666666666666666666666666666666666666";
const PREFIX: readonly string[] = ["node", "slopweaver", "github", "push", "--cwd", "/repo", "--force-with-lease"];

/** The three-entry stack every scenario here pushes the BOTTOM of: bottom → mid → top. */
function threeEntryStack(): GithubStack {
  return {
    entries: [
      { baseRef: "main", headRef: "bottom", mergedAtIso: undefined, number: 10, state: "open" },
      { baseRef: "bottom", headRef: "mid", mergedAtIso: undefined, number: 11, state: "open" },
      { baseRef: "mid", headRef: "top", mergedAtIso: undefined, number: 12, state: "open" },
    ],
    id: 7,
    number: 7,
    open: true,
  };
}

function pr({ number, commits, sha }: { number: number; commits: number; sha: string }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "owner/repo",
    body: "b",
    commits,
    draft: false,
    head: { label: "owner:h", ref: "h", repoFullName: "owner/repo", sha },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: number === 10 ? { id: 7, number: 7, position: 1, size: 3 } : undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-09-07T00:00:00Z",
  };
}

/** Every method stubbed to fail loudly — a scenario fills in only what it actually reaches. */
function stackApi({ prs }: { prs: Readonly<Record<number, WrittenPr>> }): GithubWriteApi {
  const unreachable = { kind: "http" as const, message: "should not be called", operation: "x" };
  const answer = (): never => {
    throw new Error("unreachable API call");
  };
  return {
    mergeGroupContexts: () => errAsync(unreachable),
    requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
    setRequiredStatusChecks: () => errAsync(unreachable),
    addIssueLabels: () => errAsync(unreachable),
    addToStack: () => errAsync(unreachable),
    answerReviewThread: () => errAsync(unreachable),
    reopenReviewThread: () => errAsync(unreachable),
    authenticatedUserId: () => okAsync(1),
    branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
    canAdmin: () => okAsync(false),
    canPush: () => okAsync(true),
    closePr: () => errAsync(unreachable),
    codeScanningAlert: () => errAsync(unreachable),
    codeScanningAlerts: () => errAsync(unreachable),
    dependabotAlert: () => errAsync(unreachable),
    dependabotAlerts: () => errAsync(unreachable),
    createIssueComment: () => errAsync(unreachable),
    createPr: () => errAsync(unreachable),
    createStack: () => errAsync(unreachable),
    dequeuePr: () => errAsync(unreachable),
    diffFiles: () => errAsync(unreachable),
    dismissCodeScanningAlert: () => errAsync(unreachable),
    enqueuePr: () => errAsync(unreachable),
    enqueueStackPr: () => errAsync(unreachable),
    findOpenPrByHead: ({ head }) => okAsync(head === "bottom" ? prs[10] : undefined),
    getIssueComment: () => errAsync(unreachable),
    getPr: ({ number }) => (prs[number] === undefined ? errAsync(unreachable) : okAsync(prs[number])),
    getRepoDescription: () => errAsync(unreachable),
    getStack: () => okAsync(threeEntryStack()),
    issueLabels: () => errAsync(unreachable),
    listIssueComments: () => errAsync(unreachable),
    listOpenPrs: () => okAsync({ prs: [], truncated: false, viewerId: undefined }),
    listOpenPrsAuthoredByMe: () => okAsync({ prs: [], truncated: false }),
    listPrs: () => okAsync([]),
    listRuns: () => okAsync([]),
    markPrDraft: () => okAsync(undefined),
    markPrReady: () => okAsync(undefined),
    mergePr: () => errAsync(unreachable),
    repoLabels: () => errAsync(unreachable),
    requestedReviewers: () => errAsync(unreachable),
    requestReviewers: () => errAsync(unreachable),
    reviewThreadDetails: () => errAsync(unreachable),
    reviewThreads: () => errAsync(unreachable),
    setRepoDescription: () => errAsync(unreachable),
    submitReviewRound: () => answer(),
    unstack: () => errAsync(unreachable),
    updateIssueComment: () => errAsync(unreachable),
    updatePr: () => errAsync(unreachable),
  };
}

/** One record of `git worktree list --porcelain -z` output. */
function worktreeRecord({ path, branch }: { path: string; branch: string }): string {
  return [`worktree ${path}`, `HEAD ${"4".repeat(40)}`, `branch refs/heads/${branch}`].join("\0");
}

/** A home whose local stack ledger already registered whichever entries this scenario needs. */
function tempHome({ registeredNumbers }: { registeredNumbers: readonly number[] }): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-carry-home-" });
  fixtureDirs.push(home);
  for (const number of registeredNumbers) {
    registerStackMember({ home, nowIso: "2026-09-07T00:00:00Z", number, owner: "owner", repo: "repo", via: "push" });
  }
  return home;
}

/** The reads that never depend on which step is running. */
function staticReads({ worktreesText }: { worktreesText: string }): Readonly<Record<string, string>> {
  return {
    "ls-remote --symref origin HEAD refs/heads/bottom": `ref: refs/heads/main\tHEAD\n${BOTTOM_SHA}\tHEAD\n${REMOTE_SHA}\trefs/heads/bottom`,
    "ls-remote origin refs/heads/bottom": `${BOTTOM_SHA}\trefs/heads/bottom`,
    "ls-remote origin refs/heads/mid": `${MID_SHA}\trefs/heads/mid`,
    "ls-remote origin refs/heads/top": `${TOP_SHA}\trefs/heads/top`,
    "remote get-url origin": "git@example.test:owner/repo.git",
    [`rev-list --parents -1 ${MID_SHA}^{commit}`]: `${MID_SHA} ${PARENT_SHA}`,
    [`rev-list --parents -1 ${TOP_SHA}^{commit}`]: `${TOP_SHA} ${PARENT_SHA}`,
    "rev-parse --show-toplevel": "/repo",
    "rev-parse refs/heads/bottom": BOTTOM_SHA,
    "rev-parse refs/heads/mid": MID_SHA,
    "rev-parse refs/slopweaver/fetch/base-freshness^{commit}": BOTTOM_SHA,
    "status --porcelain": "",
    "symbolic-ref --quiet --short HEAD": "bottom",
    "worktree list --porcelain -z": worktreesText,
  };
}

function harness({
  prs,
  rebaseOk = true,
  midHasWorktree = true,
}: {
  prs: Readonly<Record<number, WrittenPr>>;
  rebaseOk?: boolean;
  /** False leaves `mid` with no worktree at all — the shape that makes it un-carryable. */
  midHasWorktree?: boolean;
}): { deps: GithubPushDeps; lines: string[]; writes: readonly string[][] } {
  const lines: string[] = [];
  const writes: string[][] = [];
  const worktreesText = [
    worktreeRecord({ branch: "bottom", path: "/repo" }),
    ...(midHasWorktree ? [worktreeRecord({ branch: "mid", path: "/repo-mid" })] : []),
    worktreeRecord({ branch: "top", path: "/repo-top" }),
    "",
  ].join("\0\0");
  const reads = staticReads({ worktreesText });
  // The carry's rebase primitive fetches the fresh base into a randomly-named private ref, so the fake has
  // to answer about whichever ref the write it just captured actually named.
  let capturedRef: string | undefined;
  const readGit = ({ args, cwd }: { args: readonly string[]; cwd: string }): string => {
    const command = args.join(" ");
    // The commit-message scan's read of what the push would publish: one commit, with a clean message.
    if (args[0] === "--no-replace-objects" && args[1] === "log") return `\u001e${BOTTOM_SHA}\0fix: carry the stack\n`;
    if (command === "rev-parse HEAD") {
      if (cwd === "/repo-top") return TOP_SHA;
      return cwd === "/repo" ? BOTTOM_SHA : MID_SHA;
    }
    if (capturedRef !== undefined && command === `rev-parse ${capturedRef}^{commit}`) return FRESH_BASE_SHA;
    if (command === `merge-base ${FRESH_BASE_SHA}^{commit} ${PARENT_SHA}^{commit}`) return PARENT_SHA;
    const value = reads[command];
    if (value !== undefined) return value;
    // The head carries no proof output, so the push door passes it.
    if (args.includes("ls-tree")) return "";
    throw new Error(`unexpected Git read: ${command}`);
  };
  const gitDeps: GithubPushDeps = {
    cwd: () => "/unused",
    doorLedger: memoryDoorLedger().port,
    out: ({ line }) => lines.push(line),
    readGit,
    readPatchId: () => ok("5e1877358e8c58c6bdc46b92483800474b4b1b32"),
    stackCarry: {
      isAncestor: () => false,
      makeApi: () => stackApi({ prs }),
      token: () => "fake-test-token",
    },
    writeGit: ({ args }) => {
      writes.push([...args]);
      if (args[0] === "fetch") {
        capturedRef = args[2]?.split(":")[1];
        return ok(undefined);
      }
      if (args[0] === "rebase") return rebaseOk ? ok(undefined) : err("conflict in checkout.tsx");
      return ok(undefined);
    },
  };
  return {
    deps: {
      ...gitDeps,
      baseFreshness: {
        countCommitsAhead: () => ok(0),
        git: gitDeps,
        isAncestor: () => ok(true),
        measureReverted: () => [],
        newPrivateRef: () => "refs/slopweaver/fetch/base-freshness",
      },
      hold: {
        appendLedgerRow: () => ok(undefined),
        holderLive: () => unmeasurable<boolean>({ why: "this fake asks no registry" }),
        nowIso: () => "2026-09-07T00:10:00.000Z",
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

/** Both entries above are single-commit and worktree-resolvable, so the whole stack can be carried. */
const CARRYABLE: Readonly<Record<number, WrittenPr>> = {
  10: pr({ commits: 1, number: 10, sha: BOTTOM_SHA }),
  11: pr({ commits: 1, number: 11, sha: MID_SHA }),
  12: pr({ commits: 1, number: 12, sha: TOP_SHA }),
};

describe("github push carries the stack above a mid-stack entry", () => {
  it("rebases and pushes every entry above, bottom-up, after the branch itself lands", async () => {
    const { deps, lines, writes } = harness({ prs: CARRYABLE });
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("carry: would rebase mid (PR #11, stack #7 position 2) onto bottom and push it");
    expect(lines).toContain("carry: would rebase top (PR #12, stack #7 position 3) onto mid and push it");
    expect(lines).toContain("carry: carried mid (PR #11)");
    expect(lines).toContain("carry: carried top (PR #12)");
    expect(writes.filter((args) => args[0] === "push").map((args) => args.at(-1))).toEqual([
      `${BOTTOM_SHA}^{commit}:refs/heads/bottom`,
      `${MID_SHA}^{commit}:refs/heads/mid`,
      `${TOP_SHA}^{commit}:refs/heads/top`,
    ]);
  });

  it("pushes the branch itself BEFORE it rebases anything above it", async () => {
    const { deps, writes } = harness({ prs: CARRYABLE });
    await runGithubPush({ argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [10, 11, 12] })], deps });
    const kinds = writes.map((args) => args[0]).filter((kind) => kind === "push" || kind === "rebase");
    expect(kinds).toEqual(["push", "rebase", "push", "rebase", "push"]);
  });

  it("stops at the first entry that conflicts, and exits non-zero", async () => {
    const { deps, lines, writes } = harness({ prs: CARRYABLE, rebaseOk: false });
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toContain("carry: conflict: mid (PR #11) — conflict in checkout.tsx");
    expect(lines).not.toContain("carry: carried top (PR #12)");
    expect(writes.filter((args) => args[0] === "push").map((args) => args.at(-1))).toEqual([
      `${BOTTOM_SHA}^{commit}:refs/heads/bottom`,
    ]);
  });

  it("refuses by name, sending nothing, when an entry above cannot be carried", async () => {
    const { deps, lines, writes } = harness({
      prs: { ...CARRYABLE, 11: pr({ commits: 2, number: 11, sha: MID_SHA }) },
    });
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toContain(
      "refused: pushing bottom would orphan 2 pull request(s) stacked above it, and this push cannot carry them:",
    );
    expect(lines).toContain(
      "  #11 (mid) — stack #7 position 2 (PR #11) has 2 commit(s) — sync only rebases a PR that is exactly one commit; refusing to plan the rest of this stack above it",
    );
    expect(lines).toContain(
      "fix what each one reports, or accept the orphaning deliberately with --orphan-above 11,12",
    );
    expect(writes.filter((args) => args[0] === "push")).toEqual([]);
  });

  it("refuses when an entry above has no worktree to rebase in", async () => {
    const { deps, lines, writes } = harness({ midHasWorktree: false, prs: CARRYABLE });
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toContain(
      "  #11 (mid) — stack #7 position 2 (PR #11) has no resolvable worktree — refusing to plan the rest of this stack above it",
    );
    expect(writes.filter((args) => args[0] === "push")).toEqual([]);
  });

  it("pushes with the orphaning acknowledged, once --orphan-above names exactly what would be left behind", async () => {
    const { deps, lines, writes } = harness({
      prs: { ...CARRYABLE, 11: pr({ commits: 2, number: 11, sha: MID_SHA }) },
    });
    const code = await runGithubPush({
      argv: [...PREFIX, "--orphan-above", "11,12", "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("carry: ORPHANING #11 (mid) — acknowledged by --orphan-above");
    expect(lines).toContain("carry: ORPHANING #12 (top) — acknowledged by --orphan-above");
    expect(writes.filter((args) => args[0] === "push").map((args) => args.at(-1))).toEqual([
      `${BOTTOM_SHA}^{commit}:refs/heads/bottom`,
    ]);
  });

  it("refuses an --orphan-above that does not name every entry it would orphan", async () => {
    const { deps, lines, writes } = harness({
      prs: { ...CARRYABLE, 11: pr({ commits: 2, number: 11, sha: MID_SHA }) },
    });
    const code = await runGithubPush({
      argv: [...PREFIX, "--orphan-above", "11", "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toContain("--orphan-above does not name #12");
    expect(writes.filter((args) => args[0] === "push")).toEqual([]);
  });

  it("refuses under --dry-run too, so a preview discloses the same block a real run would hit", async () => {
    const { deps, lines, writes } = harness({
      prs: { ...CARRYABLE, 11: pr({ commits: 2, number: 11, sha: MID_SHA }) },
    });
    const code = await runGithubPush({
      argv: [...PREFIX, "--dry-run", "--home", tempHome({ registeredNumbers: [10, 11, 12] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toContain(
      "  #11 (mid) — stack #7 position 2 (PR #11) has 2 commit(s) — sync only rebases a PR that is exactly one commit; refusing to plan the rest of this stack above it",
    );
    expect(writes.filter((args) => args[0] === "push")).toEqual([]);
  });

  it("leaves a repository with no registered stack members untouched, reaching no API at all", async () => {
    const { deps, lines, writes } = harness({ prs: {} });
    const code = await runGithubPush({ argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [] })], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines.filter((line) => line.startsWith("carry:"))).toEqual([]);
    expect(writes.filter((args) => args[0] === "push").map((args) => args.at(-1))).toEqual([
      `${BOTTOM_SHA}^{commit}:refs/heads/bottom`,
    ]);
  });
});

/** A Git edge the gate's early answers must never reach — every call throws, naming it. */
function unreachableGit(): GithubPushDeps {
  const fail = ({ what }: { what: string }): never => {
    throw new Error(`the carry gate must not reach Git here: ${what}`);
  };
  return {
    cwd: () => fail({ what: "cwd" }),
    doorLedger: unreachableDoorLedger(),
    out: () => fail({ what: "out" }),
    readGit: ({ args }) => fail({ what: args.join(" ") }),
    writeGit: ({ args }) => fail({ what: args.join(" ") }),
  };
}

/** A carry request for `bottom` in owner/repo whose token resolver records every home it was asked for. */
function carryRequest({ home, tokenHomes }: { home: string; tokenHomes: string[] }): StackCarryRequest {
  return {
    branch: "bottom",
    carry: {
      isAncestor: () => {
        throw new Error("the carry gate must not measure ancestry here");
      },
      makeApi: () => {
        throw new Error("the carry gate must not build an API here");
      },
      token: ({ home: asked }) => {
        tokenHomes.push(asked);
        return undefined;
      },
    },
    defaultBranch: "main",
    git: unreachableGit(),
    home,
    orphanAbove: [],
    remote: "origin",
    repo: "owner/repo",
    repoRoot: "/repo",
  };
}

/** A home whose stack ledger holds `number`, registered under `owner/repo`. */
function ledgerHome({ number, repo }: { number: number; repo: string }): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "github-carry-gate-home-" });
  fixtureDirs.push(home);
  registerStackMember({ home, nowIso: "2026-09-07T00:00:00Z", number, owner: "owner", repo, via: "push" });
  return home;
}

describe("runStackCarryGate, called directly", () => {
  it("answers clear and prints nothing, asking for no token, when the ledger's members are another repository's", async () => {
    const tokenHomes: string[] = [];
    const lines: string[] = [];
    const gate = await runStackCarryGate({
      out: ({ line }) => lines.push(line),
      request: carryRequest({ home: ledgerHome({ number: 10, repo: "other" }), tokenHomes }),
    });
    expect(gate).toEqual({ kind: "clear" });
    expect(lines).toEqual([]);
    expect(tokenHomes).toEqual([]);
  });

  it("refuses, printing why, once this repository has a registered member and no token resolves", async () => {
    const tokenHomes: string[] = [];
    const lines: string[] = [];
    const home = ledgerHome({ number: 10, repo: "repo" });
    const gate = await runStackCarryGate({
      out: ({ line }) => lines.push(line),
      request: carryRequest({ home, tokenHomes }),
    });
    const refusal =
      "refused: this repository has registered stack members, but no GitHub token resolved " +
      "($SLOPWEAVER_HOME/secrets/github-token, or gh auth token), so what is stacked above bottom cannot be read — refusing rather " +
      "than pushing blind";
    expect(gate).toEqual({ kind: "refused", lines: [refusal] });
    expect(lines).toEqual([refusal]);
    expect(tokenHomes).toEqual([home]);
  });
});

describe("runStackCarry, called directly", () => {
  it("answers true and touches no Git for a clear gate, a refused gate and a carry with no step", () => {
    const gates: readonly StackCarryGate[] = [
      { kind: "clear" },
      { kind: "refused", lines: ["refused: not this push"] },
      { kind: "carry", lines: [], plan: { orphans: [], skipped: ["#11 is merged"], steps: [] } },
    ];
    const lines: string[] = [];
    const landed = gates.map((gate) =>
      runStackCarry({
        gate,
        git: unreachableGit(),
        home: HOME_WITHOUT_PUSH_ROOTS,
        out: ({ line }) => lines.push(line),
        remote: "origin",
      }),
    );
    expect(landed).toEqual([true, true, true]);
    expect(lines).toEqual([]);
  });
});
