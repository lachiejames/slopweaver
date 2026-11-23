/**
 * `github stack push` registering a new pull request natively above its parent: creating a stack, adding to the
 * parent's, reporting one GitHub already joined by topology, and failing the run when the PR exists but its
 * registration could not be confirmed. Split from `stackPushRun.test.ts` by behaviour.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { GithubStack } from "../../../../../../corpus/github/stack.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { UNREACHED_PROTECTION_READ } from "../../../../../protectionReadFixture.js";
import { baseForm, PREFIX, pr } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

function nativeStack({
  number,
  pullRequestNumbers,
}: {
  number: number;
  pullRequestNumbers: readonly number[];
}): GithubStack {
  return {
    entries: pullRequestNumbers.map((prNumber, index) => ({
      baseRef: index === 0 ? "main" : `entry-${String(index - 1)}`,
      headRef: `entry-${String(index)}`,
      mergedAtIso: undefined,
      number: prNumber,
      state: "open",
    })),
    id: number,
    number,
    open: true,
  };
}

describe("runGithubStackPush", () => {
  it("creates a stack when the parent PR isn't in one yet", async () => {
    const parent = pr({ number: 10 });
    const created = pr({ number: 100 });
    const madeStack = nativeStack({ number: 5, pullRequestNumbers: [10, 100] });
    const calls: string[] = [];
    const api: GithubWriteApi = {
      mergeGroupContexts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
      setRequiredStatusChecks: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      addToStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      addIssueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      answerReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reopenReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      authenticatedUserId: () => okAsync(1),
      branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
      canAdmin: () => okAsync(false),
      canPush: () => okAsync(true),
      closePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createPr: () => okAsync(created),
      createStack: ({ pullRequests }) => {
        calls.push(`createStack:${pullRequests.join(",")}`);
        return okAsync(madeStack);
      },
      dequeuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueueStackPr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      diffFiles: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dismissCodeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      findOpenPrByHead: () => okAsync(parent),
      getPr: () => okAsync(created),
      getIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      issueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listIssueComments: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrs: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrsAuthoredByMe: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listPrs: () => okAsync([]),
      listRuns: () => okAsync([]),
      markPrDraft: () => okAsync(undefined),
      markPrReady: () => okAsync(undefined),
      mergePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      repoLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestedReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreadDetails: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreads: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      setRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      submitReviewRound: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updateIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updatePr: () => okAsync(created),
      unstack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
    };
    const { deps, lines } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "bottom" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["createStack:10,100"]);
    expect(lines).toContain("stack: registered as part of stack #5");
  });

  it("adds to the parent's existing stack", async () => {
    const parent = pr({ number: 10, stack: { id: 5, number: 5, position: 1, size: 1 } });
    const created = pr({ number: 100 });
    const grown = nativeStack({ number: 5, pullRequestNumbers: [10, 100] });
    const calls: string[] = [];
    const api: GithubWriteApi = {
      mergeGroupContexts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
      setRequiredStatusChecks: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      addToStack: ({ stackNumber, pullRequests }) => {
        calls.push(`addToStack:${String(stackNumber)}:${pullRequests.join(",")}`);
        return okAsync(grown);
      },
      addIssueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      answerReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reopenReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      authenticatedUserId: () => okAsync(1),
      branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
      canAdmin: () => okAsync(false),
      canPush: () => okAsync(true),
      closePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createPr: () => okAsync(created),
      createStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dequeuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueueStackPr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      diffFiles: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dismissCodeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      findOpenPrByHead: () => okAsync(parent),
      getPr: () => okAsync(created),
      getIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      issueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listIssueComments: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrs: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrsAuthoredByMe: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listPrs: () => okAsync([]),
      listRuns: () => okAsync([]),
      markPrDraft: () => okAsync(undefined),
      markPrReady: () => okAsync(undefined),
      mergePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      repoLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestedReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreadDetails: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreads: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      setRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      submitReviewRound: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updateIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updatePr: () => okAsync(created),
      unstack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
    };
    const { deps, lines } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "bottom" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["addToStack:5:100"]);
    expect(lines).toContain("stack: registered as part of stack #5");
  });

  it("reports already-joined without calling create or add when topology already did it", async () => {
    const parent = pr({ number: 10, stack: { id: 5, number: 5, position: 1, size: 2 } });
    const created = pr({ number: 100, stack: { id: 5, number: 5, position: 2, size: 2 } });
    const calls: string[] = [];
    const api: GithubWriteApi = {
      mergeGroupContexts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
      setRequiredStatusChecks: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      addToStack: () => {
        calls.push("addToStack");
        return errAsync({ kind: "http", message: "should not be called", operation: "x" });
      },
      addIssueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      answerReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reopenReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      authenticatedUserId: () => okAsync(1),
      branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
      canAdmin: () => okAsync(false),
      canPush: () => okAsync(true),
      closePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createPr: () => okAsync(created),
      createStack: () => {
        calls.push("createStack");
        return errAsync({ kind: "http", message: "should not be called", operation: "x" });
      },
      dequeuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueueStackPr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      diffFiles: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dismissCodeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      findOpenPrByHead: () => okAsync(parent),
      getPr: () => okAsync(created),
      getIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      issueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listIssueComments: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrs: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrsAuthoredByMe: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listPrs: () => okAsync([]),
      listRuns: () => okAsync([]),
      markPrDraft: () => okAsync(undefined),
      markPrReady: () => okAsync(undefined),
      mergePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      repoLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestedReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreadDetails: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreads: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      setRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      submitReviewRound: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updateIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updatePr: () => okAsync(created),
      unstack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
    };
    const { deps, lines } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "bottom" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(lines).toContain("stack: GitHub had already joined this PR to stack #5 by branch topology");
  });

  it("FAILS the command when the pull request was created but its stack registration was not", async () => {
    const parent = pr({ number: 10, stack: undefined });
    const created = pr({ number: 100 });
    const calls: string[] = [];
    const api: GithubWriteApi = {
      mergeGroupContexts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
      setRequiredStatusChecks: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      addToStack: () => {
        calls.push("addToStack");
        return errAsync({ kind: "http", message: "should not be called", operation: "x" });
      },
      addIssueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      answerReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reopenReviewThread: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      authenticatedUserId: () => okAsync(1),
      branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
      canAdmin: () => okAsync(false),
      canPush: () => okAsync(true),
      closePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      codeScanningAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dependabotAlerts: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      createPr: () => okAsync(created),
      createStack: () => {
        calls.push("createStack");
        return errAsync({ kind: "http", message: "should not be called", operation: "x" });
      },
      dequeuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueueStackPr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      diffFiles: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dismissCodeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      findOpenPrByHead: () => okAsync(parent),
      // registerStackEntry's re-read of the new PR's own stack membership is the ONLY `getPr` call in
      // this flow (`performCreate` uses `createPr`, never `getPr`).
      getPr: () => errAsync({ kind: "http", message: "rate limited", operation: "x" }),
      getIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      getStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      issueLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listIssueComments: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrs: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listOpenPrsAuthoredByMe: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      listPrs: () => okAsync([]),
      listRuns: () => okAsync([]),
      markPrDraft: () => okAsync(undefined),
      markPrReady: () => okAsync(undefined),
      mergePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      repoLabels: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestedReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      requestReviewers: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreadDetails: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      reviewThreads: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      setRepoDescription: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      submitReviewRound: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updateIssueComment: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      updatePr: () => okAsync(created),
      unstack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
    };
    const { deps, lines } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "bottom" }), "--home", tempHome()],
      deps,
    });
    // Non-zero even though the pull request EXISTS: created-but-unregistered is the chained-not-native state
    // the doors exist to prevent, so reporting it as success would put
    // `stack audit --check` and this verb in direct disagreement about the same repository.
    expect(code).toBe(EXIT_ERROR);
    expect(calls).toEqual([]);
    expect(lines).toContain(
      "stack: NOT registered natively — could not re-read this PR's own stack membership: rate limited",
    );
    expect(lines).toContain("    slopweaver github stack adopt --pr <n>");
  });
});
