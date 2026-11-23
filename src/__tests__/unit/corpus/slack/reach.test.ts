import { describe, expect, it } from "vitest";
import type { SlackChannelRef } from "../../../../corpus/slack/fetch.js";
import {
  classifyChannelReach,
  coverageGaps,
  planChannelOldest,
  planChannelRead,
  reachKind,
  SLACK_EPOCH_OLDEST,
  tallyChannelReach,
} from "../../../../corpus/slack/reach.js";

/** The window floor, midnight UTC on its `since` day, as Slack epoch seconds — the pooled window floor used throughout. */
const WINDOW_OLDEST = "1698796800";

/** The clock every plan below is judged against — after every cursor in this file, so it caps nothing. */
const NOW = "2023-12-15T00:00:00.000Z";

describe("planChannelOldest", () => {
  it("reads a never-backfilled channel from the epoch, not from the pooled window", () => {
    expect(planChannelOldest({ backfillNew: true, nowIso: NOW, stored: undefined, windowOldest: WINDOW_OLDEST })).toBe(
      SLACK_EPOCH_OLDEST,
    );
  });

  it("honours an explicit window over the epoch backfill when the caller pinned one", () => {
    expect(planChannelOldest({ backfillNew: false, nowIso: NOW, stored: undefined, windowOldest: WINDOW_OLDEST })).toBe(
      WINDOW_OLDEST,
    );
  });

  it("reads a backfilled channel from its OWN cursor when that is earlier than the pooled window", () => {
    // The channel was last seen a month before the pooled floor; the pooled floor is a month later because other channels were
    // busier. Deferring to the pooled floor would skip the month this channel actually holds.
    expect(
      planChannelOldest({
        backfillNew: true,
        nowIso: NOW,
        stored: { cursor: "2023-10-01T00:00:00.000Z" },
        windowOldest: WINDOW_OLDEST,
      }),
    ).toBe("1696118400");
  });

  it("reads from its own cursor when that is LATER than the pooled window too", () => {
    expect(
      planChannelOldest({
        backfillNew: true,
        nowIso: NOW,
        stored: { cursor: "2023-12-01T00:00:00.000Z" },
        windowOldest: WINDOW_OLDEST,
      }),
    ).toBe("1701388800");
  });

  it("falls back to the window when a stored cursor cannot be parsed", () => {
    expect(
      planChannelOldest({
        backfillNew: true,
        nowIso: NOW,
        stored: { cursor: "not-a-date" },
        windowOldest: WINDOW_OLDEST,
      }),
    ).toBe(WINDOW_OLDEST);
  });

  // The measured defect: most of a real home's hundreds of conversations held a bare-day cursor one day ahead,
  // banked from the window's `until` (today+1) while the clock read today. Honouring it made every refresh
  // log `ingest from 1789689600` and dropped everything posted for the rest of the day.
  it("refuses a stored cursor AHEAD of the clock and reads from the clock instead", () => {
    expect(
      planChannelOldest({
        backfillNew: true,
        nowIso: "2026-09-17T12:20:00.000Z",
        stored: { cursor: "2026-09-18", fullHistory: true },
        windowOldest: WINDOW_OLDEST,
      }),
      // 2026-09-17T12:20:00Z, not 1789689600 (2026-09-18T00:00:00Z).
    ).toBe("1789647600");
  });

  it("refuses a day-ahead cursor under an EXPLICIT window too, where the floor is the request's own", () => {
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: "2026-09-17T12:20:00.000Z",
        stored: { cursor: "2026-09-18", fullHistory: true },
        // Midnight UTC two days before the clock — the floor a `--since` with `--lookback-days 2` asks for.
        windowOldest: "1789516800",
      }),
    ).toBe("1789516800");
  });

  it("lets an explicit --since floor beat a stored cursor that is merely NEWER, not future", () => {
    // The same shape with an honest cursor: `--since` is a deliberate re-read of a named span, so a stored
    // cursor inside that span may not silently narrow it. The measured re-walk wrote 0 rows because it did.
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: NOW,
        stored: { cursor: "2023-11-15T00:00:00.000Z", fullHistory: true },
        windowOldest: WINDOW_OLDEST,
      }),
    ).toBe(WINDOW_OLDEST);
  });

  it("STILL resumes a fully-backfilled channel from its own cursor under `--all`, whose floor is the epoch", () => {
    // The one narrowing that survives, and the reason `resumeExplicitWindow` exists: a killed epoch-wide
    // backfill picks up where it stopped instead of re-reading 36 hours of history it already banked.
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: NOW,
        stored: { cursor: "2023-11-15T00:00:00.000Z", fullHistory: true },
        windowOldest: SLACK_EPOCH_OLDEST,
      }),
    ).toBe("1700006400");
  });

  it("re-reads under `--all` when the channel carries no completion marker", () => {
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: NOW,
        stored: { cursor: "2023-11-15T00:00:00.000Z", fullHistory: false },
        windowOldest: SLACK_EPOCH_OLDEST,
      }),
    ).toBe(SLACK_EPOCH_OLDEST);
  });

  it("caps a WINDOW floor in the future too, where no stored cursor is involved at all", () => {
    // Reachable without a poisoned per-channel entry: the POOLED watermark banks the window's `until` for a
    // source that saw no usable timestamp, and `buildRefreshWindows` reads that cursor back as
    // `window.since`. This is the branch a per-`return` cap would have missed.
    expect(
      planChannelOldest({
        backfillNew: true,
        nowIso: "2026-09-17T12:20:00.000Z",
        stored: { cursor: "not-a-date" },
        windowOldest: "1789689600",
      }),
    ).toBe("1789647600");
  });

  it("clamps nothing when the clock itself is unreadable — a broken clock is no evidence about a cursor", () => {
    expect(
      planChannelOldest({
        backfillNew: true,
        nowIso: "not-a-date",
        stored: { cursor: "2026-09-18", fullHistory: true },
        windowOldest: WINDOW_OLDEST,
      }),
    ).toBe("1789689600");
  });
});

describe("reachKind", () => {
  it("classifies each conversation shape", () => {
    expect(reachKind({ channel: { id: "C1" } })).toBe("public");
    expect(reachKind({ channel: { id: "C2", isPrivate: true } })).toBe("private");
    expect(reachKind({ channel: { id: "D1", isIm: true } })).toBe("dm");
    expect(reachKind({ channel: { id: "G1", isMpim: true } })).toBe("group-dm");
  });

  it("counts a private group DM as a group DM, not as a private channel", () => {
    expect(reachKind({ channel: { id: "G1", isMpim: true, isPrivate: true } })).toBe("group-dm");
  });
});

const discovered: readonly SlackChannelRef[] = [
  { id: "C_PUB", isMember: true, name: "alpha" },
  { id: "C_NONMEMBER", name: "beta" },
  { id: "C_ARCHIVED", isArchived: true, name: "gamma" },
  { id: "C_PRIV", isMember: true, isPrivate: true, name: "delta" },
  { id: "D_DM", isIm: true },
];

describe("classifyChannelReach", () => {
  it("marks a channel backfilled by the PRESENCE of a cursor entry, whatever its value", () => {
    const rows = classifyChannelReach({
      cursors: new Map([["C_PUB", { cursor: "2023-11-30" }]]),
      discovered,
    });
    expect(rows.map((row) => row.backfilled)).toEqual([true, false, false, false, false]);
  });

  it("carries the name, kind, membership and archived flag for a citation to use", () => {
    const rows = classifyChannelReach({ cursors: new Map(), discovered });
    expect(rows[1]).toEqual({
      archived: false,
      backfilled: false,
      id: "C_NONMEMBER",
      kind: "public",
      member: false,
      name: "beta",
    });
    expect(rows[2]).toEqual({
      archived: true,
      backfilled: false,
      id: "C_ARCHIVED",
      kind: "public",
      member: false,
      name: "gamma",
    });
    expect(rows[4]).toEqual({ archived: false, backfilled: false, id: "D_DM", kind: "dm", member: false });
  });
});

describe("tallyChannelReach", () => {
  it("tallies backfilled/reachable per kind, listing a kind with nothing in it", () => {
    const rows = classifyChannelReach({ cursors: new Map([["C_PUB", { cursor: "x" }]]), discovered });
    expect(tallyChannelReach({ rows })).toEqual([
      { backfilled: 1, kind: "public", reachable: 3 },
      { backfilled: 0, kind: "private", reachable: 1 },
      { backfilled: 0, kind: "group-dm", reachable: 0 },
      { backfilled: 0, kind: "dm", reachable: 1 },
    ]);
  });
});

describe("coverageGaps", () => {
  it("returns every never-crawled conversation, in discovery order", () => {
    const rows = classifyChannelReach({ cursors: new Map([["C_PUB", { cursor: "x" }]]), discovered });
    expect(coverageGaps({ rows }).map((row) => row.id)).toEqual(["C_NONMEMBER", "C_ARCHIVED", "C_PRIV", "D_DM"]);
  });

  it("is empty once every reachable conversation holds an entry", () => {
    const rows = classifyChannelReach({
      cursors: new Map(discovered.map((channel) => [channel.id, { cursor: "2023-12-01" }])),
      discovered,
    });
    expect(coverageGaps({ rows })).toEqual([]);
  });
});

describe("planChannelRead", () => {
  /** A channel already read end to end, whose size is known — what the lane decision needs to choose. */
  const stored = { cursor: "2023-11-15T00:00:00.000Z", fullHistory: true, messages: 3 };

  it("takes the oracle lane under a PINNED window, because a walk writes nothing", () => {
    // The defect this closes: pinned to `poll-known-threads`, this channel cost one replies call per stored
    // thread — 56,932 of them workspace-wide, as measured.
    const plan = planChannelRead({
      backfillNew: false,
      knownThreads: 3,
      nowIso: NOW,
      stored,
      windowOldest: WINDOW_OLDEST,
    });
    expect(plan.lane).toBe("history-oracle");
    expect(plan.walkOldest).toBe(SLACK_EPOCH_OLDEST);
  });

  it("leaves the ingest floor exactly where planChannelOldest put it, pinned or not", () => {
    const floor = planChannelOldest({ backfillNew: false, nowIso: NOW, stored, windowOldest: WINDOW_OLDEST });
    const plan = planChannelRead({
      backfillNew: false,
      knownThreads: 3,
      nowIso: NOW,
      stored,
      windowOldest: WINDOW_OLDEST,
    });
    expect(plan.ingestOldest).toBe(floor);
    expect(plan.ingestOldest).toBe(WINDOW_OLDEST);
  });

  it("reports the window as pinned exactly when the caller withheld the epoch backfill", () => {
    expect(
      planChannelRead({ backfillNew: false, knownThreads: 3, nowIso: NOW, stored, windowOldest: WINDOW_OLDEST })
        .pinnedWindow,
    ).toBe(true);
    expect(
      planChannelRead({ backfillNew: true, knownThreads: 3, nowIso: NOW, stored, windowOldest: WINDOW_OLDEST })
        .pinnedWindow,
    ).toBe(false);
  });

  it("reports `--all` on a never-backfilled channel as UNPINNED — its floor is the epoch", () => {
    // `--all` withholds the epoch backfill (it pinned a window) while asking for the whole history, so its
    // own floor is the epoch and nothing can sit below it. Reported pinned, an unseen thread root would be
    // deferred and an explicit whole-history request would return no replies for any thread it had not
    // already seen.
    const plan = planChannelRead({
      backfillNew: false,
      knownThreads: 3,
      nowIso: NOW,
      stored: undefined,
      windowOldest: SLACK_EPOCH_OLDEST,
    });
    expect(plan.ingestOldest).toBe(SLACK_EPOCH_OLDEST);
    expect(plan.pinnedWindow).toBe(false);
  });

  it("keeps the poll lane on a firehose, where history pages outnumber known threads", () => {
    const firehose = { cursor: "2023-11-15T00:00:00.000Z", fullHistory: true, messages: 1_000_000 };
    const plan = planChannelRead({
      backfillNew: false,
      knownThreads: 3,
      nowIso: NOW,
      stored: firehose,
      windowOldest: WINDOW_OLDEST,
    });
    expect(plan.lane).toBe("poll-known-threads");
    expect(plan.walkOldest).toBe(plan.ingestOldest);
  });

  it("keeps the poll lane when no thread of this channel is known, in either window mode", () => {
    expect(
      planChannelRead({ backfillNew: false, knownThreads: 0, nowIso: NOW, stored, windowOldest: WINDOW_OLDEST }).lane,
    ).toBe("poll-known-threads");
    expect(
      planChannelRead({ backfillNew: true, knownThreads: 0, nowIso: NOW, stored, windowOldest: WINDOW_OLDEST }).lane,
    ).toBe("poll-known-threads");
  });

  it("takes the oracle lane for a channel whose size has never been recorded — the walk is what learns it", () => {
    const plan = planChannelRead({
      backfillNew: false,
      knownThreads: 1,
      nowIso: NOW,
      stored: undefined,
      windowOldest: WINDOW_OLDEST,
    });
    expect(plan.lane).toBe("history-oracle");
    expect(plan.ingestOldest).toBe(WINDOW_OLDEST);
  });
});
