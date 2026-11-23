/**
 * `markConversationBackfilled` — the per-conversation write the Slack crawl makes the instant a conversation's
 * bronze commit lands. What it claims is "this channel has been read to the end", so the case that matters is
 * that a read which started part-way through makes no such claim however much it wrote.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { markConversationBackfilled } from "../../../../../cli/commands/refresh/slackCursorPersist.js";
import { readSlackChannelWatermarks } from "../../../../../corpus/slack/channelWatermark.js";
import { unwrap } from "../../../../../lib/result.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slack-cursor-persist-"));
  homes.push(home);
  return home;
}

describe("markConversationBackfilled", () => {
  it("marks a conversation read from the epoch as fully backfilled, with its walked message count", () => {
    const home = freshHome();
    const written = markConversationBackfilled({
      channelId: "C1",
      home,
      maxTsIso: "2026-09-20T10:00:00.000Z",
      nowIso: "2026-09-28T00:00:00.000Z",
      oldest: "0",
      until: "2026-09-29T00:00:00.000Z",
      walkedMessages: 5,
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).path.startsWith(home)).toBe(true);
    expect(readSlackChannelWatermarks({ home }).get("C1")).toEqual({
      cursor: "2026-09-20T10:00:00.000Z",
      fullHistory: true,
      messages: 5,
    });
  });

  it("does NOT mark a conversation read from part-way through as fully backfilled", () => {
    const home = freshHome();
    const written = markConversationBackfilled({
      channelId: "C2",
      home,
      maxTsIso: "2026-09-20T10:00:00.000Z",
      nowIso: "2026-09-28T00:00:00.000Z",
      oldest: "1758000000.000000",
      until: "2026-09-29T00:00:00.000Z",
    });
    expect(written.isOk()).toBe(true);
    expect(readSlackChannelWatermarks({ home }).get("C2")).toEqual({
      cursor: "2026-09-20T10:00:00.000Z",
      fullHistory: false,
    });
  });
});
