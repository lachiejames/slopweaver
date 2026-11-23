/**
 * The incident read's deadline held on every Slack call: a call that answers in time passes through untouched, a
 * reply page that hangs is abandoned once the time left runs out, and a spent deadline asks Slack nothing more.
 */
import { describe, expect, it } from "vitest";

import { deadlineBound } from "../../../orgHealth/deadline.js";
import { READ_DEADLINE_MS } from "../../../orgHealth/policy.js";
import type { IncidentReadApi } from "../../../orgHealth/read.js";
import { NOW_MS } from "./orgIncidentFixture.js";

const PAGE = { hasMore: false, messages: ["m"] };

/** A Slack seam whose history answers at once and whose replies never answer, counting every reply asked. */
function hangingReplies(): { api: IncidentReadApi; asked: string[] } {
  const asked: string[] = [];
  return {
    api: {
      history: () => Promise.resolve(PAGE),
      replies: (args) => {
        asked.push(args.ts);
        return new Promise(() => undefined);
      },
    },
    asked,
  };
}

const REPLIES = { channel: "C0SYNINCIDENTS", oldest: "0", ts: "1790126245.320409" };

describe("deadlineBound", () => {
  it("passes a call that answers in time straight through, the deadline unspent", async () => {
    const bound = deadlineBound({
      api: hangingReplies().api,
      clock: () => NOW_MS,
      wait: () => new Promise(() => undefined),
    });
    const page = await bound.api.history({ channel: "C0SYNINCIDENTS", latest: "1", oldest: "0" });
    expect([page, bound.spentAtMs()]).toEqual([PAGE, undefined]);
  });

  it("abandons a reply page that hangs once the time it had left runs out", async () => {
    let now = NOW_MS;
    const waited: number[] = [];
    const bound = deadlineBound({
      api: hangingReplies().api,
      clock: () => now,
      wait: (ms) => {
        waited.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    now += 30_000;
    await expect(bound.api.replies(REPLIES)).rejects.toThrow("the read's deadline passed during this call");
    expect([waited, bound.spentAtMs()]).toEqual([[READ_DEADLINE_MS - 30_000], READ_DEADLINE_MS]);
  });

  it("refuses a page that answered after the deadline even when it settled before the timer ran", async () => {
    let now = NOW_MS;
    const late: IncidentReadApi = {
      history: () => {
        now += READ_DEADLINE_MS + 1;
        return Promise.resolve(PAGE);
      },
      replies: () => Promise.resolve(PAGE),
    };
    const bound = deadlineBound({ api: late, clock: () => now, wait: () => new Promise(() => undefined) });
    await expect(bound.api.history({ channel: "C0SYNINCIDENTS", latest: "1", oldest: "0" })).rejects.toThrow(
      "the read's deadline passed during this call",
    );
    expect(bound.spentAtMs()).toBe(READ_DEADLINE_MS + 1);
  });

  it("asks Slack nothing once the deadline is spent", async () => {
    let now = NOW_MS;
    const seam = hangingReplies();
    const bound = deadlineBound({ api: seam.api, clock: () => now, wait: () => new Promise(() => undefined) });
    now += READ_DEADLINE_MS;
    await expect(bound.api.replies(REPLIES)).rejects.toThrow("the read's deadline was spent before this call");
    expect([seam.asked, bound.spentAtMs()]).toEqual([[], READ_DEADLINE_MS]);
  });
});
