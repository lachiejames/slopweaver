/**
 * `update`'s address resolution and authorisation (`addressRun.ts`), driven directly.
 *
 * The pure halves — the `owner/name` split, the live target and its locus — are compared whole. The async
 * half runs against a typed fake `GithubWriteApi` whose every unreached method answers an error, and an
 * explicit temp home so the ledger hint a branch address consults is a real, empty directory.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import {
  liveLocusFor,
  liveTargetFor,
  ownerRepoOf,
  resolveAndAuthorise,
} from "../../../../../cli/commands/github/addressRun.js";
import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import type { PrAddress } from "../../../../../cli/commands/github/updateCore.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { toIngestError } from "../../../../../lib/ingestError.js";
import { err } from "../../../../../lib/result.js";
import { unavailableAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { memoryIdentityRosterPort } from "../../../../identityRosterFixture.js";
import { UNREACHED_PROTECTION_READ } from "../../../../protectionReadFixture.js";

const UNREACHED = toIngestError({ error: new Error("not reached by this test"), operation: "github.fake" });
const HEAD_SHA = "1111111111111111111111111111111111111111";
const OTHER_SHA = "2222222222222222222222222222222222222222";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "github-address-run-"));
  homes.push(home);
  return home;
}

function pr({
  authorId = 1,
  headRepoFullName = "o/r",
}: {
  authorId?: number;
  headRepoFullName?: string;
} = {}): WrittenPr {
  return {
    authorId,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "fork:feature", ref: "feature", repoFullName: headRepoFullName, sha: HEAD_SHA },
    htmlUrl: "https://example.invalid/pr/7",
    mergedAtIso: undefined,
    nodeId: "PR_7",
    number: 7,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

/** Every field a fake `GithubWriteApi` must fill; overrides replace the unreachable-by-default stubs. */
function fakeApi(overrides: Partial<GithubWriteApi>): GithubWriteApi {
  return {
    mergeGroupContexts: () => errAsync(UNREACHED),
    requiredStatusChecks: () => errAsync(UNREACHED_PROTECTION_READ),
    setRequiredStatusChecks: () => errAsync(UNREACHED),
    addIssueLabels: () => errAsync(UNREACHED),
    addToStack: () => errAsync(UNREACHED),
    answerReviewThread: () => errAsync(UNREACHED),
    reopenReviewThread: () => errAsync(UNREACHED),
    authenticatedUserId: () => errAsync(UNREACHED),
    branchProtection: () => errAsync(UNREACHED_PROTECTION_READ),
    canAdmin: () => errAsync(UNREACHED),
    canPush: () => errAsync(UNREACHED),
    closePr: () => errAsync(UNREACHED),
    codeScanningAlert: () => errAsync(UNREACHED),
    codeScanningAlerts: () => errAsync(UNREACHED),
    dependabotAlert: () => errAsync(UNREACHED),
    dependabotAlerts: () => errAsync(UNREACHED),
    createIssueComment: () => errAsync(UNREACHED),
    createPr: () => errAsync(UNREACHED),
    createStack: () => errAsync(UNREACHED),
    dequeuePr: () => errAsync(UNREACHED),
    diffFiles: () => errAsync(UNREACHED),
    dismissCodeScanningAlert: () => errAsync(UNREACHED),
    enqueuePr: () => errAsync(UNREACHED),
    enqueueStackPr: () => errAsync(UNREACHED),
    findOpenPrByHead: () => errAsync(UNREACHED),
    getIssueComment: () => errAsync(UNREACHED),
    getPr: () => errAsync(UNREACHED),
    getRepoDescription: () => errAsync(UNREACHED),
    getStack: () => errAsync(UNREACHED),
    issueLabels: () => errAsync(UNREACHED),
    listIssueComments: () => errAsync(UNREACHED),
    listOpenPrs: () => errAsync(UNREACHED),
    listOpenPrsAuthoredByMe: () => errAsync(UNREACHED),
    listPrs: () => errAsync(UNREACHED),
    listRuns: () => errAsync(UNREACHED),
    markPrDraft: () => errAsync(UNREACHED),
    markPrReady: () => errAsync(UNREACHED),
    mergePr: () => errAsync(UNREACHED),
    repoLabels: () => errAsync(UNREACHED),
    requestedReviewers: () => errAsync(UNREACHED),
    requestReviewers: () => errAsync(UNREACHED),
    reviewThreadDetails: () => errAsync(UNREACHED),
    reviewThreads: () => errAsync(UNREACHED),
    setRepoDescription: () => errAsync(UNREACHED),
    submitReviewRound: () => errAsync(UNREACHED),
    updateIssueComment: () => errAsync(UNREACHED),
    updatePr: () => errAsync(UNREACHED),
    unstack: () => errAsync(UNREACHED),
    ...overrides,
  };
}

/** The edges `resolveAndAuthorise` reads (`env`, `out`); every other edge throws if reached. */
function harness({ allowForeign }: { allowForeign: string | undefined }): { deps: GithubPrDeps; outLines: string[] } {
  const outLines: string[] = [];
  const unreached = (): never => {
    throw new Error("not reached by address resolution");
  };
  const env: GithubPrDeps["env"] = ({ name }) => (name === "SLOPWEAVER_ALLOW_FOREIGN_PR" ? allowForeign : undefined);
  return {
    deps: {
      // Address resolution never records an act; a ledger that refuses every call keeps a stray one visible.
      autonomy: unavailableAutonomyLedgerPort(),
      cwd: unreached,
      descriptionReview: clearDescriptionReview,
      doorLedger: memoryDoorLedger().port,
      identityRoster: memoryIdentityRosterPort(),
      installationIdentifiers: unreached,
      env,
      err: unreached,
      makeApi: unreached,
      measureAlreadyLanded: () => err(["not reached by address resolution"]),
      measureBaseFreshness: () =>
        err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["not reached by address resolution"] })),
      now: unreached,
      out: ({ line }) => outLines.push(line),
      readFileSource: unreached,
      readForm: unreached,
      sleep: unreached,
      token: unreached,
      writeFileOut: unreached,
    },
    outLines,
  };
}

const NUMBER_ADDRESS: PrAddress = { kind: "number", number: 7, owner: "o", repo: "r" };

describe("ownerRepoOf", () => {
  it("splits an owner/name full name into its two segments", () => {
    expect(ownerRepoOf({ fullName: "acme/acme-admin" })).toEqual({ owner: "acme", repo: "acme-admin" });
  });

  it("throws on a name missing either half, naming the payload it was given", () => {
    expect(() => ownerRepoOf({ fullName: "o" })).toThrow(
      'GitHub returned a repository full name that is not owner/name: "o"',
    );
    expect(() => ownerRepoOf({ fullName: "/r" })).toThrow(
      'GitHub returned a repository full name that is not owner/name: "/r"',
    );
    expect(() => ownerRepoOf({ fullName: "o/" })).toThrow(
      'GitHub returned a repository full name that is not owner/name: "o/"',
    );
  });
});

describe("liveTargetFor and liveLocusFor", () => {
  it("routes a same-repository pull request by its bare head ref, comparing repositories case-insensitively", () => {
    const live = pr({ headRepoFullName: "O/R" });
    expect(liveTargetFor({ pr: live })).toEqual({ base: "main", head: "feature", owner: "o", repo: "r" });
    expect(liveLocusFor({ pr: live })).toBe("o/r#main...feature");
  });

  it("routes a fork's pull request by GitHub's qualified head label", () => {
    const live = pr({ headRepoFullName: "fork/r" });
    expect(liveTargetFor({ pr: live })).toEqual({ base: "main", head: "fork:feature", owner: "o", repo: "r" });
    expect(liveLocusFor({ pr: live })).toBe("o/r#main...fork:feature");
  });

  it("routes a deleted fork (no head repository) by the qualified label, not as a same-repository branch", () => {
    const live: WrittenPr = { ...pr(), head: { ...pr().head, repoFullName: undefined } };
    expect(liveTargetFor({ pr: live })).toEqual({ base: "main", head: "fork:feature", owner: "o", repo: "r" });
  });
});

describe("resolveAndAuthorise", () => {
  it("returns the live pull request for its own author with no notice", async () => {
    const { deps, outLines } = harness({ allowForeign: undefined });
    const api = fakeApi({ authenticatedUserId: () => okAsync(1), getPr: () => okAsync(pr()) });

    const result = await resolveAndAuthorise({
      address: NUMBER_ADDRESS,
      api,
      deps,
      home: tempHome(),
      selfReviewRequested: false,
    });

    expect(result).toEqual({ live: pr() });
    expect(outLines).toEqual([]);
  });

  it("names the address and GitHub's reason when the numbered pull request cannot be read", async () => {
    const { deps } = harness({ allowForeign: undefined });
    const api = fakeApi({
      getPr: () => errAsync(toIngestError({ error: new Error("Not Found"), operation: "github.pulls.get" })),
    });

    const result = await resolveAndAuthorise({
      address: NUMBER_ADDRESS,
      api,
      deps,
      home: tempHome(),
      selfReviewRequested: false,
    });

    expect(result).toEqual({ reason: "could not read o/r#7: Not Found" });
  });

  it("refuses an --expect-head mismatch before it reads the caller's identity", async () => {
    const { deps } = harness({ allowForeign: undefined });
    let identityReads = 0;
    const authenticatedUserId: GithubWriteApi["authenticatedUserId"] = () => {
      identityReads += 1;
      return okAsync(1);
    };
    const api = fakeApi({ authenticatedUserId, getPr: () => okAsync(pr()) });

    const result = await resolveAndAuthorise({
      address: NUMBER_ADDRESS,
      api,
      deps,
      expectHead: OTHER_SHA,
      home: tempHome(),
      selfReviewRequested: false,
    });

    expect(result).toEqual({
      reason: `#7 is at ${HEAD_SHA}, not the expected head ${OTHER_SHA}, so nothing was sent. Re-derive the edit from the current head`,
    });
    expect(identityReads).toBe(0);
  });

  it("admits a foreign author under SLOPWEAVER_ALLOW_FOREIGN_PR=1 and prints the override notice", async () => {
    const { deps, outLines } = harness({ allowForeign: "1" });
    const api = fakeApi({ authenticatedUserId: () => okAsync(2), getPr: () => okAsync(pr({ authorId: 1 })) });

    const result = await resolveAndAuthorise({
      address: NUMBER_ADDRESS,
      api,
      deps,
      home: tempHome(),
      selfReviewRequested: false,
    });

    expect(result).toEqual({ live: pr({ authorId: 1 }) });
    expect(outLines).toEqual([
      "OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1 — editing a description on a pull request you did not author. Say so in the pull request.",
    ]);
  });

  it("refuses a foreign author when the override is absent, printing nothing", async () => {
    const { deps, outLines } = harness({ allowForeign: undefined });
    const api = fakeApi({ authenticatedUserId: () => okAsync(2), getPr: () => okAsync(pr({ authorId: 1 })) });

    const result = await resolveAndAuthorise({
      address: NUMBER_ADDRESS,
      api,
      deps,
      home: tempHome(),
      selfReviewRequested: false,
    });

    expect(result).toEqual({
      reason:
        "this pull request was opened by a different GitHub account from the one this token belongs to, and " +
        "editing other people's descriptions is not what this verb is for. Re-run with " +
        "SLOPWEAVER_ALLOW_FOREIGN_PR=1 if you really mean to",
    });
    expect(outLines).toEqual([]);
  });

  it("checks a self-review round's authorship strictly, so the foreign-PR override does not admit it", async () => {
    const { deps, outLines } = harness({ allowForeign: "1" });
    const api = fakeApi({ authenticatedUserId: () => okAsync(2), getPr: () => okAsync(pr({ authorId: 1 })) });

    const result = await resolveAndAuthorise({
      address: NUMBER_ADDRESS,
      api,
      deps,
      home: tempHome(),
      selfReviewRequested: true,
    });

    expect(result).toEqual({
      reason: "inline self-review comments may only be posted on the authenticated account's own pull request",
    });
    expect(outLines).toEqual([]);
  });

  it("resolves a branch address with no ledger hint by listing GitHub with the owner-qualified head", async () => {
    const { deps } = harness({ allowForeign: undefined });
    const listCalls: Parameters<GithubWriteApi["listPrs"]>[0][] = [];
    const listPrs: GithubWriteApi["listPrs"] = (input) => {
      listCalls.push(input);
      return okAsync([pr()]);
    };
    const api = fakeApi({ authenticatedUserId: () => okAsync(1), listPrs });

    const result = await resolveAndAuthorise({
      address: { base: "main", head: "feature", kind: "branch", owner: "o", repo: "r" },
      api,
      deps,
      home: tempHome(),
      selfReviewRequested: false,
    });

    expect(result).toEqual({ live: pr() });
    expect(listCalls).toEqual([{ base: "main", head: "o:feature", owner: "o", repo: "r" }]);
  });
});
