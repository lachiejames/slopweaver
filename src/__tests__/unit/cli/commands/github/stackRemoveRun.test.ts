import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { type GithubStackRemoveDeps, runGithubStackRemove } from "../../../../../cli/commands/github/stackRemoveRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubStack } from "../../../../../corpus/github/stack.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { isRegisteredStackMember, registerStackMember } from "../../../../../outbound/github/stackLedger.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const PREFIX: readonly string[] = ["node", "slopweaver", "github", "stack", "remove", "--repo", "o/r", "--pr", "11"];

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "github-stack-remove-home-"));
}

function pr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 1,
    baseRef: "bottom",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:top", ref: "top", repoFullName: "o/r", sha: "3333333333333333333333333333333333333333" },
    htmlUrl: "https://example.invalid/pr/11",
    mergedAtIso: undefined,
    nodeId: "PR_11",
    number: 11,
    stack: { id: 900, number: 5, position: 2, size: 3 },
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function entry({
  number,
  mergedAtIso = undefined,
}: {
  number: number;
  mergedAtIso?: string | undefined;
}): GithubStack["entries"][number] {
  return { baseRef: "main", headRef: `branch-${String(number)}`, mergedAtIso, number, state: "open" };
}

function nativeStack({
  number = 5,
  entries,
}: {
  number?: number;
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
    unstack: () => errAsync(unreachable),
    updateIssueComment: () => errAsync(unreachable),
    updatePr: () => errAsync(unreachable),
    ...overrides,
  };
}

function deps({ api, doorLedger = memoryDoorLedger().port }: { api: GithubWriteApi; doorLedger?: DoorLedgerPort }): {
  deps: GithubStackRemoveDeps;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    deps: {
      doorLedger,
      env: () => undefined,
      makeApi: () => api,
      now: () => new Date("2026-08-10T00:00:00Z"),
      out: ({ line }) => lines.push(line),
      token: () => "fake-test-token",
    },
    lines,
  };
}

describe("runGithubStackRemove", () => {
  it("refuses usage errors before any read", async () => {
    const { deps: d } = deps({ api: unreachableApi({}) });
    const code = await runGithubStackRemove({ argv: ["node", "slopweaver", "github", "stack", "remove"], deps: d });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses when the pull request is not a stack member", async () => {
    const { deps: d, lines } = deps({ api: unreachableApi({ getPr: () => okAsync(pr({ stack: undefined })) }) });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", tempHome()], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual(["refused: #11 is not a member of any native GitHub stack — nothing to remove"]);
  });

  it("refuses a foreign-authored pull request without the override", async () => {
    const { deps: d, lines } = deps({
      api: unreachableApi({ authenticatedUserId: () => okAsync(1), getPr: () => okAsync(pr({ authorId: 2 })) }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", tempHome()], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("different GitHub account"))).toBe(true);
  });

  it("refuses a stack with a merged entry, before any write", async () => {
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () =>
          okAsync(
            nativeStack({
              entries: [entry({ mergedAtIso: "2026-08-01T00:00:00Z", number: 10 }), entry({ number: 11 })],
            }),
          ),
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", tempHome()], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([
      "refused: native stack #5 has a merged entry (#10) — remove only handles a stack where every entry is still open, since GitHub's own unstack endpoint would leave a merged entry in place rather than remove it",
    ]);
  });

  it("dry-runs after live reads without acquiring the lock or writing", async () => {
    const home = tempHome();
    const heldLock = acquireOperationLock({ home, key: "o/r", nowIso: "2026-08-10T00:00:00Z" });
    expect(heldLock.isOk()).toBe(true);
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () => okAsync(nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] })),
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--dry-run", "--home", home], deps: d });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "would remove #11 from native stack #5 — dissolve the stack entirely, since only #10 would remain, too few to re-stack",
      "dry run: a token was resolved and the pull request and stack were READ; no door record, no network write.",
    ]);
  });

  it("refuses when another stack operation already holds the lock", async () => {
    const home = tempHome();
    const heldLock = acquireOperationLock({ home, key: "o/r", nowIso: "2026-08-10T00:00:00Z" });
    expect(heldLock.isOk()).toBe(true);
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () => okAsync(nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] })),
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("another stack operation is in progress"))).toBe(true);
  });

  it("removes and re-forms the remaining entries when two or more survive, unregistering only the removed PR", async () => {
    const home = tempHome();
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 10, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 11, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 12, owner: "o", repo: "r", via: "push" });
    const readStack = nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 }), entry({ number: 12 })] });
    const { deps: d, lines } = deps({
      api: unreachableApi({
        createStack: ({ pullRequests }) =>
          okAsync(nativeStack({ entries: pullRequests.map((n) => entry({ number: n })), number: 9 })),
        getPr: () => okAsync(pr()),
        getStack: () => okAsync(readStack),
        unstack: () => okAsync(undefined),
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "would remove #11 from native stack #5 — dissolve it and re-form the remaining 2 entries (#10, #12) as a new stack, in the same order",
      "removed — native stack #5 dissolved, remaining entries re-formed as stack #9",
    ]);
    expect(isRegisteredStackMember({ home, number: 11, owner: "o", repo: "r" })).toBe(false);
    expect(isRegisteredStackMember({ home, number: 10, owner: "o", repo: "r" })).toBe(true);
    expect(isRegisteredStackMember({ home, number: 12, owner: "o", repo: "r" })).toBe(true);
  });

  it("removes nothing when the door cannot record its decision", async () => {
    const home = tempHome();
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 11, owner: "o", repo: "r", via: "push" });
    const readStack = nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] });
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () => okAsync(readStack),
        unstack: () => {
          throw new Error("the stack must not be dissolved when the decision was not recorded");
        },
      }),
      doorLedger: unreachableDoorLedger(),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("not performed:"))).toBe(true);
    expect(isRegisteredStackMember({ home, number: 11, owner: "o", repo: "r" })).toBe(true);
  });

  it("removes with no recreate when only one entry would remain", async () => {
    const home = tempHome();
    const readStack = nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] });
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () => okAsync(readStack),
        unstack: () => okAsync(undefined),
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "would remove #11 from native stack #5 — dissolve the stack entirely, since only #10 would remain, too few to re-stack",
      "removed — native stack #5 is now dissolved",
    ]);
  });

  it("reports unconfirmed when unstack leaves a survivor in place unexpectedly", async () => {
    const home = tempHome();
    const readStack = nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] });
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () => okAsync(readStack),
        unstack: () => okAsync(nativeStack({ entries: [entry({ number: 10 })] })),
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([
      "would remove #11 from native stack #5 — dissolve the stack entirely, since only #10 would remain, too few to re-stack",
      "unconfirmed: unstack left 1 entry in place (locked or already merged) instead of fully dissolving stack #5",
    ]);
  });

  it("refuses when the stack's own entries moved between planning and writing", async () => {
    const home = tempHome();
    let call = 0;
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getPr: () => okAsync(pr()),
        getStack: () => {
          call += 1;
          return call === 1
            ? okAsync(nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] }))
            : okAsync(nativeStack({ entries: [entry({ number: 11 }), entry({ number: 13 })] }));
        },
      }),
    });
    const code = await runGithubStackRemove({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.at(-1)).toContain("changed between planning");
  });
});
