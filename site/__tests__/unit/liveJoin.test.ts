import { describe, expect, it } from "vitest";

import { joinReads } from "../../lib/liveJoin";

const riding = {
  answeredAtMs: 100_000,
  askedEveryMs: 20_000,
  everyMs: 20_000,
  hasLast: true,
  joinedLive: true,
  nowMs: 105_000,
  supersede: false,
};

describe("whether a mount reads a live channel again", () => {
  it("rides a polled channel another component keeps current while its answer is younger than the poll", () => {
    expect(joinReads(riding)).toBe(false);
  });

  it("reads once the answer is as old as the poll promises", () => {
    expect(joinReads({ ...riding, nowMs: 120_000 })).toBe(true);
  });

  it("reads on a first mount, when nothing else keeps the channel current", () => {
    expect(joinReads({ ...riding, joinedLive: false })).toBe(true);
  });

  it("always reads for a press, which must never be answered from before its write", () => {
    expect(joinReads({ ...riding, supersede: true })).toBe(true);
  });

  it("reads when there is nothing to hand over, or no landing time to judge it by", () => {
    expect(joinReads({ ...riding, hasLast: false })).toBe(true);
    expect(joinReads({ ...riding, answeredAtMs: undefined })).toBe(true);
  });

  it("reads a channel every subscriber reads once, since no poll keeps it current", () => {
    expect(joinReads({ ...riding, askedEveryMs: undefined, everyMs: undefined, nowMs: 100_001 })).toBe(true);
  });

  it("reads when the clock says the answer landed after now", () => {
    expect(joinReads({ ...riding, nowMs: 90_000 })).toBe(true);
  });

  it("judges the answer's age by the tighter of the poll already running and the mount's own", () => {
    expect(joinReads({ ...riding, askedEveryMs: 4000 })).toBe(true);
    expect(joinReads({ ...riding, askedEveryMs: 60_000 })).toBe(false);
  });

  it("reads for a read-once mount joining a channel another component polls, whatever the answer's age", () => {
    expect(joinReads({ ...riding, askedEveryMs: undefined })).toBe(true);
  });
});
