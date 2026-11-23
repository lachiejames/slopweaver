import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  flushNotionBatch,
  notionDurabilityNotes,
  slackChannelCommitter,
} from "../../../../../cli/commands/refresh/tokenedJobs.js";
import { bronzeFile } from "../../../../../corpus/corpusPaths.js";
import { readSlackChannelWatermarks } from "../../../../../corpus/slack/channelWatermark.js";
import type { CorpusRecord, ExportWindow } from "../../../../../corpus/types.js";
import { epochSecondsToIso } from "../../../../../lib/date.js";
import { unwrap } from "../../../../../lib/result.js";

const window: ExportWindow = { since: "2026-01-01", until: "2026-02-01" };
const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "notion",
  kind: "page",
  refs: [],
  source: "notion",
  sourceId: "page:1",
  text: "hi",
  tsIso: "2026-01-15T00:00:00Z",
  url: "u",
  ...over,
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-notion-batch-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("flushNotionBatch (the incremental-write durability checkpoint)", () => {
  it("writes a non-empty batch to bronze immediately and counts it in spend", () => {
    const spend = { failed: 0, written: 0 };
    flushNotionBatch({ home, spend, window })({ records: [rec()] });
    expect(spend).toEqual({ failed: 0, written: 1 });
    const file = bronzeFile({ home, source: "notion", window });
    expect(readFileSync(file, "utf8")).toContain('"sourceId":"page:1"');
  });

  it("does nothing for an empty batch — no file, no spend", () => {
    const spend = { failed: 0, written: 0 };
    flushNotionBatch({ home, spend, window })({ records: [] });
    expect(spend).toEqual({ failed: 0, written: 0 });
  });

  it("across two batches, dedupes an identical record rather than double-counting it", () => {
    const spend = { failed: 0, written: 0 };
    const flush = flushNotionBatch({ home, spend, window });
    flush({ records: [rec({ sourceId: "page:1" })] });
    flush({ records: [rec({ sourceId: "page:1" }), rec({ sourceId: "page:2" })] });
    expect(spend).toEqual({ failed: 0, written: 2 });
  });
});

describe("notionDurabilityNotes", () => {
  it("reports nothing when nothing was flushed", () => {
    expect(notionDurabilityNotes({ spend: { failed: 0, written: 0 } })).toEqual([]);
  });

  it("reports what was flushed and what failed, as separate lines", () => {
    expect(notionDurabilityNotes({ spend: { failed: 2, written: 5 } })).toEqual([
      "durability: flushed 5 record(s) to bronze incrementally during the crawl",
      "durability: 2 incremental batch write(s) FAILED — that content only lands via the closing write, if the run completes",
    ]);
  });
});

describe("slackChannelCommitter — a PREFIX is rows, a CONVERSATION is rows plus the marker", () => {
  const slackWindow: ExportWindow = { since: "1970-01-01", until: "2026-08-24" };
  const maps = { channelNames: {}, userNames: {} };
  const channel = { id: "C_BIG", is_member: true, name: "big" };
  const chunk = ({ from }: { from: number }) => ({
    channelId: "C_BIG",
    channelName: "big",
    messages: [
      {
        channelId: "C_BIG",
        files: [],
        permalink: `https://acme.slack.com/archives/C_BIG/p${from}`,
        reactions: [],
        ts: `${from}.000100`,
        tsIso: epochSecondsToIso({ seconds: from })!,
      },
    ],
    replies: [],
  });

  /** The per-channel backfill store as it stands on disk, or `undefined` when nothing ever wrote it. */
  const storedEntry = () => readSlackChannelWatermarks({ home }).get("C_BIG");

  /** The clock these commits are judged against — after every timestamp here, so it caps nothing. */
  const nowIso = (): string => "2027-02-01T00:00:00.000Z";

  it("banks a prefix to bronze while claiming nothing about the conversation's coverage", () => {
    const seams = slackChannelCommitter({ bounded: false, home, nowIso, ownerBot: undefined, window: slackWindow })!;
    expect(unwrap(seams.commitPartial({ channel, items: chunk({ from: 1_800_000_000 }), maps })).written).toBe(1);
    expect(readFileSync(bronzeFile({ home, source: "slack", window: slackWindow }), "utf8")).toContain("C_BIG");
    // No entry at all, so `planChannelOldest` still reads the conversation from the epoch next run.
    expect(storedEntry()).toBe(undefined);
  });

  it("marks the conversation only when it COMPLETES, at the newest timestamp the whole read saw", () => {
    const seams = slackChannelCommitter({ bounded: false, home, nowIso, ownerBot: undefined, window: slackWindow })!;
    seams.commitPartial({ channel, items: chunk({ from: 1_800_000_000 }), maps });
    // The tail carries the OLDEST rows — the marker must still record the newest the prefix saw.
    const tail = chunk({ from: 1_700_000_000 });
    expect(
      unwrap(
        seams.commit({
          channel,
          items: tail,
          maps,
          maxTsIso: "2027-01-15T08:00:00.000Z",
          oldest: "0",
        }),
      ).written,
    ).toBe(1);
    expect(storedEntry()).toEqual({ cursor: "2027-01-15T08:00:00.000Z", fullHistory: true });
  });

  it("gives a bounded run no seams at all, so a capped read can never write a marker", () => {
    expect(slackChannelCommitter({ bounded: true, home, nowIso, ownerBot: undefined, window: slackWindow })).toBe(
      undefined,
    );
  });
});
