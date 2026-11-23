/**
 * The push→pull bridge. The case that matters is the blocking one: a consumer waiting on an empty queue
 * must resume when a frame arrives later, and must terminate when the socket ends instead of hanging.
 */
import { describe, expect, it } from "vitest";

import { createFrameQueue } from "../../../../live/listen/frameQueue.js";

/** Drain a queue into an array — the consumer side, exactly as the listener loop uses it. */
async function drain({ frames }: { frames: AsyncIterable<string> }): Promise<string[]> {
  const seen: string[] = [];
  for await (const text of frames) {
    seen.push(text);
  }
  return seen;
}

describe("createFrameQueue", () => {
  it("yields frames buffered before the consumer started, in order", async () => {
    const queue = createFrameQueue();
    queue.push({ text: "one" });
    queue.push({ text: "two" });
    queue.end({ why: "done" });

    expect(await drain({ frames: queue.frames() })).toEqual(["one", "two"]);
  });

  it("resumes a waiting consumer when a frame arrives later", async () => {
    const queue = createFrameQueue();
    const drained = drain({ frames: queue.frames() });
    queue.push({ text: "late" });
    queue.end({ why: "done" });

    expect(await drained).toEqual(["late"]);
  });

  it("terminates a waiting consumer when the queue ends with nothing buffered", async () => {
    const queue = createFrameQueue();
    const drained = drain({ frames: queue.frames() });
    queue.end({ why: "the socket closed (code 1006)" });

    expect(await drained).toEqual([]);
    expect(queue.endedBecause()).toBe("the socket closed (code 1006)");
  });

  it("keeps the FIRST end reason, since it is the one that caused the rest", () => {
    const queue = createFrameQueue();
    queue.end({ why: "the socket reported an error" });
    queue.end({ why: "the socket closed (code 1006)" });

    expect(queue.endedBecause()).toBe("the socket reported an error");
  });

  it("is live until it ends", () => {
    expect(createFrameQueue().endedBecause()).toBe(undefined);
  });

  it("ignores a frame pushed after the end, which could never be handled anyway", async () => {
    const queue = createFrameQueue();
    queue.push({ text: "before" });
    queue.end({ why: "done" });
    queue.push({ text: "after" });

    expect(await drain({ frames: queue.frames() })).toEqual(["before"]);
  });

  it("drains what is already buffered even though the queue has ended", async () => {
    const queue = createFrameQueue();
    queue.push({ text: "one" });
    queue.push({ text: "two" });
    queue.end({ why: "the socket closed (code 1000)" });

    expect(await drain({ frames: queue.frames() })).toEqual(["one", "two"]);
  });

  /**
   * The `--once` silent drop, made countable.
   *
   * MEASURED before it was fixed, and the measurement corrected the assumption in both directions. Frames
   * already buffered are NOT lost — the test above proves the queue empties its buffer before honouring the
   * end. What IS lost is a frame arriving after: `push` no-ops, and until this counter existed it did so in
   * total silence, so a tag abandoned at close produced no number and no log line.
   */
  it("counts a frame pushed after the end, so a lost tag produces a number", () => {
    const queue = createFrameQueue();
    queue.push({ text: "before" });
    queue.end({ why: "--once handled one mention" });
    queue.push({ text: "after-one" });
    queue.push({ text: "after-two" });

    expect(queue.discarded()).toBe(2);
  });

  it("counts nothing while the queue is live, so a non-zero count always means real loss", () => {
    const queue = createFrameQueue();
    queue.push({ text: "one" });
    queue.push({ text: "two" });

    expect(queue.discarded()).toBe(0);
  });

  it("does not count a buffered frame that the drain went on to deliver", async () => {
    const queue = createFrameQueue();
    queue.push({ text: "buffered" });
    queue.end({ why: "closed" });
    await drain({ frames: queue.frames() });

    expect(queue.discarded()).toBe(0);
  });

  it("cancel unblocks a consumer waiting on an empty queue", async () => {
    const queue = createFrameQueue();
    const drained = drain({ frames: queue.frames() });
    queue.cancel({ why: "deadline expired" });

    expect(await drained).toEqual([]);
    expect(queue.endedBecause()).toBe("deadline expired");
  });

  it("cancel discards already-buffered frames instead of draining them, and counts them", async () => {
    const queue = createFrameQueue();
    queue.push({ text: "one" });
    queue.push({ text: "two" });
    queue.cancel({ why: "deadline expired" });

    expect(await drain({ frames: queue.frames() })).toEqual([]);
    expect(queue.discarded()).toBe(2);
  });

  it("end still drains buffered frames, unaffected by cancel existing", async () => {
    const queue = createFrameQueue();
    queue.push({ text: "one" });
    queue.end({ why: "closed" });

    expect(await drain({ frames: queue.frames() })).toEqual(["one"]);
    expect(queue.discarded()).toBe(0);
  });

  it("keeps counting pushes after cancel, same as after end", () => {
    const queue = createFrameQueue();
    queue.cancel({ why: "deadline expired" });
    queue.push({ text: "after" });

    expect(queue.discarded()).toBe(1);
  });

  it("cancel keeps the FIRST end reason, whether end or cancel set it first", () => {
    const endedFirst = createFrameQueue();
    endedFirst.end({ why: "the socket closed" });
    endedFirst.cancel({ why: "deadline expired" });
    expect(endedFirst.endedBecause()).toBe("the socket closed");

    const cancelledFirst = createFrameQueue();
    cancelledFirst.cancel({ why: "deadline expired" });
    cancelledFirst.end({ why: "the socket closed" });
    expect(cancelledFirst.endedBecause()).toBe("deadline expired");
  });
});
