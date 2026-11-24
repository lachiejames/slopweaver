import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { NotPerformed } from "../../../../../admit/doorRefusal.js";
import { selfReviewOutcomeLines } from "../../../../../cli/commands/github/selfReviewOutcome.js";
import { type GithubSelfReviewApi, sendSelfReviewRound } from "../../../../../cli/commands/github/selfReviewRun.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  confirmSelfReviewRound,
  readSelfReviewReservation,
  readSelfReviewRound,
  reserveSelfReviewRound,
  selfReviewLocus,
} from "../../../../../outbound/github/selfReviewLedger.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../profileHoldFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "self-review-run-"));
  fixtureDirs.push(home);
  return home;
}

/** A patch exposing right-side lines 1-4 on `src/a.ts` — every existing test's comments land inside it. */
const DIFF_PATCH = ["@@ -1,3 +1,4 @@", " line1", "+line2", "+line3", " line4"].join("\n");

function pr({ sha }: { sha: string }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "body",
    commits: 1,
    draft: true,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha },
    htmlUrl: "https://example.test/o/r/pull/7",
    mergedAtIso: undefined,
    nodeId: "PR7",
    number: 7,
    stack: undefined,
    state: "open",
    title: "title",
    updatedAtIso: "2026-08-14T00:00:00Z",
  };
}

describe("sendSelfReviewRound", () => {
  it("posts fresh first, resolves only the confirmed prior round, and advances ownership after readback", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    const calls: string[] = [];
    let round = 0;
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]),
      reviewThreads: () => {
        calls.push(`read:${String(round)}`);
        return okAsync(
          round === 1
            ? [{ commentIds: ["C1"], id: "T1", isResolved: false }]
            : [{ commentIds: ["C2"], id: "T2", isResolved: false }],
        );
      },
      submitReviewRound: ({ resolveThreadIds }) => {
        round += 1;
        calls.push(`submit:${String(round)}:${resolveThreadIds.join(",")}`);
        return okAsync({ commentIds: [round === 1 ? "C1" : "C2"], reviewId: `R${String(round)}` });
      },
    };
    const first = await sendSelfReviewRound({
      api,
      form: {
        comments: [{ body: "This introduces the typed boundary.", kind: "explanation", line: 2, path: "src/a.ts" }],
      },
      home,
      ledger: door.port,
      nowIso: "t1",
      pr: pr({ sha: "one" }),
    });
    expect(first).toEqual({
      comments: 1,
      kind: "posted",
      number: 7,
      resolvedThreads: 0,
      url: "https://example.test/o/r/pull/7",
    });
    const second = await sendSelfReviewRound({
      api,
      form: {
        comments: [{ body: "This now keeps the ledger current.", kind: "explanation", line: 3, path: "src/a.ts" }],
      },
      home,
      ledger: door.port,
      nowIso: "t2",
      pr: pr({ sha: "two" }),
    });
    expect(second).toEqual({
      comments: 1,
      kind: "posted",
      number: 7,
      resolvedThreads: 1,
      url: "https://example.test/o/r/pull/7",
    });
    expect(calls).toEqual(["submit:1:", "read:1", "submit:2:T1", "read:2"]);
    expect(
      unwrap(
        readSelfReviewRound({
          home,
          locus: selfReviewLocus({ number: 7, owner: "o", repo: "r" }),
          pullRequestId: "PR7",
        }),
      ),
    ).toEqual({
      kind: "owned",
      record: {
        confirmedIso: "t2",
        formHash: "cd9012516a45bbabb328e4869e154f81",
        headSha: "two",
        locus: "o/r#7",
        pullRequestId: "PR7",
        threadIds: ["T2"],
      },
    });
  });

  it("resolves none of a round another pull request left at this address, says so, and binds the next to this one", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    const locus = selfReviewLocus({ number: 7, owner: "o", repo: "r" });
    // The archived repository's #7 confirmed a round at this address before the rename, bound to its own node id.
    reserveSelfReviewRound({
      home,
      intent: { formHash: "old", headSha: "old", locus, reservedIso: "t0" },
      pullRequestId: "ARCHIVED_PR7",
    });
    expect(
      confirmSelfReviewRound({
        home,
        record: {
          confirmedIso: "t0",
          formHash: "old",
          headSha: "old",
          locus,
          pullRequestId: "ARCHIVED_PR7",
          threadIds: ["OLD1", "OLD2"],
        },
      }),
    ).toEqual({ kind: "confirmed" });
    const resolved: string[][] = [];
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]),
      reviewThreads: () => okAsync([{ commentIds: ["C1"], id: "T1", isResolved: false }]),
      submitReviewRound: ({ resolveThreadIds }) => {
        resolved.push([...resolveThreadIds]);
        return okAsync({ commentIds: ["C1"], reviewId: "R1" });
      },
    };
    const outcome = await sendSelfReviewRound({
      api,
      form: {
        comments: [{ body: "This now keeps the ledger current.", kind: "explanation", line: 3, path: "src/a.ts" }],
      },
      home,
      ledger: door.port,
      nowIso: "t1",
      pr: pr({ sha: "one" }),
    });
    expect(resolved).toEqual([[]]);
    expect(selfReviewOutcomeLines({ command: "slopweaver github push", outcome })).toEqual([
      "self-review: posted 1 inline comment(s) on #7 and resolved 0 previous thread(s)",
      "https://example.test/o/r/pull/7",
      "self-review: set aside the round confirmed at t0 for o/r#7: it is not bound to this pull request, so none " +
        "of its threads were resolved",
    ]);
    expect(unwrap(readSelfReviewRound({ home, locus, pullRequestId: "PR7" }))).toEqual({
      kind: "owned",
      record: {
        confirmedIso: "t1",
        formHash: "cd9012516a45bbabb328e4869e154f81",
        headSha: "one",
        locus,
        pullRequestId: "PR7",
        threadIds: ["T1"],
      },
    });
  });

  it("reports a round set aside on a refusal too, where nothing overwrites it", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    const locus = selfReviewLocus({ number: 7, owner: "o", repo: "r" });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "old", headSha: "old", locus, reservedIso: "t0" },
      pullRequestId: "ARCHIVED_PR7",
    });
    confirmSelfReviewRound({
      home,
      record: {
        confirmedIso: "t0",
        formHash: "old",
        headSha: "old",
        locus,
        pullRequestId: "ARCHIVED_PR7",
        threadIds: ["OLD1"],
      },
    });
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/other.ts" }]),
      reviewThreads: () => okAsync([]),
      submitReviewRound: () => okAsync({ commentIds: ["C1"], reviewId: "R1" }),
    };
    const outcome = await sendSelfReviewRound({
      api,
      form: {
        comments: [{ body: "This now keeps the ledger current.", kind: "explanation", line: 3, path: "src/a.ts" }],
      },
      home,
      ledger: door.port,
      nowIso: "t1",
      pr: pr({ sha: "one" }),
    });
    expect(selfReviewOutcomeLines({ command: "slopweaver github push", outcome })).toEqual([
      "self-review refused: these comment anchors are not part of the live diff at the reviewed head SHA: src/a.ts:3",
      "self-review: set aside the round confirmed at t0 for o/r#7: it is not bound to this pull request, so none " +
        "of its threads were resolved",
    ]);
    expect(unwrap(readSelfReviewRound({ home, locus, pullRequestId: "ARCHIVED_PR7" }))).toEqual({
      kind: "owned",
      record: {
        confirmedIso: "t0",
        formHash: "old",
        headSha: "old",
        locus,
        pullRequestId: "ARCHIVED_PR7",
        threadIds: ["OLD1"],
      },
    });
  });

  it("holds an ambiguous write and never calls the provider again", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    let submissions = 0;
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]),
      reviewThreads: () => okAsync([]),
      submitReviewRound: () => {
        submissions += 1;
        return errAsync({ kind: "http", message: "connection reset", operation: "github.review" });
      },
    };
    const input = {
      api,
      form: {
        comments: [{ body: "This explains the changed boundary.", kind: "explanation", line: 2, path: "src/a.ts" }],
      },
      home,
      ledger: door.port,
      pr: pr({ sha: "one" }),
    } as const;
    const first = await sendSelfReviewRound({ ...input, nowIso: "t1" });
    const doorRowsAfterFirst = door.text();
    expect(doorRowsAfterFirst.length).toBeGreaterThan(0);
    const second = await sendSelfReviewRound({ ...input, nowIso: "t2" });
    // The held round answers before the door, so the retry that can never be sent leaves no door row.
    expect(door.text()).toBe(doorRowsAfterFirst);
    expect(first).toEqual({
      kind: "unconfirmed",
      locus: "o/r#7",
      reason: "the submit-and-resolve mutation failed (connection reset); inspect GitHub before any retry",
    });
    expect(second).toEqual({
      kind: "unconfirmed",
      locus: "o/r#7",
      reason: "a round for head one was reserved at t1; inspect GitHub before any retry",
    });
    expect(submissions).toBe(1);
  });

  it("refuses a reservation that is there but corrupt before the door, and sends once it is gone", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    const calls: string[] = [];
    const api: GithubSelfReviewApi = {
      diffFiles: () => {
        calls.push("diffFiles");
        return okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]);
      },
      reviewThreads: () => okAsync([{ commentIds: ["C1"], id: "T1", isResolved: false }]),
      submitReviewRound: () => {
        calls.push("submitReviewRound");
        return okAsync({ commentIds: ["C1"], reviewId: "R1" });
      },
    };
    const form = {
      comments: [
        { body: "This targets the live diff correctly.", kind: "explanation" as const, line: 2, path: "src/a.ts" },
      ],
    };
    const locus = selfReviewLocus({ number: 7, owner: "o", repo: "r" });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "one", locus, reservedIso: "t0" },
      pullRequestId: "PR7",
    });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const lock = join(
      ledger,
      readdirSync(ledger).find((name) => name.endsWith(".lock"))!,
    );
    writeFileSync(join(lock, "reservation.json"), "{");
    const refused = await sendSelfReviewRound({
      api,
      form,
      home,
      ledger: door.port,
      nowIso: "t1",
      pr: pr({ sha: "one" }),
    });
    expect(refused).toEqual({ kind: "refused", reason: unwrapErr(readSelfReviewReservation({ home, locus }))[0] });
    expect(calls).toEqual([]);
    expect(door.records().length).toBe(0);
    rmSync(lock, { force: true, recursive: true });
    const posted = await sendSelfReviewRound({
      api,
      form,
      home,
      ledger: door.port,
      nowIso: "t2",
      pr: pr({ sha: "one" }),
    });
    expect(posted.kind).toBe("posted");
    expect(door.records().length).toBe(1);
  });

  it("answers a lock that records no round as held before the door, writing no door row", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    const locus = selfReviewLocus({ number: 7, owner: "o", repo: "r" });
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "one", locus, reservedIso: "t0" },
      pullRequestId: "PR7",
    });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const lock = join(
      ledger,
      readdirSync(ledger).find((name) => name.endsWith(".lock"))!,
    );
    rmSync(join(lock, "reservation.json"));
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]),
      reviewThreads: () => okAsync([]),
      submitReviewRound: () => okAsync({ commentIds: ["C1"], reviewId: "R1" }),
    };
    const form = {
      comments: [
        { body: "This targets the live diff correctly.", kind: "explanation" as const, line: 2, path: "src/a.ts" },
      ],
    };
    expect(
      await sendSelfReviewRound({ api, form, home, ledger: door.port, nowIso: "t1", pr: pr({ sha: "one" }) }),
    ).toEqual({
      kind: "unconfirmed",
      locus,
      reason: "the reservation lock is held but records no round; inspect GitHub before any retry",
    });
    expect(door.records().length).toBe(0);
  });

  it("refuses a stale anchor before the composite mutation and releases its own reservation", async () => {
    const home = tempHome();
    const door = memoryDoorLedger();
    const calls: string[] = [];
    const api: GithubSelfReviewApi = {
      diffFiles: () => {
        calls.push("diffFiles");
        return okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]);
      },
      reviewThreads: () => okAsync([{ commentIds: ["C1"], id: "T1", isResolved: false }]),
      submitReviewRound: () => {
        calls.push("submitReviewRound");
        return okAsync({ commentIds: ["C1"], reviewId: "R1" });
      },
    };
    const refused = await sendSelfReviewRound({
      api,
      form: {
        comments: [
          { body: "This targets a line the diff moved past.", kind: "explanation", line: 99, path: "src/a.ts" },
        ],
      },
      home,
      ledger: door.port,
      nowIso: "t1",
      pr: pr({ sha: "one" }),
    });
    expect(refused).toEqual({
      kind: "refused",
      reason: "these comment anchors are not part of the live diff at the reviewed head SHA: src/a.ts:99",
    });
    expect(calls).toEqual(["diffFiles"]);
    // The refused round never resolved anything, and released its own reservation: a corrected retry proceeds.
    const posted = await sendSelfReviewRound({
      api,
      form: {
        comments: [{ body: "This targets the live diff correctly.", kind: "explanation", line: 2, path: "src/a.ts" }],
      },
      home,
      ledger: door.port,
      nowIso: "t2",
      pr: pr({ sha: "one" }),
    });
    expect(posted).toEqual({
      comments: 1,
      kind: "posted",
      number: 7,
      resolvedThreads: 0,
      url: "https://example.test/o/r/pull/7",
    });
    expect(calls).toEqual(["diffFiles", "diffFiles", "submitReviewRound"]);
  });

  it("refuses, sending nothing, when the door's decision cannot be recorded", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]),
      reviewThreads: () => okAsync([]),
      submitReviewRound: () => {
        calls.push("submitReviewRound");
        return okAsync({ commentIds: ["C1"], reviewId: "R1" });
      },
    };
    const refused = await sendSelfReviewRound({
      api,
      form: {
        comments: [{ body: "This targets the live diff correctly.", kind: "explanation", line: 2, path: "src/a.ts" }],
      },
      home,
      ledger: unreachableDoorLedger(),
      nowIso: "t1",
      pr: pr({ sha: "one" }),
    });
    expect(refused.kind).toBe("not-performed");
    expect((refused as { through: NotPerformed }).through.kind).toBe("recording-refused");
    expect(calls).toEqual([]);
  });

  it("carries the door's own refusal, and the outcome lines print it whole, when the door holds the round", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const api: GithubSelfReviewApi = {
      diffFiles: () => okAsync([{ patch: DIFF_PATCH, path: "src/a.ts" }]),
      reviewThreads: () => okAsync([]),
      submitReviewRound: () => {
        calls.push("submitReviewRound");
        return okAsync({ commentIds: ["C1"], reviewId: "R1" });
      },
    };
    const held = await withProfileHold({
      home,
      run: () =>
        sendSelfReviewRound({
          api,
          form: {
            comments: [
              { body: "This targets the live diff correctly.", kind: "explanation", line: 2, path: "src/a.ts" },
            ],
          },
          home,
          ledger: memoryDoorLedger().port,
          nowIso: "t1",
          pr: pr({ sha: "one" }),
        }),
    });
    expect(calls).toEqual([]);
    expect(held.decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(selfReviewOutcomeLines({ command: "slopweaver github push", outcome: held.result })).toEqual(
      expectedHoldRefusal({ command: "slopweaver github push", decision: held.decision }),
    );
  });
});
