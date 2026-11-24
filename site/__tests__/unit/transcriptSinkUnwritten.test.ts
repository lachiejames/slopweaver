/*
 * Whether the current call's words are on disk yet (`TranscriptSink.unwritten`), which a rollover waits on before it
 * releases the call: a successor minted while the voice's answer still sat in this queue was told an exchange ending on
 * the owner's question. Driven through the shared plain fake post; an earlier call's residue never counts.
 */

import { describe, expect, it } from "vitest";

import { CALL, harness, OLD_CALL, OPEN, STEP, settle, shape } from "./transcriptSinkHarness";

describe("TranscriptSink.unwritten", () => {
  it("is false before any call, true while the open line's post awaits its answer, and false once it is taken", async () => {
    const { posts, sink } = harness();
    const before = sink.unwritten();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    const inFlight = sink.unwritten();
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    expect([before, inFlight, sink.unwritten()]).toEqual([false, true, false]);
  });

  it("stays true while a final waits behind the post in flight, and through its own post, until that is taken", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "all twelve are up", who: "voice" } });
    const queuedBehind = sink.unwritten();
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    const ownPost = sink.unwritten();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect(shape({ wire: posts[1].wire })).toEqual(["all twelve are up:true"]);
    expect([queuedBehind, ownPost, sink.unwritten()]).toEqual([true, true, false]);
  });

  it("counts none of an earlier call's lines still in flight, and the next call's from its own open line", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    sink.end({ leaving: false, why: "rolled over in a pause" });
    sink.begin({ call: CALL });
    const residueOnly = sink.unwritten();
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.open({ call: CALL, line: OPEN });
    expect([residueOnly, sink.unwritten()]).toEqual([false, true]);
  });

  it("stays true for a batch put back on no answer, and clears once the retry is taken", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 0, why: undefined });
    await settle();
    const putBack = sink.unwritten();
    sink.snapshot();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect([putBack, sink.unwritten()]).toEqual([true, false]);
  });

  // A step is diagnostics on a call already closed, so neither its queued line nor its own post holds a rollover.
  it("counts no reconnect step of the current call, in its own post or put back on the queue", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "dropped" });
    const closeInFlight = sink.unwritten();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.reconnect({ call: CALL, line: STEP });
    const stepInFlight = sink.unwritten();
    posts[2].answer({ status: 503, why: undefined });
    await settle();
    expect(shape({ wire: posts[2].wire })).toEqual(["reconnect"]);
    expect([closeInFlight, stepInFlight, sink.unwritten()]).toEqual([true, false, false]);
  });

  // A refused batch is said through `onRefused` and gone: nothing left could reach the disk, so nothing waits on it.
  it("is false once a refused batch is dropped and said", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 422, why: "refused" });
    await settle();
    expect([sink.unwritten(), refused.map((loss) => loss.lines)]).toEqual([false, [1]]);
  });

  // Later words of an open stretch wait in memory for the next snapshot, so an empty queue is not words on disk.
  it("is true while an open stretch holds words no partial carried yet, and clears once the snapshot's post is taken", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.speaking({ call: CALL, open: undefined, speech: { id: "s-1", text: "is the", who: "owner" } });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    const firstPartialWritten = sink.unwritten();
    sink.speaking({ call: CALL, open: undefined, speech: { id: "s-1", text: "is the pool healthy", who: "owner" } });
    const heldInMemory = sink.unwritten();
    sink.snapshot();
    posts[2].answer({ status: 200, why: undefined });
    await settle();
    expect(shape({ wire: posts[2].wire })).toEqual(["is the pool healthy:false"]);
    expect([firstPartialWritten, heldInMemory, sink.unwritten()]).toEqual([false, true, false]);
  });
});
