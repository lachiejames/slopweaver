import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import {
  type GithubStackDissolveDeps,
  runGithubStackDissolve,
} from "../../../../../cli/commands/github/stackDissolveRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubStack } from "../../../../../corpus/github/stack.js";
import type { GithubWriteApi } from "../../../../../corpus/github/write.js";
import { isRegisteredStackMember, registerStackMember } from "../../../../../outbound/github/stackLedger.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const PREFIX: readonly string[] = [
  "node",
  "slopweaver",
  "github",
  "stack",
  "dissolve",
  "--repo",
  "o/r",
  "--stack",
  "42",
];

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "github-stack-dissolve-home-"));
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
  number = 42,
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
  deps: GithubStackDissolveDeps;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    deps: {
      doorLedger,
      makeApi: () => api,
      now: () => new Date("2026-08-10T00:00:00Z"),
      out: ({ line }) => lines.push(line),
      token: () => "fake-test-token",
    },
    lines,
  };
}

describe("runGithubStackDissolve", () => {
  it("refuses usage errors before any read", async () => {
    const { deps: d } = deps({ api: unreachableApi({}) });
    const code = await runGithubStackDissolve({ argv: ["node", "slopweaver", "github", "stack", "dissolve"], deps: d });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a stack with no entries", async () => {
    const { deps: d, lines } = deps({ api: unreachableApi({ getStack: () => okAsync(nativeStack({ entries: [] })) }) });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--home", tempHome()], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual(["refused: native stack #42 has no entries — nothing to dissolve"]);
  });

  it("dry-runs after a live read without acquiring the lock or writing", async () => {
    const home = tempHome();
    const heldLock = acquireOperationLock({ home, key: "o/r", nowIso: "2026-08-10T00:00:00Z" });
    expect(heldLock.isOk()).toBe(true);
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getStack: () => okAsync(nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] })),
      }),
    });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--dry-run", "--home", home], deps: d });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "would dissolve native stack #42 (#10, #11)",
      "dry run: a token was resolved and the stack was READ; no door record, no network write.",
    ]);
  });

  it("refuses when another stack operation already holds the lock", async () => {
    const home = tempHome();
    const heldLock = acquireOperationLock({ home, key: "o/r", nowIso: "2026-08-10T00:00:00Z" });
    expect(heldLock.isOk()).toBe(true);
    const { deps: d, lines } = deps({
      api: unreachableApi({ getStack: () => okAsync(nativeStack({ entries: [entry({ number: 10 })] })) }),
    });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("another stack operation is in progress"))).toBe(true);
  });

  it("dissolves fully on a 204, unregistering every removed entry", async () => {
    const home = tempHome();
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 10, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 11, owner: "o", repo: "r", via: "push" });
    const readStack = nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] });
    const { deps: d, lines } = deps({
      api: unreachableApi({ getStack: () => okAsync(readStack), unstack: () => okAsync(undefined) }),
    });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual([
      "would dissolve native stack #42 (#10, #11)",
      "dissolved — native stack #42 no longer exists",
    ]);
    expect(isRegisteredStackMember({ home, number: 10, owner: "o", repo: "r" })).toBe(false);
    expect(isRegisteredStackMember({ home, number: 11, owner: "o", repo: "r" })).toBe(false);
  });

  it("dissolves nothing when the door cannot record its decision", async () => {
    const home = tempHome();
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 10, owner: "o", repo: "r", via: "push" });
    const readStack = nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] });
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getStack: () => okAsync(readStack),
        unstack: () => {
          throw new Error("the stack must not be dissolved when the decision was not recorded");
        },
      }),
      doorLedger: unreachableDoorLedger(),
    });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("not performed:"))).toBe(true);
    expect(isRegisteredStackMember({ home, number: 10, owner: "o", repo: "r" })).toBe(true);
  });

  it("reports a partial survival on a 200, unregistering only what actually left", async () => {
    const home = tempHome();
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 10, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home, nowIso: "2026-08-10T00:00:00Z", number: 11, owner: "o", repo: "r", via: "push" });
    const readStack = nativeStack({
      entries: [entry({ mergedAtIso: "2026-08-01T00:00:00Z", number: 10 }), entry({ number: 11 })],
    });
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getStack: () => okAsync(readStack),
        unstack: () => okAsync(nativeStack({ entries: [entry({ mergedAtIso: "2026-08-01T00:00:00Z", number: 10 })] })),
      }),
    });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_OK);
    expect(lines.at(-1)).toContain("survives with the locked or already-merged #10");
    expect(isRegisteredStackMember({ home, number: 10, owner: "o", repo: "r" })).toBe(true);
    expect(isRegisteredStackMember({ home, number: 11, owner: "o", repo: "r" })).toBe(false);
  });

  it("refuses when the stack's own entries moved between planning and writing", async () => {
    const home = tempHome();
    let call = 0;
    const { deps: d, lines } = deps({
      api: unreachableApi({
        getStack: () => {
          call += 1;
          return call === 1
            ? okAsync(nativeStack({ entries: [entry({ number: 10 }), entry({ number: 11 })] }))
            : okAsync(nativeStack({ entries: [entry({ number: 11 }), entry({ number: 13 })] }));
        },
      }),
    });
    const code = await runGithubStackDissolve({ argv: [...PREFIX, "--home", home], deps: d });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.at(-1)).toContain("changed between planning");
  });
});
