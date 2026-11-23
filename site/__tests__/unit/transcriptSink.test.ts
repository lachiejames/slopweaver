/*
 * The call transcript's sink, driven through a plain fake post (a seam, not a mock): only the current, opened call
 * is written; one post is in flight at a time; a batch with no answer goes back to the front and is retried even
 * after the call ended; a refused one is said, never silently lost; and the end writes the speech still open before
 * the close, once. A tool's answer settled after it was asked is `transcriptSinkSettledTool.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { CallLine, TalkTranscriptWire } from "../../lib/talkTranscript";
import { refusedDetail } from "../../lib/transcriptLoss";
import { createTranscriptSink } from "../../lib/transcriptSink";
import type { TranscriptPostAnswer } from "../../lib/transcriptSinkContract";
import { AT, CALL, harness, OLD_CALL, OPEN, opens, type Refused, STEP, settle, shape } from "./transcriptSinkHarness";

describe("createTranscriptSink", () => {
  it("writes nothing before the call's open line, and nothing for an earlier call", () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-0", text: "early", who: "owner" } });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: OLD_CALL, open: undefined, speech: { id: "s-9", text: "late close", who: "owner" } });
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"]]);
  });

  // A call's offer lands only where its line can follow it: the answer is what `useRunningList` refuses on.
  it("answers whether a recorded line was queued: only on the current call, once it opened and before it ended", () => {
    const { posts, sink } = harness();
    const offered: CallLine = {
      atIso: AT,
      kind: "offered",
      offer: { id: "offer-1", made: "1", text: "on it" },
    };
    sink.begin({ call: CALL });
    const beforeOpen = sink.record({ call: CALL, line: offered });
    sink.open({ call: CALL, line: OPEN });
    const open = sink.record({ call: CALL, line: offered });
    const otherCall = sink.record({ call: OLD_CALL, line: offered });
    sink.end({ leaving: false, why: undefined });
    const ended = sink.record({ call: CALL, line: offered });
    expect([beforeOpen, open, otherCall, ended]).toEqual([false, true, false, false]);
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"]]);
  });

  it("holds one post in flight and sends what queued behind it on a 200", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "two", who: "voice" } });
    expect(posts.length).toBe(1);
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    expect(shape({ wire: posts[1].wire })).toEqual(["one:true", "two:true"]);
  });

  it("puts a batch with no answer back at the front, ahead of what queued since", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    posts[0].answer({ status: 0, why: undefined });
    await settle();
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "two", who: "owner" } });
    expect(shape({ wire: posts[1].wire })).toEqual(["open", "one:true", "two:true"]);
  });

  // A batch the route answered 503 after the verb had appended it went in again whole.
  it("posts a batch a 503 put back with the same write ids, and mints fresh ones only for lines queued since", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    posts[0].answer({ status: 503, why: "slopweaver talk transcript did not answer within 10s" });
    await settle();
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "two", who: "owner" } });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.map((post) => post.wire.lines.map((line) => line.writeId))).toEqual([["w-1"], ["w-1", "w-2", "w-3"]]);
  });

  it("says a refused batch on the page rather than losing it silently", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 422, why: "a line is not an object of a known kind" });
    await settle();
    expect(refused).toEqual([
      { calls: [CALL], live: CALL, lines: 1, turns: [], why: "a line is not an object of a known kind" },
    ]);
    expect(refusedDetail(refused[0])).toBe("1 line(s) not written: a line is not an object of a known kind");
  });

  // A turn whose every line was refused is never on disk, so the history keeps its carried copy.
  it("names the turns whose speech a refused batch carried, once each, as the history ids them", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.speaking({ call: CALL, open: undefined, speech: { id: "s-1", text: "goodnight", who: "owner" } });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "goodnight then", who: "owner" } });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    posts[1].answer({ status: 413, why: "too large" });
    await settle();
    expect(refused.map((input) => [input.lines, input.turns])).toEqual([[2, [`${CALL}:s-1`]]]);
  });

  // The batch with a stretch's first line was refused, and its final line read as begun after the next.
  it("carries when a stretch began on every line of it, so a refused first line leaves its start known", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: undefined, speech: { id: "s-1", text: "first", who: "voice" } });
    posts[1].answer({ status: 413, why: "too large" });
    await settle();
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "wait", who: "owner" } });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "first, finished", who: "voice" } });
    posts[2].answer({ status: 200, why: undefined });
    await settle();
    expect(
      posts
        .slice(2)
        .flatMap((post) =>
          post.wire.lines.flatMap((line) =>
            line.kind === "segment" ? [`${line.id} ${line.atIso} ${String(line.beganIso)}`] : [],
          ),
        ),
    ).toEqual([
      "s-2 2026-09-25T02:30:00.002Z 2026-09-25T02:30:00.002Z",
      "s-1 2026-09-25T02:30:00.003Z 2026-09-25T02:30:00.001Z",
    ]);
  });

  // A batch of a dropped call can be refused after the reconnect, while the page shows the new call.
  it("names which call a refused batch was of, so a reconnected page does not read it as its own", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.end({ leaving: false, why: "dropped" });
    sink.begin({ call: "call-2" });
    sink.open({ call: "call-2", line: OPEN });
    posts[0].answer({ status: 409, why: "the call is closed" });
    await settle();
    expect(refused).toEqual([{ calls: [CALL], live: "call-2", lines: 1, turns: [], why: "the call is closed" }]);
    expect(refusedDetail(refused[0])).toBe("1 line(s) of an earlier call not written: the call is closed");
  });

  // The reconnect begins on a timer, so a refusal can land after the drop and before it.
  it("labels a refusal that answers after its call ended and before the reconnect began as an earlier call's", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.end({ leaving: false, why: "dropped" });
    posts[0].answer({ status: 409, why: "the call is closed" });
    await settle();
    expect(refused).toEqual([{ calls: [CALL], live: undefined, lines: 1, turns: [], why: "the call is closed" }]);
    expect(refusedDetail(refused[0])).toBe("1 line(s) of an earlier call not written: the call is closed");
  });

  it("ends by writing the speech still open as a partial, then the close, once, as a keepalive when leaving", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: undefined, speech: { id: "s-1", text: "and merge the", who: "owner" } });
    sink.end({ leaving: true, why: "the page was closed or reloaded mid-call" });
    sink.end({ leaving: false, why: undefined });
    expect(posts.slice(1).map((post) => [shape({ wire: post.wire }), post.keepalive])).toEqual([
      [["and merge the:false"], false],
      [["and merge the:false", "closed"], true],
    ]);
  });

  // A reconnect "tried to, but it didn't succeed", and nothing on disk said why.
  it("writes a reconnect step onto a call it closed, after the close, while a new call runs", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "the plan call ended: the console's own 90-minute call limit was reached" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.begin({ call: CALL });
    sink.reconnect({
      call: OLD_CALL,
      line: { atIso: AT, event: { attempt: 1, kind: "failed", why: "no answer" }, kind: "reconnect" },
    });
    expect(posts.map((post) => [post.wire.callId, shape({ wire: post.wire })])).toEqual([
      [OLD_CALL, ["open"]],
      [OLD_CALL, ["closed"]],
      [OLD_CALL, ["reconnect"]],
    ]);
    expect(posts[2].wire.lines[0]).toEqual({
      atIso: "2026-09-25T02:30:00.002Z",
      event: { attempt: 1, kind: "failed", why: "no answer" },
      kind: "reconnect",
      writeId: "w-3",
    });
  });

  it("writes no reconnect step onto a call still running, or one never opened and closed", () => {
    const { posts, sink } = harness();
    const line = {
      atIso: AT,
      event: { attempt: 1, delayMs: 0, kind: "scheduled" },
      kind: "reconnect",
    } as const;
    sink.begin({ call: OLD_CALL });
    sink.end({ leaving: false, why: "the microphone was not available: denied" });
    sink.reconnect({ call: OLD_CALL, line });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.reconnect({ call: CALL, line });
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"]]);
  });

  // A step on the shared bounded queue could push out the running call's lines, or outlive its close.
  it("drops a reconnect step itself on a full queue, never a line already queued", async () => {
    const refused: Refused[] = [];
    const posts: { wire: TalkTranscriptWire; answer: (input: TranscriptPostAnswer) => void }[] = [];
    const sink = createTranscriptSink({
      nowIso: () => AT,
      onRefused: (input) => {
        refused.push(input);
      },
      post: ({ wire }) =>
        new Promise<TranscriptPostAnswer>((resolve) => {
          posts.push({ answer: resolve, wire });
        }),
      queueMax: 2,
    });
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    sink.end({ leaving: false, why: "dropped" });
    sink.reconnect({ call: OLD_CALL, line: STEP });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    posts[2].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.map((post) => [post.wire.callId, shape({ wire: post.wire })])).toEqual([
      [OLD_CALL, ["open"]],
      [OLD_CALL, ["closed"]],
      [CALL, ["open", "one:true"]],
    ]);
    expect(refused).toEqual([]);
  });

  // A step admitted into the last free slot made the running call's next line evict one.
  it("drops a queued reconnect step before any line of the running call when the queue passes its bound", async () => {
    const refused: Refused[] = [];
    const posts: { wire: TalkTranscriptWire; answer: (input: TranscriptPostAnswer) => void }[] = [];
    const sink = createTranscriptSink({
      nowIso: () => AT,
      onRefused: (input) => {
        refused.push(input);
      },
      post: ({ wire }) =>
        new Promise<TranscriptPostAnswer>((resolve) => {
          posts.push({ answer: resolve, wire });
        }),
      queueMax: 2,
    });
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "dropped" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    sink.reconnect({ call: OLD_CALL, line: STEP });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "two", who: "owner" } });
    posts[2].answer({ status: 200, why: undefined });
    await settle();
    expect(shape({ wire: posts[3].wire })).toEqual(["one:true", "two:true"]);
    expect(refused).toEqual([
      {
        calls: [OLD_CALL],
        live: CALL,
        lines: 1,
        turns: [],
        why: "no post was taken while 2 lines queued; the oldest went",
      },
    ]);
  });

  // Leaving sends the close as a keepalive, which a step's own post could overtake.
  it("holds a reconnect step until the route took its close, and drops it when the route refuses that close", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: true, why: "dropped" });
    sink.reconnect({ call: OLD_CALL, line: STEP });
    const beforeAnswer = posts.length;
    posts[1].answer({ status: 409, why: "the call is closed" });
    await settle();
    sink.snapshot();
    expect([beforeAnswer, posts.map((post) => shape({ wire: post.wire }))]).toEqual([2, [["open"], ["closed"]]]);
  });

  // A step stamped on the shared sequence must not push the owner's next call's lines a millisecond later.
  it("stamps the owner's next call's lines the same whether or not a reconnect step was written between them", async () => {
    const nextOpenIso = async ({ step }: { step: boolean }): Promise<string> => {
      const { posts, sink } = harness();
      sink.begin({ call: OLD_CALL });
      sink.open({ call: OLD_CALL, line: OPEN });
      posts[0].answer({ status: 200, why: undefined });
      await settle();
      sink.end({ leaving: false, why: "dropped" });
      posts[1].answer({ status: 200, why: undefined });
      await settle();
      if (step) {
        sink.reconnect({ call: OLD_CALL, line: STEP });
        posts[2].answer({ status: 200, why: undefined });
        await settle();
      }
      sink.begin({ call: CALL });
      sink.open({ call: CALL, line: OPEN });
      return posts.at(-1)!.wire.lines[0].atIso;
    };

    expect(await nextOpenIso({ step: true })).toBe(await nextOpenIso({ step: false }));
  });

  // A step post that hangs must not hold the one slot, or the owner's next call's lines wait unsent behind it.
  it("posts the owner's next call's lines while a reconnect step's post is still unanswered", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "dropped" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.reconnect({ call: OLD_CALL, line: STEP });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });

    expect(posts.map((post) => [post.wire.callId, ...shape({ wire: post.wire })])).toEqual([
      [OLD_CALL, "open"],
      [OLD_CALL, "closed"],
      [OLD_CALL, "reconnect"],
      [CALL, "open"],
    ]);
  });

  it("puts a step whose post got no answer back on the queue, and posts it again with the next line", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "dropped" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.reconnect({ call: OLD_CALL, line: STEP });
    posts[2].answer({ status: 503, why: undefined });
    await settle();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });

    expect(posts.slice(3).map((post) => [post.wire.callId, ...shape({ wire: post.wire })])).toEqual([
      [OLD_CALL, "reconnect"],
      [CALL, "open"],
    ]);
  });

  it("stamps a reconnect step after the last line of its own call", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "dropped" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.reconnect({ call: OLD_CALL, line: STEP });

    expect([posts[1].wire.lines[0].atIso, posts[2].wire.lines[0].atIso]).toEqual([
      "2026-09-25T02:30:00.001Z",
      "2026-09-25T02:30:00.002Z",
    ]);
  });

  it("writes a step held behind a keepalive close once the route took that close", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: true, why: "dropped" });
    sink.reconnect({ call: OLD_CALL, line: STEP });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.snapshot();
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"], ["closed"], ["reconnect"]]);
  });

  it("writes no reconnect step onto a call whose close the queue dropped or the route refused", async () => {
    const evicting = { answers: [] as ((input: TranscriptPostAnswer) => void)[], wires: [] as TalkTranscriptWire[] };
    const sink = createTranscriptSink({
      nowIso: () => AT,
      onRefused: () => undefined,
      post: ({ wire }) =>
        new Promise<TranscriptPostAnswer>((resolve) => {
          evicting.wires.push(wire);
          evicting.answers.push(resolve);
        }),
      queueMax: 2,
    });
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    sink.end({ leaving: false, why: "dropped" });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    evicting.answers[0]({ status: 200, why: undefined });
    await settle();
    sink.reconnect({ call: OLD_CALL, line: STEP });
    evicting.answers[1]({ status: 200, why: undefined });
    await settle();
    expect(evicting.wires.map((wire) => [wire.callId, shape({ wire })])).toEqual([
      [OLD_CALL, ["open"]],
      [CALL, ["open", "one:true"]],
    ]);

    const { posts, sink: refusing } = harness();
    refusing.begin({ call: OLD_CALL });
    refusing.open({ call: OLD_CALL, line: OPEN });
    refusing.end({ leaving: false, why: "dropped" });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    posts[1].answer({ status: 409, why: "the call is closed" });
    await settle();
    refusing.reconnect({ call: OLD_CALL, line: STEP });
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"], ["closed"]]);
  });

  it("drops a reconnect step queued while its close was in flight when the route refuses that close", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "dropped" });
    sink.reconnect({ call: OLD_CALL, line: STEP });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[1].answer({ status: 409, why: "the call is closed" });
    await settle();
    sink.snapshot();
    expect(posts.map((post) => [post.wire.callId, shape({ wire: post.wire })])).toEqual([
      [OLD_CALL, ["open"]],
      [OLD_CALL, ["closed"]],
      [CALL, ["open"]],
    ]);
  });

  it("retries a batch an ended call left queued on the next snapshot", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: undefined });
    posts[1].answer({ status: 503, why: undefined });
    await settle();
    sink.snapshot();
    expect(posts.slice(1).map((post) => shape({ wire: post.wire }))).toEqual([["closed"], ["closed"]]);
  });

  it("carries a batch an ended call left queued on the keepalive post as the page goes", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 0, why: undefined });
    await settle();
    sink.end({ leaving: false, why: undefined });
    posts[1].answer({ status: 0, why: undefined });
    await settle();
    sink.end({ leaving: true, why: "the page was closed or reloaded mid-call" });
    expect(posts.slice(2).map((post) => [shape({ wire: post.wire }), post.keepalive])).toEqual([
      [["open", "closed"], true],
    ]);
  });

  // Leaving sends one keepalive batch of at most 200 lines, and the words queued past it went with the page.
  it("posts every batch it holds as the page goes, not only the first", () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    for (let at = 0; at <= 100; at += 1) {
      const speech = { id: `u${String(at)}`, text: `word ${String(at)}`, who: "owner" as const };
      sink.speaking({ call: CALL, open: "hand:x", speech });
      sink.spoke({ call: CALL, open: "hand:x", speech });
    }
    sink.end({ leaving: true, why: "the page was closed or reloaded mid-call" });
    const leaving = posts.filter((post) => post.keepalive);
    expect([leaving.map((post) => post.wire.lines.length), shape({ wire: leaving.at(-1)!.wire }).slice(-2)]).toEqual([
      [200, 3],
      ["word 100:true", "closed"],
    ]);
  });

  // An overtaking batch rearranges the file, so the instants alone must carry the order.
  it("stamps every line strictly after the one before it, even within one millisecond", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: "hand:x", speech: { id: "a", text: "hello", who: "owner" } });
    sink.spoke({ call: CALL, open: "hand:x", speech: { id: "b", text: "world", who: "owner" } });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.flatMap((post) => post.wire.lines.map((line) => line.atIso))).toEqual([
      "2026-09-25T02:30:00.000Z",
      "2026-09-25T02:30:00.001Z",
      "2026-09-25T02:30:00.002Z",
    ]);
  });

  // One millisecond past the last instant a Date holds must not throw and lose the owner's words from the queue.
  it("keeps the owner's words when the line before was stamped at the last instant a Date holds", async () => {
    const { posts, sink } = harness();
    const last = "+275760-09-13T00:00:00.000Z";
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: { ...OPEN, atIso: last } });
    sink.spoke({ call: CALL, open: "hand:a", speech: { id: "s-1", text: "ship it", who: "owner" } });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    const lines = posts.flatMap((post) => post.wire.lines);
    expect([lines.map((line) => line.atIso), shape({ wire: { callId: CALL, lines } })]).toEqual([
      [last, last],
      ["open", "ship it:true"],
    ]);
  });

  // A page kept in the back-forward cache comes back, and a lost keepalive held the only copy of the owner's words.
  it("puts a keepalive batch with no answer back on the queue, where the next snapshot retries it", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: "hand:a", speech: { id: "s-1", text: "ship it", who: "owner" } });
    sink.end({ leaving: true, why: "the page was closed or reloaded mid-call" });
    posts[1].answer({ status: 0, why: undefined });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.snapshot();
    expect(posts.map((post) => [shape({ wire: post.wire }), post.keepalive])).toEqual([
      [["open"], false],
      [["ship it:true", "closed"], true],
      [["ship it:true", "closed"], false],
    ]);
  });

  it("says how many of the oldest lines went when the queue passed its bound", async () => {
    const refused: Refused[] = [];
    const answers: ((input: TranscriptPostAnswer) => void)[] = [];
    const sink = createTranscriptSink({
      nowIso: () => AT,
      onRefused: (input) => {
        refused.push(input);
      },
      post: () =>
        new Promise<TranscriptPostAnswer>((resolve) => {
          answers.push(resolve);
        }),
      queueMax: 2,
    });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    for (const id of ["s-1", "s-2", "s-3", "s-4"]) {
      sink.spoke({ call: CALL, open: undefined, speech: { id, text: id, who: "owner" } });
    }
    answers[0]({ status: 0, why: undefined });
    await settle();
    expect(refused.map((entry) => [entry.lines, entry.turns])).toEqual([
      [1, [`${CALL}:s-1`]],
      [1, [`${CALL}:s-2`]],
      [1, []],
    ]);
  });

  // A word said while a card is open lands on THAT card, so the card is the one open
  // when the speech began — opening the next card mid-sentence must not carry the sentence with it.
  it("stamps every line of a stretch of speech with the card open when it began, and omits a card when none was", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: "hand:voice-mark-step", speech: { id: "s-1", text: "what is a", who: "owner" } });
    sink.snapshot();
    sink.spoke({ call: CALL, open: "ask:next", speech: { id: "s-1", text: "what is a voice mark", who: "owner" } });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "ok", who: "owner" } });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.slice(1).flatMap((post) => opens({ wire: post.wire }))).toEqual([
      "s-1@hand:voice-mark-step",
      "s-1@hand:voice-mark-step",
      "s-2@undefined",
    ]);
  });

  it("forgets the cards of an earlier call's segment ids when a new call begins", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    sink.speaking({ call: OLD_CALL, open: "ask:first", speech: { id: "s-1", text: "a", who: "owner" } });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: CALL, open: "ask:second", speech: { id: "s-1", text: "b", who: "owner" } });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.flatMap((post) => opens({ wire: post.wire }).map((open) => `${post.wire.callId}:${open}`))).toEqual([
      `${OLD_CALL}:s-1@ask:first`,
      `${CALL}:s-1@ask:second`,
    ]);
  });

  it("never lets a late event of an earlier call claim a segment id's card in the call now running", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.spoke({ call: OLD_CALL, open: "ask:first", speech: { id: "s-1", text: "late", who: "owner" } });
    sink.spoke({ call: CALL, open: "ask:second", speech: { id: "s-1", text: "b", who: "owner" } });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.flatMap((post) => opens({ wire: post.wire }))).toEqual(["s-1@ask:second"]);
    expect(sink.heardOver()).toEqual({
      contexts: [undefined],
      lastOpen: "ask:second",
      opens: ["ask:second"],
      segmentId: "s-1",
    });
  });

  it("keeps this call's open speech when a late close of an earlier call reuses its segment id", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: "ask:new", speech: { id: "s-1", text: "ship it", who: "owner" } });
    sink.spoke({ call: OLD_CALL, open: "ask:old", speech: { id: "s-1", text: "old words", who: "owner" } });
    sink.end({ leaving: true, why: "the page was closed or reloaded mid-call" });
    expect(posts.slice(1).map((post) => shape({ wire: post.wire }))).toEqual([
      ["ship it:false"],
      ["ship it:false", "closed"],
    ]);
  });

  it("snapshots open speech only when it changed since the last snapshot", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: undefined, speech: { id: "s-1", text: "and", who: "owner" } });
    sink.snapshot();
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.snapshot();
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"], ["and:false"]]);
  });

  // A relay posted before the next snapshot already heard these words, so the stretch's first line is
  // written when it is first heard, and its later updates wait for the snapshot.
  it("writes a stretch the moment it is first heard, and its later updates only at a snapshot", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: "hand:b", speech: { id: "s-1", text: "also", who: "owner" } });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: "hand:b", speech: { id: "s-1", text: "also inspect it", who: "owner" } });
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"], ["also:false"]]);
    sink.snapshot();
    expect(shape({ wire: posts[2].wire })).toEqual(["also inspect it:false"]);
  });

  // The draft a turn is handed is the card the owner's words began over, not one they moved to after.
  it("answers a segment's first stamp after the card moved, nothing for one unheard, and forgets on a new call", () => {
    const { sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.speaking({ call: CALL, open: "post:sd-30e3b8b1", speech: { id: "s-1", text: "What is", who: "owner" } });
    sink.spoke({ call: CALL, open: "ask:moved-on", speech: { id: "s-1", text: "What is the reply?", who: "owner" } });
    expect(sink.heardStamp({ segmentId: "s-1" })).toEqual({
      context: undefined,
      open: "post:sd-30e3b8b1",
      openBy: undefined,
    });
    expect(sink.heardStamp({ segmentId: "s-2" })).toBe(undefined);
    sink.begin({ call: OLD_CALL });
    expect(sink.heardStamp({ segmentId: "s-1" })).toBe(undefined);
  });

  it("keeps the cards the owner's words since the last relay began over, for this call only", () => {
    const { sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    expect(sink.heardOver()).toBe(undefined);
    sink.speaking({ call: CALL, open: "hand:voice-mark-step", speech: { id: "s-1", text: "ship", who: "owner" } });
    sink.spoke({ call: CALL, open: "pr:16406", speech: { id: "s-1", text: "ship it", who: "owner" } });
    sink.spoke({ call: CALL, open: "pr:16406", speech: { id: "s-2", text: "on it", who: "voice" } });
    sink.spoke({ call: OLD_CALL, open: "ask:first", speech: { id: "s-9", text: "late close", who: "owner" } });
    expect(sink.heardOver()).toEqual({
      contexts: [undefined],
      lastOpen: "hand:voice-mark-step",
      opens: ["hand:voice-mark-step"],
      segmentId: "s-1",
    });
    sink.spoke({ call: CALL, open: "pr:16406", speech: { id: "s-3", text: "and B", who: "owner" } });
    expect(sink.heardOver()).toEqual({
      contexts: [undefined],
      lastOpen: "pr:16406",
      opens: ["hand:voice-mark-step", "pr:16406"],
      segmentId: "s-3",
    });
    sink.relayed();
    expect(sink.heardOver()).toBe(undefined);
    sink.spoke({ call: CALL, open: "pr:16406", speech: { id: "s-4", text: "then B", who: "owner" } });
    expect(sink.heardOver()).toEqual({
      contexts: [undefined],
      lastOpen: "pr:16406",
      opens: ["pr:16406"],
      segmentId: "s-4",
    });
    sink.begin({ call: OLD_CALL });
    expect(sink.heardOver()).toBe(undefined);
  });

  // A segment keeps the console it began on, so a switch before the relay does not move the owner's words.
  it("stamps each segment with the console the owner was on when it began", () => {
    const { sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.speaking({ call: CALL, context: "work", open: undefined, speech: { id: "s-1", text: "ship", who: "owner" } });
    sink.spoke({
      call: CALL,
      context: "slopweaver",
      open: undefined,
      speech: { id: "s-1", text: "ship it", who: "owner" },
    });
    expect(sink.heardOver()).toEqual({ contexts: ["work"], lastOpen: undefined, opens: [undefined], segmentId: "s-1" });
  });

  // The voice opened this ask, and the owner's aside over it must not land as a ruling.
  it("says the voice opened the card the speech began over, and a relay still hears that card", async () => {
    const ask =
      "ask:the-proposal-that-a-bad-db-migration-can-never-break-ci-again-found-with-what-happened-to-it-and-todays-failed-migration-tied-to-it";
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.speaking({ call: CALL, open: ask, openBy: "voice", speech: { id: "s-1", text: "just coming", who: "owner" } });
    sink.spoke({
      call: CALL,
      open: "ask:opened-by-the-owner",
      openBy: undefined,
      speech: { id: "s-1", text: "just coming back to the computer in a minute", who: "owner" },
    });
    sink.spoke({ call: CALL, open: "ask:opened-by-the-owner", speech: { id: "s-2", text: "this one", who: "owner" } });
    expect(sink.heardOver()).toEqual({
      contexts: [undefined],
      lastOpen: "ask:opened-by-the-owner",
      opens: [ask, "ask:opened-by-the-owner"],
      segmentId: "s-2",
    });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    expect(
      posts
        .slice(1)
        .flatMap((post) =>
          post.wire.lines.flatMap((line) => (line.kind === "segment" ? [`${line.id}@${String(line.openBy)}`] : [])),
        ),
    ).toEqual(["s-1@voice", "s-1@voice", "s-2@undefined"]);
  });
});
