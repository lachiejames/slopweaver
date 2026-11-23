/**
 * The loop-breakage rows `turn review` appends — the round cap, carry starvation, reviewer death and a late
 * previous-round verdict — read
 * back off a real ledger under a temp home, with the clock injected so every row's timestamp is exact.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  archiveLateReviewerVerdict,
  recordCarryStarvation,
  recordReviewerDeath,
  recordRoundCap,
} from "../../../../../cli/commands/turn/reviewLedger.js";
import type { AskIdentity } from "../../../../../live/ask/identity.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import type { CarriedForward } from "../../../../../live/turn/reviewRounds.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "review-ledger-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const ASK: AskIdentity = { channel: "C1", messageTs: "1789788122.066099", threadTs: "1789788100.000100" };

/** Every path under the temp home, relative — the filesystem witness for "writes nothing". */
const homeContents = (): readonly string[] => readdirSync(home, { recursive: true }).map(String).toSorted();

/** The ledger's rows, each parsed, in file order. */
const ledgerRows = (): readonly unknown[] =>
  readFileSync(join(home, "ledgers", "loop-breakage.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));

/** A clock that returns one fixed instant and counts how often it was asked. */
const fixedClock = ({ iso }: { iso: string }) => {
  const calls = { count: 0 };
  return {
    calls,
    now: (): Date => {
      calls.count += 1;
      return new Date(iso);
    },
  };
};

/** A carried-forward fixture, with the two fields the starvation judgement reads overridable. */
const inheritedWith = (over: Partial<CarriedForward>): CarriedForward => ({
  carriedReads: [],
  carriedSettled: [],
  carriedUnresolved: [],
  previousOutcome: "broken",
  previousSettledLiveCount: 0,
  reviewStartedAt: undefined,
  round: 2,
  settledDigest: undefined,
  ...over,
});

describe("recordRoundCap", () => {
  it("writes nothing and never samples the clock at round 3, then writes one row with the literal cap at round 4", () => {
    const atCap = fixedClock({ iso: "2026-10-13T03:00:00.000Z" });
    recordRoundCap({ askIdentity: ASK, home, now: atCap.now, round: 3 });

    expect(atCap.calls.count).toBe(0);
    expect(homeContents()).toEqual([]);

    const pastCap = fixedClock({ iso: "2026-10-13T03:00:00.000Z" });
    recordRoundCap({ askIdentity: ASK, home, now: pastCap.now, round: 4 });

    expect(pastCap.calls.count).toBe(1);
    expect(homeContents()).toEqual(["ledgers", "ledgers/loop-breakage.jsonl"]);
    expect(ledgerRows()).toEqual([
      {
        at: "2026-10-13T03:00:00.000Z",
        cause:
          "this ask has already opened 3 review round(s) without an answer clearing review, so another was " +
          "opened past the cap of 3",
        didInstead:
          "opened the round anyway with its packet narrowed — unrequested scope cannot raise the outcome past " +
          "the cap, and the answer still cannot post without a clean verdict",
        error: "review round 4 exceeds the cap of 3",
        thread: "C1/1789788122.066099",
        what: "turn review opened round 4 for this ask",
      },
    ]);
  });
});

describe("recordCarryStarvation", () => {
  it("writes nothing when the last round settled no live claim, or when a re-read is carried — sampling the clock once either way", () => {
    const settledNothing = fixedClock({ iso: "2026-10-13T04:00:00.000Z" });
    const carriesARead = fixedClock({ iso: "2026-10-13T04:00:00.000Z" });

    recordCarryStarvation({
      askIdentity: ASK,
      home,
      inherited: inheritedWith({ previousSettledLiveCount: 0 }),
      now: settledNothing.now,
    });
    recordCarryStarvation({
      askIdentity: ASK,
      home,
      inherited: inheritedWith({
        carriedReads: [
          { evidence: "read it", readAtIso: "2026-10-13T03:59:00.000Z", readCommand: "slopweaver x", text: "a claim" },
        ],
        previousSettledLiveCount: 2,
      }),
      now: carriesARead.now,
    });

    expect(settledNothing.calls.count).toBe(1);
    expect(carriesARead.calls.count).toBe(1);
    expect(homeContents()).toEqual([]);
  });

  it("writes the starvation row when live claims were settled and none is carried as a re-read", () => {
    const clock = fixedClock({ iso: "2026-10-13T04:00:00.000Z" });

    recordCarryStarvation({
      askIdentity: ASK,
      home,
      inherited: inheritedWith({ previousSettledLiveCount: 2, round: 5 }),
      now: clock.now,
    });

    expect(ledgerRows()).toEqual([
      {
        at: "2026-10-13T04:00:00.000Z",
        cause:
          "the previous reviewer settled live claims without recording a `readCommand` and `readAtIso` for any " +
          "of them, so the next round has nothing it can re-run and inherits a blank page",
        didInstead:
          "opened the round with no read to re-run — the previous reviewer wrote `readCommand` and `readAtIso` " +
          "on none of them; the reviewer rediscovers every one of those claims from nothing",
        error: "the previous verdict settled 2 high-impact live claim(s) and round 5 carries none of them as a re-read",
        thread: "C1/1789788122.066099",
        what: "turn review opened round 5 for this ask",
      },
    ]);
  });
});

describe("recordReviewerDeath", () => {
  const record: ReviewRecord = {
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
    reviewerSession: "reviewer-1",
    round: 1,
    schemaVersion: 2,
    spawnedAt: "2026-10-13T05:00:00.000Z",
    threadTs: "1789788200.000200",
    verdictPath: "/reviews/verdict.json",
  };

  it("writes the death row once, however many times the same death is recorded", () => {
    const clock = fixedClock({ iso: "2026-10-13T05:10:00.000Z" });
    const truth = { kind: "phantom", reason: "workspace closed", why: "workspace-gone" } as const;

    recordReviewerDeath({ home, now: clock.now, record, truth });
    recordReviewerDeath({ home, now: clock.now, record, truth });

    expect(clock.calls.count).toBe(2);
    expect(existsSync(join(home, "ledgers", "loop-breakage.jsonl"))).toBe(true);
    expect(ledgerRows()).toEqual([
      {
        at: "2026-10-13T05:10:00.000Z",
        cause: "workspace-gone: the reviewer's cmux workspace no longer exists, so its session went with it",
        didInstead:
          "reported the death to the poll's caller and left /reviews/verdict.json untouched; the answer still has " +
          "no verdict, so re-run turn review to open a fresh reviewer",
        error: "workspace closed",
        thread: "C9/1789788200.000200",
        what:
          "the reviewer for this ask died before writing a verdict — workspace workspace:7 (workspace-id-1), " +
          "session (the record carries no session name), host claude-code, spawned 2026-10-13T05:00:00.000Z, " +
          "bound to sha256:abc, cwd (the record carries no cwd), cause workspace-gone",
      },
    ]);
  });
});

describe("archiveLateReviewerVerdict", () => {
  const ARCHIVE_NAME = "verdict-superseded-reviewer-workspace-971-2026-10-23T03-19-59-999Z.json";

  /** The standing round, its review directory under the temp home, with its `record.json` written. */
  const standing = (): ReviewRecord => {
    const record = roundRecord();
    writeFileSync(join(dirname(record.verdictPath), "record.json"), JSON.stringify(record), "utf8");
    return record;
  };

  /** The standing round's record, its directory made but nothing written into it. */
  const roundRecord = (): ReviewRecord => {
    const dir = join(home, "live", "slack", "reviews", "C0SYN000002-1792725097.691199");
    mkdirSync(dir, { recursive: true });
    return {
      answerDigest: "sha256:" + "b".repeat(64),
      answerPath: join(home, "answer.json"),
      authorSession: "author workspace:960",
      carriedUnresolved: [],
      channel: "C0SYN000002",
      messageTs: "1792725097.691199",
      packetPath: join(dir, "packet.md"),
      reviewer: {
        host: "claude-code",
        surfaceId: "surface-id-980",
        surfaceRef: "surface:980",
        workspaceId: "workspace-id-980",
        workspaceRef: "workspace:980",
      },
      reviewerSession: "reviewer workspace:980",
      round: 2,
      schemaVersion: 2,
      spawnedAt: "2026-10-23T03:20:00.000Z",
      threadTs: "1792725097.691199",
      verdictPath: join(dir, "verdict.json"),
    };
  };

  /** A parseable verdict, written by whichever reviewer session is named. */
  const verdictBy = ({ record, reviewerSession }: { record: ReviewRecord; reviewerSession: string }): string =>
    JSON.stringify({
      answerDigest: "sha256:" + "a".repeat(64),
      authorSession: record.authorSession,
      claims: [{ evidence: "the thread", impact: "high", support: "supported", text: "a claim" }],
      outcome: "clean",
      reviewerSession,
      schemaVersion: 1,
    });

  it("archives a previous round's late verdict under its WRITER's name and records exactly one row", () => {
    const record = standing();
    const late = verdictBy({ record, reviewerSession: "reviewer workspace:971" });
    writeFileSync(record.verdictPath, late, "utf8");
    const clock = fixedClock({ iso: "2026-10-23T03:28:06.000Z" });

    const archived = archiveLateReviewerVerdict({ home, now: clock.now, record });

    const archivePath = join(dirname(record.verdictPath), ARCHIVE_NAME);
    expect(archived).toBe(archivePath);
    expect(existsSync(record.verdictPath)).toBe(false);
    expect(readFileSync(archivePath, "utf8")).toBe(late);
    expect(ledgerRows()).toEqual([
      {
        at: "2026-10-23T03:28:06.000Z",
        cause:
          "the previous round's reviewer wrote its verdict after this round opened, so the archive at round open " +
          "had nothing to move and the fixed verdict path held a verdict that speaks for no reviewer now recorded",
        didInstead: `turn review --poll archived it to ${archivePath} and kept polling reviewer workspace:980, whose own verdict lands at the same path`,
        error: `${record.verdictPath} holds a PREVIOUS round's verdict, written by reviewer workspace:971`,
        thread: "C0SYN000002/1792725097.691199",
        what:
          "turn review --poll found a late verdict from reviewer workspace:971 over the round spawned " +
          `2026-10-23T03:20:00.000Z (reviewer workspace:980) — archived as ${ARCHIVE_NAME}`,
      },
    ]);
  });

  it("a second poll finds nothing to move and writes neither an archive nor a row", () => {
    const record = standing();
    writeFileSync(record.verdictPath, verdictBy({ record, reviewerSession: "reviewer workspace:971" }), "utf8");
    archiveLateReviewerVerdict({ home, now: fixedClock({ iso: "2026-10-23T03:28:06.000Z" }).now, record });

    expect(archiveLateReviewerVerdict({ home, now: fixedClock({ iso: "2026-10-23T03:29:00.000Z" }).now, record })).toBe(
      undefined,
    );
    expect(readdirSync(dirname(record.verdictPath)).toSorted()).toEqual([ARCHIVE_NAME, "record.json"].toSorted());
    expect(ledgerRows()).toHaveLength(1);
  });

  it("NEVER MOVES the standing reviewer's own verdict, and records nothing", () => {
    const record = standing();
    const own = verdictBy({ record, reviewerSession: "reviewer workspace:980" });
    writeFileSync(record.verdictPath, own, "utf8");
    const clock = fixedClock({ iso: "2026-10-23T03:28:06.000Z" });

    expect(archiveLateReviewerVerdict({ home, now: clock.now, record })).toBe(undefined);
    expect(readFileSync(record.verdictPath, "utf8")).toBe(own);
    expect(clock.calls.count).toBe(0);
    expect(existsSync(join(home, "ledgers", "loop-breakage.jsonl"))).toBe(false);
  });

  it("moves NOTHING when record.json now names a newer round — the file may be that round's own verdict", () => {
    const stale = standing();
    const newer: ReviewRecord = {
      ...stale,
      reviewerSession: "reviewer workspace:990",
      round: 3,
      spawnedAt: "2026-10-23T03:30:00.000Z",
    };
    writeFileSync(join(dirname(stale.verdictPath), "record.json"), JSON.stringify(newer), "utf8");
    const own = verdictBy({ record: newer, reviewerSession: "reviewer workspace:990" });
    writeFileSync(stale.verdictPath, own, "utf8");

    expect(
      archiveLateReviewerVerdict({ home, now: fixedClock({ iso: "2026-10-23T03:31:00.000Z" }).now, record: stale }),
    ).toBe(undefined);
    expect(readFileSync(stale.verdictPath, "utf8")).toBe(own);
    expect(existsSync(join(home, "ledgers", "loop-breakage.jsonl"))).toBe(false);
  });

  it("moves NOTHING when no record.json stands at all", () => {
    const record = roundRecord();
    const late = verdictBy({ record, reviewerSession: "reviewer workspace:971" });
    writeFileSync(record.verdictPath, late, "utf8");

    expect(archiveLateReviewerVerdict({ home, now: fixedClock({ iso: "2026-10-23T03:28:06.000Z" }).now, record })).toBe(
      undefined,
    );
    expect(readFileSync(record.verdictPath, "utf8")).toBe(late);
  });

  it("PUTS BACK the verdict and throws naming the kept archive link when its row cannot be written", () => {
    const record = standing();
    const late = verdictBy({ record, reviewerSession: "reviewer workspace:971" });
    writeFileSync(record.verdictPath, late, "utf8");
    // A regular file where the ledgers directory belongs: the append fails, exactly as an unwritable home would.
    writeFileSync(join(home, "ledgers"), "not a directory", "utf8");

    expect(() =>
      archiveLateReviewerVerdict({ home, now: fixedClock({ iso: "2026-10-23T03:28:06.000Z" }).now, record }),
    ).toThrow(`the unrecorded archive link ${join(dirname(record.verdictPath), ARCHIVE_NAME)} is left standing`);
    expect(readFileSync(record.verdictPath, "utf8")).toBe(late);
    expect(readdirSync(dirname(record.verdictPath)).toSorted()).toEqual(["record.json", ARCHIVE_NAME, "verdict.json"]);
  });

  it("moves nothing when the record names a verdict path other than the canonical verdict.json", () => {
    const canonical = roundRecord();
    const record = { ...canonical, verdictPath: join(dirname(canonical.verdictPath), ARCHIVE_NAME) };
    writeFileSync(join(dirname(record.verdictPath), "record.json"), JSON.stringify(record), "utf8");
    const late = verdictBy({ record, reviewerSession: "reviewer workspace:971" });
    writeFileSync(record.verdictPath, late, "utf8");

    expect(archiveLateReviewerVerdict({ home, now: fixedClock({ iso: "2026-10-23T03:28:06.000Z" }).now, record })).toBe(
      undefined,
    );
    expect(readFileSync(record.verdictPath, "utf8")).toBe(late);
    expect(readdirSync(dirname(record.verdictPath)).toSorted()).toEqual([ARCHIVE_NAME, "record.json"].toSorted());
  });

  it("moves nothing when the clock throws, because the instant is sampled before the claim", () => {
    const record = standing();
    const late = verdictBy({ record, reviewerSession: "reviewer workspace:971" });
    writeFileSync(record.verdictPath, late, "utf8");
    const brokenClock = (): Date => {
      throw new Error("clock failed");
    };

    expect(() => archiveLateReviewerVerdict({ home, now: brokenClock, record })).toThrow("clock failed");
    expect(readFileSync(record.verdictPath, "utf8")).toBe(late);
    expect(readdirSync(dirname(record.verdictPath)).toSorted()).toEqual(["record.json", "verdict.json"]);
  });

  it("leaves an archive already under that name byte for byte, and numbers its way past it", () => {
    const record = standing();
    const taken = join(dirname(record.verdictPath), ARCHIVE_NAME);
    writeFileSync(taken, "an earlier archive", "utf8");
    writeFileSync(record.verdictPath, verdictBy({ record, reviewerSession: "reviewer workspace:971" }), "utf8");

    const archived = archiveLateReviewerVerdict({
      home,
      now: fixedClock({ iso: "2026-10-23T03:28:06.000Z" }).now,
      record,
    });

    expect(archived).toBe(
      join(dirname(record.verdictPath), "verdict-superseded-reviewer-workspace-971-2-2026-10-23T03-19-59-999Z.json"),
    );
    expect(readFileSync(taken, "utf8")).toBe("an earlier archive");
  });
});
