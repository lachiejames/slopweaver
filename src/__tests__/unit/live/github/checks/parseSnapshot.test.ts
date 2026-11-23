/**
 * `parseChecksSnapshot` — the GraphQL rollup shaped into typed checks: check runs and legacy status contexts,
 * latest-per-name with the discards carried as superseded, the mergeability verdict, and the residue a short
 * or undecodable page leaves.
 *
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseChecksSnapshot } from "../../../../../live/github/checks.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import { IDENTITY, rollupData } from "./harness.js";

describe("parseChecksSnapshot", () => {
  it("shapes a mix of check runs and legacy status contexts into typed checks", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              conclusion: "SUCCESS",
              detailsUrl: "https://x/1",
              name: "lint",
              status: "COMPLETED",
            },
            { __typename: "CheckRun", detailsUrl: "https://x/2", name: "build", status: "IN_PROGRESS" },
            { __typename: "CheckRun", name: "deploy", status: "QUEUED" },
            {
              __typename: "CheckRun",
              conclusion: "FAILURE",
              detailsUrl: "https://x/3",
              name: "test",
              status: "COMPLETED",
            },
            { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: "https://x/4" },
          ],
          state: "FAILURE",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot).toEqual({
      checks: [
        { conclusion: "SUCCESS", kind: "check-run", name: "lint", state: "passed", url: "https://x/1" },
        { kind: "check-run", name: "build", state: "running", url: "https://x/2" },
        { kind: "check-run", name: "deploy", state: "queued", url: undefined },
        { conclusion: "FAILURE", kind: "check-run", name: "test", state: "failed", url: "https://x/3" },
        { kind: "status", name: "ci/legacy", state: "passed", url: "https://x/4" },
      ],
      headSha: "abc123",
      mergeable: undefined,
      residue: [],
      rollupState: "FAILURE",
      supersededChecks: [],
      truncated: false,
    });
  });

  it("keeps SKIPPED and NEUTRAL distinct from SUCCESS in the raw conclusion while all three stay passed", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            { __typename: "CheckRun", conclusion: "SUCCESS", name: "e2e (a)", status: "COMPLETED" },
            { __typename: "CheckRun", conclusion: "SKIPPED", name: "e2e (b)", status: "COMPLETED" },
            { __typename: "CheckRun", conclusion: "NEUTRAL", name: "e2e (c)", status: "COMPLETED" },
          ],
          state: "SUCCESS",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks).toEqual([
      { conclusion: "SUCCESS", kind: "check-run", name: "e2e (a)", state: "passed", url: undefined },
      { conclusion: "SKIPPED", kind: "check-run", name: "e2e (b)", state: "passed", url: undefined },
      { conclusion: "NEUTRAL", kind: "check-run", name: "e2e (c)", state: "passed", url: undefined },
    ]);
  });

  it("keeps the WINNING re-run's conclusion when latest-per-name discards an older one", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:20:00Z" },
              conclusion: "SKIPPED",
              name: "e2e",
              status: "COMPLETED",
            },
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:00:00Z" },
              conclusion: "SUCCESS",
              name: "e2e",
              status: "COMPLETED",
            },
          ],
          state: "SUCCESS",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks).toEqual([
      { conclusion: "SKIPPED", kind: "check-run", name: "e2e", state: "passed", url: undefined },
    ]);
  });

  it("carries a TIED loser's raw conclusion, unordered, so an evidence gate can refuse to pick by listing order", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:00:00Z" },
              conclusion: "SUCCESS",
              name: "E2E (billing)",
              status: "COMPLETED",
            },
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:00:00Z" },
              conclusion: "SKIPPED",
              name: "E2E (billing)",
              status: "COMPLETED",
            },
          ],
          state: "SUCCESS",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks).toEqual([
      { conclusion: "SUCCESS", kind: "check-run", name: "E2E (billing)", state: "passed", url: undefined },
    ]);
    expect(snapshot.supersededChecks).toEqual([
      {
        completedAt: undefined,
        conclusion: "SKIPPED",
        kind: "check-run",
        name: "E2E (billing)",
        replacedBy: undefined,
        runId: undefined,
        state: "passed",
      },
    ]);
  });

  it("carries GitHub's CONFLICTING verdict onto the snapshot — the cause of a required context never running", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: {
          repository: {
            pullRequest: {
              baseRefName: "main",
              commits: { nodes: [{ commit: { oid: "abc123" } }] },
              mergeable: "CONFLICTING",
            },
          },
        },
        identity: IDENTITY,
      }),
    );

    expect(snapshot.mergeable).toBe("CONFLICTING");
    expect(snapshot.baseRef).toBe("main");
  });

  it("carries MERGEABLE, which is what RULES a conflict out rather than leaving it unmeasured", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: {
          repository: {
            pullRequest: { commits: { nodes: [{ commit: { oid: "abc123" } }] }, mergeable: "MERGEABLE" },
          },
        },
        identity: IDENTITY,
      }),
    );

    expect(snapshot.mergeable).toBe("MERGEABLE");
  });

  it("collapses a token GitHub does not document to UNKNOWN rather than carrying it verbatim", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: {
          repository: { pullRequest: { commits: { nodes: [{ commit: { oid: "abc123" } }] }, mergeable: "WAT" } },
        },
        identity: IDENTITY,
      }),
    );

    expect(snapshot.mergeable).toBe("UNKNOWN");
  });

  it("answers `undefined`, never MERGEABLE, when the read selected no mergeability at all", () => {
    const snapshot = unwrap(parseChecksSnapshot({ data: rollupData({}), identity: IDENTITY }));

    expect(snapshot.mergeable).toBe(undefined);
  });

  it("still answers the mergeability when the pull request carries no head commit to parse", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: { repository: { pullRequest: { commits: { nodes: [] }, mergeable: "CONFLICTING" } } },
        identity: IDENTITY,
      }),
    );

    expect(snapshot.mergeable).toBe("CONFLICTING");
    expect(snapshot.headSha).toBe("");
  });

  it("refuses when GitHub reports no such pull request", () => {
    const failure = unwrapErr(parseChecksSnapshot({ data: { repository: { pullRequest: null } }, identity: IDENTITY }));

    expect(failure).toEqual(GithubLiveErrors.notFound({ identity: IDENTITY, kind: "pull request" }));
  });

  it("answers an empty, already-pending snapshot when the head commit carries no rollup at all", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: { repository: { pullRequest: { commits: { nodes: [{ commit: { oid: "abc123" } }] } } } },
        identity: IDENTITY,
      }),
    );

    expect(snapshot).toEqual({
      checks: [],
      headSha: "abc123",
      mergeable: undefined,
      residue: [],
      rollupState: "PENDING",
      supersededChecks: [],
      truncated: false,
    });
  });

  it("keeps only the newest check run per name when a re-run leaves stale contexts behind", () => {
    // Real shape observed live: editing a pull request's description retriggered its CI, and the very next
    // poll answered two contexts per name — the fresh one listed BEFORE its own stale predecessor.
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-08-20T10:26:29Z" },
              name: "build",
              status: "IN_PROGRESS",
            },
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-08-20T10:16:07Z" },
              conclusion: "SUCCESS",
              name: "build",
              status: "COMPLETED",
            },
          ],
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks).toEqual([{ kind: "check-run", name: "build", state: "running", url: undefined }]);
  });

  it("carries a discarded failed re-run as supersededChecks — the superseded-run shape: rollup FAILURE, latest-per-name all passed", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:00:00Z", workflowRun: { databaseId: 33717795965 } },
              completedAt: "2026-09-03T05:11:44Z",
              conclusion: "FAILURE",
              name: "dev-gate",
              status: "COMPLETED",
            },
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:20:00Z", workflowRun: { databaseId: 33717812345 } },
              completedAt: "2026-09-03T05:31:00Z",
              conclusion: "SUCCESS",
              name: "dev-gate",
              status: "COMPLETED",
            },
          ],
          state: "FAILURE",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks).toEqual([
      {
        conclusion: "SUCCESS",
        datedAt: "2026-09-03T05:31:00Z",
        kind: "check-run",
        name: "dev-gate",
        runId: "33717812345",
        state: "passed",
        url: undefined,
      },
    ]);
    expect(snapshot.supersededChecks).toEqual([
      {
        completedAt: "2026-09-03T05:11:44Z",
        conclusion: "FAILURE",
        kind: "check-run",
        name: "dev-gate",
        replacedBy: { completedAt: "2026-09-03T05:31:00Z", runId: "33717812345", state: "passed" },
        runId: "33717795965",
        state: "failed",
      },
    ]);
  });

  it("keeps only the newest legacy status context per name, by its own createdAt", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            { __typename: "StatusContext", context: "ci/legacy", createdAt: "2026-08-20T09:00:00Z", state: "FAILURE" },
            { __typename: "StatusContext", context: "ci/legacy", createdAt: "2026-08-20T10:00:00Z", state: "SUCCESS" },
          ],
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks).toEqual([
      { datedAt: "2026-08-20T10:00:00Z", kind: "status", name: "ci/legacy", state: "passed", url: undefined },
    ]);
  });

  it("flags residue when more check contexts exist than the requested limit", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [{ __typename: "CheckRun", conclusion: "SUCCESS", name: "lint", status: "COMPLETED" }],
          hasNextPage: true,
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.residue).toEqual([
      "more check contexts exist than the requested --limit; pass a larger one to see them all",
    ]);
  });

  it("marks the read truncated when a context does not decode, so a head whose running check is unreadable never reads done", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            { __typename: "CheckRun", conclusion: "SUCCESS", name: "lint", status: "COMPLETED" },
            null,
            { __typename: "CheckRun", status: "IN_PROGRESS" },
          ],
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.checks.map((check) => check.name)).toEqual(["lint"]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.residue).toEqual(["2 check context(s) did not decode, so the read is short"]);
  });

  it("marks the read truncated when the rollup carries no contexts connection at all", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: {
          repository: {
            pullRequest: {
              commits: { nodes: [{ commit: { oid: "abc123", statusCheckRollup: { state: "PENDING" } } }] },
            },
          },
        },
        identity: IDENTITY,
      }),
    );

    expect([snapshot.checks, snapshot.truncated, snapshot.residue]).toEqual([
      [],
      true,
      ["1 check context(s) did not decode, so the read is short"],
    ]);
  });

  it("leaves a fully decoded page untruncated", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [{ __typename: "CheckRun", conclusion: "SUCCESS", name: "lint", status: "COMPLETED" }],
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.truncated).toBe(false);
    expect(snapshot.residue).toEqual([]);
  });
});
