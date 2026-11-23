/**
 * `runGithubPrRequestReview`, driven end-to-end against a real temp home carrying a derived-roster fixture.
 *
 * The roster is real filesystem state (per `.claude/rules/testing.md`'s sanctioned fixture exception) rather
 * than an injected fake, because `reviewerWiring.ts` reads it directly — matching how `labelRun.test.ts`
 * exercises its own door-wrapped write against a real client fake and a real temp home.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { runGithubPrRequestReview } from "../../../../../cli/commands/github/requestReviewRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { silverIdentitiesPath } from "../../../../../corpus/corpusPaths.js";
import type { GithubWriteApi, RequestedReviewers, WrittenPr } from "../../../../../corpus/github/write.js";
import { err } from "../../../../../lib/result.js";
import { emptyObservation } from "../../../../../silver/derive/freshness.js";
import { freshnessStampPath } from "../../../../../silver/derive/stamp.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };
const HEAD = {
  label: "o:feature",
  ref: "feature",
  repoFullName: "o/r",
  sha: "1111111111111111111111111111111111111111",
};

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/**
 * A temp home with a derived roster, plus a MATCHING freshness stamp — an all-zero observation for an
 * otherwise-empty home, so `reviewersFromIdentity`'s just-in-time refresh reads the roster as already fresh
 * rather than attempting a real `slopweaver derive` against a home with no bronze corpus at all.
 */
function tempHomeWithRoster({ people }: { people: readonly unknown[] }): string {
  const home = mkdtempSync(join(tmpdir(), "github-request-review-home-"));
  homes.push(home);
  const identitiesPath = silverIdentitiesPath({ home });
  mkdirSync(dirname(identitiesPath), { recursive: true });
  writeFileSync(identitiesPath, JSON.stringify({ candidates: [], people }), "utf8");
  writeFileSync(
    freshnessStampPath({ home }),
    JSON.stringify({ ...emptyObservation(), derivedAtIso: "2026-01-01T00:00:00Z", version: 1 }),
    "utf8",
  );
  return home;
}

function ada(): unknown {
  return { confidence: "handle", id: "p1", identities: [{ handle: "ada", nativeId: "ada-gh", source: "github" }] };
}

function pr({ authorId = 1, state = "open" }: { authorId?: number; state?: string } = {}): WrittenPr {
  return {
    authorId,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: HEAD,
    htmlUrl: "https://example.invalid/pr/7",
    mergedAtIso: undefined,
    nodeId: "PR_7",
    number: 7,
    stack: undefined,
    state,
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

function requested({
  users = [],
  teams = [],
}: { users?: readonly string[]; teams?: readonly string[] } = {}): RequestedReviewers {
  return { teams, users };
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

function harnessDeps({ api }: { api: GithubWriteApi }): { deps: GithubPrDeps; errLines: string[]; outLines: string[] } {
  const errLines: string[] = [];
  const outLines: string[] = [];
  return {
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      cwd: () => "/repo",
      descriptionReview: clearDescriptionReview,
      doorLedger: memoryDoorLedger().port,
      env: () => undefined,
      err: ({ line }) => errLines.push(line),
      // The store's human roster, empty: the derived roster written by `tempHomeWithRoster` is the whole directory.
      identityRoster: memoryIdentityRosterPort(),
      installationIdentifiers: () => Promise.resolve({ identifiers: undefined, unread: [] }),
      makeApi: () => api,
      measureAlreadyLanded: () => err(["not exercised by request-review"]),
      measureBaseFreshness: () =>
        err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["not exercised by request-review"] })),
      now: () => new Date("2026-08-15T00:00:00Z"),
      out: ({ line }) => outLines.push(line),
      readFileSource: () => {
        throw new Error("not exercised by request-review");
      },
      readForm: () => {
        throw new Error("not exercised by request-review");
      },
      sleep: () => Promise.resolve(),
      token: () => "fake-test-token",
      writeFileOut: () => {
        throw new Error("not exercised by request-review");
      },
    },
    errLines,
    outLines,
  };
}

describe("runGithubPrRequestReview", () => {
  it("refuses a login the roster does not confirm BEFORE resolving a token", async () => {
    const home = tempHomeWithRoster({ people: [] });
    const { deps, errLines } = harnessDeps({ api: fakeApi({}) });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "nobody-knows-this-login", "--dry-run", "--home", home],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toContain("no exact match");
  });

  it("refuses, naming the store, when the identity roster cannot say who a login is — live and dry-run alike", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    const { deps, errLines } = harnessDeps({ api: fakeApi({}) });
    const down = { ...deps, identityRoster: unavailableIdentityRosterPort() };

    const live = await runGithubPrRequestReview({
      deps: down,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });
    const dry = await runGithubPrRequestReview({
      deps: down,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--dry-run", "--home", home],
    });

    expect([live, dry]).toEqual([EXIT_ERROR, EXIT_ERROR]);
    expect(errLines.map((line) => line.startsWith("this install keeps its identity roster in the store"))).toEqual([
      true,
      true,
    ]);
  });

  it("dry-run reports only the still-missing reviewers, and performs no door write", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    const api = fakeApi({
      getPr: () => okAsync(pr()),
      requestedReviewers: () => okAsync(requested({ users: ["already-here"] })),
    });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--dry-run", "--home", home],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("would request");
    expect(outLines[0]).toContain("ada-gh");
  });

  it("reports already requested and performs no write when every resolved login is already present", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    const api = fakeApi({
      getPr: () => okAsync(pr()),
      requestedReviewers: () => okAsync(requested({ users: ["ada-gh"] })),
    });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("already requested");
  });

  it("requests review on a pull request whatever its base branch is called, a personal-looking one included", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    const writes: { reviewers: readonly string[]; teamReviewers: readonly string[] }[] = [];
    const api = fakeApi({
      getPr: () => okAsync({ ...pr(), baseRef: "v2-ada-owner-work-console" }),
      requestedReviewers: () => okAsync(requested({ users: writes.length > 0 ? ["ada-gh"] : [] })),
      requestReviewers: ({ reviewers, teamReviewers }) => {
        writes.push({ reviewers, teamReviewers });
        return okAsync(requested({ users: ["ada-gh"] }));
      },
    });
    const { deps, errLines, outLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });

    expect(code).toBe(EXIT_OK);
    expect(errLines).toEqual([]);
    expect(writes).toEqual([{ reviewers: ["ada-gh"], teamReviewers: [] }]);
    expect(outLines[0]).toContain("requested #7");
  });

  it("refuses a foreign-authored pull request rather than requesting review on someone else's work", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    const api = fakeApi({
      authenticatedUserId: () => okAsync(99),
      getPr: () => okAsync(pr({ authorId: 1 })),
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(errLines[0]).toContain("not what this verb is for");
  });

  it("writes, re-reads and confirms on the live path", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    let wrote = false;
    const api = fakeApi({
      getPr: () => okAsync(pr()),
      requestedReviewers: () => (wrote ? okAsync(requested({ users: ["ada-gh"] })) : okAsync(requested({}))),
      requestReviewers: () => {
        wrote = true;
        return okAsync(requested({ users: ["ada-gh"] }));
      },
    });
    const { deps, outLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });

    expect(code).toBe(EXIT_OK);
    expect(outLines[0]).toContain("requested #7");
    expect(outLines[0]).toContain("ada-gh");
  });
});

describe("a door ledger whose store is down", () => {
  it("requests no review, and says the decision was not recorded", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    let writes = 0;
    const api = fakeApi({
      getPr: () => okAsync(pr()),
      requestedReviewers: () => okAsync(requested({})),
      requestReviewers: () => {
        writes += 1;
        return okAsync(requested({ users: ["ada-gh"] }));
      },
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps: { ...deps, doorLedger: unreachableDoorLedger() },
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(writes).toBe(0);
    expect(errLines[0]).toContain("slopweaver github pr request-review not performed:");
  });
});

describe("finding gate on request-review", () => {
  it("refuses to ask a teammate to review a pull request whose head is an unruled finding row", async () => {
    const home = tempHomeWithRoster({ people: [ada()] });
    const dir = join(home, "handovers");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${HEAD.ref}.md`),
      [
        "---",
        `slug: ${HEAD.ref}`,
        "kind: ask",
        'summary: "watchPr.sh dies silent"',
        "status: ready",
        "askedIso: 2026-09-02T06:14:01Z",
        "origin: finding",
        "observedBy: session-40",
        "evidence: [owner/repo#16360]",
        "blockedBy: []",
        "artifact: null",
        "doneWhen: []",
        "---",
        "",
      ].join("\n"),
      "utf8",
    );
    let requestedWrite = false;
    const api = fakeApi({
      getPr: () => okAsync(pr()),
      requestReviewers: () => {
        requestedWrite = true;
        return okAsync(requested());
      },
      requestedReviewers: () => okAsync(requested()),
    });
    const { deps, errLines } = harnessDeps({ api });

    const code = await runGithubPrRequestReview({
      deps,
      rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada-gh", "--home", home],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(requestedWrite).toBe(false);
    expect(errLines[0]).toBe(
      "refused: finding-unruled: cannot ask a teammate to review #7 for feature until the owner has ruled on it",
    );
  });
});
