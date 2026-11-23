/*
 * The call transcript's sink, for a tool's answer settled after it was asked: each call keeps every tool's answer,
 * written only once it was delivered, on the call that asked even after its hang-up, and a lost one is said.
 */

import { describe, expect, it } from "vitest";

import type { TalkTranscriptWire } from "../../lib/talkTranscript";
import { createTranscriptSink } from "../../lib/transcriptSink";
import type { TranscriptPostAnswer } from "../../lib/transcriptSinkContract";
import { AT, CALL, harness, OLD_CALL, OPEN, type Refused, settle, shape } from "./transcriptSinkHarness";

// Each call keeps every tool's answer, written only once it was delivered.
describe("settledTool", () => {
  const TOOL = {
    answer: '{"answer":"ABC-1 is done"}',
    atIso: AT,
    detail: "read ABC-1",
    kind: "tool",
    name: "code_read",
    refused: false,
  } as const;

  it("writes an answer settled while its call runs as any other line of that call", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.length).toBe(1);
    sink.settledTool({ call: CALL, line: TOOL });
    expect(posts.map((post) => [post.wire.callId, shape({ wire: post.wire })])).toEqual([
      [CALL, ["open"]],
      [CALL, ["tool"]],
    ]);
    expect(posts[1].wire.lines[0]).toEqual({ ...TOOL, atIso: "2026-09-25T02:30:00.001Z", writeId: "w-2" });
  });

  it("lands an answer whose delivery outlasted a hang-up on the call that asked, after its close, never the next", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "the owner hung up" });
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.settledTool({ call: OLD_CALL, line: TOOL });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    posts[2].answer({ status: 200, why: undefined });
    await settle();
    expect(posts.map((post) => [post.wire.callId, shape({ wire: post.wire })])).toEqual([
      [OLD_CALL, ["open"]],
      [OLD_CALL, ["closed"]],
      [CALL, ["open"]],
      [OLD_CALL, ["tool"]],
    ]);
    expect(posts[1].wire.lines[0].atIso).toBe("2026-09-25T02:30:00.001Z");
    expect(posts[3].wire.lines[0]).toEqual({ ...TOOL, atIso: "2026-09-25T02:30:00.002Z", writeId: "w-4" });
    expect(refused).toEqual([]);
  });

  it("posts a late answer a 503 put back with the same write id", async () => {
    const { posts, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "the owner hung up" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.settledTool({ call: OLD_CALL, line: TOOL });
    posts[2].answer({ status: 503, why: undefined });
    await settle();
    sink.snapshot();
    expect(posts.map((post) => [post.wire.callId, post.wire.lines.map((line) => line.writeId)])).toEqual([
      [OLD_CALL, ["w-1"]],
      [OLD_CALL, ["w-2"]],
      [OLD_CALL, ["w-3"]],
      [OLD_CALL, ["w-3"]],
    ]);
  });

  it("says a late answer the queue's bound pushed out, rather than dropping it silently", async () => {
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
    sink.end({ leaving: false, why: "the owner hung up" });
    posts[1].answer({ status: 200, why: undefined });
    await settle();
    sink.begin({ call: CALL });
    sink.open({ call: CALL, line: OPEN });
    sink.settledTool({ call: OLD_CALL, line: TOOL });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-1", text: "one", who: "owner" } });
    sink.spoke({ call: CALL, open: undefined, speech: { id: "s-2", text: "two", who: "owner" } });
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

  it("says an answer held behind a close the route refused, which goes with that close", async () => {
    const { posts, refused, sink } = harness();
    sink.begin({ call: OLD_CALL });
    sink.open({ call: OLD_CALL, line: OPEN });
    posts[0].answer({ status: 200, why: undefined });
    await settle();
    sink.end({ leaving: false, why: "the owner hung up" });
    sink.settledTool({ call: OLD_CALL, line: TOOL });
    posts[1].answer({ status: 409, why: "the call is closed" });
    await settle();
    sink.snapshot();
    expect(posts.map((post) => shape({ wire: post.wire }))).toEqual([["open"], ["closed"]]);
    expect(refused).toEqual([
      {
        calls: [OLD_CALL],
        live: undefined,
        lines: 1,
        turns: [],
        why: "the call's close was not written, so the tool answers held behind it went with it",
      },
      { calls: [OLD_CALL], live: undefined, lines: 1, turns: [], why: "the call is closed" },
    ]);
  });

  it("says an answer for a call this page never opened, which has no file to follow", () => {
    const { posts, refused, sink } = harness();
    sink.settledTool({ call: OLD_CALL, line: TOOL });
    expect(posts).toEqual([]);
    expect(refused).toEqual([
      {
        calls: [OLD_CALL],
        live: undefined,
        lines: 1,
        turns: [],
        why: "the call that asked was not open and no close of it was written, so its tool answer has no file",
      },
    ]);
  });
});
