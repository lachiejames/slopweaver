import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import { writePushRootBinding } from "../../../../../admit/pushRootStore.js";
import { type GithubStackSyncDeps, runGithubStackSync } from "../../../../../cli/commands/github/stackSyncRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubStack } from "../../../../../corpus/github/stack.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { err, ok } from "../../../../../lib/result.js";
import { registerStackMember } from "../../../../../outbound/github/stackLedger.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const MAIN_SHA = "1111111111111111111111111111111111111111";
const OLD_TOP_SHA = "2222222222222222222222222222222222222222";
const NEW_LOCAL_SHA = "3333333333333333333333333333333333333333";
const PARENT_SHA = "5555555555555555555555555555555555555555";
const FRESH_ROOT = "6666666666666666666666666666666666666666";
const OLD_ROOT = "7777777777777777777777777777777777777777";
const PRIVATE_REF_PLACEHOLDER = "refs/slopweaver/fetch/<ref>";
const PREFIX: readonly string[] = ["node", "slopweaver", "github", "stack", "sync"];

/** Replace the randomly-named private fetch ref with a stable placeholder, for exact-value assertions. */
function normalizeWrites({ writes }: { writes: readonly (readonly string[])[] }): (readonly string[])[] {
  return writes.map((args) =>
    args.map((arg) => arg.replace(/refs\/slopweaver\/fetch\/[0-9a-f-]{36}/g, PRIVATE_REF_PLACEHOLDER)),
  );
}

/**
 * An isolated ledger, exactly like `stackPushRun/harness.ts`'s own `tempHome` — plus whichever PR numbers this
 * scenario has already registered into local stack state, since discovery now reads the ledger rather than
 * every native stack the operator happens to be part of.
 */
function tempHome({ registeredNumbers = [] }: { registeredNumbers?: readonly number[] } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "github-stack-sync-home-"));
  fixtureDirs.push(home);
  for (const number of registeredNumbers) {
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number, owner: "o", repo: "r", via: "push" });
  }
  return home;
}

function pr({ number, stackNumber }: { number: number; stackNumber?: number }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:h", ref: "h", repoFullName: "o/r", sha: NEW_LOCAL_SHA },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack: stackNumber === undefined ? undefined : { id: stackNumber, number: stackNumber, position: 1, size: 1 },
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

/** One record of `git worktree list --porcelain -z` output. */
function worktreeRecord({ path, branch }: { path: string; branch: string }): string {
  return [`worktree ${path}`, `HEAD ${"4".repeat(40)}`, `branch refs/heads/${branch}`].join("\0");
}

/** Every command with a fixed answer, independent of call order or captured state. */
function staticReads({
  defaultBranch,
  worktreesText,
}: {
  defaultBranch: string;
  worktreesText: string;
}): Readonly<Record<string, string>> {
  return {
    "ls-remote --symref origin HEAD": `ref: refs/heads/${defaultBranch}\tHEAD\n${MAIN_SHA}\tHEAD`,
    "ls-remote origin refs/heads/main": `${MAIN_SHA}\trefs/heads/main`,
    "remote get-url origin": "git@example.test:o/r.git",
    [`rev-list --parents -1 ${NEW_LOCAL_SHA}^{commit}`]: `${NEW_LOCAL_SHA} ${PARENT_SHA}`,
    "rev-parse --show-toplevel": "/repo",
    "rev-parse HEAD": NEW_LOCAL_SHA,
    "status --porcelain": "",
    "worktree list --porcelain -z": worktreesText,
  };
}

function harness({
  defaultBranch = "main",
  rebaseOk = true,
  pushOk = true,
  postPushRemoteSha = NEW_LOCAL_SHA,
  extraReads = {},
  api,
}: {
  defaultBranch?: string;
  rebaseOk?: boolean;
  pushOk?: boolean;
  postPushRemoteSha?: string;
  /** Answers beyond the static set, for the reads only a bound push-root register makes the guard ask. */
  extraReads?: Readonly<Record<string, string>>;
  api: GithubWriteApi;
}): { deps: GithubStackSyncDeps; door: MemoryDoorLedger; writes: (readonly string[])[]; lines: string[] } {
  const writes: (readonly string[])[] = [];
  const lines: string[] = [];
  let topLsRemoteCalls = 0;
  let capturedRef: string | undefined;
  const worktreesText = [
    worktreeRecord({ branch: "main", path: "/repo" }),
    worktreeRecord({ branch: "top", path: "/repo-top" }),
    "",
  ].join("\0\0");
  const readGit = ({ args }: { args: readonly string[] }): string => {
    const command = args.join(" ");
    if (command === "ls-remote origin refs/heads/top") {
      topLsRemoteCalls += 1;
      return `${topLsRemoteCalls === 1 ? OLD_TOP_SHA : postPushRemoteSha}\trefs/heads/top`;
    }
    if (capturedRef !== undefined && command === `rev-parse ${capturedRef}^{commit}`) return MAIN_SHA;
    const value = { ...staticReads({ defaultBranch, worktreesText }), ...extraReads }[command];
    if (value !== undefined) return value;
    // The head carries no proof output, so the push door passes it.
    if (args.includes("ls-tree")) return "";
    throw new Error(`unexpected Git read: ${command}`);
  };
  const door = memoryDoorLedger();
  const deps: GithubStackSyncDeps = {
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
    isAncestor: () => false,
    makeApi: () => api,
    now: () => new Date("2026-08-10T00:00:00Z"),
    out: ({ line }) => lines.push(line),
    token: () => "fake-test-token",
  };
  return { deps, door, lines, writes };
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

function stack({ entries }: { entries: readonly GithubStack["entries"][number][] }): GithubStack {
  return { entries, id: 5, number: 5, open: true };
}

/** One stack whose single open entry, `top`, has a moved base. */
function oneMovedEntryApi(): GithubWriteApi {
  return unreachableApi({
    getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
    getStack: () =>
      okAsync(
        stack({ entries: [{ baseRef: "main", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" }] }),
      ),
  });
}

/** A home with that entry registered and `o/r`'s fresh root recorded, so every push to it meets the guard. */
function boundHome(): string {
  const home = tempHome({ registeredNumbers: [100] });
  const bound = writePushRootBinding({
    binding: { recordedAtIso: "2026-08-10T00:00:00Z", repository: "o/r", rootSha: FRESH_ROOT },
    home,
  });
  expect(bound.isOk()).toBe(true);
  return home;
}

/** What the guard reads once the register binds the push target: its push url, the rebased head's root, the clone's depth. */
function guardReads({ root }: { root: string }): Readonly<Record<string, string>> {
  return {
    [`--no-replace-objects rev-list --max-parents=0 ${NEW_LOCAL_SHA}^{commit}`]: root,
    "remote get-url --push --all origin": "git@github.com:o/r.git",
    "rev-parse --is-shallow-repository": "false",
  };
}

describe("runGithubStackSync", () => {
  it("refuses usage errors before any Git read", async () => {
    const { deps } = harness({ api: unreachableApi({}) });
    const code = await runGithubStackSync({ argv: [...PREFIX, "--unknown"], deps });
    expect(code).toBe(EXIT_USAGE);
  });

  it("reports nothing to sync when nothing is registered in local stack state", async () => {
    const { deps, lines } = harness({ api: unreachableApi({}) });
    const code = await runGithubStackSync({ argv: [...PREFIX, "--home", tempHome()], deps });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("nothing to sync: every stack you're part of is already based on its live parent.");
  });

  it("dry-runs without rebasing or pushing", async () => {
    const api = unreachableApi({
      getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
      getStack: () =>
        okAsync(
          stack({ entries: [{ baseRef: "main", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" }] }),
        ),
    });
    const { deps, lines, writes } = harness({ api });
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--dry-run", "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(writes).toEqual([]);
    expect(lines).toContain("dry run: no rebase, no door record, no push.");
    expect(lines).toContain("would rebase top (PR #100, stack #5 position 1) onto main — base-moved");
  });

  it("performs no push when the door cannot record its decision", async () => {
    const api = unreachableApi({
      getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
      getStack: () =>
        okAsync(
          stack({ entries: [{ baseRef: "main", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" }] }),
        ),
    });
    const { deps: baseDeps, lines, writes } = harness({ api });
    const deps: GithubStackSyncDeps = { ...baseDeps, git: { ...baseDeps.git, doorLedger: unreachableDoorLedger() } };
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(writes.filter((write) => write[0] === "push")).toEqual([]);
    expect(lines.some((line) => line.includes("not performed:"))).toBe(true);
  });

  it("rebases and pushes the one entry that has moved, confirming the push", async () => {
    const api = unreachableApi({
      getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
      getStack: () =>
        okAsync(
          stack({ entries: [{ baseRef: "main", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" }] }),
        ),
    });
    const { deps, lines, writes } = harness({ api });
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(normalizeWrites({ writes })).toEqual([
      ["fetch", "origin", `refs/heads/main:${PRIVATE_REF_PLACEHOLDER}`],
      ["rebase", "--no-update-refs", "--onto", `${MAIN_SHA}^{commit}`, `${PARENT_SHA}^{commit}`],
      ["update-ref", "-d", PRIVATE_REF_PLACEHOLDER],
      [
        "push",
        "--set-upstream",
        `--force-with-lease=refs/heads/top:${OLD_TOP_SHA}`,
        "origin",
        `${NEW_LOCAL_SHA}^{commit}:refs/heads/top`,
      ],
    ]);
    expect(lines).toContain("synced top (PR #100)");
  });

  it("refuses to push a REBASED head carrying old history once the repository's fresh root is recorded", async () => {
    const { deps, lines, writes } = harness({ api: oneMovedEntryApi(), extraReads: guardReads({ root: OLD_ROOT }) });
    const code = await runGithubStackSync({ argv: [...PREFIX, "--home", boundHome()], deps });

    expect(code).toBe(EXIT_ERROR);
    // The fetch and the rebase only read the remote and move local state; the guard judges the head they produce,
    // which does not exist before them, and nothing is sent.
    expect(normalizeWrites({ writes }).map((write) => write[0])).toEqual(["fetch", "rebase", "update-ref"]);
    expect(lines.some((line) => line.includes(`o/r ← ${NEW_LOCAL_SHA.slice(0, 12)}: its history's roots are`))).toBe(
      true,
    );
  });

  it("pushes a rebased head whose only root is the recorded one", async () => {
    const { deps, lines, writes } = harness({ api: oneMovedEntryApi(), extraReads: guardReads({ root: FRESH_ROOT }) });
    const code = await runGithubStackSync({ argv: [...PREFIX, "--home", boundHome()], deps });

    expect(code).toBe(EXIT_OK);
    expect(writes.filter((write) => write[0] === "push").length).toBe(1);
    expect(lines).toContain("synced top (PR #100)");
  });

  it("reports a rebase conflict and stops without pushing", async () => {
    const api = unreachableApi({
      getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
      getStack: () =>
        okAsync(
          stack({ entries: [{ baseRef: "main", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" }] }),
        ),
    });
    const { deps, lines, writes } = harness({ api, rebaseOk: false });
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(normalizeWrites({ writes })).toEqual([
      ["fetch", "origin", `refs/heads/main:${PRIVATE_REF_PLACEHOLDER}`],
      ["rebase", "--no-update-refs", "--onto", `${MAIN_SHA}^{commit}`, `${PARENT_SHA}^{commit}`],
      ["update-ref", "-d", PRIVATE_REF_PLACEHOLDER],
    ]);
    expect(lines).toContain("conflict: top (PR #100) — conflict in file.ts");
  });

  it("reports the push as unconfirmed when the remote SHA does not match after pushing", async () => {
    const api = unreachableApi({
      getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
      getStack: () =>
        okAsync(
          stack({ entries: [{ baseRef: "main", headRef: "top", mergedAtIso: undefined, number: 100, state: "open" }] }),
        ),
    });
    const { deps, lines } = harness({ api, postPushRemoteSha: "9999999999999999999999999999999999999999" });
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("unconfirmed"))).toBe(true);
  });

  it("reports a merged entry as residue and leaves it out of the plan", async () => {
    const api = unreachableApi({
      getPr: () => okAsync(pr({ number: 100, stackNumber: 5 })),
      getStack: () =>
        okAsync(
          stack({
            entries: [
              { baseRef: "main", headRef: "top", mergedAtIso: "2026-08-01T00:00:00Z", number: 100, state: "closed" },
            ],
          }),
        ),
    });
    const { deps, lines } = harness({ api });
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("residue: stack #5 position 1 (PR #100) is merged");
  });

  it("surfaces a discovery failure as residue instead of throwing", async () => {
    const api = unreachableApi({
      getPr: () => errAsync({ kind: "http", message: "rate limited", operation: "x" }),
    });
    const { deps, lines } = harness({ api });
    const code = await runGithubStackSync({
      argv: [...PREFIX, "--home", tempHome({ registeredNumbers: [100] })],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("residue: could not read PR #100: rate limited");
  });
});
