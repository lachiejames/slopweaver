/**
 * The `github pr` verb driven end-to-end against a fake GitHub: every API method unreachable unless a test
 * overrides it, and every injectable edge recording what the verb printed and wrote. A plain fake passed in,
 * never a mock — the verb under test is the shipped one.
 */
import { errAsync, okAsync } from "neverthrow";

import { clearDescriptionReview } from "../cli/commands/github/descriptionReviewCheck.js";
import type { GithubPrDeps } from "../cli/commands/github/run.js";
import type { GithubWriteApi } from "../corpus/github/write.js";
import { ok } from "../lib/result.js";
import { memoryAutonomyLedgerPort } from "./autonomyLedgerFixture.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "./doorLedgerFixture.js";
import { memoryIdentityRosterPort } from "./identityRosterFixture.js";
import { UNREACHED_PROTECTION_READ } from "./protectionReadFixture.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };

/**
 * Every field a fake `GithubWriteApi` must fill.
 *
 * @param overrides the methods this test reaches; every other one answers an HTTP error
 * @returns a complete API whose unreached methods fail loudly rather than succeed by accident
 */
export function fakeApi(overrides: Partial<GithubWriteApi>): GithubWriteApi {
  return {
    mergeGroupContexts: () => errAsync(HTTP_ERROR),
    requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
    setRequiredStatusChecks: () => errAsync(HTTP_ERROR),
    addToStack: () => errAsync(HTTP_ERROR),
    addIssueLabels: () => errAsync(HTTP_ERROR),
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
    listOpenPrs: () => errAsync(HTTP_ERROR),
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

/**
 * A `readFileSource` over fake files by path, throwing on a path the test did not plant.
 *
 * @param files the fake files, by path
 * @returns the reader
 */
export function fakeFileSource({
  files,
}: {
  files: Readonly<Record<string, string>>;
}): (input: { source: string }) => string {
  return ({ source }) => {
    const content = files[source];
    if (content === undefined) {
      throw new Error(`no fake file at ${source}`);
    }
    return content;
  };
}

/**
 * The verb's edges over `api`, recording every printed line and written file.
 *
 * @param files the fake files `--file` and `readFileSource` read, by path
 * @param env the process variables the verb reads; none by default
 * @param door the in-memory door ledger the verb records through; a fresh one by default
 * @returns the deps to pass, the door ledger they record through, and the lines and writes they recorded
 */
export function harnessDeps({
  api,
  door = memoryDoorLedger(),
  env = {},
  files = {},
}: {
  api: GithubWriteApi;
  door?: MemoryDoorLedger;
  env?: Readonly<Record<string, string>>;
  files?: Readonly<Record<string, string>>;
}): {
  deps: GithubPrDeps;
  door: MemoryDoorLedger;
  lines: string[];
  writes: Record<string, string>;
} {
  const lines: string[] = [];
  const writes: Record<string, string> = {};
  return {
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      cwd: () => "/repo",
      descriptionReview: clearDescriptionReview,
      doorLedger: door.port,
      identityRoster: memoryIdentityRosterPort(),
      installationIdentifiers: () => Promise.resolve({ identifiers: undefined, unread: [] }),
      env: ({ name }) => env[name],
      err: () => undefined,
      makeApi: () => api,
      measureAlreadyLanded: () => ok({ kind: "skipped", why: "not exercised by this test" }),
      measureBaseFreshness: () => ok({ kind: "skipped", why: "not exercised by this test" }),
      now: () => new Date("2026-08-15T00:00:00Z"),
      out: ({ line }) => lines.push(line),
      readFileSource: fakeFileSource({ files }),
      readForm: ({ source }) => source,
      sleep: () => Promise.resolve(),
      token: () => "fake-test-token",
      writeFileOut: ({ path, content }) => {
        writes[path] = content;
      },
    },
    door,
    lines,
    writes,
  };
}
