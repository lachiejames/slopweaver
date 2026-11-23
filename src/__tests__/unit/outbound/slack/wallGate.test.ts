import { describe, expect, it } from "vitest";

import {
  existingWallRun,
  type ThreadReplyIdentity,
  WALL_RUN_LIMIT,
  wallRefusal,
} from "../../../../outbound/slack/wallGate.js";

/** The exact escape sentence fragment the wall refusal ends on, spelled out rather than imported. */
const WALL_ESCAPE = 'run slopweaver hatch open wall --reason "<why this one is a legitimate exception>", then re-run';

const THREAD_TS = "1786600397.866979";

/** N consecutive OUR replies, oldest first, ts `t1`..`tN`, each carrying its own permalink. */
function ourReplies({ count }: { count: number }): ThreadReplyIdentity[] {
  return Array.from({ length: count }, (_, index) => ({
    ours: true,
    permalink: `https://x.slack.com/archives/C1/pt${String(index + 1)}`,
    ts: `t${String(index + 1)}`,
  }));
}

describe("existingWallRun", () => {
  it("counts every reply when they are all ours", () => {
    const replies: ThreadReplyIdentity[] = [
      { ours: false, permalink: "p0", ts: THREAD_TS },
      ...ourReplies({ count: 3 }),
    ];
    expect(existingWallRun({ actor: "bot", replies, threadTs: THREAD_TS })).toEqual({
      firstOursPermalink: "https://x.slack.com/archives/C1/pt1",
      length: 3,
    });
  });

  it("stops at the most recent message from someone else, and names its ts", () => {
    const replies: ThreadReplyIdentity[] = [
      { ours: false, permalink: "p0", ts: THREAD_TS },
      { ours: true, permalink: "pa", ts: "t1" },
      { ours: false, permalink: "pb", ts: "t2" },
      { ours: true, permalink: "pc", ts: "t3" },
      { ours: true, permalink: "pd", ts: "t4" },
    ];
    expect(existingWallRun({ actor: "bot", replies, threadTs: THREAD_TS })).toEqual({
      firstOursPermalink: "pc",
      lastOtherTs: "t2",
      length: 2,
    });
  });

  it("reports an empty run, with no lastOtherTs, when the most recent reply is not ours", () => {
    const replies: ThreadReplyIdentity[] = [
      { ours: true, permalink: "pa", ts: "t1" },
      { ours: false, permalink: "pb", ts: "t2" },
    ];
    expect(existingWallRun({ actor: "bot", replies, threadTs: THREAD_TS })).toEqual({ length: 0, lastOtherTs: "t2" });
  });

  it("reports an empty run, with no lastOtherTs, when there are no replies at all", () => {
    expect(existingWallRun({ actor: "bot", replies: [], threadTs: THREAD_TS })).toEqual({ length: 0 });
  });

  it("excludes the thread parent from the run even when it is ours", () => {
    const replies: ThreadReplyIdentity[] = [
      { ours: true, permalink: "p0", ts: THREAD_TS },
      { ours: true, permalink: "pa", ts: "t1" },
    ];
    expect(existingWallRun({ actor: "bot", replies, threadTs: THREAD_TS })).toEqual({
      firstOursPermalink: "pa",
      length: 1,
    });
  });

  it("a thread parent by someone else does not count as a message from someone else", () => {
    // Only the parent (someone else) precedes an unbroken run of ours — the run must read as if the
    // parent were not there at all: full length, and NO lastOtherTs, because nobody has actually REPLIED.
    const replies: ThreadReplyIdentity[] = [
      { ours: false, permalink: "p0", ts: THREAD_TS },
      ...ourReplies({ count: 5 }),
    ];
    expect(existingWallRun({ actor: "bot", replies, threadTs: THREAD_TS })).toEqual({
      firstOursPermalink: "https://x.slack.com/archives/C1/pt1",
      length: 5,
    });
  });
});

describe("existingWallRun — the as-me lane, where our identity is the owner's own hand", () => {
  // The acme-admin pull request shape: two replies the owner typed stand
  // at the tail of the thread, and the drip asked for is five messages.
  const tomThreadReplies: ThreadReplyIdentity[] = [
    { ours: false, permalink: "p0", ts: THREAD_TS },
    { ours: false, permalink: "ptom", ts: "t1" },
    { ours: true, permalink: "phis1", ts: "t2" },
    { ours: true, permalink: "phis2", ts: "t3" },
  ];

  it("does not count the owner's own earlier replies, so the standing run is empty", () => {
    expect(existingWallRun({ actor: "me", replies: tomThreadReplies, threadTs: THREAD_TS })).toEqual({
      length: 0,
      lastOtherTs: "t1",
    });
  });

  it("PASSES the five-message drip the owner asked for, over those same two earlier replies", () => {
    const existingRun = existingWallRun({ actor: "me", replies: tomThreadReplies, threadTs: THREAD_TS });
    expect(wallRefusal({ allowWall: false, existingRun, newMessageCount: 5 })).toEqual([]);
  });

  it("REFUSES a sixth message inside the drip itself", () => {
    const existingRun = existingWallRun({ actor: "me", replies: tomThreadReplies, threadTs: THREAD_TS });
    expect(wallRefusal({ allowWall: false, existingRun, newMessageCount: 6 })).toEqual([
      "this send would take our unbroken run in this thread to 6 consecutive messages — nobody else has " +
        "replied since their message at ts t1. this send alone posts 6 consecutive messages — rewrite it " +
        "as ONE message carrying the whole thought, not a smaller number of them, or for one deliberate " +
        `append ${WALL_ESCAPE}.`,
    ]);
  });

  it("the SAME replies under the bot lane still build a run of 2 — the actor is what changed", () => {
    expect(existingWallRun({ actor: "bot", replies: tomThreadReplies, threadTs: THREAD_TS })).toEqual({
      firstOursPermalink: "phis1",
      lastOtherTs: "t1",
      length: 2,
    });
  });

  it("still reports the last message from someone else, so the refusal prose stays true", () => {
    const replies: ThreadReplyIdentity[] = [
      { ours: false, permalink: "p0", ts: THREAD_TS },
      { ours: true, permalink: "pa", ts: "t1" },
      { ours: false, permalink: "pb", ts: "t2" },
      { ours: true, permalink: "pc", ts: "t3" },
    ];
    expect(existingWallRun({ actor: "me", replies, threadTs: THREAD_TS })).toEqual({
      length: 0,
      lastOtherTs: "t2",
    });
  });
});

describe("wallRefusal — the boundary is 5", () => {
  it("PASSES a send that would land the run at exactly 5", () => {
    expect(wallRefusal({ allowWall: false, existingRun: { length: 4 }, newMessageCount: 1 })).toEqual([]);
  });

  it("REFUSES a send that would land the run at 6", () => {
    const refusal = wallRefusal({
      allowWall: false,
      existingRun: { firstOursPermalink: "https://x.slack.com/archives/C1/pt1", lastOtherTs: "t0", length: 4 },
      newMessageCount: 2,
    });
    expect(refusal).toEqual([
      "this send would take our unbroken run in this thread to 6 consecutive messages — nobody else has " +
        "replied since their message at ts t0. edit the existing run into ONE message, starting at " +
        "https://x.slack.com/archives/C1/pt1, rather than appending to it, or for one deliberate append " +
        `${WALL_ESCAPE}.`,
    ]);
  });

  it("counts the run the send would CREATE, not only the run standing before it", () => {
    // Nothing exists yet, but this one send alone posts 6 consecutive messages (a drip).
    const refusal = wallRefusal({ allowWall: false, existingRun: { length: 0 }, newMessageCount: 6 });
    expect(refusal).toEqual([
      "this send would take our unbroken run in this thread to 6 consecutive messages — nobody else has " +
        "ever replied in this thread. this send alone posts 6 consecutive messages — rewrite it as ONE " +
        "message carrying the whole thought, not a smaller number of them, or for one deliberate append " +
        `${WALL_ESCAPE}.`,
    ]);
  });

  it("PASSES over the limit when the named override is active", () => {
    expect(wallRefusal({ allowWall: true, existingRun: { length: 10 }, newMessageCount: 5 })).toEqual([]);
  });

  it("WALL_RUN_LIMIT is 5 — the measured human ceiling in the incident thread", () => {
    expect(WALL_RUN_LIMIT).toBe(5);
  });
});
