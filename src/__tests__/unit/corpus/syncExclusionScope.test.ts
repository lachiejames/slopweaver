/**
 * The SCOPE half of the denylist — `<id> @ <channel>` — and rule D, which rescues a denied alert humans
 * replied under.
 *
 * These are the two properties the scope half buys, and each of them is a case a bare author ban got
 * measurably wrong. The scope cases exist because the same Datadog app is nearly all of `#monitor-feed`
 * and a small minority of `#sync-alerts`; the rule-D cases exist because all but a couple of the
 * human rows in that channel are thread replies, so the blunt rule would have deleted hundreds of threads
 * of incident diagnosis.
 *
 * The `defer` verdict gets its own block because it is the one shape a reader will not predict: it is not a
 * third kind of denial, it is "denied, and a streaming caller has not read the evidence yet".
 */
import { describe, expect, it } from "vitest";

import {
  excludeFromSync,
  humanThreadKeyOf,
  humanThreadKeysIn,
  parseSyncExclusionLines,
  type SyncExclusion,
  slackThreadKey,
  syncExclusionVerdict,
  threadKeyFor,
} from "../../../corpus/syncExclusion.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap } from "../../../lib/result.js";

/** One Slack record, with only the fields a case cares about spelled out. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "slack/C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "C1:1.0",
    text: "hello",
    tsIso: "2026-09-01T00:00:00.000Z",
    url: "https://example.invalid/1",
    ...over,
  };
}

/** An alert from the denied app, optionally in a thread. */
function alert({ channel, threadTs }: { channel: string; threadTs?: string }): CorpusRecord {
  return record({
    attrs: { channel },
    raw: { app_id: "AAPP", bot_id: "BBOT", ...(threadTs === undefined ? {} : { thread_ts: threadTs }) },
  });
}

/** A message a person wrote, optionally as a reply in a thread. */
function human({ channel, threadTs }: { channel: string; threadTs?: string }): CorpusRecord {
  return record({
    attrs: { channel },
    author: "UHUMAN",
    raw: { user: "UHUMAN", ...(threadTs === undefined ? {} : { thread_ts: threadTs }) },
  });
}

/** The denylist naming one app in one channel, by name. */
function scopedTo({ channel }: { channel: string }): SyncExclusion {
  return unwrap(parseSyncExclusionLines({ lines: [`AAPP @ ${channel}`], path: "/fixture" }));
}

/** No human has been seen speaking anywhere. */
const NO_EVIDENCE = { keys: new Set<string>() };

describe("parseSyncExclusionLines", () => {
  it("reads a bare id as a global denial, which is what every existing install has written", () => {
    const parsed = unwrap(parseSyncExclusionLines({ lines: ["AAPP"], path: "/fixture" }));
    expect([...parsed.ids]).toStrictEqual(["aapp"]);
    expect(parsed.scoped).toStrictEqual([]);
  });

  it("reads a scoped entry, and a leading # makes the scope a channel NAME rather than an id", () => {
    const parsed = unwrap(parseSyncExclusionLines({ lines: ["AAPP @ #monitor-feed"], path: "/fixture" }));
    expect([...parsed.ids]).toStrictEqual([]);
    expect(parsed.scoped).toStrictEqual([{ id: "aapp", scope: { kind: "channel-name", value: "#monitor-feed" } }]);
  });

  it("reads a scope with no # as a channel ID, which survives a rename", () => {
    const parsed = unwrap(parseSyncExclusionLines({ lines: ["AAPP @ C0SYN000038"], path: "/fixture" }));
    expect(parsed.scoped[0]!.scope).toStrictEqual({ kind: "channel-id", value: "c0syn000038" });
  });

  it("does not treat a channel name's # as the start of a comment", () => {
    // The loader strips a line STARTING with #; a # mid-line is a channel. Getting this wrong silently
    // turns every scoped entry into a bare global ban, which is the exact rule this change replaced.
    const parsed = unwrap(parseSyncExclusionLines({ lines: ["AAPP @ #alerts"], path: "/fixture" }));
    expect(parsed.scoped[0]!.scope.value).toBe("#alerts");
  });

  it("refuses an entry with an empty side, naming the line", () => {
    const parsed = parseSyncExclusionLines({ lines: ["AAPP @ "], path: "/fixture" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("both sides must be non-empty");
  });

  it("refuses an entry carrying two separators, because a scope names ONE channel", () => {
    const parsed = parseSyncExclusionLines({ lines: ["AAPP @ #a @ #b"], path: "/fixture" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("more than one");
  });

  it("reports every malformed line rather than the first, because an operator fixes the file once", () => {
    const parsed = parseSyncExclusionLines({ lines: ["AAPP @ ", " @ #b"], path: "/fixture" });
    expect(parsed._unsafeUnwrapErr().length).toBe(2);
  });
});

describe("a scoped denial applies in its own channel and nowhere else", () => {
  it("denies the app in the channel the scope names", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      humanThreads: NO_EVIDENCE,
      record: alert({ channel: "#monitor-feed" }),
    });
    expect(verdict).toBe("deny");
  });

  it("ADMITS the same app in another channel — the thousands of rows a bare author ban took", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      humanThreads: NO_EVIDENCE,
      record: alert({ channel: "#sync-alerts" }),
    });
    expect(verdict).toBe("admit");
  });

  it("matches a channel name exactly, so #alerts never catches #alerts-platform", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#alerts" }),
      humanThreads: NO_EVIDENCE,
      record: alert({ channel: "#alerts-platform" }),
    });
    expect(verdict).toBe("admit");
  });

  it("matches a channel id off the record's container", () => {
    const exclusion = unwrap(parseSyncExclusionLines({ lines: ["AAPP @ C1"], path: "/fixture" }));
    const verdict = syncExclusionVerdict({ exclusion, humanThreads: NO_EVIDENCE, record: alert({ channel: "#x" }) });
    expect(verdict).toBe("deny");
  });

  it("never applies a scoped entry to a record from another source", () => {
    const exclusion = unwrap(parseSyncExclusionLines({ lines: ["AAPP @ C1"], path: "/fixture" }));
    const github = record({ author: "AAPP", container: "org/C1", source: "github" });
    expect(syncExclusionVerdict({ exclusion, humanThreads: NO_EVIDENCE, record: github })).toBe("admit");
  });

  it("lets a global entry and a scoped entry coexist in one file", () => {
    const exclusion = unwrap(parseSyncExclusionLines({ lines: ["UOTHER", "AAPP @ #monitor-feed"], path: "/f" }));
    expect([...exclusion.ids]).toStrictEqual(["uother"]);
    expect(exclusion.scoped.length).toBe(1);
  });
});

describe("rule D — a human reply in the thread rescues the alert that started it", () => {
  it("ADMITS a denied alert once a human has been seen in its thread", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      humanThreads: { keys: new Set([slackThreadKey({ channelId: "c1", threadTs: "1.0" })]) },
      record: alert({ channel: "#monitor-feed", threadTs: "1.0" }),
    });
    expect(verdict).toBe("admit");
  });

  it("DEFERS a denied alert in a thread no human has been seen in yet", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      humanThreads: NO_EVIDENCE,
      record: alert({ channel: "#monitor-feed", threadTs: "1.0" }),
    });
    expect(verdict).toBe("defer");
  });

  it("DENIES outright a denied alert that is in no thread at all — the million-row case", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      humanThreads: NO_EVIDENCE,
      record: alert({ channel: "#monitor-feed" }),
    });
    expect(verdict).toBe("deny");
  });

  it("does not let a human in ANOTHER channel rescue this one's alert", () => {
    const verdict = syncExclusionVerdict({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      humanThreads: { keys: new Set([slackThreadKey({ channelId: "c99", threadTs: "1.0" })]) },
      record: alert({ channel: "#monitor-feed", threadTs: "1.0" }),
    });
    expect(verdict).toBe("defer");
  });
});

describe("what counts as human evidence", () => {
  it("counts a person's reply", () => {
    expect(humanThreadKeyOf({ record: human({ channel: "#c", threadTs: "1.0" }) })).toBe(
      slackThreadKey({ channelId: "C1", threadTs: "1.0" }),
    );
  });

  it("does not count a bot's own reply, or an alert could rescue itself", () => {
    expect(humanThreadKeyOf({ record: alert({ channel: "#c", threadTs: "1.0" }) })).toBe(null);
  });

  it("treats a record with no raw payload as UNKNOWN rather than human", () => {
    expect(humanThreadKeyOf({ record: record({ author: "UHUMAN" }) })).toBe(null);
  });

  it("does not count a human who is not in a thread, because rule D is about threads", () => {
    expect(humanThreadKeyOf({ record: human({ channel: "#c" }) })).toBe(null);
  });

  it("reads the thread of any record, bot or not, so a held candidate keys the same way as its evidence", () => {
    expect(threadKeyFor({ record: alert({ channel: "#c", threadTs: "1.0" }) })).toBe(
      slackThreadKey({ channelId: "C1", threadTs: "1.0" }),
    );
  });

  it("gathers every human thread in a batch", () => {
    const context = humanThreadKeysIn({
      records: [human({ channel: "#c", threadTs: "1.0" }), human({ channel: "#c", threadTs: "2.0" })],
    });
    expect([...context.keys].toSorted()).toStrictEqual([
      slackThreadKey({ channelId: "C1", threadTs: "1.0" }),
      slackThreadKey({ channelId: "C1", threadTs: "2.0" }),
    ]);
  });
});

describe("excludeFromSync gathers its own evidence, so order cannot matter to it", () => {
  it("keeps the alert when the human reply comes AFTER it in the array", () => {
    const outcome = excludeFromSync({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      records: [
        alert({ channel: "#monitor-feed", threadTs: "1.0" }),
        human({ channel: "#monitor-feed", threadTs: "1.0" }),
      ],
    });
    expect(outcome.kept.length).toBe(2);
    expect(outcome.excluded).toBe(0);
    expect(outcome.rescued).toBe(1);
  });

  it("keeps the alert when the human reply comes BEFORE it", () => {
    const outcome = excludeFromSync({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      records: [
        human({ channel: "#monitor-feed", threadTs: "1.0" }),
        alert({ channel: "#monitor-feed", threadTs: "1.0" }),
      ],
    });
    expect(outcome.kept.length).toBe(2);
    expect(outcome.rescued).toBe(1);
  });

  it("drops a thread only bots ever spoke in", () => {
    const outcome = excludeFromSync({
      exclusion: scopedTo({ channel: "#monitor-feed" }),
      records: [
        alert({ channel: "#monitor-feed", threadTs: "1.0" }),
        alert({ channel: "#monitor-feed", threadTs: "1.0" }),
      ],
    });
    expect(outcome.kept).toStrictEqual([]);
    expect(outcome.excluded).toBe(2);
    expect(outcome.rescued).toBe(0);
  });
});
