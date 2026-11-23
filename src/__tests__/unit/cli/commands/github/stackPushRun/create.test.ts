/**
 * `github stack push` creating the bottom of a fresh stack: the amend stages exactly the pinned tree, the push
 * leases on the remote it read, the body sent is linkified, and a push the remote does not confirm fails the run.
 * Split from `stackPushRun.test.ts` by behaviour.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runGithubStackPush } from "../../../../../../cli/commands/github/stackPushRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../../corpus/github/write.js";
import { UNREACHED_PROTECTION_READ } from "../../../../../protectionReadFixture.js";
import { AMENDED_SHA, baseForm, PREFIX, pr } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackPush", () => {
  it("creates the bottom of a fresh stack and registers nothing", async () => {
    const created = pr({ number: 100 });
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
      createStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dequeuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueueStackPr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      diffFiles: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dismissCodeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      findOpenPrByHead: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
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
    const { deps, lines, pins, reads, writes } = harness({ api });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(pins).toEqual(["/repo"]);
    // The amend stages, reads back what it staged, and commits only because that is the pinned tree.
    expect(reads.slice(reads.indexOf("add --all"), reads.indexOf("add --all") + 2)).toEqual([
      "add --all",
      "write-tree",
    ]);
    // `git add --all` is a read (its output is unused, matching `amend()`'s own implementation) — only the
    // amend commit and the push itself are `writeGit` calls.
    expect(writes).toEqual([
      ["commit", "--amend", "--no-edit"],
      [
        "push",
        "--set-upstream",
        "--force-with-lease=refs/heads/top:1111111111111111111111111111111111111111",
        "origin",
        `${AMENDED_SHA}^{commit}:refs/heads/top`,
      ],
    ]);
    expect(lines).toContain("stack: this is the bottom of a fresh stack — no registration needed");
  });

  it("linkifies a bare issue reference in the form before it ever reaches the created PR's body", async () => {
    const created = pr({ number: 100 });
    let sentBody = "";
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
      createPr: ({ body }) => {
        sentBody = body;
        return okAsync(created);
      },
      createStack: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dequeuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueuePr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      enqueueStackPr: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      diffFiles: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      dismissCodeScanningAlert: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
      findOpenPrByHead: () => errAsync({ kind: "http", message: "unreachable", operation: "x" }),
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
      argv: [...PREFIX, "--form", baseForm({ base: "main", explainerText: "caused by #123" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(sentBody).toContain('<a href="https://github.com/o/r/issues/123">#123</a>');
    expect(sentBody).not.toContain("caused by #123");
    expect(lines).toContain("stack: this is the bottom of a fresh stack — no registration needed");
  });

  it("reports the push as unconfirmed when the remote SHA does not match after pushing", async () => {
    // `canPush` is the only API call before the amend, so it is the only method this fake needs.
    const api = { canPush: () => okAsync(true) } as unknown as GithubWriteApi;
    const { deps, lines } = harness({ api, postAmendRemoteSha: "9999999999999999999999999999999999999999" });
    const code = await runGithubStackPush({
      argv: [...PREFIX, "--form", baseForm({ base: "main" }), "--home", tempHome()],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.some((line) => line.includes("unconfirmed"))).toBe(true);
  });
});
