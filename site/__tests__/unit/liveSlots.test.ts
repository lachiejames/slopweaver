import { describe, expect, it } from "vitest";

import {
  LIVE_READ_SLOTS,
  type LiveReadPriority,
  type LiveReadQueue,
  liveReadPriority,
  liveSlotNames,
  nextLiveReadWaiter,
  openLiveReadQueue,
  queueLiveRead,
  releaseLiveRead,
} from "../../lib/liveSlots";

/**
 * Queue one read whose grant records its label, so a test reads the grant order off one array.
 */
function ask({
  granted,
  label,
  priority,
  queue,
}: {
  granted: string[];
  label: string;
  priority: LiveReadPriority;
  queue: LiveReadQueue;
}): void {
  queueLiveRead({ grant: () => granted.push(label), line: () => priority, queue });
}

/**
 * Release one slot `times` times over.
 */
function releaseTimes({ queue, times }: { queue: LiveReadQueue; times: number }): void {
  for (let index = 0; index < times; index += 1) {
    releaseLiveRead({ queue });
  }
}

describe("the live reads' connection slots", () => {
  it("names one lock per slot, three of the origin's six connections", () => {
    expect(LIVE_READ_SLOTS).toBe(3);
    expect(liveSlotNames()).toEqual(["sw-live-0", "sw-live-1", "sw-live-2"]);
  });

  it("grants at once while a slot is free, and queues each read past the limit in its own line", () => {
    const queue = openLiveReadQueue({ limit: 2 });
    const granted: string[] = [];
    ask({ granted, label: "a", priority: "poll", queue });
    ask({ granted, label: "b", priority: "foreground", queue });
    ask({ granted, label: "c", priority: "poll", queue });
    ask({ granted, label: "d", priority: "foreground", queue });
    expect(granted).toEqual(["a", "b"]);
    expect(queue.inUse).toBe(2);
    expect(queue.waiting.map((waiter) => waiter.line())).toEqual(["poll", "foreground"]);
  });

  it("hands a returned slot to a first read queued after two polls, ahead of both", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "poll", queue });
    ask({ granted, label: "tick-1", priority: "poll", queue });
    ask({ granted, label: "tick-2", priority: "poll", queue });
    ask({ granted, label: "first-read", priority: "foreground", queue });
    releaseLiveRead({ queue });
    expect(granted).toEqual(["held", "first-read"]);
    expect(queue.inUse).toBe(1);
  });

  it("keeps foreground reads first come first served among themselves", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "foreground", queue });
    ask({ granted, label: "f1", priority: "foreground", queue });
    ask({ granted, label: "f2", priority: "foreground", queue });
    ask({ granted, label: "f3", priority: "foreground", queue });
    releaseTimes({ queue, times: 3 });
    expect(granted).toEqual(["held", "f1", "f2", "f3"]);
  });

  it("keeps polls first come first served among themselves", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "poll", queue });
    ask({ granted, label: "p1", priority: "poll", queue });
    ask({ granted, label: "p2", priority: "poll", queue });
    ask({ granted, label: "p3", priority: "poll", queue });
    releaseTimes({ queue, times: 3 });
    expect(granted).toEqual(["held", "p1", "p2", "p3"]);
  });

  it("lets exactly `limit` foreground grants pass a waiting poll, and gives that poll the next slot", () => {
    const queue = openLiveReadQueue({ limit: 3 });
    const granted: string[] = [];
    ask({ granted, label: "h1", priority: "poll", queue });
    ask({ granted, label: "h2", priority: "poll", queue });
    ask({ granted, label: "h3", priority: "poll", queue });
    ask({ granted, label: "tick", priority: "poll", queue });
    for (const label of ["f1", "f2", "f3", "f4", "f5"]) {
      ask({ granted, label, priority: "foreground", queue });
    }
    releaseTimes({ queue, times: 3 });
    expect(granted).toEqual(["h1", "h2", "h3", "f1", "f2", "f3"]);
    expect(queue.aheadGrantsWhilePollWaited).toBe(3);
    releaseLiveRead({ queue });
    expect(granted).toEqual(["h1", "h2", "h3", "f1", "f2", "f3", "tick"]);
    expect(queue.inUse).toBe(3);
  });

  it("gives the poll class one grant in every `limit + 1` while polls wait, oldest poll first", () => {
    const queue = openLiveReadQueue({ limit: 3 });
    const granted: string[] = [];
    for (const label of ["h1", "h2", "h3", "p1", "p2"]) {
      ask({ granted, label, priority: "poll", queue });
    }
    for (const label of ["f1", "f2", "f3", "f4", "f5", "f6", "f7"]) {
      ask({ granted, label, priority: "foreground", queue });
    }
    releaseTimes({ queue, times: 9 });
    expect(granted.slice(3)).toEqual(["f1", "f2", "f3", "p1", "f4", "f5", "f6", "p2", "f7"]);
  });

  it("starts the count again once the poll has its slot, so foreground reads go first in the next round", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "poll", queue });
    ask({ granted, label: "p1", priority: "poll", queue });
    ask({ granted, label: "p2", priority: "poll", queue });
    ask({ granted, label: "f1", priority: "foreground", queue });
    ask({ granted, label: "f2", priority: "foreground", queue });
    ask({ granted, label: "f3", priority: "foreground", queue });
    releaseTimes({ queue, times: 2 });
    expect(granted).toEqual(["held", "f1", "p1"]);
    expect(queue.aheadGrantsWhilePollWaited).toBe(0);
    releaseLiveRead({ queue });
    expect(granted).toEqual(["held", "f1", "p1", "f2"]);
    expect(queue.aheadGrantsWhilePollWaited).toBe(1);
  });

  it("hands a returned slot straight to a waiting poll when no foreground read waits", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "foreground", queue });
    ask({ granted, label: "tick", priority: "poll", queue });
    releaseLiveRead({ queue });
    expect(granted).toEqual(["held", "tick"]);
    expect(queue.inUse).toBe(1);
  });

  it("carries no fairness debt from foreground grants made while no poll waited", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "foreground", queue });
    for (const label of ["f1", "f2", "f3", "f4"]) {
      ask({ granted, label, priority: "foreground", queue });
    }
    releaseTimes({ queue, times: 3 });
    expect(queue.aheadGrantsWhilePollWaited).toBe(0);
    ask({ granted, label: "tick", priority: "poll", queue });
    ask({ granted, label: "f5", priority: "foreground", queue });
    releaseLiveRead({ queue });
    expect(granted).toEqual(["held", "f1", "f2", "f3", "f4"]);
    expect(queue.aheadGrantsWhilePollWaited).toBe(1);
    releaseLiveRead({ queue });
    expect(granted).toEqual(["held", "f1", "f2", "f3", "f4", "tick"]);
    expect(queue.aheadGrantsWhilePollWaited).toBe(0);
  });

  it("frees the slot when nobody waits, and grants the next read at once", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "a", priority: "poll", queue });
    releaseLiveRead({ queue });
    expect(queue.inUse).toBe(0);
    ask({ granted, label: "b", priority: "poll", queue });
    expect(granted).toEqual(["a", "b"]);
    expect(queue.inUse).toBe(1);
  });
});

describe("which line a live read waits in", () => {
  it("puts a channel with nothing current drawn yet in the foreground, whatever asked for the read", () => {
    expect(liveReadPriority({ cause: "mount", hasCurrentReading: false, primary: false })).toBe("foreground");
    expect(liveReadPriority({ cause: "retry", hasCurrentReading: false, primary: false })).toBe("foreground");
    expect(liveReadPriority({ cause: "poll", hasCurrentReading: false, primary: false })).toBe("foreground");
    expect(liveReadPriority({ cause: "catch-up", hasCurrentReading: false, primary: false })).toBe("foreground");
  });

  it("puts a press in the foreground even over a current reading", () => {
    expect(liveReadPriority({ cause: "press", hasCurrentReading: true, primary: false })).toBe("foreground");
  });

  it("puts every other read of a channel drawing a current reading behind, as background work", () => {
    expect(liveReadPriority({ cause: "poll", hasCurrentReading: true, primary: false })).toBe("poll");
    expect(liveReadPriority({ cause: "catch-up", hasCurrentReading: true, primary: false })).toBe("poll");
    expect(liveReadPriority({ cause: "retry", hasCurrentReading: true, primary: false })).toBe("poll");
    expect(liveReadPriority({ cause: "mount", hasCurrentReading: true, primary: false })).toBe("poll");
  });

  it("puts a primary channel's first read, and a press on it, in the primary line", () => {
    expect(liveReadPriority({ cause: "mount", hasCurrentReading: false, primary: true })).toBe("primary");
    expect(liveReadPriority({ cause: "retry", hasCurrentReading: false, primary: true })).toBe("primary");
    expect(liveReadPriority({ cause: "press", hasCurrentReading: true, primary: true })).toBe("primary");
  });

  // What bounds the primary line: once a primary channel draws a current reading, its ticks are background work.
  it("puts a primary channel's tick over a current reading behind, as background work", () => {
    expect(liveReadPriority({ cause: "poll", hasCurrentReading: true, primary: true })).toBe("poll");
    expect(liveReadPriority({ cause: "catch-up", hasCurrentReading: true, primary: true })).toBe("poll");
    expect(liveReadPriority({ cause: "mount", hasCurrentReading: true, primary: true })).toBe("poll");
  });
});

describe("the page's primary reads in the slot queue", () => {
  it("hands a returned slot to the oldest primary read, ahead of foreground reads queued before it", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    ask({ granted, label: "held", priority: "foreground", queue });
    ask({ granted, label: "badge-1", priority: "foreground", queue });
    ask({ granted, label: "badge-2", priority: "foreground", queue });
    ask({ granted, label: "register-1", priority: "primary", queue });
    ask({ granted, label: "register-2", priority: "primary", queue });
    releaseTimes({ queue, times: 4 });
    expect(granted).toEqual(["held", "register-1", "register-2", "badge-1", "badge-2"]);
    expect(queue.inUse).toBe(1);
  });

  it("grants every foreground read once the primary reads have gone, oldest first", () => {
    const queue = openLiveReadQueue({ limit: 2 });
    const granted: string[] = [];
    const asked: readonly (readonly [string, LiveReadPriority])[] = [
      ["h1", "foreground"],
      ["h2", "foreground"],
      ["f1", "foreground"],
      ["p1", "primary"],
      ["f2", "foreground"],
      ["p2", "primary"],
      ["f3", "foreground"],
    ];
    for (const [label, priority] of asked) {
      ask({ granted, label, priority, queue });
    }
    releaseTimes({ queue, times: 7 });
    expect(granted).toEqual(["h1", "h2", "p1", "p2", "f1", "f2", "f3"]);
    expect(queue.inUse).toBe(0);
    expect(queue.waiting).toEqual([]);
  });

  it("keeps a waiting poll's one grant in every `limit + 1`, counting primary grants as going ahead of it", () => {
    const queue = openLiveReadQueue({ limit: 3 });
    const granted: string[] = [];
    for (const label of ["h1", "h2", "h3", "tick-1", "tick-2"]) {
      ask({ granted, label, priority: "poll", queue });
    }
    for (const label of ["r1", "r2", "r3", "r4"]) {
      ask({ granted, label, priority: "primary", queue });
    }
    for (const label of ["f1", "f2"]) {
      ask({ granted, label, priority: "foreground", queue });
    }
    releaseTimes({ queue, times: 8 });
    expect(granted.slice(3)).toEqual(["r1", "r2", "r3", "tick-1", "r4", "f1", "f2", "tick-2"]);
  });

  it("moves a waiting read up when its line turns primary before a slot comes back", () => {
    const queue = openLiveReadQueue({ limit: 1 });
    const granted: string[] = [];
    let joinedAsPrimary = false;
    ask({ granted, label: "held", priority: "foreground", queue });
    ask({ granted, label: "badge", priority: "foreground", queue });
    queueLiveRead({
      grant: () => granted.push("shared"),
      line: () => (joinedAsPrimary ? "primary" : "foreground"),
      queue,
    });
    joinedAsPrimary = true;
    releaseLiveRead({ queue });
    expect(granted).toEqual(["held", "shared"]);
  });
});

describe("which waiting read a returned slot goes to", () => {
  it("names nobody when nobody waits", () => {
    expect(nextLiveReadWaiter({ aheadGrantsWhilePollWaited: 0, limit: 3, lines: [] })).toBe(undefined);
  });

  it("names the oldest primary, else the oldest foreground, else the oldest poll", () => {
    const lines: readonly LiveReadPriority[] = ["poll", "foreground", "primary", "primary"];
    expect(nextLiveReadWaiter({ aheadGrantsWhilePollWaited: 0, limit: 3, lines })).toBe(2);
    expect(nextLiveReadWaiter({ aheadGrantsWhilePollWaited: 0, limit: 3, lines: ["poll", "foreground"] })).toBe(1);
    expect(nextLiveReadWaiter({ aheadGrantsWhilePollWaited: 0, limit: 3, lines: ["poll", "poll"] })).toBe(0);
  });

  it("names the oldest poll once `limit` reads have gone ahead of it, a primary waiting or not", () => {
    expect(nextLiveReadWaiter({ aheadGrantsWhilePollWaited: 3, limit: 3, lines: ["primary", "poll"] })).toBe(1);
    expect(nextLiveReadWaiter({ aheadGrantsWhilePollWaited: 2, limit: 3, lines: ["primary", "poll"] })).toBe(0);
  });
});
