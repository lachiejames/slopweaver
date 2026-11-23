/**
 * `newNonBotMessagesSince` — the "did anything new happen since this turn started" check. Pure: every case
 * is a plain call against literal raw Slack message fixtures.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { ThreadBoundaryErrors } from "../../../../live/turn/threadBoundaryErrors.js";
import {
  deltaBoundary,
  newestTsOf,
  newNonBotMessagesSince,
  threadDeltaDecision,
  threadDeltaEffect,
  threadDeltaFromMessages,
} from "../../../../live/turn/threadFreshness.js";

describe("threadDeltaFromMessages", () => {
  const ASK = "1785000000.000100";
  const NOW = "2026-07-25T17:00:00.000Z";
  // One human message a minute after the ask, the fast-thread shape: three people answering while a draft is
  // being composed.
  const FAST_THREAD = [
    { ts: ASK, user: "U_ASKER" },
    { ts: "1785000060.000100", user: "U_A" },
    { bot_id: "B1", ts: "1785000090.000100" },
    { ts: "1785000120.000100", user: "U_B" },
    { ts: "1785000180.000100", user: "U_C" },
  ];

  it("reconsiders every human message after the ask when no read is claimed, never the bot's own", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: FAST_THREAD,
        readThrough: undefined,
      }),
    );
    expect(decision).toMatchObject({
      kind: "reconsider",
      since: [
        { ts: "1785000060.000100", userId: "U_A" },
        { ts: "1785000120.000100", userId: "U_B" },
        { ts: "1785000180.000100", userId: "U_C" },
      ],
    });
  });

  it("reconsiders only what landed after a claimed read in the middle of a fast thread", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: FAST_THREAD,
        readThrough: "1785000120.000100",
      }),
    );
    expect(decision).toMatchObject({ kind: "reconsider", since: [{ ts: "1785000180.000100", userId: "U_C" }] });
  });

  it("notes rather than refuses when the read reaches the newest human message", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: FAST_THREAD,
        readThrough: "1785000180.000100",
      }),
    );
    expect(decision.kind).toBe("note");
  });

  it("refuses a claimed read past the newest human message, the bot's later card notwithstanding", () => {
    const error = unwrapErr(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: [...FAST_THREAD, { bot_id: "B1", ts: "1785000240.000100" }],
        readThrough: "1785000240.000100",
      }),
    );
    expect(error.code).toBe(
      ThreadBoundaryErrors.afterThread({ given: "1785000240.000100", newestTs: "1785000180.000100" }).code,
    );
  });

  it("drops a message the answer accounts for, at the send", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        accountedForTs: ["1785000060.000100", "1785000120.000100", "1785000180.000100"],
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: FAST_THREAD,
        readThrough: undefined,
      }),
    );
    expect(decision).toEqual({ kind: "post" });
  });
});

describe("newNonBotMessagesSince", () => {
  it("reports a human message that landed strictly after sinceTs", () => {
    const fresh = newNonBotMessagesSince({
      rawMessages: [{ ts: "1785000000.000200", user: "U_OTHER" }],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([{ ts: "1785000000.000200", userId: "U_OTHER" }]);
  });

  it("never reports the addressing message itself, or anything before it", () => {
    const fresh = newNonBotMessagesSince({
      rawMessages: [
        { ts: "1785000000.000100", user: "U_ASKER" },
        { ts: "1785000000.000050", user: "U_EARLIER" },
      ],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([]);
  });

  it("excludes a message carrying bot_id, even though it also carries a userId", () => {
    // The exact trap `../listen/recover.ts` names: an as-me post carries the app's own bot_id right next
    // to the owner's real userId.
    const fresh = newNonBotMessagesSince({
      rawMessages: [{ bot_id: "B1", ts: "1785000000.000200", user: "U_OWNER" }],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([]);
  });

  it("excludes a message carrying app_id but no bot_id", () => {
    const fresh = newNonBotMessagesSince({
      rawMessages: [{ app_id: "A1", ts: "1785000000.000200" }],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([]);
  });

  it("skips a message with no ts, rather than throwing", () => {
    const fresh = newNonBotMessagesSince({ rawMessages: [{ user: "U1" }], sinceTs: "1785000000.000100" });
    expect(fresh).toEqual([]);
  });

  it("skips a non-object entry", () => {
    const fresh = newNonBotMessagesSince({ rawMessages: ["not an object"], sinceTs: "1785000000.000100" });
    expect(fresh).toEqual([]);
  });

  it("carries no userId when the message has none", () => {
    const fresh = newNonBotMessagesSince({ rawMessages: [{ ts: "1785000000.000200" }], sinceTs: "1785000000.000100" });
    expect(fresh).toEqual([{ ts: "1785000000.000200" }]);
    expect(Object.keys(fresh[0]!)).toEqual(["ts"]);
  });

  it("returns every fresh message, sorted oldest first, regardless of input order", () => {
    const fresh = newNonBotMessagesSince({
      rawMessages: [
        { ts: "1785000000.000400", user: "U2" },
        { ts: "1785000000.000200", user: "U1" },
      ],
      sinceTs: "1785000000.000100",
    });
    expect(fresh.map((m) => m.ts)).toEqual(["1785000000.000200", "1785000000.000400"]);
  });

  it("excludes an accounted-for message even though it landed after sinceTs — the compound-instruction case", () => {
    const fresh = newNonBotMessagesSince({
      accountedForTs: ["1785000000.000300"],
      rawMessages: [{ ts: "1785000000.000300", user: "U_OWNER" }],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([]);
  });

  it("still reports a genuinely new message alongside an excluded, accounted-for one", () => {
    const fresh = newNonBotMessagesSince({
      accountedForTs: ["1785000000.000300"],
      rawMessages: [
        { ts: "1785000000.000300", user: "U_OWNER" },
        { ts: "1785000000.000500", user: "U_OTHER" },
      ],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([{ ts: "1785000000.000500", userId: "U_OTHER" }]);
  });

  it("defaults accountedForTs to none, so ordinary callers are unaffected", () => {
    const fresh = newNonBotMessagesSince({
      rawMessages: [{ ts: "1785000000.000300", user: "U_OWNER" }],
      sinceTs: "1785000000.000100",
    });
    expect(fresh).toEqual([{ ts: "1785000000.000300", userId: "U_OWNER" }]);
  });
});

const READ_THROUGH_ISO = "2026-09-15T03:09:00.000Z";
/** The addressing message's instant — the boundary the door measures from when no read-through is named. */
const ADDRESSED_ISO = "2026-09-15T02:41:00.000Z";

describe("threadDeltaDecision", () => {
  const nowIso = "2026-09-15T03:17:29.508Z";

  it("posts unchanged when no read-through was claimed and nothing landed", () => {
    const decision = threadDeltaDecision({
      cleared: false,
      nowIso,
      boundaryIso: ADDRESSED_ISO,
      readThroughIso: undefined,
      since: [],
    });
    expect(decision).toEqual({ kind: "post" });
  });

  it("refuses when no read-through was claimed, the thread moved and nobody cleared it", () => {
    const decision = threadDeltaDecision({
      boundaryIso: ADDRESSED_ISO,
      cleared: false,
      nowIso,
      readThroughIso: undefined,
      since: [{ ts: "1789441413.014549", userId: "U_ONE" }],
    });
    expect(decision).toEqual({
      kind: "reconsider",
      lines: [
        "the thread moved since this answer read it — 1 new message(s):",
        "  1789441413.014549 from U_ONE",
        "read every one of them, then take ONE of these two routes:",
        "  none of them touches a claim this answer makes — pass --delta-cleared and it posts with a freshness note, costing no review round",
        "  one of them contradicts or pre-empts a claim this answer makes — fix that claim and re-open review NARROWED to it",
      ],
      since: [{ ts: "1789441413.014549", userId: "U_ONE" }],
    });
  });

  it("TAKES THE ROUTE ITS OWN REFUSAL NAMES — --delta-cleared alone posts, noting the addressing boundary", () => {
    const decision = threadDeltaDecision({
      boundaryIso: ADDRESSED_ISO,
      cleared: true,
      nowIso,
      readThroughIso: undefined,
      since: [
        { ts: "1789441413.014549", userId: "U_ONE" },
        { ts: "1789441500.000100", userId: "U_TWO" },
      ],
    });
    expect(decision).toEqual({
      kind: "note",
      line: "i read this thread through 02:41Z. as of 03:17Z, 2 messages landed in here since, and none of them touched anything i claim above.",
      since: [
        { ts: "1789441413.014549", userId: "U_ONE" },
        { ts: "1789441500.000100", userId: "U_TWO" },
      ],
    });
  });

  it("a cleared EMPTY delta with no read-through still posts silently", () => {
    const decision = threadDeltaDecision({
      boundaryIso: ADDRESSED_ISO,
      cleared: true,
      nowIso,
      readThroughIso: undefined,
      since: [],
    });
    expect(decision).toEqual({ kind: "post" });
  });

  it("STILL SAYS WHAT IT READ THROUGH on an empty delta — the over-claim that skips most must not be silent", () => {
    const decision = threadDeltaDecision({
      cleared: false,
      nowIso,
      boundaryIso: READ_THROUGH_ISO,
      readThroughIso: READ_THROUGH_ISO,
      since: [],
    });
    expect(decision).toEqual({
      kind: "note",
      line: "i read this thread through 03:09Z, and as of 03:17Z nothing has landed in here since.",
      since: [],
    });
  });

  it("carries one composed freshness note when the author cleared a delta", () => {
    const decision = threadDeltaDecision({
      cleared: true,
      nowIso,
      boundaryIso: READ_THROUGH_ISO,
      readThroughIso: READ_THROUGH_ISO,
      since: [
        { ts: "1789441413.014549", userId: "U_ONE" },
        { ts: "1789441500.000100", userId: "U_TWO" },
      ],
    });
    expect(decision).toEqual({
      kind: "note",
      line: "i read this thread through 03:09Z. as of 03:17Z, 2 messages landed in here since, and none of them touched anything i claim above.",
      since: [
        { ts: "1789441413.014549", userId: "U_ONE" },
        { ts: "1789441500.000100", userId: "U_TWO" },
      ],
    });
  });

  it("says message rather than messages when exactly one landed", () => {
    const decision = threadDeltaDecision({
      cleared: true,
      nowIso,
      boundaryIso: READ_THROUGH_ISO,
      readThroughIso: READ_THROUGH_ISO,
      since: [{ ts: "1789441413.014549", userId: "U_ONE" }],
    });
    expect(decision).toEqual({
      kind: "note",
      line: "i read this thread through 03:09Z. as of 03:17Z, 1 message landed in here since, and none of them touched anything i claim above.",
      since: [{ ts: "1789441413.014549", userId: "U_ONE" }],
    });
  });

  it("names the INJECTED instant, never a wall clock", () => {
    const decision = threadDeltaDecision({
      boundaryIso: "2019-01-02T21:30:00.000Z",
      cleared: true,
      nowIso: "2019-01-02T22:04:00.000Z",
      readThroughIso: "2019-01-02T21:30:00.000Z",
      since: [{ ts: "1789441413.014549" }],
    });
    expect(decision).toEqual({
      kind: "note",
      line: "i read this thread through 21:30Z. as of 22:04Z, 1 message landed in here since, and none of them touched anything i claim above.",
      since: [{ ts: "1789441413.014549" }],
    });
  });

  it("refuses an uncleared delta, naming every message and BOTH routes out", () => {
    const decision = threadDeltaDecision({
      cleared: false,
      nowIso,
      boundaryIso: READ_THROUGH_ISO,
      readThroughIso: READ_THROUGH_ISO,
      since: [{ ts: "1789441413.014549", userId: "U_ONE" }],
    });
    expect(decision).toEqual({
      kind: "reconsider",
      lines: [
        "the thread moved since this answer read it — 1 new message(s):",
        "  1789441413.014549 from U_ONE",
        "read every one of them, then take ONE of these two routes:",
        "  none of them touches a claim this answer makes — pass --delta-cleared and it posts with a freshness note, costing no review round",
        "  one of them contradicts or pre-empts a claim this answer makes — fix that claim and re-open review NARROWED to it",
      ],
      since: [{ ts: "1789441413.014549", userId: "U_ONE" }],
    });
  });

  it("names a message with no resolvable author by its ts alone", () => {
    const decision = threadDeltaDecision({
      cleared: false,
      nowIso,
      boundaryIso: READ_THROUGH_ISO,
      readThroughIso: READ_THROUGH_ISO,
      since: [{ ts: "1789441413.014549" }],
    });
    expect(decision).toEqual({
      kind: "reconsider",
      lines: [
        "the thread moved since this answer read it \u2014 1 new message(s):",
        "  1789441413.014549",
        "read every one of them, then take ONE of these two routes:",
        "  none of them touches a claim this answer makes \u2014 pass --delta-cleared and it posts with a freshness note, costing no review round",
        "  one of them contradicts or pre-empts a claim this answer makes \u2014 fix that claim and re-open review NARROWED to it",
      ],
      since: [{ ts: "1789441413.014549" }],
    });
  });
});

describe("threadDeltaEffect", () => {
  const nowIso = "2026-09-15T03:17:29.508Z";
  const since = [{ ts: "1789441413.014549", userId: "U_ONE" }];

  it("an untouched thread with no claimed read neither notes nor refuses", () => {
    const effect = threadDeltaEffect({
      decision: threadDeltaDecision({
        cleared: false,
        nowIso,
        boundaryIso: ADDRESSED_ISO,
        readThroughIso: undefined,
        since: [],
      }),
    });
    expect(effect).toEqual({ note: undefined, refusal: undefined });
  });

  it("an untouched thread WITH a claimed read notes what was read and still never refuses", () => {
    const effect = threadDeltaEffect({
      decision: threadDeltaDecision({
        cleared: false,
        nowIso,
        boundaryIso: READ_THROUGH_ISO,
        readThroughIso: READ_THROUGH_ISO,
        since: [],
      }),
    });
    expect(effect).toEqual({
      note: "i read this thread through 03:09Z, and as of 03:17Z nothing has landed in here since.",
      refusal: undefined,
    });
  });

  it("A MOVED THREAD SOMEBODY CLEARED COSTS NO ROUND — it notes and never refuses", () => {
    const effect = threadDeltaEffect({
      decision: threadDeltaDecision({
        cleared: true,
        nowIso,
        boundaryIso: READ_THROUGH_ISO,
        readThroughIso: READ_THROUGH_ISO,
        since,
      }),
    });
    expect(effect.refusal).toBe(undefined);
    expect(effect.note).toBe(
      "i read this thread through 03:09Z. as of 03:17Z, 1 message landed in here since, and none of them touched anything i claim above.",
    );
  });

  it("a moved thread nobody has read refuses, and carries no note to post with", () => {
    const effect = threadDeltaEffect({
      decision: threadDeltaDecision({
        cleared: false,
        nowIso,
        boundaryIso: READ_THROUGH_ISO,
        readThroughIso: READ_THROUGH_ISO,
        since,
      }),
    });
    expect(effect.note).toBe(undefined);
    expect(effect.refusal).toEqual([
      "the thread moved since this answer read it — 1 new message(s):",
      "  1789441413.014549 from U_ONE",
      "read every one of them, then take ONE of these two routes:",
      "  none of them touches a claim this answer makes — pass --delta-cleared and it posts with a freshness note, costing no review round",
      "  one of them contradicts or pre-empts a claim this answer makes — fix that claim and re-open review NARROWED to it",
    ]);
  });
});

describe("newestTsOf", () => {
  it("returns the greatest ts whatever order the thread arrived in", () => {
    const newest = newestTsOf({
      rawMessages: [{ ts: "1789441413.014549" }, { ts: "1789441500.000100" }, { ts: "1789440329.196259" }],
    });
    expect(newest).toBe("1789441500.000100");
  });

  it("ignores a message with no readable ts rather than throwing", () => {
    expect(newestTsOf({ rawMessages: ["not an object", {}, { ts: 17 }, { ts: "1789441413.014549" }] })).toBe(
      "1789441413.014549",
    );
  });

  it("is undefined for a thread with nothing readable in it", () => {
    expect(newestTsOf({ rawMessages: [] })).toBe(undefined);
  });

  it("EXCLUDES the bot's own posts, so its card can never raise the ceiling above a human message", () => {
    const newest = newestTsOf({
      rawMessages: [
        { ts: "1789440329.196259", user: "U_HUMAN" },
        { bot_id: "B1", ts: "1789441413.014549" },
        { app_id: "A1", ts: "1789441500.000100" },
      ],
    });
    expect(newest).toBe("1789440329.196259");
  });

  it("is undefined for a thread the bot alone has posted in", () => {
    expect(newestTsOf({ rawMessages: [{ bot_id: "B1", ts: "1789441413.014549" }] })).toBe(undefined);
  });
});

describe("deltaBoundary", () => {
  const addressedTs = "1789433376.265259";
  const newestTs = "1789441413.014549";

  it("falls back to the addressing message when no read is claimed", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs, readThrough: undefined });
    expect(boundary.isOk()).toBe(true);
    expect(unwrap(boundary)).toBe(addressedTs);
  });

  it("takes a claimed read that sits between the ask and the thread's tail", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs, readThrough: "1789440329.196259" });
    expect(boundary.isOk()).toBe(true);
    expect(unwrap(boundary)).toBe("1789440329.196259");
  });

  it("takes a claimed read that is exactly the thread's newest message", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs, readThrough: newestTs });
    expect(boundary.isOk()).toBe(true);
    expect(unwrap(boundary)).toBe(newestTs);
  });

  it("REFUSES a claimed read later than the thread's newest message — a read that cannot have happened", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs, readThrough: "1789999999.000000" });
    expect(boundary.isErr()).toBe(true);
    expect(unwrapErr(boundary)).toEqual(ThreadBoundaryErrors.afterThread({ given: "1789999999.000000", newestTs }));
    expect(unwrapErr(boundary).message).toBe(
      "--read-through 1789999999.000000 is later than the thread's newest message (1789441413.014549) — that is a read this answer cannot have taken",
    );
  });

  it("REFUSES a claimed read before the ask, which would widen the window rather than narrow it", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs, readThrough: "1789000000.000000" });
    expect(boundary.isErr()).toBe(true);
    expect(unwrapErr(boundary)).toEqual(ThreadBoundaryErrors.beforeAsk({ addressedTs, given: "1789000000.000000" }));
    expect(unwrapErr(boundary).message).toBe(
      "--read-through 1789000000.000000 is at or before the message being answered (1789433376.265259) — it may only move the boundary forward, never widen it",
    );
  });

  it("REFUSES a claimed read equal to the ask itself, for the same reason", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs, readThrough: addressedTs });
    expect(boundary.isErr()).toBe(true);
    expect(unwrapErr(boundary).code).toBe("BOUNDARY_BEFORE_ASK");
    expect(unwrapErr(boundary).message).toBe(
      "--read-through 1789433376.265259 is at or before the message being answered (1789433376.265259) — it may only move the boundary forward, never widen it",
    );
  });

  it("REFUSES a claimed read above the newest HUMAN message even when the bot has posted later", () => {
    // The finding this pins: the bot's own progress card is usually the thread's tail, so a ceiling that
    // counted it would let one --read-through silence every human message in the thread at once.
    const rawMessages = [
      { ts: "1789440329.196259", user: "U_HUMAN" },
      { bot_id: "B1", ts: "1789441413.014549" },
    ];
    const boundary = deltaBoundary({
      addressedTs,
      newestTs: newestTsOf({ rawMessages }),
      readThrough: "1789441413.014549",
    });
    expect(boundary.isErr()).toBe(true);
    expect(unwrapErr(boundary).code).toBe("BOUNDARY_AFTER_THREAD");
  });

  it("takes a claimed read on an unreadable thread, because there is no ceiling to check it against", () => {
    const boundary = deltaBoundary({ addressedTs, newestTs: undefined, readThrough: "1789440329.196259" });
    expect(boundary.isOk()).toBe(true);
    expect(unwrap(boundary)).toBe("1789440329.196259");
  });
});
