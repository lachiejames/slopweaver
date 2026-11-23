import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { runGithubPrRetarget } from "../../../../../cli/commands/github/retargetRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { err } from "../../../../../lib/result.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { memoryIdentityRosterPort } from "../../../../identityRosterFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };
const PREFIX: readonly string[] = ["--repo", "o/r", "--number", "7"];

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fresh, isolated door-ledger directory — matching `stackAdoptRun.test.ts`'s own `tempHome`. Every case
 * below passes it as `--home`: `runGithubPrRetarget` falls back to `slopweaverHome()` when the flag is
 * absent, so a case that omits it records its external write in the developer's REAL `~/.slopweaver`.
 */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "github-pr-retarget-home-"));
  fixtureDirs.push(home);
  return home;
}

const HEAD = {
  label: "o:feature",
  ref: "feature",
  repoFullName: "o/r",
  sha: "1111111111111111111111111111111111111111",
};

function pr({
  authorId = 1,
  state = "open",
  baseRef = "main",
  stack = undefined,
}: {
  authorId?: number;
  state?: string;
  baseRef?: string;
  stack?: WrittenPr["stack"];
} = {}): WrittenPr {
  return {
    authorId,
    baseRef,
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: HEAD,
    htmlUrl: "https://example.invalid/pr/7",
    mergedAtIso: undefined,
    nodeId: "PR_7",
    number: 7,
    stack,
    state,
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

/** Every field a fake `GithubWriteApi` must fill; overrides replace the unreachable-by-default stubs. */
function fakeApi(overrides: Partial<GithubWriteApi>): GithubWriteApi {
  return {
    mergeGroupContexts: () => errAsync(HTTP_ERROR),
    requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
    setRequiredStatusChecks: () => errAsync(HTTP_ERROR),
    addIssueLabels: () => errAsync(HTTP_ERROR),
    addToStack: () => errAsync(HTTP_ERROR),
    answerReviewThread: () => errAsync(HTTP_ERROR),
    reopenReviewThread: () => errAsync(HTTP_ERROR),
    authenticatedUserId: () => okAsync(1),
    branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
    canAdmin: () => okAsync(false),
    canPush: () => okAsync(true),
    closePr: () => errAsync(HTTP_ERROR),
    codeScanningAlert: () => errAsync(HTTP_ERROR),
    codeScanningAlerts: () => errAsync(HTTP_ERROR),
    dependabotAlert: () => errAsync(HTTP_ERROR),
    dependabotAlerts: () => errAsync(HTTP_ERROR),
    createIssueComment: () => errAsync(HTTP_ERROR),
    createPr: () => errAsync(HTTP_ERROR),
    createStack: () => errAsync(HTTP_ERROR),
    dequeuePr: () => errAsync(HTTP_ERROR),
    diffFiles: () => errAsync(HTTP_ERROR),
    dismissCodeScanningAlert: () => errAsync(HTTP_ERROR),
    enqueuePr: () => errAsync(HTTP_ERROR),
    enqueueStackPr: () => errAsync(HTTP_ERROR),
    findOpenPrByHead: () => errAsync(HTTP_ERROR),
    getIssueComment: () => errAsync(HTTP_ERROR),
    getPr: () => errAsync(HTTP_ERROR),
    getRepoDescription: () => errAsync(HTTP_ERROR),
    getStack: () => errAsync(HTTP_ERROR),
    issueLabels: () => errAsync(HTTP_ERROR),
    listIssueComments: () => errAsync(HTTP_ERROR),
    listOpenPrs: () => okAsync({ prs: [], truncated: false, viewerId: 1 }),
    listOpenPrsAuthoredByMe: () => errAsync(HTTP_ERROR),
    listPrs: () => okAsync([]),
    listRuns: () => okAsync([]),
    markPrDraft: () => okAsync(undefined),
    markPrReady: () => okAsync(undefined),
    mergePr: () => errAsync(HTTP_ERROR),
    repoLabels: () => errAsync(HTTP_ERROR),
    requestedReviewers: () => errAsync(HTTP_ERROR),
    requestReviewers: () => errAsync(HTTP_ERROR),
    reviewThreadDetails: () => errAsync(HTTP_ERROR),
    reviewThreads: () => errAsync(HTTP_ERROR),
    setRepoDescription: () => errAsync(HTTP_ERROR),
    submitReviewRound: () => errAsync(HTTP_ERROR),
    updateIssueComment: () => errAsync(HTTP_ERROR),
    updatePr: () => errAsync(HTTP_ERROR),
    unstack: () => errAsync(HTTP_ERROR),
    ...overrides,
  };
}

function harnessDeps({ api }: { api: GithubWriteApi }): {
  deps: GithubPrDeps;
  door: MemoryDoorLedger;
  errLines: string[];
  outLines: string[];
} {
  const errLines: string[] = [];
  const outLines: string[] = [];
  const door = memoryDoorLedger();
  return {
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      cwd: () => "/repo",
      descriptionReview: clearDescriptionReview,
      doorLedger: door.port,
      identityRoster: memoryIdentityRosterPort(),
      installationIdentifiers: () => Promise.resolve({ identifiers: undefined, unread: [] }),
      env: () => undefined,
      err: ({ line }) => errLines.push(line),
      makeApi: () => api,
      measureAlreadyLanded: () => err(["not exercised by retarget"]),
      measureBaseFreshness: () =>
        err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["not exercised by retarget"] })),
      now: () => new Date("2026-08-30T00:00:00Z"),
      out: ({ line }) => outLines.push(line),
      readFileSource: () => {
        throw new Error("not exercised by retarget");
      },
      readForm: () => {
        throw new Error("not exercised by retarget");
      },
      sleep: () => Promise.resolve(),
      token: () => "fake-test-token",
      writeFileOut: () => {
        throw new Error("not exercised by retarget");
      },
    },
    door,
    errLines,
    outLines,
  };
}

describe("runGithubPrRetarget", () => {
  it("refuses usage errors before resolving a token", async () => {
    const { deps, errLines } = harnessDeps({ api: fakeApi({}) });

    const code = await runGithubPrRetarget({ deps, rest: [...PREFIX, "--home", tempHome()] });

    expect(code).toBe(EXIT_USAGE);
    expect(errLines[0]).toContain("--base <ref> is required");
  });

  it("refuses a foreign-authored pull request rather than retargeting someone else's work", async () => {
    const api = fakeApi({
      authenticatedUserId: () => okAsync(99),
      getPr: () => okAsync(pr({ authorId: 1 })),
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toContain("not what this verb is for");
  });

  it("refuses a base equal to the pull request's own head branch", async () => {
    const api = fakeApi({ getPr: () => okAsync(pr({})) });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "feature", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toContain("own head branch");
  });

  it("reports a no-op and performs no write when the base already matches", async () => {
    const api = fakeApi({ getPr: () => okAsync(pr({ baseRef: "main" })) });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "main", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("already targets main");
  });

  it("refuses a pull request that is a member of a native GitHub stack", async () => {
    const api = fakeApi({
      getPr: () => okAsync(pr({ stack: { id: 900, number: 42, position: 1, size: 2 } })),
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toContain("native stack #42");
  });

  it("dry-run reads but performs no door write", async () => {
    const api = fakeApi({ getPr: () => okAsync(pr({})) });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--dry-run", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("would retarget #7 -> release");
  });

  it("writes, re-reads and confirms the base changed on the live path", async () => {
    let wrote = false;
    const api = fakeApi({
      getPr: () => okAsync(pr({ baseRef: wrote ? "release" : "main" })),
      updatePr: () => {
        wrote = true;
        return okAsync(pr({ baseRef: "release" }));
      },
    });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("retargeted #7 -> release");
  });

  it("writes nothing, and says the decision was not recorded, when the door ledger's store is down", async () => {
    let writes = 0;
    const api = fakeApi({
      getPr: () => okAsync(pr({ baseRef: "main" })),
      updatePr: () => {
        writes += 1;
        return okAsync(pr({ baseRef: "release" }));
      },
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps: { ...deps, doorLedger: unreachableDoorLedger() },
      rest: [...PREFIX, "--base", "release", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(writes).toBe(0);
    expect(errLines[0]).toContain("slopweaver github pr retarget not performed:");
  });

  it("refuses when GitHub accepts the write but the read-back still reports the old base", async () => {
    const api = fakeApi({
      getPr: () => okAsync(pr({ baseRef: "main" })),
      updatePr: () => okAsync(pr({ baseRef: "release" })),
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toContain("read-back still reports the base as main");
  });

  it("refuses a base that is another open pull request's head branch, naming the stack it must join", async () => {
    const parent = pr({ baseRef: "main", stack: { id: 9, number: 16958, position: 1, size: 1 } });
    const api = fakeApi({
      getPr: () => okAsync(pr({ baseRef: "main" })),
      listOpenPrs: () =>
        okAsync({
          prs: [{ ...parent, head: { ...HEAD, ref: "release" }, number: 16339 }],
          truncated: false,
          viewerId: 1,
        }),
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toBe(
      "refused: retargeting #7 onto release would leave a chained pull request that GitHub does not know is a stack.",
    );
    expect(errLines[3]).toBe("  it must join native stack #16958.");
  });

  it("refuses that same base under --dry-run too, so a preview never promises a write the next run refuses", async () => {
    const parent = pr({ baseRef: "main" });
    const api = fakeApi({
      getPr: () => okAsync(pr({ baseRef: "main" })),
      listOpenPrs: () =>
        okAsync({
          prs: [{ ...parent, head: { ...HEAD, ref: "release" }, number: 16672 }],
          truncated: false,
          viewerId: 1,
        }),
    });
    const { deps, errLines, outLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--dry-run", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(outLines).toEqual([]);
    expect(errLines[3]).toBe("  there is no native stack yet, so one must be formed from the pair.");
  });

  it("retargets AND registers the native stack in one invocation under --adopt", async () => {
    let wrote = false;
    const parent = pr({ baseRef: "main" });
    const api = fakeApi({
      createStack: () => okAsync({ entries: [], id: 9, number: 4242, open: true }),
      getPr: () => okAsync(pr({ baseRef: wrote ? "release" : "main" })),
      listOpenPrs: () =>
        okAsync({
          prs: [{ ...parent, head: { ...HEAD, ref: "release" }, number: 16672 }],
          truncated: false,
          viewerId: 1,
        }),
      updatePr: () => {
        wrote = true;
        return okAsync(pr({ baseRef: "release" }));
      },
    });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--adopt", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("retargeted #7 -> release");
    expect(outLines[1]).toBe("stack: registered as part of stack #4242");
  });

  it("reports failure when the base landed but the stack registration did not", async () => {
    let wrote = false;
    const parent = pr({ baseRef: "main" });
    const api = fakeApi({
      createStack: () => errAsync(HTTP_ERROR),
      getPr: () => okAsync(pr({ baseRef: wrote ? "release" : "main" })),
      listOpenPrs: () =>
        okAsync({
          prs: [{ ...parent, head: { ...HEAD, ref: "release" }, number: 16672 }],
          truncated: false,
          viewerId: 1,
        }),
      updatePr: () => {
        wrote = true;
        return okAsync(pr({ baseRef: "release" }));
      },
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRetarget({
      deps,
      rest: [...PREFIX, "--base", "release", "--adopt", "--home", tempHome()],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toBe("stack: NOT registered natively — the stack create call failed: unreachable");
  });
});
