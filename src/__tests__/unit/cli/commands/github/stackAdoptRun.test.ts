import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { localAdoptFacts } from "../../../../../cli/commands/github/stackAdoptGit.js";
import { type GithubStackAdoptDeps, runGithubStackAdopt } from "../../../../../cli/commands/github/stackAdoptRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubStack } from "../../../../../corpus/github/stack.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { err, ok } from "../../../../../lib/result.js";
import { isRegisteredStackMember } from "../../../../../outbound/github/stackLedger.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const HEAD_SHA = "3333333333333333333333333333333333333333";
const PARENT_SHA = "5555555555555555555555555555555555555555";
const MAIN_SHA = "1111111111111111111111111111111111111111";
const PRIVATE_REF_PLACEHOLDER = "refs/slopweaver/fetch/<ref>";
const PREFIX: readonly string[] = ["node", "slopweaver", "github", "stack", "adopt", "--pr", "100"];

/** Replace the randomly-named private fetch ref with a stable placeholder, for exact-value assertions. */
function normalizeWrites({ writes }: { writes: readonly (readonly string[])[] }): (readonly string[])[] {
  return writes.map((args) =>
    args.map((arg) => arg.replace(/refs\/slopweaver\/fetch\/[0-9a-f-]{36}/g, PRIVATE_REF_PLACEHOLDER)),
  );
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, isolated ledger directory — matching `stackPushRun/harness.ts`'s own `tempHome`. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "github-stack-adopt-home-"));
  fixtureDirs.push(home);
  return home;
}

function pr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:top", ref: "top", repoFullName: "o/r", sha: HEAD_SHA },
    htmlUrl: "https://example.invalid/pr/100",
    mergedAtIso: undefined,
    nodeId: "PR_100",
    number: 100,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function nativeStack({
  number,
  entries,
}: {
  number: number;
  entries: readonly GithubStack["entries"][number][];
}): GithubStack {
  return { entries, id: number, number, open: true };
}

/** Every method stubbed to fail loudly — a test only fills in the ones its scenario actually reaches. */
function unreachableApi(overrides: Partial<GithubWriteApi>): GithubWriteApi {
  const unreachable = { kind: "http" as const, message: "should not be called", operation: "x" };
  return {
    mergeGroupContexts: () => errAsync(unreachable),
    requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
    setRequiredStatusChecks: () => errAsync(unreachable),
    addToStack: () => errAsync(unreachable),
    addIssueLabels: () => errAsync(unreachable),
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
    findOpenPrByHead: () => errAsync(unreachable),
    getIssueComment: () => errAsync(unreachable),
    getPr: () => errAsync(unreachable),
    getRepoDescription: () => errAsync(unreachable),
    getStack: () => errAsync(unreachable),
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
    submitReviewRound: () => errAsync(unreachable),
    updateIssueComment: () => errAsync(unreachable),
    updatePr: () => errAsync(unreachable),
    unstack: () => errAsync(unreachable),
    ...overrides,
  };
}

/** Every command with a fixed answer, independent of call order or captured state. */
function staticReads({
  branch,
  defaultBranch,
  dirty,
  remoteUrl,
}: {
  branch: string;
  defaultBranch: string;
  dirty: boolean;
  remoteUrl: string;
}): Readonly<Record<string, string>> {
  return {
    "remote get-url origin": remoteUrl,
    "rev-parse --show-toplevel": "/repo",
    "rev-parse HEAD": HEAD_SHA,
    [`ls-remote --symref origin HEAD refs/heads/${branch}`]: `ref: refs/heads/${defaultBranch}\tHEAD\n${MAIN_SHA}\tHEAD`,
    [`rev-list --parents -1 ${HEAD_SHA}^{commit}`]: `${HEAD_SHA} ${PARENT_SHA}`,
    "status --porcelain": dirty ? " M some-file.ts" : "",
    "symbolic-ref --quiet --short HEAD": branch,
  };
}

/**
 * Build the injectable deps. `ls-remote origin refs/heads/top` (no `--symref`) is read exactly ONCE in a real
 * adopted run — after the push, to confirm it landed — since the lease itself is built from `plan.headSha`
 * (already confirmed by the freshness re-check), never from a fresh pre-push read.
 */
function harness({
  branch = "top",
  defaultBranch = "main",
  dirty = false,
  rebaseOk = true,
  pushOk = true,
  postPushRemoteSha = HEAD_SHA,
  remoteUrl = "git@example.test:o/r.git",
  api,
}: {
  branch?: string;
  defaultBranch?: string;
  dirty?: boolean;
  rebaseOk?: boolean;
  pushOk?: boolean;
  postPushRemoteSha?: string;
  remoteUrl?: string;
  api: GithubWriteApi;
}): { deps: GithubStackAdoptDeps; door: MemoryDoorLedger; writes: (readonly string[])[]; lines: string[] } {
  const writes: (readonly string[])[] = [];
  const lines: string[] = [];
  let capturedRef: string | undefined;
  const readGit = ({ args }: { args: readonly string[] }): string => {
    const command = args.join(" ");
    if (capturedRef !== undefined && command === `rev-parse ${capturedRef}^{commit}`) return MAIN_SHA;
    if (command === `ls-remote origin refs/heads/${branch}`) return `${postPushRemoteSha}\trefs/heads/${branch}`;
    const value = staticReads({ branch, defaultBranch, dirty, remoteUrl })[command];
    if (value !== undefined) return value;
    // The head carries no proof output, so the push door passes it.
    if (args.includes("ls-tree")) return "";
    throw new Error(`unexpected Git read: ${command}`);
  };
  const door = memoryDoorLedger();
  const deps: GithubStackAdoptDeps = {
    env: () => undefined,
    git: {
      cwd: () => "/repo",
      doorLedger: door.port,
      out: ({ line }) => lines.push(line),
      readGit,
      writeGit: ({ args }) => {
        writes.push(args);
        if (args[0] === "fetch") {
          capturedRef = args[2]?.split(":")[1];
          return ok(undefined);
        }
        if (args[0] === "update-ref") return ok(undefined);
        if (args[0] === "rebase") return rebaseOk ? ok(undefined) : err("conflict in file.ts");
        return pushOk ? ok(undefined) : err("git exited 1");
      },
    },
    makeApi: () => api,
    now: () => new Date("2026-08-10T00:00:00Z"),
    out: ({ line }) => lines.push(line),
    token: () => "fake-test-token",
  };
  return { deps, door, lines, writes };
}

describe("runGithubStackAdopt", () => {
  it("refuses usage errors before any Git read", async () => {
    const api = unreachableApi({});
    const { deps } = harness({ api });
    const code = await runGithubStackAdopt({ argv: ["node", "slopweaver", "github", "stack", "adopt"], deps });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a closed pull request before any write", async () => {
    const api = unreachableApi({ getPr: () => okAsync(pr({ state: "closed" })) });
    const { deps, lines, writes } = harness({ api });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines).toEqual(["refused: PR #100 is closed, not open — adopt only handles an open pull request"]);
  });

  it("refuses a dirty worktree before any write", async () => {
    const api = unreachableApi({ getPr: () => okAsync(pr()) });
    const { deps, lines, writes } = harness({ api, dirty: true });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.some((line) => line.includes("uncommitted changes"))).toBe(true);
  });

  it("refuses a foreign-authored pull request without the override", async () => {
    const api = unreachableApi({ authenticatedUserId: () => okAsync(1), getPr: () => okAsync(pr({ authorId: 2 })) });
    const { deps, lines, writes } = harness({ api });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.some((line) => line.includes("different GitHub account"))).toBe(true);
  });

  it("dry-runs after live reads without acquiring the lock or performing writes", async () => {
    const home = tempHome();
    const heldLock = acquireOperationLock({ home, key: "o/r", nowIso: "2026-08-10T00:00:00Z" });
    expect(heldLock.isOk()).toBe(true);
    let prReads = 0;
    const api = unreachableApi({
      getPr: () => {
        prReads += 1;
        return okAsync(pr());
      },
    });
    const { deps, door, lines, writes } = harness({ api });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--dry-run", "--home", home], deps });
    expect(code).toBe(EXIT_OK);
    expect(prReads).toBe(1);
    expect(writes).toEqual([]);
    expect(lines).toEqual([
      "would adopt PR #100 (top onto main) into stack state",
      "dry run: no rebase, no door record, no push, no network write.",
    ]);
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
    expect(door.records()).toEqual([]);
  });

  it("performs nothing when the door cannot record its decision", async () => {
    const api = unreachableApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps: baseDeps, lines, writes } = harness({ api });
    const deps: GithubStackAdoptDeps = { ...baseDeps, git: { ...baseDeps.git, doorLedger: unreachableDoorLedger() } };
    const home = tempHome();
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes.filter((write) => write[0] === "push")).toEqual([]);
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
    expect(lines.some((line) => line.includes("not performed:"))).toBe(true);
  });

  it("adopts a PR at the bottom of a fresh stack, registering locally but not natively", async () => {
    const home = tempHome();
    const api = unreachableApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps, lines, writes } = harness({ api });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", home], deps });
    expect(code).toBe(EXIT_OK);
    expect(normalizeWrites({ writes })).toEqual([
      ["fetch", "origin", `refs/heads/main:${PRIVATE_REF_PLACEHOLDER}`],
      ["rebase", "--no-update-refs", "--onto", `${MAIN_SHA}^{commit}`, `${PARENT_SHA}^{commit}`],
      ["update-ref", "-d", PRIVATE_REF_PLACEHOLDER],
      [
        "push",
        "--set-upstream",
        `--force-with-lease=refs/heads/top:${HEAD_SHA}`,
        "origin",
        `${HEAD_SHA}^{commit}:refs/heads/top`,
      ],
    ]);
    expect(lines).toContain("adopted PR #100");
    expect(lines).toContain("stack: this is the bottom of a fresh stack — no registration needed");
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(true);
  });

  it("leases the push against the freshness-confirmed head SHA, never a live pre-push read", async () => {
    // Simulate an external actor having pushed something else to the branch by the time ANY ls-remote read
    // resolves. If pushRebasedHead re-read the remote fresh (the bug this closes), the lease would legitimise
    // that external push instead of refusing it. The lease must still be built from plan.headSha (HEAD_SHA).
    const EXTERNAL_SHA = "7".repeat(40);
    const api = unreachableApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps, writes } = harness({ api, postPushRemoteSha: EXTERNAL_SHA });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR); // unconfirmed: the post-push read reports the external SHA, not ours
    const pushWrite = normalizeWrites({ writes }).find((args) => args[0] === "push");
    expect(pushWrite).toEqual([
      "push",
      "--set-upstream",
      `--force-with-lease=refs/heads/top:${HEAD_SHA}`,
      "origin",
      `${HEAD_SHA}^{commit}:refs/heads/top`,
    ]);
  });

  it("registers into a newly-created native stack when the parent PR isn't in one yet", async () => {
    const parent = pr({
      baseRef: "main",
      head: { label: "o:bottom", ref: "bottom", repoFullName: "o/r", sha: "9".repeat(40) },
      number: 10,
    });
    const created = nativeStack({
      entries: [
        { baseRef: "main", headRef: "bottom", mergedAtIso: undefined, number: 10, state: "open" },
        { baseRef: "bottom", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" },
      ],
      number: 5,
    });
    const calls: string[] = [];
    const api = unreachableApi({
      createStack: ({ pullRequests }) => {
        calls.push(`createStack:${pullRequests.join(",")}`);
        return okAsync(created);
      },
      findOpenPrByHead: () => okAsync(parent),
      getPr: () => okAsync(pr({ baseRef: "bottom" })),
      getStack: () => okAsync(created),
    });
    const { deps, lines } = harness({ api, defaultBranch: "main" });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["createStack:10,100"]);
    expect(lines).toContain("stack: registered as part of stack #5");
  });

  it("reports a rebase conflict and performs no push or registration", async () => {
    const api = unreachableApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps, lines, writes } = harness({ api, rebaseOk: false });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(normalizeWrites({ writes })).toEqual([
      ["fetch", "origin", `refs/heads/main:${PRIVATE_REF_PLACEHOLDER}`],
      ["rebase", "--no-update-refs", "--onto", `${MAIN_SHA}^{commit}`, `${PARENT_SHA}^{commit}`],
      ["update-ref", "-d", PRIVATE_REF_PLACEHOLDER],
    ]);
    expect(lines).toContain("conflict: conflict in file.ts");
  });

  it("reports the push as unconfirmed when the remote SHA does not match after pushing", async () => {
    const api = unreachableApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps, lines } = harness({ api, postPushRemoteSha: "9999999999999999999999999999999999999999" });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("unconfirmed"))).toBe(true);
  });

  it("refuses when the pull request moved between planning and the door admitting the write", async () => {
    let calls = 0;
    const api = unreachableApi({
      getPr: () => {
        calls += 1;
        return okAsync(pr({ authorId: calls === 1 ? 1 : 2, baseRef: "main" }));
      },
    });
    const { deps, lines, writes } = harness({ api });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.some((line) => line.includes("the author changed"))).toBe(true);
  });

  it("warns about an unregistered, unmerged entry below it in the native stack", async () => {
    const stack = nativeStack({
      entries: [
        { baseRef: "main", headRef: "bottom", mergedAtIso: undefined, number: 10, state: "open" },
        { baseRef: "bottom", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" },
      ],
      number: 5,
    });
    const api = unreachableApi({
      findOpenPrByHead: () =>
        okAsync(
          pr({
            baseRef: "main",
            head: { label: "o:bottom", ref: "bottom", repoFullName: "o/r", sha: "9".repeat(40) },
            number: 10,
            stack: { id: 5, number: 5, position: 1, size: 2 },
          }),
        ),
      getPr: () => okAsync(pr({ baseRef: "bottom", stack: { id: 5, number: 5, position: 2, size: 2 } })),
      getStack: () => okAsync(stack),
    });
    const { deps, lines } = harness({ api, defaultBranch: "main" });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("stack: GitHub had already joined this PR to stack #5 by branch topology");
    expect(
      lines.some((line) =>
        line.startsWith("warning: PR #100 sits above an unregistered, unmerged entry (#10) in native stack #5"),
      ),
    ).toBe(true);
  });

  it("contends on the same lock as a differently-cased remote for the same repository", async () => {
    // GitHub owner/repo names are case-insensitive; the lock key must be normalised or two operations on
    // the SAME repository, resolved through differently-cased remotes, would silently run concurrently.
    const home = tempHome();
    acquireOperationLock({ home, key: "o/r", nowIso: "2026-08-10T00:00:00Z" });
    const api = unreachableApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps, lines, writes } = harness({ api, remoteUrl: "git@example.test:O/R.git" });
    const code = await runGithubStackAdopt({ argv: [...PREFIX, "--home", home], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(writes).toEqual([]);
    expect(lines.some((line) => line.includes("another stack operation is in progress on o/r"))).toBe(true);
  });
});

describe("localAdoptFacts", () => {
  it("reads the checkout's root, branch, repository, default branch, head and tree state, writing nothing", () => {
    const { deps, writes } = harness({ api: unreachableApi({}), dirty: true });
    expect(localAdoptFacts({ cwd: "/anywhere", git: deps.git, remote: "origin" })).toEqual({
      checkedOutBranch: "top",
      defaultBranch: "main",
      dirty: true,
      localHeadSha: HEAD_SHA,
      owner: "o",
      repo: "r",
      repoRoot: "/repo",
    });
    expect(writes).toEqual([]);
  });

  it("throws, naming the remote, when its URL names no owner/name repository", () => {
    const { deps } = harness({ api: unreachableApi({}), remoteUrl: "not a repository url" });
    expect(() => localAdoptFacts({ cwd: "/repo", git: deps.git, remote: "origin" })).toThrow(
      "remote origin is not an owner/name Git repository URL",
    );
  });
});
