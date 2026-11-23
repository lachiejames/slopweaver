/**
 * `reviewStore` — one directory per ask, three files, read back through the same strict parsers the verb
 * uses. Filesystem only for a genuine round-trip in a temp home.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSupersededVerdictName } from "../../../../live/turn/checkpoint.js";
import type { ReviewRecord } from "../../../../live/turn/review.js";
import {
  archiveVerdictFile,
  claimVerdictFile,
  linkVerdictArchive,
  markReviewerReleased,
  readReviewRecord,
  readVerdictFile,
  restoreClaimedVerdict,
  reviewPaths,
  supersededVerdictName,
  writeReview,
} from "../../../../live/turn/reviewStore.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

function freshHome(): string {
  const home = join(tmpdir(), `slopweaver-review-store-${String(process.pid)}-${String(Math.random()).slice(2)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function recordIn({ home }: { home: string }): ReviewRecord {
  const paths = reviewPaths({ askIdentity: ASK, home });
  return {
    ...ASK,
    answerDigest: "sha256:" + "a".repeat(64),
    answerPath: join(home, "answer.json"),
    authorSession: "author workspace workspace:1 (id-workspace:1)",
    carriedUnresolved: [],
    packetPath: paths.packet,
    reviewer: {
      host: "claude-code",
      surfaceId: "id-surface:9",
      surfaceRef: "surface:9",
      workspaceId: "id-workspace:9",
      workspaceRef: "workspace:9",
    },
    reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
    round: 1,
    schemaVersion: 2,
    spawnedAt: "2026-08-25T00:00:00.000Z",
    verdictPath: paths.verdict,
  };
}

describe("reviewPaths", () => {
  it("keys the directory exactly like the dispatch record, under live/slack/reviews", () => {
    const paths = reviewPaths({ askIdentity: ASK, home: "/h" });
    expect(paths).toStrictEqual({
      dir: "/h/live/slack/reviews/C1-1785000000.000100",
      packet: "/h/live/slack/reviews/C1-1785000000.000100/packet.md",
      record: "/h/live/slack/reviews/C1-1785000000.000100/record.json",
      verdict: "/h/live/slack/reviews/C1-1785000000.000100/verdict.json",
    });
  });
});

function verdictFor({ record, over = {} }: { record: ReviewRecord; over?: Record<string, unknown> }): string {
  return JSON.stringify({
    answerDigest: record.answerDigest,
    authorSession: record.authorSession,
    claims: [{ evidence: "the thread", impact: "high", support: "supported", text: "a claim" }],
    outcome: "clean",
    reviewerSession: record.reviewerSession,
    schemaVersion: 1,
    ...over,
  });
}

describe("supersededVerdictName", () => {
  it("names the DISPLACED round, reducing both halves to what a filename carries unquoted", () => {
    expect(supersededVerdictName({ reviewer: "9C117B00-388D-4A50", spawnedAt: "2026-08-26T08:37:50.100Z" })).toBe(
      "verdict-superseded-9C117B00-388D-4A50-2026-08-26T08-37-50-100Z.json",
    );
  });

  it("falls back to a readable token rather than an empty name segment", () => {
    expect(supersededVerdictName({ reviewer: "…", spawnedAt: "-" })).toBe("verdict-superseded-unknown-unknown.json");
  });
});

describe("writeReview / readReviewRecord", () => {
  it("round-trips the record and lands the packet at the path the record names", () => {
    const home = freshHome();
    const record = recordIn({ home });
    expect(writeReview({ home, packet: "# packet", record })).toBeUndefined();
    expect(readReviewRecord({ askIdentity: ASK, home })).toStrictEqual(record);
  });

  it("reads undefined when no review was ever opened", () => {
    expect(readReviewRecord({ askIdentity: ASK, home: freshHome() })).toBeUndefined();
  });

  it("ARCHIVES the previous round's verdict, naming the round it displaced, and leaves the path empty", () => {
    const home = freshHome();
    const first = recordIn({ home });
    writeReview({ home, packet: "# packet", record: first });
    writeFileSync(first.verdictPath, verdictFor({ record: first }), "utf8");

    const second: ReviewRecord = {
      ...first,
      answerDigest: "sha256:" + "b".repeat(64),
      reviewer: { ...first.reviewer, workspaceId: "id-workspace:12", workspaceRef: "workspace:12" },
      reviewerSession: "reviewer workspace workspace:12 (id-workspace:12)",
      spawnedAt: "2026-08-25T01:00:00.000Z",
    };
    const archived = writeReview({ home, packet: "# packet 2", record: second });

    expect(archived).toBe(
      join(
        reviewPaths({ askIdentity: ASK, home }).dir,
        "verdict-superseded-id-workspace-9-2026-08-25T00-00-00-000Z.json",
      ),
    );
    expect(existsSync(second.verdictPath)).toBe(false);
    expect(readVerdictFile({ record: second })).toStrictEqual({ kind: "absent" });
    expect(JSON.parse(readFileSync(archived!, "utf8")).reviewerSession).toBe(first.reviewerSession);
  });
});

describe("archiveVerdictFile", () => {
  it("names the archive after the WRITER it is given and empties the fixed path", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.verdict, "late", "utf8");

    const archived = archiveVerdictFile({ paths, reviewer: "workspace:971", spawnedAt: "2026-10-23T03:20:00.000Z" });

    expect(archived).toBe(join(paths.dir, "verdict-superseded-workspace-971-2026-10-23T03-20-00-000Z.json"));
    expect(readFileSync(archived!, "utf8")).toBe("late");
    expect(existsSync(paths.verdict)).toBe(false);
  });

  it("NEVER OVERWRITES an archive already under that name — the second takes a numbered reviewer token", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });
    const taken = join(paths.dir, "verdict-superseded-workspace-971-2026-10-23T03-20-00-000Z.json");
    writeFileSync(taken, "first", "utf8");
    writeFileSync(paths.verdict, "second", "utf8");

    const archived = archiveVerdictFile({ paths, reviewer: "workspace:971", spawnedAt: "2026-10-23T03:20:00.000Z" });

    expect(archived).toBe(join(paths.dir, "verdict-superseded-workspace-971-2-2026-10-23T03-20-00-000Z.json"));
    expect(readFileSync(taken, "utf8")).toBe("first");
    expect(readFileSync(archived!, "utf8")).toBe("second");
    expect(parseSupersededVerdictName({ name: basename(archived!) })).toStrictEqual({
      file: "verdict-superseded-workspace-971-2-2026-10-23T03-20-00-000Z.json",
      reviewer: "workspace-971-2",
      spawnedAt: "2026-10-23T03:20:00.000Z",
      standing: false,
    });
  });

  it("answers undefined and moves nothing when the fixed path is empty", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });
    expect(archiveVerdictFile({ paths, reviewer: "workspace:971", spawnedAt: "2026-10-23T03:20:00.000Z" })).toBe(
      undefined,
    );
    expect(readdirSync(paths.dir)).toStrictEqual([]);
  });
});

describe("linkVerdictArchive", () => {
  it("links the archive name and LEAVES the source, so a caller can record before it unlinks", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.verdict, "late", "utf8");

    const archived = linkVerdictArchive({ paths, reviewer: "workspace:971", spawnedAt: "2026-10-23T03:20:00.000Z" });

    expect(archived).toBe(join(paths.dir, "verdict-superseded-workspace-971-2026-10-23T03-20-00-000Z.json"));
    expect(readFileSync(archived!, "utf8")).toBe("late");
    expect(readFileSync(paths.verdict, "utf8")).toBe("late");
  });
});

describe("claimVerdictFile / restoreClaimedVerdict", () => {
  it("takes the file off the fixed path into a claim name checkpoint never reads, and puts it back", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.verdict, "own", "utf8");

    const claimed = claimVerdictFile({ paths })!;

    expect(existsSync(paths.verdict)).toBe(false);
    expect(readFileSync(claimed, "utf8")).toBe("own");
    expect(basename(claimed).startsWith("verdict-claim-")).toBe(true);
    expect(parseSupersededVerdictName({ name: basename(claimed) })).toBeUndefined();

    expect(restoreClaimedVerdict({ claimed, paths })).toBe("restored");
    expect(readFileSync(paths.verdict, "utf8")).toBe("own");
    expect(readdirSync(paths.dir)).toStrictEqual(["verdict.json"]);
  });

  it("NEVER restores over a verdict that landed after the claim — both files survive", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.verdict, "claimed", "utf8");
    const claimed = claimVerdictFile({ paths })!;
    writeFileSync(paths.verdict, "newer", "utf8");

    expect(restoreClaimedVerdict({ claimed, paths })).toBe("path-taken");
    expect(readFileSync(paths.verdict, "utf8")).toBe("newer");
    expect(readFileSync(claimed, "utf8")).toBe("claimed");
  });

  it("claims nothing when the fixed path is empty", () => {
    const home = freshHome();
    const paths = reviewPaths({ askIdentity: ASK, home });
    mkdirSync(paths.dir, { recursive: true });

    expect(claimVerdictFile({ paths })).toBeUndefined();
    expect(readdirSync(paths.dir)).toStrictEqual([]);
  });
});

describe("markReviewerReleased", () => {
  it("stamps the record so a later terminal reap knows the workspace is already gone", () => {
    const home = freshHome();
    const record = recordIn({ home });
    writeReview({ home, packet: "# packet", record });

    markReviewerReleased({ atIso: "2026-08-27T05:00:00.000Z", home, record });

    expect(readReviewRecord({ askIdentity: ASK, home })).toStrictEqual({
      ...record,
      releasedAt: "2026-08-27T05:00:00.000Z",
    });
  });

  it("creates nothing when no record is there — there is nothing left to say it about", () => {
    const home = freshHome();
    markReviewerReleased({ atIso: "2026-08-27T05:00:00.000Z", home, record: recordIn({ home }) });

    expect(readReviewRecord({ askIdentity: ASK, home })).toBeUndefined();
  });
});

describe("readVerdictFile", () => {
  it("is absent before the reviewer has written anything", () => {
    const home = freshHome();
    const record = recordIn({ home });
    writeReview({ home, packet: "# packet", record });
    expect(readVerdictFile({ record })).toStrictEqual({ kind: "absent" });
  });

  it("is present once a well-formed verdict lands at the recorded path", () => {
    const home = freshHome();
    const record = recordIn({ home });
    writeReview({ home, packet: "# packet", record });
    const verdict = {
      answerDigest: record.answerDigest,
      authorSession: record.authorSession,
      claims: [{ evidence: "the thread", impact: "high", support: "supported", text: "a claim" }],
      outcome: "clean",
      reviewerSession: record.reviewerSession,
      schemaVersion: 1,
    };
    writeFileSync(record.verdictPath, JSON.stringify(verdict), "utf8");
    // `imageObservations` is absent on the file and present as `[]` on the parsed verdict: absence means
    // the empty list, so a verdict written before the field existed reads as covering no pictures — which
    // is exactly right for this text-only answer. See `ReviewVerdict.imageObservations`.
    expect(readVerdictFile({ record })).toStrictEqual({
      kind: "present",
      verdict: { ...verdict, imageObservations: [] },
    });
  });

  it("is SUPERSEDED, never present, when a previous round's reviewer wrote the file at this path", () => {
    const home = freshHome();
    const record = recordIn({ home });
    writeReview({ home, packet: "# packet", record });
    const wroteIt = "reviewer workspace workspace:3 (id-workspace:3)";
    writeFileSync(record.verdictPath, verdictFor({ over: { reviewerSession: wroteIt }, record }), "utf8");
    const read = readVerdictFile({ record });
    expect(read.kind).toBe("superseded");
    expect((read as { kind: "superseded"; wroteIt: string }).wroteIt).toBe(wroteIt);
  });

  it("is invalid, with the parser's reason, when the file is there but is not a verdict", () => {
    const home = freshHome();
    const record = recordIn({ home });
    writeReview({ home, packet: "# packet", record });
    writeFileSync(record.verdictPath, JSON.stringify({ outcome: "fine" }), "utf8");
    const read = readVerdictFile({ record });
    expect(read.kind).toBe("invalid");
    expect((read as { kind: "invalid"; reason: string }).reason).toContain("answerDigest");
  });
});
