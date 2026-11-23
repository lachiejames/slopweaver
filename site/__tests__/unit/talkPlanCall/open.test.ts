/**
 * `PlanCall` opening a call, journalling its thread, answering tool calls and ending.
 */

import { describe, expect, it } from "vitest";
import {
  LIFETIME_REASON,
  PLAN_CALL_LIMITS,
  type SequencedEvent,
  UNDELIVERED_TOOL_TEXT,
} from "../../../lib/planCallContract";
import {
  CLAIMED,
  COMPOSITION,
  failure,
  harness,
  OPENS,
  opened,
  PLAN_LOGIN,
  result,
  SDP_LINE,
  settle,
  TOOL_REQUEST,
} from "./harness";

describe("PlanCall.open", () => {
  it("initializes, requires a ChatGPT login, starts the thread, then realtime with the offer", async () => {
    const h = await opened();
    expect(h.written.map((m) => m["method"])).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "thread/start",
      "thread/realtime/start",
    ]);
    expect(h.written[0]["params"]).toEqual({
      capabilities: { experimentalApi: true },
      clientInfo: { name: "slopweaver-console", title: "Slopweaver console", version: "1" },
    });
    expect(h.written[3]["params"]).toEqual(COMPOSITION.thread);
    expect(h.written[4]["params"]).toEqual({
      delegationAckFiller: false,
      threadId: "thread-1",
      transport: { sdp: "v=0 offer", type: "webrtc" },
      version: "v3",
      voice: "sol",
    });
    expect(h.kills.count).toBe(0);
  });

  // `talk offer` seeds the voice's history with the greeting lines (`src/talk/planSession.ts`); the console adds nothing.
  it("hands the composition's initialItems to the realtime start byte for byte", async () => {
    const initialItems = [{ role: "developer", text: "The owner already knows you.\nNever introduce yourself." }];
    const h = harness({ script: OPENS });
    const composition = { ...COMPOSITION, realtime: { ...COMPOSITION.realtime, initialItems } };
    expect(await h.call.open({ composition, offerSdp: "v=0 offer" })).toEqual({
      kind: "open",
      sdp: "v=0 answer",
      threadId: "thread-1",
    });
    expect(h.written[4]["params"]).toEqual({
      delegationAckFiller: false,
      initialItems,
      threadId: "thread-1",
      transport: { sdp: "v=0 offer", type: "webrtc" },
      version: "v3",
      voice: "sol",
    });
  });

  it("refuses DEFINITIVELY on an API-key login, before any thread exists", async () => {
    const h = harness({ script: { ...PLAN_LOGIN, "account/read": result({ account: { type: "apiKey" } }) } });
    expect(await h.call.open({ composition: COMPOSITION, offerSdp: "o" })).toEqual({
      kind: "refused",
      reason: "Codex is signed in with apiKey, not a ChatGPT plan",
    });
    expect(h.written.map((m) => m["method"])).toEqual(["initialize", "initialized", "account/read"]);
    expect(h.kills.count).toBe(1);
  });

  it("refuses DEFINITIVELY when thread/start errors", async () => {
    const h = harness({ script: { ...PLAN_LOGIN, "thread/start": failure("model not allowed") } });
    expect(await h.call.open({ composition: COMPOSITION, offerSdp: "o" })).toEqual({
      kind: "refused",
      reason: "the app-server did not start a thread: model not allowed",
    });
  });

  it("stops the call and kills the child when the handshake throws, rather than leaving it held", async () => {
    const h = harness({ script: PLAN_LOGIN });
    const composition = { ...COMPOSITION, thread: { ...COMPOSITION.thread, unserialisable: 1n } };
    expect(await h.call.open({ composition, offerSdp: "o" })).toEqual({
      kind: "ambiguous",
      reason: "the handshake threw (Do not know how to serialize a BigInt); a plan session may exist",
    });
    expect([h.call.ended, h.kills.count]).toEqual([true, 1]);
  });

  it("refuses DEFINITIVELY when Codex answers the realtime start with an error", async () => {
    const h = harness({ script: { ...PLAN_LOGIN, "thread/realtime/start": failure("usage limit reached") } });
    expect(await h.call.open({ composition: COMPOSITION, offerSdp: "o" })).toEqual({
      kind: "refused",
      reason: "Codex refused the realtime session: usage limit reached",
    });
    expect(h.kills.count).toBe(1);
  });

  it("is AMBIGUOUS when the realtime start is never answered — a session may exist", async () => {
    const h = harness({ script: PLAN_LOGIN });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "o" });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.realtimeStartMs });
    expect(await outcome).toEqual({
      kind: "ambiguous",
      reason: "the realtime start got no answer in time; a plan session may exist",
    });
    expect(h.kills.count).toBe(1);
  });

  it("is AMBIGUOUS when the start is accepted but no SDP follows", async () => {
    const h = harness({ script: { ...PLAN_LOGIN, "thread/realtime/start": result({}) } });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "o" });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.realtimeStartMs });
    expect(await outcome).toEqual({
      kind: "ambiguous",
      reason: "Codex accepted the realtime start but no answer SDP arrived; a plan session may exist",
    });
  });

  it("is AMBIGUOUS when the child exits after the realtime start was written", async () => {
    const h = harness({ script: PLAN_LOGIN });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "o" });
    await settle();
    h.call.exited({ detail: "code 1" });
    expect(await outcome).toEqual({
      kind: "ambiguous",
      reason: "the realtime start got the app-server exited (code 1); a plan session may exist",
    });
  });

  it("takes the SDP when it arrives BEFORE the start's answer", async () => {
    const h = harness({
      script: {
        ...PLAN_LOGIN,
        "thread/realtime/start": ({ id }) => `${SDP_LINE}${JSON.stringify({ id, result: {} })}\n`,
      },
    });
    expect(await h.call.open({ composition: COMPOSITION, offerSdp: "o" })).toEqual({
      kind: "open",
      sdp: "v=0 answer",
      threadId: "thread-1",
    });
  });
});

describe("the thread journal", () => {
  it("records the start request, the thread, each notification and a tool answer BEFORE it is written, then closes", async () => {
    const h = await opened();
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    const writesBeforeAnswer = h.written.length;
    h.call.answer({
      claimant: "page-a",
      contentItems: [{ text: "hit", type: "inputText" }],
      success: true,
      token: "token-1.1",
    });
    h.call.stop({ reason: "done" });
    expect(h.journal).toEqual([
      "starting voice",
      "started thread-1",
      "observe thread/realtime/sdp",
      `answered search_corpus true after ${String(writesBeforeAnswer)} writes`,
      "close",
    ]);
  });
});

describe("tool calls", () => {
  it("reach the page by opaque token and are answered once, under the server's own id", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: TOOL_REQUEST });
    expect(seen).toEqual([
      {
        event: { arguments: '{"query":"q"}', kind: "tool", token: "token-1.1", tool: "search_corpus", turnId: "u1" },
        seq: 1,
      },
    ]);
    const items = [{ text: "three hits", type: "inputText" as const }];
    const writtenBefore = h.written.length;
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "token-1.1" })).toEqual({
      kind: "refused",
      reason: "that tool call was never claimed; a page claims it before running it",
    });
    expect(h.written.length).toBe(writtenBefore);
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "token-1.1" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
    expect(h.written.at(-1)).toEqual({ id: 77, result: { contentItems: items, success: true } });
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "token-1.1" })).toEqual({
      kind: "refused",
      reason: "no tool call is waiting on that token: answered already, timed out, or never made",
    });
  });

  // A claim or answer that gets no answer must not leave the thread waiting out the whole window with the voice silent.
  it("settles an unclaimed call the page could not run at once, in this server's words, and never again", async () => {
    const h = await opened();
    // A page following the stream, so the window can pass without the absent-stream grace ending the call.
    h.call.subscribe({ after: 0, listener: () => undefined });
    h.call.receive({ chunk: TOOL_REQUEST });
    const pageWords = [{ text: "the page's own text", type: "inputText" as const }];
    const writtenBefore = h.written.length;

    expect(h.call.answer({ claimant: "page-a", contentItems: pageWords, success: false, token: "token-1.1" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.pendingToolMs });

    expect(h.written.slice(writtenBefore)).toEqual([
      { id: 77, result: { contentItems: [{ text: UNDELIVERED_TOOL_TEXT, type: "inputText" }], success: false } },
    ]);
    expect(h.call.answer({ claimant: "page-a", contentItems: pageWords, success: false, token: "token-1.1" })).toEqual({
      kind: "refused",
      reason: "no tool call is waiting on that token: answered already, timed out, or never made",
    });
  });

  it("takes a claimed call's failure answer in the page's words, as any answer to a call it ran", async () => {
    const h = await opened();
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    const items = [{ text: "the answer did not arrive", type: "inputText" as const }];

    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: false, token: "token-1.1" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
    expect(h.written.at(-1)).toEqual({ id: 77, result: { contentItems: items, success: false } });
  });

  // Page A's claim is lost, page B claims and runs it, and only then does A's failure arrive.
  it("refuses a failure from a page that did not claim the call, so the page running it still answers it", async () => {
    const h = await opened();
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.claim({ claimant: "page-b", token: "token-1.1" });
    const writtenBefore = h.written.length;
    const undelivered = [{ text: UNDELIVERED_TOOL_TEXT, type: "inputText" as const }];
    const ran = [{ text: "three hits", type: "inputText" as const }];

    expect(
      h.call.answer({ claimant: "page-a", contentItems: undelivered, success: false, token: "token-1.1" }),
    ).toEqual({
      kind: "refused",
      reason: "that tool call is another page's; the page that claimed it answers it",
    });
    expect(h.call.answer({ claimant: "page-b", contentItems: ran, success: true, token: "token-1.1" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
    expect(h.written.slice(writtenBefore)).toEqual([{ id: 77, result: { contentItems: ran, success: true } }]);
  });

  it("drops a settled tool call replayed under a fresh RPC id, so it never runs twice", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    h.call.answer({
      claimant: "page-a",
      contentItems: [{ text: "three hits", type: "inputText" }],
      success: true,
      token: "token-1.1",
    });
    h.call.receive({ chunk: TOOL_REQUEST.replace(`"id":77`, `"id":78`) });
    expect(h.written.at(-1)).toEqual({
      error: { code: -32601, message: "the console does not answer item/tool/call" },
      id: 78,
    });
    expect(seen.length).toBe(1);
  });

  it("drops a second request reusing a waiting call's RPC id, so that id is answered once, by the claimed call", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: TOOL_REQUEST });
    expect(h.call.claim({ claimant: "page-a", token: "token-1.1" })).toEqual(CLAIMED);
    const writtenBefore = h.written.length;
    h.call.receive({ chunk: TOOL_REQUEST.replace(`"c1"`, `"c2"`) });
    expect([h.written.length, seen.length]).toEqual([writtenBefore, 1]);
    const items = [{ text: "ran", type: "inputText" as const }];
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "token-1.1" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
    expect(h.written.slice(writtenBefore)).toEqual([{ id: 77, result: { contentItems: items, success: true } }]);
  });

  it("drops a tool call from any thread but the call's own", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: TOOL_REQUEST.replace(`"thread-1"`, `"thread-old"`) });
    expect(h.written.at(-1)).toEqual({
      error: { code: -32601, message: "the console does not answer item/tool/call" },
      id: 77,
    });
    expect(seen).toEqual([]);
  });

  // A claim that reaches a swapped-out server instead must not leave each turn sitting out the claimed window until
  // the owner's next words end it.
  it("answers a call no page claimed as undelivered once the short unclaimed wait runs out, and only once", async () => {
    const h = await opened();
    h.call.subscribe({ after: 0, listener: () => undefined });
    h.call.receive({ chunk: TOOL_REQUEST });
    const writtenBefore = h.written.length;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.unclaimedToolMs - 1 });
    expect(h.written.length).toBe(writtenBefore);
    h.clock.advance({ ms: 1 });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.pendingToolMs });
    expect(h.written.slice(writtenBefore)).toEqual([
      { id: 77, result: { contentItems: [{ text: UNDELIVERED_TOOL_TEXT, type: "inputText" }], success: false } },
    ]);
  });

  it("answers a claimed call the page never answered as a failure, so the thread never waits forever", async () => {
    const h = await opened();
    h.call.subscribe({ after: 0, listener: () => undefined });
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    const writtenBefore = h.written.length;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.pendingToolMs - 1 });
    expect(h.written.length).toBe(writtenBefore);
    h.clock.advance({ ms: 1 });
    expect(h.written.slice(writtenBefore)).toEqual([
      {
        id: 77,
        result: {
          contentItems: [{ text: "The console did not answer this tool call in time.", type: "inputText" }],
          success: false,
        },
      },
    ]);
  });

  it("never issues one token twice in a call, so a late answer to a timed-out call cannot answer a later one", async () => {
    const h = await opened({ mint: () => "T" });
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: TOOL_REQUEST });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.unclaimedToolMs });
    h.call.receive({ chunk: TOOL_REQUEST.replace(`"id":77`, `"id":78`).replace(`"c1"`, `"c2"`) });
    expect(seen.map(({ event }) => ("token" in event ? event.token : event.kind))).toEqual(["T.1", "T.2"]);
    const items = [{ text: "late", type: "inputText" as const }];
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "T.1" })).toEqual({
      kind: "refused",
      reason: "no tool call is waiting on that token: answered already, timed out, or never made",
    });
    h.call.claim({ claimant: "page-a", token: "T.2" });
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "T.2" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
    expect(h.written.at(-1)).toEqual({ id: 78, result: { contentItems: items, success: true } });
  });

  it("lets the page claim a waiting tool call once, and swaps its short wait for a whole claimed one", async () => {
    const h = await opened();
    h.call.subscribe({ after: 0, listener: () => undefined });
    h.call.receive({ chunk: TOOL_REQUEST });
    const writtenBefore = h.written.length;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.unclaimedToolMs - 1 });
    expect(h.call.claim({ claimant: "page-a", token: "token-1.1" })).toEqual(CLAIMED);
    expect(h.call.claim({ claimant: "page-a", token: "token-1.1" })).toEqual({
      kind: "refused",
      reason: "that tool call is already claimed; it is run once",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.pendingToolMs - 1 });
    expect(h.written.length).toBe(writtenBefore);
    const items = [{ text: "ran", type: "inputText" as const }];
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: "token-1.1" })).toEqual({
      arguments: JSON.stringify({ query: "q" }),
      kind: "answered",
      tool: "search_corpus",
    });
  });

  it("refuses a claim on a tool call the server already timed out, so its late event is never run", async () => {
    const h = await opened();
    h.call.subscribe({ after: 0, listener: () => undefined });
    h.call.receive({ chunk: TOOL_REQUEST });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.unclaimedToolMs });
    expect(h.call.claim({ claimant: "page-a", token: "token-1.1" })).toEqual({
      kind: "refused",
      reason: "no tool call is waiting on that token: answered already, timed out, or never made",
    });
  });

  it("refuses any other server request with an error, relaying nothing", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({
      chunk: `${JSON.stringify({ id: 5, method: "item/commandExecution/requestApproval", params: {} })}\n`,
    });
    expect(h.written.at(-1)).toEqual({
      error: { code: -32601, message: "the console does not answer item/commandExecution/requestApproval" },
      id: 5,
    });
    expect(seen).toEqual([]);
  });

  it("replays what a late stream missed, after the last sequence it saw", async () => {
    const h = await opened();
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.receive({ chunk: TOOL_REQUEST.replace("77", "78").replace(`"c1"`, `"c2"`) });
    expect(h.call.subscribe({ after: 1, listener: () => undefined }).replay.map((entry) => entry.seq)).toEqual([2]);
  });
});

describe("ending", () => {
  it("stops on the transport's close: realtime stop written, child killed once, closed emitted once", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    const closed = `${JSON.stringify({ method: "thread/realtime/closed", params: { reason: "user", threadId: "thread-1" } })}\n`;
    h.call.receive({ chunk: closed });
    h.call.receive({ chunk: closed });
    h.call.stop({ reason: "again" });
    expect(h.written.at(-1)).toEqual({ id: 5, method: "thread/realtime/stop", params: { threadId: "thread-1" } });
    expect(h.kills.count).toBe(1);
    expect(h.ended).toEqual(["call-1"]);
    expect(seen).toEqual([{ event: { kind: "closed", reason: "the realtime transport closed: user" }, seq: 1 }]);
  });

  it("stops when the page's stream stays absent past the grace, and not while one is attached", async () => {
    const h = await opened();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.streamAbsentMs - 1 });
    const { unsubscribe } = h.call.subscribe({ after: 0, listener: () => undefined });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.streamAbsentMs * 2 });
    expect(h.kills.count).toBe(0);
    unsubscribe();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.streamAbsentMs });
    expect(h.kills.count).toBe(1);
    expect(h.call.ended).toBe(true);
  });

  it("stops at the hard lifetime whatever else is true, saying the cap is the console's own", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lifetimeMs });
    expect(h.kills.count).toBe(1);
    expect(seen).toEqual([{ event: { kind: "closed", reason: LIFETIME_REASON }, seq: 1 }]);
    expect(LIFETIME_REASON).toBe(
      "the console's own 90-minute call limit was reached; start a new call and it picks up where this one left off",
    );
  });

  it("refuses an answer once the call has ended", async () => {
    const h = await opened();
    h.call.receive({ chunk: TOOL_REQUEST });
    h.call.stop({ reason: "the owner hung up" });
    expect(
      h.call.answer({
        claimant: "page-a",
        contentItems: [{ text: "x", type: "inputText" }],
        success: true,
        token: "token-1.1",
      }),
    ).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});
