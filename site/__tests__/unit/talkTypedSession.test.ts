/*
 * The typed twin's lifecycle over a fake child and a fake clock: it opens the voice's thread with no realtime, each
 * message is one `turn/start`, a send while a reply runs is refused, a retried id starts nothing, and what the thread
 * writes streams to the page throttled with the whole message last.
 *
 * The child is a plain fake port that answers requests from a script; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { MeetingLedger } from "../../lib/meetingLedger";
import { LIFETIME_REASON, PLAN_CALL_LIMITS, type SequencedEvent } from "../../lib/planCallContract";
import { TYPED_UNSURE_HOLD_MS } from "../../lib/talkArbiter";
import { TalkNoticeLedger } from "../../lib/talkNoticeLedger";
import type { PlanComposition } from "../../lib/talkPlanProtocol";
import { STILL_REPLYING, TypedPlanSession, WRITTEN_EVERY_MS } from "../../lib/talkTypedSession";
import { fakeClock, COMPOSITION as PLAN_CALL_COMPOSITION } from "./talkPlanCall/harness";

const COMPOSITION: PlanComposition = { ...PLAN_CALL_COMPOSITION, tools: ["slack_thread_after"] };

/** How the child answers each method. */
type Script = Record<string, (input: { id: number }) => string | undefined>;

/** Let every queued answer land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

const result =
  (value: unknown) =>
  ({ id }: { id: number }) =>
    `${JSON.stringify({ id, result: value })}\n`;

const PLAN_LOGIN: Script = {
  "account/read": result({ account: { planType: "pro", type: "chatgpt" } }),
  initialize: result({ userAgent: "codex" }),
  "thread/start": result({ thread: { id: "thread-1" } }),
};

/** A plan login whose thread takes every turn, numbering them. */
function accepting(): Script {
  let turns = 0;
  return {
    ...PLAN_LOGIN,
    "turn/start": ({ id }) => {
      turns += 1;
      return result({ turn: { id: `t-${String(turns)}`, status: "inProgress" } })({ id });
    },
  };
}

/**
 * A typed conversation over a scripted child.
 *
 * @param script how the child answers each method
 * @returns the session, what was written, the kill count, the clock and every event it emitted
 */
function harness({ script }: { script: Script }): {
  session: TypedPlanSession;
  written: Record<string, unknown>[];
  kills: { count: number };
  clock: ReturnType<typeof fakeClock>;
  seen: SequencedEvent[];
} {
  const written: Record<string, unknown>[] = [];
  const kills = { count: 0 };
  const clock = fakeClock();
  const holder: { session?: TypedPlanSession } = {};
  const session = new TypedPlanSession({
    clock,
    id: "typed-1",
    journal: {
      close: () => undefined,
      observe: () => undefined,
      threadNeverStarted: () => undefined,
      threadStarted: () => undefined,
      threadStarting: () => undefined,
      toolAnswered: () => undefined,
    },
    meetings: new MeetingLedger(),
    mintToken: () => "token-1",
    notices: new TalkNoticeLedger(),
    onEnded: () => undefined,
    port: {
      kill: () => {
        kills.count += 1;
      },
      write: ({ line }) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        written.push(message);
        const answer = typeof message["method"] === "string" ? script[message["method"]] : undefined;
        const reply = answer?.({ id: message["id"] as number });
        if (reply !== undefined) {
          queueMicrotask(() => holder.session!.receive({ chunk: reply }));
        }
      },
    },
  });
  holder.session = session;
  const seen: SequencedEvent[] = [];
  session.subscribe({ after: 0, listener: (event) => seen.push(event) });
  return { clock, kills, seen, session, written };
}

/**
 * A typed conversation, opened.
 *
 * @param script how the child answers, when a test needs more than an accepting thread
 * @returns the harness
 */
async function opened({ script = accepting() }: { script?: Script } = {}): Promise<ReturnType<typeof harness>> {
  const h = harness({ script });
  expect(await h.session.openTyped({ composition: COMPOSITION })).toEqual({ kind: "open", threadId: "thread-1" });
  return h;
}

/** A notification line, as the app-server writes it. */
const line = ({ method, params }: { method: string; params: unknown }) => `${JSON.stringify({ method, params })}\n`;

/** A `turn/completed` for one of thread-1's turns. */
const completed = ({ turnId }: { turnId: string }) =>
  line({
    method: "turn/completed",
    params: { threadId: "thread-1", turn: { error: null, id: turnId, items: [], status: "completed" } },
  });

/** A `turn/started` for one of thread-1's turns. */
const started = ({ turnId }: { turnId: string }) =>
  line({
    method: "turn/started",
    params: { threadId: "thread-1", turn: { id: turnId, items: [], status: "inProgress" } },
  });

/** One delta of an agent message. */
const delta = ({ text, threadId = "thread-1" }: { text: string; threadId?: string }) =>
  line({ method: "item/agentMessage/delta", params: { delta: text, itemId: "msg-1", threadId, turnId: "t-1" } });

/** Only the `written` events, in order. */
const writtenOf = ({ seen }: { seen: readonly SequencedEvent[] }) =>
  seen.map(({ event }) => event).filter((event) => event.kind === "written");

describe("TypedPlanSession.openTyped", () => {
  it("initializes, requires a ChatGPT login and starts the thread — never realtime", async () => {
    const h = await opened();
    expect(h.written.map((m) => m["method"])).toEqual(["initialize", "initialized", "account/read", "thread/start"]);
    expect(h.written[3]["params"]).toEqual(COMPOSITION.thread);
    expect(h.session.surface).toBe("typed");
    expect(h.session.replying).toBe(false);
    expect(h.kills.count).toBe(0);
  });

  it("refuses on an API-key login, and has already stopped", async () => {
    const h = harness({ script: { ...PLAN_LOGIN, "account/read": result({ account: { type: "apiKey" } }) } });
    expect(await h.session.openTyped({ composition: COMPOSITION })).toEqual({
      kind: "refused",
      reason: "Codex is signed in with apiKey, not a ChatGPT plan",
    });
    expect(h.session.ended).toBe(true);
    expect(h.kills.count).toBe(1);
  });
});

describe("TypedPlanSession.say", () => {
  it("is refused before the thread opens, writing nothing", async () => {
    const h = harness({ script: accepting() });
    expect(await h.session.say({ messageId: "m-1", text: "hi" })).toEqual({
      kind: "refused",
      reason: "the typed conversation has not opened yet",
    });
    expect(h.written).toEqual([]);
  });

  it("sends one turn/start on the thread with the owner's text, and holds the turn as running", async () => {
    const h = await opened();
    const text = "what does https://example.slack.com/archives/C1/p1700000000000100 say?";
    expect(await h.session.say({ messageId: "m-1", text })).toEqual({ kind: "accepted", turnId: "t-1" });
    expect(h.written.at(-1)!["method"]).toBe("turn/start");
    expect(h.written.at(-1)!["params"]).toEqual({ input: [{ text, type: "text" }], threadId: "thread-1" });
    expect(h.session.replying).toBe(true);
  });

  it("refuses a second message while the first is answered, then takes one once that turn completes", async () => {
    const h = await opened();
    await h.session.say({ messageId: "m-1", text: "one" });
    expect(await h.session.say({ messageId: "m-2", text: "two" })).toEqual({ kind: "refused", reason: STILL_REPLYING });
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    expect(h.session.replying).toBe(false);
    expect(await h.session.say({ messageId: "m-3", text: "three" })).toEqual({ kind: "accepted", turnId: "t-2" });
    expect(h.written.filter((m) => m["method"] === "turn/start").length).toBe(2);
  });

  it("answers a retried id with the first send's outcome and starts nothing more", async () => {
    const h = await opened();
    const first = await h.session.say({ messageId: "m-1", text: "one" });
    const again = await h.session.say({ messageId: "m-1", text: "one" });
    expect(again).toEqual(first);
    expect(h.written.filter((m) => m["method"] === "turn/start").length).toBe(1);
  });

  it("refuses blank text, writing nothing", async () => {
    const h = await opened();
    const before = h.written.length;
    expect(await h.session.say({ messageId: "m-1", text: "  \n" })).toEqual({
      kind: "refused",
      reason: "there is nothing to send",
    });
    expect(h.written.length).toBe(before);
  });

  it("is refused when the thread errors, holding nothing as running", async () => {
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) => `${JSON.stringify({ error: { code: -1, message: "busy" }, id })}\n`,
      },
    });
    const said = await h.session.say({ messageId: "m-1", text: "one" });
    expect(said.kind).toBe("refused");
    expect(h.session.replying).toBe(false);
  });

  it("is ambiguous when the thread answers with no turn id, and still answering until the hold passes", async () => {
    const h = await opened({ script: { ...PLAN_LOGIN, "turn/start": result({}) } });
    const said = await h.session.say({ messageId: "m-1", text: "one" });
    expect(said.kind).toBe("ambiguous");
    expect(h.session.replying).toBe(true);
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS - 1 });
    expect(h.session.replying).toBe(true);
    h.clock.advance({ ms: 1 });
    expect(h.session.replying).toBe(false);
  });

  it("holds a send of unknown fate by the thread's word once it says a turn started, then ended", async () => {
    const h = await opened({ script: { ...PLAN_LOGIN, "turn/start": result({}) } });
    await h.session.say({ messageId: "m-1", text: "one" });
    h.session.receive({ chunk: started({ turnId: "t-late" }) });
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS });
    expect(h.session.replying).toBe(true);
    h.session.receive({ chunk: completed({ turnId: "t-late" }) });
    expect(h.session.replying).toBe(false);
  });

  it("is accepted as the announced turn when the thread announced it before answering the start with an error", async () => {
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) =>
          `${started({ turnId: "t-1" })}${completed({ turnId: "t-1" })}${JSON.stringify({ error: { code: -1, message: "busy" }, id })}\n`,
      },
    });
    expect(await h.session.say({ messageId: "m-1", text: "one" })).toEqual({ kind: "accepted", turnId: "t-1" });
    expect(h.session.replying).toBe(false);
  });

  it("holds an errored send as maybe sent when the turn announced while it was out may be an earlier unsure send's", async () => {
    let starts = 0;
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) => {
          starts += 1;
          if (starts === 1) {
            return result({})({ id });
          }
          return `${started({ turnId: "t-a" })}${JSON.stringify({ error: { code: -1, message: "busy" }, id })}\n`;
        },
      },
    });
    expect((await h.session.say({ messageId: "m-a", text: "a" })).kind).toBe("ambiguous");
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS });
    expect(await h.session.say({ messageId: "m-b", text: "b" })).toEqual({
      kind: "ambiguous",
      reason: expect.stringContaining("the thread may have taken it") as string,
    });
    expect(h.session.replying).toBe(true);
    h.session.receive({ chunk: completed({ turnId: "t-a" }) });
    expect(h.session.replying).toBe(true);
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS });
    expect(h.session.replying).toBe(false);
  });

  it("names the announced turn when the start is answered with no turn id, still running until it completes", async () => {
    const h = await opened({
      script: { ...PLAN_LOGIN, "turn/start": ({ id }) => `${started({ turnId: "t-1" })}${result({})({ id })}` },
    });
    expect(await h.session.say({ messageId: "m-1", text: "one" })).toEqual({ kind: "accepted", turnId: "t-1" });
    expect(h.session.replying).toBe(true);
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    expect(h.session.replying).toBe(false);
  });

  it("never names a turn announced while a send was out as its own when an earlier unsure send was unheard of", async () => {
    let starts = 0;
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) => {
          starts += 1;
          if (starts === 1) {
            return result({})({ id });
          }
          return `${started({ turnId: "t-a" })}${result({})({ id })}`;
        },
      },
    });
    expect((await h.session.say({ messageId: "m-a", text: "a" })).kind).toBe("ambiguous");
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS });
    expect((await h.session.say({ messageId: "m-b", text: "b" })).kind).toBe("ambiguous");
    expect(h.session.replying).toBe(true);
    // The earlier send's turn ending says nothing of this one's, so the bounded hold still stands.
    h.session.receive({ chunk: completed({ turnId: "t-a" }) });
    expect(h.session.replying).toBe(true);
    h.session.receive({ chunk: started({ turnId: "t-b" }) });
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS });
    expect(h.session.replying).toBe(true);
    h.session.receive({ chunk: completed({ turnId: "t-b" }) });
    expect(h.session.replying).toBe(false);
  });

  it("holds an unknown send for the bounded hold even when an earlier send's turn started and ended while it was out", async () => {
    let starts = 0;
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) => {
          starts += 1;
          if (starts === 1) {
            return result({})({ id });
          }
          return `${started({ turnId: "t-a" })}${completed({ turnId: "t-a" })}${result({})({ id })}`;
        },
      },
    });
    await h.session.say({ messageId: "m-a", text: "a" });
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS });
    expect((await h.session.say({ messageId: "m-b", text: "b" })).kind).toBe("ambiguous");
    h.clock.advance({ ms: TYPED_UNSURE_HOLD_MS - 1 });
    expect(h.session.replying).toBe(true);
    h.clock.advance({ ms: 1 });
    expect(h.session.replying).toBe(false);
  });

  it("keeps a turn running when its completion is still in progress, even one reaching it before the start's answer", async () => {
    const inProgress = line({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { error: null, id: "t-1", items: [], status: "inProgress" } },
    });
    const h = await opened({
      script: { ...PLAN_LOGIN, "turn/start": ({ id }) => `${inProgress}${result({ turn: { id: "t-1" } })({ id })}` },
    });
    expect(await h.session.say({ messageId: "m-1", text: "one" })).toEqual({ kind: "accepted", turnId: "t-1" });
    expect(h.session.replying).toBe(true);
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    expect(h.session.replying).toBe(false);
  });

  it("refuses a resume, writing nothing: only the owner's own send starts a turn", async () => {
    const h = await opened();
    const before = h.written.length;
    expect(await h.session.resume()).toEqual({
      kind: "refused",
      reason: "a typed conversation has no voice to take its turn",
    });
    expect(h.written.length).toBe(before);
  });

  it("keeps an unknown send's hold through a late repeat of an earlier turn's completion", async () => {
    let turns = 0;
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) => {
          turns += 1;
          return result(turns === 1 ? { turn: { id: "t-1", status: "inProgress" } } : {})({ id });
        },
      },
    });
    expect(await h.session.say({ messageId: "m-1", text: "one" })).toEqual({ kind: "accepted", turnId: "t-1" });
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    expect((await h.session.say({ messageId: "m-2", text: "two" })).kind).toBe("ambiguous");
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    expect(h.session.replying).toBe(true);
  });

  it("is ambiguous, never refused, when the conversation ends before the thread answers the send", async () => {
    const h = await opened({ script: PLAN_LOGIN });
    const saying = h.session.say({ messageId: "m-1", text: "one" });
    h.session.stop({ reason: "the page left" });
    expect(await saying).toEqual({
      kind: "ambiguous",
      reason: expect.stringContaining("the thread may have taken it"),
    });
  });

  it("never holds a turn as running when its completion arrived before the answer to its start", async () => {
    const h = await opened({ script: PLAN_LOGIN });
    const saying = h.session.say({ messageId: "m-1", text: "one" });
    const startId = h.written.at(-1)!["id"] as number;
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    h.session.receive({ chunk: `${JSON.stringify({ id: startId, result: { turn: { id: "t-1" } } })}\n` });
    expect(await saying).toEqual({ kind: "accepted", turnId: "t-1" });
    expect(h.session.replying).toBe(false);
  });
});

describe("what the thread writes", () => {
  it("streams a message at most every WRITTEN_EVERY_MS on telemetry, then the whole message", async () => {
    const h = await opened();
    await h.session.say({ messageId: "m-1", text: "read it" });
    await settle();
    h.session.receive({ chunk: delta({ text: "The " }) });
    h.clock.advance({ ms: WRITTEN_EVERY_MS - 1 });
    h.session.receive({ chunk: delta({ text: "thread " }) });
    h.clock.advance({ ms: 1 });
    h.session.receive({ chunk: delta({ text: "says" }) });
    h.session.receive({
      chunk: line({
        method: "item/completed",
        params: {
          item: { id: "msg-1", text: "The thread says yes.", type: "agentMessage" },
          threadId: "thread-1",
          turnId: "t-1",
        },
      }),
    });
    expect(writtenOf({ seen: h.seen })).toEqual([
      { final: false, itemId: "msg-1", kind: "written", text: "The ", turnId: "t-1" },
      { final: false, itemId: "msg-1", kind: "written", text: "The thread says", turnId: "t-1" },
      { final: true, itemId: "msg-1", kind: "written", text: "The thread says yes.", turnId: "t-1" },
    ]);
  });

  it("writes a message whole once, however often its completion arrives, and drops a delta after it", async () => {
    const h = await opened();
    const whole = line({
      method: "item/completed",
      params: { item: { id: "msg-1", text: "Done.", type: "agentMessage" }, threadId: "thread-1", turnId: "t-1" },
    });
    h.session.receive({ chunk: whole });
    h.session.receive({ chunk: whole });
    h.session.receive({ chunk: delta({ text: "late" }) });
    expect(writtenOf({ seen: h.seen })).toEqual([
      { final: true, itemId: "msg-1", kind: "written", text: "Done.", turnId: "t-1" },
    ]);
  });

  it("ignores another thread's writing", async () => {
    const h = await opened();
    h.session.receive({ chunk: delta({ text: "not ours", threadId: "thread-9" }) });
    expect(writtenOf({ seen: h.seen })).toEqual([]);
  });

  it("replays a partial message to a page that attaches mid-answer", async () => {
    const h = await opened();
    h.session.receive({ chunk: delta({ text: "Hi" }) });
    const { replay } = h.session.subscribe({ after: 0, listener: () => undefined });
    expect(writtenOf({ seen: replay })).toEqual([
      { final: false, itemId: "msg-1", kind: "written", text: "Hi", turnId: "t-1" },
    ]);
  });
});

describe("what a voice has and a typed conversation does not", () => {
  it("refuses a nudge, a look and a look frame, writing nothing", async () => {
    const h = await opened();
    const before = h.written.length;
    expect(await h.session.nudge()).toEqual({ kind: "refused", reason: "a typed conversation has no voice to nudge" });
    expect((await h.session.sayLooking()).kind).toBe("refused");
    expect((await h.session.attachLook()).kind).toBe("refused");
    expect(h.written.length).toBe(before);
  });

  it("never has a voice say it is on it, nor sends a progress cue, however long a turn runs", async () => {
    const h = await opened();
    expect((await h.session.say({ messageId: "m-1", text: "hi" })).kind).toBe("accepted");
    h.session.receive({ chunk: started({ turnId: "t-1" }) });
    const before = h.written.length;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs + PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(h.written.slice(before)).toEqual([]);
    expect(h.seen.filter(({ event }) => event.kind === "progress")).toEqual([]);
  });

  it("is never told to roll over in a quiet floor, and meets the ceiling as it always did", async () => {
    const h = await opened();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs + PLAN_CALL_LIMITS.rolloverQuietMs * 2 });
    expect(h.seen.map(({ event }) => event.kind)).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lifetimeMs });
    expect(h.seen.map(({ event }) => event)).toEqual([{ kind: "closed", reason: LIFETIME_REASON }]);
  });

  it("is never told to roll over as the cut nears, in the urgent or the last stage", async () => {
    const h = await opened();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lifetimeMs - PLAN_CALL_LIMITS.rolloverUrgentMs });
    expect(h.seen.map(({ event }) => event.kind)).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverUrgentMs - PLAN_CALL_LIMITS.rolloverLastMs });
    expect(h.seen.map(({ event }) => event.kind)).toEqual([]);
  });

  it("is never told to roll over when its thread's context fills either", async () => {
    const h = await opened();
    const last = {
      cachedInputTokens: 0,
      inputTokens: 258_000,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 258_000,
    };
    const tokenUsage = { last, modelContextWindow: 258_400, total: last };
    h.session.receive({
      chunk: line({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", tokenUsage, turnId: "t-1" } }),
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverQuietMs * 4 });
    expect(h.seen.map(({ event }) => event.kind)).toEqual(["usage"]);
  });

  it("stops once, killing the child and closing with the reason", async () => {
    const h = await opened();
    h.session.stop({ reason: "a newer typed conversation replaced it" });
    h.session.stop({ reason: "again" });
    expect(h.kills.count).toBe(1);
    expect(h.seen.at(-1)!.event).toEqual({ kind: "closed", reason: "a newer typed conversation replaced it" });
  });
});

/** The fixed running-list notice, as the owner's next message carries it ahead of their words. */
const NOTICE = { text: "the owner put something in the running list; read it with running_list", type: "text" };

describe("TypedPlanSession.notifyRunningListChanged", () => {
  it("writes nothing when told, and the owner's next message carries the fixed notice ahead of their words, once", async () => {
    const h = await opened();
    const before = h.written.length;
    expect(await h.session.notifyRunningListChanged()).toBe(undefined);
    expect(h.written.length).toBe(before);
    await h.session.say({ messageId: "m-1", text: "what did I just add?" });
    expect(h.written.at(-1)!["params"]).toEqual({
      input: [NOTICE, { text: "what did I just add?", type: "text" }],
      threadId: "thread-1",
    });
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    await h.session.say({ messageId: "m-2", text: "thanks" });
    expect(h.written.at(-1)!["params"]).toEqual({ input: [{ text: "thanks", type: "text" }], threadId: "thread-1" });
  });

  it("is safe while a reply is in flight: nothing is written into it, and the next message carries one notice", async () => {
    const h = await opened();
    await h.session.say({ messageId: "m-1", text: "one" });
    expect(h.session.replying).toBe(true);
    const before = h.written.length;
    expect([await h.session.notifyRunningListChanged(), await h.session.notifyRunningListChanged()]).toEqual([
      undefined,
      undefined,
    ]);
    expect(h.written.length).toBe(before);
    h.session.receive({ chunk: completed({ turnId: "t-1" }) });
    await h.session.say({ messageId: "m-2", text: "two" });
    expect(h.written.at(-1)!["params"]).toEqual({
      input: [NOTICE, { text: "two", type: "text" }],
      threadId: "thread-1",
    });
  });

  it("keeps the notice for the message after one the thread refused outright", async () => {
    let starts = 0;
    const h = await opened({
      script: {
        ...PLAN_LOGIN,
        "turn/start": ({ id }) => {
          starts += 1;
          if (starts === 1) {
            return `${JSON.stringify({ error: { code: -1, message: "busy" }, id })}\n`;
          }
          return result({ turn: { id: "t-2", status: "inProgress" } })({ id });
        },
      },
    });
    await h.session.notifyRunningListChanged();
    expect((await h.session.say({ messageId: "m-1", text: "one" })).kind).toBe("refused");
    expect(await h.session.say({ messageId: "m-2", text: "two" })).toEqual({ kind: "accepted", turnId: "t-2" });
    expect(h.written.at(-1)!["params"]).toEqual({
      input: [NOTICE, { text: "two", type: "text" }],
      threadId: "thread-1",
    });
  });

  it("refuses before the thread opens and after it ends, writing nothing", async () => {
    const unopened = harness({ script: accepting() });
    expect(await unopened.session.notifyRunningListChanged()).toBe("the typed conversation has not opened yet");
    expect(unopened.written).toEqual([]);
    const h = await opened();
    h.session.stop({ reason: "the owner closed it" });
    const before = h.written.length;
    expect(await h.session.notifyRunningListChanged()).toBe("the typed conversation has ended: the owner closed it");
    expect(h.written.length).toBe(before);
  });
});
