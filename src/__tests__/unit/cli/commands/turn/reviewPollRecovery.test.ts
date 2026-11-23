/**
 * `readPollTruthRecoveringLateVerdict` — a `--poll` read that finds a PREVIOUS round's verdict archives it and
 * reads again, so the poll reports this round's reviewer rather than refusing on a file no verb could clear.
 * The read and the archive are plain fake functions that record their calls; no mocks.
 */
import { describe, expect, it } from "vitest";

import { readPollTruthRecoveringLateVerdict } from "../../../../../cli/commands/turn/reviewPollRun.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import type { ReviewPollTruth } from "../../../../../live/turn/reviewPoll.js";

const RECORD: ReviewRecord = {
  answerDigest: "sha256:abc",
  answerPath: "/answers/a.json",
  authorSession: "worker-1",
  carriedUnresolved: [],
  channel: "C9",
  messageTs: "1789788200.000200",
  packetPath: "/reviews/packet.md",
  reviewer: {
    host: "claude-code",
    surfaceId: "surface-id-1",
    surfaceRef: "surface:1",
    workspaceId: "workspace-id-1",
    workspaceRef: "workspace:7",
  },
  reviewerSession: "reviewer-2",
  round: 2,
  schemaVersion: 2,
  spawnedAt: "2026-10-13T05:00:00.000Z",
  threadTs: "1789788200.000200",
  verdictPath: "/reviews/verdict.json",
};

const ARCHIVED = "/reviews/verdict-superseded-reviewer-1-2026-10-13T04-59-59-999Z.json";
const SUPERSEDED: ReviewPollTruth = { kind: "superseded", path: "/reviews/verdict.json", wroteIt: "reviewer-1" };
const WORKING: ReviewPollTruth = { kind: "working", reconciledDoubt: undefined };
const PHANTOM: ReviewPollTruth = {
  kind: "phantom",
  reason: "cmux has no workspace workspace-id-1",
  why: "workspace-gone",
};
const VERDICT: ReviewPollTruth = {
  digestMatches: true,
  kind: "verdict",
  outcome: "clean",
  path: "/reviews/verdict.json",
};

/** Fake effects: reads hand back `truths` in order, the archive moves a file unless told not to, every call lands in `calls`. */
function fakes({
  archiveMoves = true,
  archiveThrows = false,
  truths,
}: {
  archiveMoves?: boolean;
  archiveThrows?: boolean;
  truths: readonly ReviewPollTruth[];
}) {
  const calls: string[] = [];
  let next = 0;
  return {
    calls,
    deps: {
      archiveLate: (record: ReviewRecord): string | undefined => {
        calls.push(`archive ${record.verdictPath}`);
        if (archiveThrows) {
          throw new Error("EACCES: permission denied");
        }
        if (!archiveMoves) {
          return undefined;
        }
        return ARCHIVED;
      },
      read: () => {
        const truth = truths[next]!;
        next += 1;
        calls.push(`read ${truth.kind}`);
        return Promise.resolve(ok({ record: RECORD, truth }));
      },
    },
  };
}

describe("readPollTruthRecoveringLateVerdict", () => {
  it("archives a superseded file ONCE, re-reads, and reports this round's reviewer still working", async () => {
    const { calls, deps } = fakes({ truths: [SUPERSEDED, WORKING] });

    const reading = await readPollTruthRecoveringLateVerdict({ deps });

    expect(unwrap(reading).truth).toStrictEqual(WORKING);
    expect(calls).toStrictEqual(["read superseded", "archive /reviews/verdict.json", "read working"]);
  });

  it("lets the standing reviewer's own verdict win the re-read", async () => {
    const { calls, deps } = fakes({ truths: [SUPERSEDED, VERDICT] });

    const reading = await readPollTruthRecoveringLateVerdict({ deps });

    expect(unwrap(reading).truth).toStrictEqual(VERDICT);
    expect(calls).toStrictEqual(["read superseded", "archive /reviews/verdict.json", "read verdict"]);
  });

  it("asks the archive beside a DEAD reviewer too, whose death outranks the file in the truth", async () => {
    const { calls, deps } = fakes({ truths: [PHANTOM, PHANTOM] });

    const reading = await readPollTruthRecoveringLateVerdict({ deps });

    expect(unwrap(reading).truth).toStrictEqual(PHANTOM);
    expect(calls).toStrictEqual(["read phantom", "archive /reviews/verdict.json", "read phantom"]);
  });

  it("never re-reads when the archive moved nothing", async () => {
    const { calls, deps } = fakes({ archiveMoves: false, truths: [WORKING, VERDICT] });

    const reading = await readPollTruthRecoveringLateVerdict({ deps });

    expect(unwrap(reading).truth).toStrictEqual(WORKING);
    expect(calls).toStrictEqual(["read working", "archive /reviews/verdict.json"]);
  });

  it("never asks the archive when the first read is this reviewer's own verdict", async () => {
    const { calls, deps } = fakes({ truths: [VERDICT, WORKING] });

    const reading = await readPollTruthRecoveringLateVerdict({ deps });

    expect(unwrap(reading).truth).toStrictEqual(VERDICT);
    expect(calls).toStrictEqual(["read verdict"]);
  });

  it("hands back the superseded reading when the archive throws, so the refusal still says why", async () => {
    const { calls, deps } = fakes({ archiveThrows: true, truths: [SUPERSEDED, WORKING] });

    const reading = await readPollTruthRecoveringLateVerdict({ deps });

    expect(unwrap(reading).truth).toStrictEqual(SUPERSEDED);
    expect(calls).toStrictEqual(["read superseded", "archive /reviews/verdict.json"]);
  });
});
