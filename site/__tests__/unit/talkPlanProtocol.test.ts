/*
 * The app-server wire, pure: each line classified exactly, a stream split exactly, and every shape the console
 * acts on — a tool call, a tool answer, a login, the verb's composition — refused when it is not the documented one.
 */
import { describe, expect, it } from "vitest";

import { pendingToolName } from "../../components/voice/talkToolCalls";
import {
  APP_SERVER_LINE_MAX_BYTES,
  decodeAppServerLine,
  LineBuffer,
  mayHaveBeenTaken,
  planAccountRefusal,
  planCompositionOf,
  rpcErrorLine,
  rpcRequestLine,
  rpcResultLine,
  threadIdOf,
} from "../../lib/talkPlanProtocol";
import { planContentItemsOf, planToolCallOf, threadTokenUsageOf } from "../../lib/talkPlanProtocolItems";
import {
  agentMessageOf,
  codexTurnOf,
  startedTurnIdOf,
  toolStepName,
  turnActivityOf,
} from "../../lib/talkPlanProtocolTurns";

// The page's own pending-tool row took plain "verb" while the Codex step named it.
describe("toolStepName", () => {
  it("names the verb an object-argument verb call runs, keeps another tool's own name, and says plain verb else", () => {
    expect([
      toolStepName({ args: { request: { noun: "slack", verb: "unread" } }, tool: "verb" }),
      toolStepName({ args: { request: { noun: "slack", verb: "unread" } }, tool: "browser_read" }),
      toolStepName({ args: '{"request":{"noun":"github","verb":"checks"}}', tool: "verb" }),
      toolStepName({ args: undefined, tool: "verb" }),
    ]).toEqual(["slopweaver slack unread", "browser_read", "verb", "verb"]);
  });

  // Measured: a JSON-string argument named the verb on one row and plain "verb" on the other.
  it("gives the Codex step and the pending-tool row the same name, object or string arguments alike", () => {
    const params = { callId: "c1", threadId: "thread-1", tool: "verb", turnId: "u1" };
    const rowsFor: (args: unknown) => readonly string[] = (args) => {
      const notice = turnActivityOf({
        method: "item/started",
        params: {
          item: { arguments: args, id: "i-1", tool: "verb", type: "dynamicToolCall" },
          threadId: "thread-1",
          turnId: "u1",
        },
      });
      const call = planToolCallOf({ params: { ...params, arguments: args } })!;
      const pending = pendingToolName({ rawArguments: call.arguments, tool: call.tool });
      return [JSON.stringify(notice), pending];
    };
    const started = '{"itemId":"i-1","phase":"started","step":{"kind":"tool","name":';
    expect([
      rowsFor({ request: { noun: "github", verb: "checks" } }),
      rowsFor('{"request":{"noun":"github","verb":"checks"}}'),
    ]).toEqual([
      [`${started}"slopweaver github checks"},"threadId":"thread-1","turnId":"u1"}`, "slopweaver github checks"],
      [`${started}"verb"},"threadId":"thread-1","turnId":"u1"}`, "verb"],
    ]);
  });
});

// A write the call ended under while in flight may have reached the voice, so its provenance is kept.
describe("mayHaveBeenTaken", () => {
  it("counts an answer, a timeout and an end in flight as taken, and a refusal or an end before the write as not", () => {
    const ended = { kind: "ended", reason: "the owner hung up" } as const;
    expect([
      mayHaveBeenTaken({ outcome: { kind: "result", result: {} }, wasLive: true }),
      mayHaveBeenTaken({ outcome: { kind: "timeout" }, wasLive: true }),
      mayHaveBeenTaken({ outcome: ended, wasLive: true }),
      mayHaveBeenTaken({ outcome: ended, wasLive: false }),
      mayHaveBeenTaken({ outcome: { kind: "error", message: "refused" }, wasLive: true }),
    ]).toEqual([true, true, true, false, false]);
  });
});

// Measured on 0.157.1: a `turn/start` of typed text into the voice's own thread.
describe("agentMessageOf", () => {
  const at = { threadId: "thread-1", turnId: "t-1" };

  it("reads a delta", () => {
    expect(
      agentMessageOf({ method: "item/agentMessage/delta", params: { ...at, delta: "Hel", itemId: "msg-1" } }),
    ).toEqual({ ...at, delta: "Hel", itemId: "msg-1", kind: "delta" });
  });

  it("reads a completed agent message whole", () => {
    const item = { id: "msg-1", phase: "final_answer", text: "Hello.", type: "agentMessage" };
    expect(agentMessageOf({ method: "item/completed", params: { ...at, item } })).toEqual({
      ...at,
      commentary: false,
      itemId: "msg-1",
      kind: "completed",
      text: "Hello.",
    });
  });

  it("says a commentary message is one, so the call can drop it behind its turn's answer", () => {
    const item = { id: "msg-2", phase: "commentary", text: "Checking.", type: "agentMessage" };
    expect(agentMessageOf({ method: "item/completed", params: { ...at, item } })).toEqual({
      ...at,
      commentary: true,
      itemId: "msg-2",
      kind: "completed",
      text: "Checking.",
    });
  });

  it("is not one for any other item completing, or a delta missing what the page reads", () => {
    const reasoning = { id: "r-1", type: "reasoning" };
    expect(agentMessageOf({ method: "item/completed", params: { ...at, item: reasoning } })).toBeUndefined();
    expect(agentMessageOf({ method: "item/agentMessage/delta", params: { ...at, delta: "x" } })).toBeUndefined();
    expect(agentMessageOf({ method: "item/agentMessage/delta", params: { delta: "x", itemId: "m" } })).toBeUndefined();
    expect(agentMessageOf({ method: "turn/started", params: { ...at, delta: "x", itemId: "m" } })).toBeUndefined();
  });
});

describe("startedTurnIdOf", () => {
  it("reads the turn a turn/start answered with", () => {
    expect(startedTurnIdOf({ result: { turn: { id: "t-7", status: "inProgress" } } })).toBe("t-7");
  });

  it("is undefined when the answer names no turn", () => {
    expect(startedTurnIdOf({ result: {} })).toBeUndefined();
    expect(startedTurnIdOf({ result: { turn: { id: "" } } })).toBeUndefined();
    expect(startedTurnIdOf({ result: null })).toBeUndefined();
  });
});

describe("codexTurnOf", () => {
  const turn = { error: null, id: "t-1", items: [], status: "inProgress" };

  it("reads a turn's start and a failed end with its own message", () => {
    expect(codexTurnOf({ params: { threadId: "thread-1", turn } })).toEqual({
      failure: null,
      status: "inProgress",
      threadId: "thread-1",
      turnId: "t-1",
    });
    const failed = { ...turn, error: { additionalDetails: null, message: "usage limit reached" }, status: "failed" };
    expect(codexTurnOf({ params: { threadId: "thread-1", turn: failed } })).toEqual({
      failure: "usage limit reached",
      status: "failed",
      threadId: "thread-1",
      turnId: "t-1",
    });
  });

  it("refuses an unknown status, an empty or overlong turn id, and params that are not a turn", () => {
    expect(codexTurnOf({ params: { threadId: "thread-1", turn: { ...turn, status: "stalled" } } })).toBe(undefined);
    expect(codexTurnOf({ params: { threadId: "thread-1", turn: { ...turn, id: "" } } })).toBe(undefined);
    expect(codexTurnOf({ params: { threadId: "thread-1", turn: { ...turn, id: "x".repeat(201) } } })).toBe(undefined);
    expect(codexTurnOf({ params: { turn } })).toBe(undefined);
    expect(codexTurnOf({ params: "not params" })).toBe(undefined);
  });
});

describe("turnActivityOf", () => {
  const params = { threadId: "thread-1", turnId: "t-1" };

  const startOf = (item: unknown) => turnActivityOf({ method: "item/started", params: { ...params, item } });
  /** The notice an item with no id starting is read as, naming `step`. */
  const started = (step: unknown) => ({ ...params, itemId: undefined, phase: "started", step });

  it("names the step a starting item is, from its type", () => {
    expect([
      startOf({ type: "reasoning" }),
      startOf({ type: "agentMessage" }),
      startOf({ tool: "relay_steer", type: "dynamicToolCall" }),
      startOf({ tool: "search_docs", type: "mcpToolCall" }),
      startOf({ type: "webSearch" }),
      startOf({ type: "commandExecution" }),
      startOf({ type: "contextCompaction" }),
      startOf("not an item"),
    ]).toEqual([
      started({ kind: "reasoning" }),
      started({ kind: "writing" }),
      started({ kind: "tool", name: "relay_steer" }),
      started({ kind: "tool", name: "search_docs" }),
      started({ kind: "tool", name: "web search" }),
      started({ kind: "tool", name: "a command" }),
      started({ kind: "compacting" }),
      started({ kind: "working" }),
    ]);
  });

  // Items overlap, so a completion names WHICH item ended; what the turn is on after it is the call's to say.
  it("reads an item's start and completion with that item's id, and an empty id as none", () => {
    const item = { id: "d-1", tool: "read_card", type: "dynamicToolCall" };
    expect([
      startOf(item),
      turnActivityOf({ method: "item/completed", params: { ...params, item } }),
      turnActivityOf({ method: "item/completed", params: { ...params, item: { ...item, id: "" } } }),
      turnActivityOf({ method: "thread/compacted", params }),
    ]).toEqual([
      { ...params, itemId: "d-1", phase: "started", step: { kind: "tool", name: "read_card" } },
      { ...params, itemId: "d-1", phase: "completed" },
      { ...params, itemId: undefined, phase: "completed" },
      undefined,
    ]);
  });

  // The owner's words, a steer included, are no step of the model's: neither their start nor their end moves the wait.
  it("reads the owner's own message item, starting or completing, as progress", () => {
    const item = { id: "u-1", type: "userMessage" };
    expect([startOf(item), turnActivityOf({ method: "item/completed", params: { ...params, item } })]).toEqual([
      { ...params, phase: "progress" },
      { ...params, phase: "progress" },
    ]);
  });

  // A bare "ran a verb" says nothing when there are a thousand verbs, so the row names which one.
  it("names the verb a verb call runs from object arguments, and plain verb from a string or none", () => {
    expect([
      startOf({ arguments: { request: { noun: "cmux", verb: "list" } }, tool: "verb", type: "dynamicToolCall" }),
      startOf({ arguments: '{"request":{"noun":"github","verb":"checks"}}', tool: "verb", type: "dynamicToolCall" }),
      startOf({ arguments: { request: { noun: "cmux" } }, tool: "verb", type: "dynamicToolCall" }),
      startOf({ arguments: "{not json", tool: "verb", type: "dynamicToolCall" }),
    ]).toEqual([
      started({ kind: "tool", name: "slopweaver cmux list" }),
      started({ kind: "tool", name: "verb" }),
      started({ kind: "tool", name: "verb" }),
      started({ kind: "tool", name: "verb" }),
    ]);
  });

  // A message half written keeps saying it is writing: a delta is no model boundary.
  it("reads a delta as progress", () => {
    expect(turnActivityOf({ method: "item/agentMessage/delta", params })).toEqual({ ...params, phase: "progress" });
  });

  it("ignores a notification that is not an item's, or names no turn", () => {
    expect(turnActivityOf({ method: "thread/tokenUsage/updated", params })).toBe(undefined);
    expect(turnActivityOf({ method: "item/completed", params: { threadId: "thread-1" } })).toBe(undefined);
  });
});

describe("threadTokenUsageOf", () => {
  const last = { cachedInputTokens: 30, inputTokens: 41, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 44 };
  const total = { ...last, cacheWriteInputTokens: 0, inputTokens: 118, totalTokens: 121 };
  const params = { threadId: "thread-1", tokenUsage: { last, modelContextWindow: 272_000, total }, turnId: "u1" };

  it("reads the turn's counts, the running total and the window, keeping an absent cache-write count absent", () => {
    const usage = threadTokenUsageOf({ params })!;
    expect(usage).toEqual({ contextWindow: 272_000, last, threadId: "thread-1", total, turnId: "u1" });
    expect("cacheWriteInputTokens" in usage.last).toBe(false);
    expect(usage.total.cacheWriteInputTokens).toBe(0);
  });

  it("reads a null window as unknown, and a missing one as unreadable", () => {
    const unknown = { ...params, tokenUsage: { last, modelContextWindow: null, total } };
    expect(threadTokenUsageOf({ params: unknown })!.contextWindow).toBe(null);
    expect(threadTokenUsageOf({ params: { ...params, tokenUsage: { last, total } } })).toBe(undefined);
  });

  it("refuses a negative, fractional, unsafe or string count, and a missing turn — never a partly filled usage", () => {
    const withCounts = (over: Record<string, unknown>) => ({
      ...params,
      tokenUsage: { last: { ...last, ...over }, modelContextWindow: 272_000, total },
    });
    expect(threadTokenUsageOf({ params: withCounts({ inputTokens: -1 }) })).toBe(undefined);
    expect(threadTokenUsageOf({ params: withCounts({ outputTokens: 2.5 }) })).toBe(undefined);
    expect(threadTokenUsageOf({ params: withCounts({ totalTokens: 2 ** 60 }) })).toBe(undefined);
    expect(threadTokenUsageOf({ params: withCounts({ cachedInputTokens: "30" }) })).toBe(undefined);
    expect(threadTokenUsageOf({ params: withCounts({ cacheWriteInputTokens: -2 }) })).toBe(undefined);
    expect(threadTokenUsageOf({ params: { ...params, turnId: "" } })).toBe(undefined);
    expect(threadTokenUsageOf({ params: "not params" })).toBe(undefined);
  });
});

describe("decodeAppServerLine", () => {
  it("classifies a response, an error, a server request and a notification", () => {
    expect(decodeAppServerLine({ line: '{"id":1,"result":{}}' })).toEqual({
      inbound: { id: 1, kind: "response", result: {} },
    });
    expect(decodeAppServerLine({ line: '{"id":2,"error":{"code":-1,"message":"usage limit"}}' })).toEqual({
      inbound: { id: 2, kind: "response-error", message: "usage limit" },
    });
    expect(decodeAppServerLine({ line: '{"id":"s1","method":"item/tool/call","params":{"a":1}}' })).toEqual({
      inbound: { id: "s1", kind: "request", method: "item/tool/call", params: { a: 1 } },
    });
    expect(decodeAppServerLine({ line: '{"method":"thread/realtime/sdp","params":{"sdp":"v=0"}}' })).toEqual({
      inbound: { kind: "notification", method: "thread/realtime/sdp", params: { sdp: "v=0" } },
    });
  });

  it("refuses a response carrying both a result and an error, or neither", () => {
    expect(decodeAppServerLine({ line: '{"id":3,"result":{},"error":{"message":"x"}}' })).toEqual({
      refused: "the app-server answered 3 with both a result and an error",
    });
    expect(decodeAppServerLine({ line: '{"id":3}' })).toEqual({
      refused: "the app-server answered 3 with neither a result nor an error",
    });
  });

  it("refuses what is not a JSON-RPC message", () => {
    expect(decodeAppServerLine({ line: "panic: boom" })).toEqual({
      refused: "the app-server wrote a line that is not JSON, beginning `panic: boom`",
    });
    expect(decodeAppServerLine({ line: "[1]" })).toEqual({
      refused: "the app-server wrote JSON that is not an object",
    });
    expect(decodeAppServerLine({ line: "{}" })).toEqual({
      refused: "the app-server wrote a message with neither an id nor a method",
    });
  });
});

describe("LineBuffer", () => {
  it("holds a partial line across chunks and strips CR", () => {
    const buffer = new LineBuffer();
    expect(buffer.push({ chunk: '{"a":' })).toEqual({ lines: [] });
    expect(buffer.push({ chunk: '1}\r\n\n{"b":2}\n{"c"' })).toEqual({ lines: ['{"a":1}', '{"b":2}'] });
    expect(buffer.push({ chunk: ":3}\n" })).toEqual({ lines: ['{"c":3}'] });
  });

  it("refuses a line that outgrows the cap rather than buffering it", () => {
    const buffer = new LineBuffer();
    expect(buffer.push({ chunk: "x".repeat(APP_SERVER_LINE_MAX_BYTES + 1) })).toEqual({
      overflow: APP_SERVER_LINE_MAX_BYTES + 1,
    });
  });
});

describe("the encoders", () => {
  it("write one newline-terminated JSON-RPC line each", () => {
    expect(rpcRequestLine({ id: 4, method: "account/read", params: { refreshToken: false } })).toBe(
      '{"id":4,"method":"account/read","params":{"refreshToken":false}}\n',
    );
    expect(rpcResultLine({ id: "s1", result: { success: true } })).toBe('{"id":"s1","result":{"success":true}}\n');
    expect(rpcErrorLine({ id: 9, message: "no" })).toBe('{"error":{"code":-32601,"message":"no"},"id":9}\n');
  });
});

describe("planToolCallOf", () => {
  it("re-serialises object arguments into the JSON string the page's executor parses", () => {
    expect(
      planToolCallOf({
        params: { arguments: { query: "x" }, callId: "c1", namespace: null, threadId: "t-1", tool: "search_corpus" },
      }),
    ).toEqual({ arguments: '{"query":"x"}', callId: "c1", threadId: "t-1", tool: "search_corpus" });
  });

  it("reads absent arguments as an empty object, and refuses a call with no id or no thread", () => {
    expect(planToolCallOf({ params: { arguments: null, callId: "c2", threadId: "t-1", tool: "read_page" } })).toEqual({
      arguments: "{}",
      callId: "c2",
      threadId: "t-1",
      tool: "read_page",
    });
    expect(planToolCallOf({ params: { threadId: "t-1", tool: "read_page" } })).toBe(undefined);
    expect(planToolCallOf({ params: { callId: "c3", tool: "read_page" } })).toBe(undefined);
  });

  // The app-server's DynamicToolCallParams requires turnId; a triage ruling is bound to the card by it.
  it("carries the turn the call was made in, leaves it undefined from a server naming none, and refuses one off type", () => {
    const params = { arguments: {}, callId: "c4", threadId: "t-1", tool: "triage_next" };
    expect(planToolCallOf({ params: { ...params, turnId: "turn-9" } })!.turnId).toBe("turn-9");
    expect(Object.hasOwn(planToolCallOf({ params })!, "turnId")).toBe(true);
    expect(planToolCallOf({ params })!.turnId).toBe(undefined);
    expect(planToolCallOf({ params: { ...params, turnId: 9 } })).toBe(undefined);
  });
});

describe("planContentItemsOf", () => {
  it("passes text and a data-URL image through", () => {
    const items = [
      { text: "frame", type: "inputText" },
      { imageUrl: "data:image/jpeg;base64,AAAA", type: "inputImage" },
    ];
    expect(planContentItemsOf({ value: items })).toEqual(items);
  });

  it("refuses an empty list, a remote image and an unknown item", () => {
    expect(planContentItemsOf({ value: [] })).toBe(undefined);
    expect(planContentItemsOf({ value: [{ imageUrl: "https://x/y.png", type: "inputImage" }] })).toBe(undefined);
    expect(planContentItemsOf({ value: [{ audioUrl: "data:audio/wav;base64,AA", type: "inputAudio" }] })).toBe(
      undefined,
    );
  });
});

describe("planAccountRefusal", () => {
  it("accepts a ChatGPT login and names anything else", () => {
    expect(planAccountRefusal({ result: { account: { email: "e", planType: "pro", type: "chatgpt" } } })).toBe(
      undefined,
    );
    expect(planAccountRefusal({ result: { account: { type: "apiKey" } } })).toBe(
      "Codex is signed in with apiKey, not a ChatGPT plan",
    );
    expect(planAccountRefusal({ result: { account: null, requiresOpenaiAuth: true } })).toBe(
      "Codex is not signed in: run `codex login` with the owner's ChatGPT account",
    );
  });
});

describe("threadIdOf", () => {
  it("reads thread.id", () => {
    expect(threadIdOf({ result: { model: "m", thread: { id: "t-1" } } })).toBe("t-1");
    expect(threadIdOf({ result: {} })).toBe(undefined);
  });
});

/** A report shaped exactly as `talk offer --json` prints one. */
const REPORT = {
  appServer: {
    argv: ["app-server", "--strict-config"],
    codexHome: "/stores/codex-one",
    executable: "/vendored/codex",
    planAlias: "codex-one",
    unsetEnv: ["OPENAI_API_KEY"],
  },
  backendModel: "gpt-6-astra",
  continuity: { opener: "x" },
  model: "realtime-v3",
  pack: { leftOut: [] },
  realtime: { version: "v3", voice: "sol" },
  thread: { ephemeral: true },
  tools: ["read_page", "relay_steer"],
  voice: "sol",
  writers: ["relay_steer"],
};

/** What {@link REPORT} composes into, carrying no reopen reminder. */
const COMPOSED = {
  argv: ["app-server", "--strict-config"],
  backendModel: "gpt-6-astra",
  codexHome: "/stores/codex-one",
  continuity: { opener: "x" },
  executable: "/vendored/codex",
  model: "realtime-v3",
  pack: { leftOut: [] },
  planAlias: "codex-one",
  realtime: { version: "v3", voice: "sol" },
  reopenReminder: null,
  thread: { ephemeral: true },
  tools: ["read_page", "relay_steer"],
  unsetEnv: ["OPENAI_API_KEY"],
  voice: "sol",
  writers: ["relay_steer"],
};

describe("planCompositionOf", () => {
  it("reads the verb's plan report", () => {
    expect(planCompositionOf({ out: JSON.stringify(REPORT) })).toEqual({ composition: COMPOSED });
  });

  // A call the owner reopens within the minute carries the reminder the window hands the voice.
  it("reads a reopen reminder, null or absent as none, and refuses one missing a field", () => {
    const reminder = {
      previousCallId: "call-0",
      previousEndedIso: "2026-11-06T01:10:00.000Z",
      text: "Remind the owner.",
    };
    expect(planCompositionOf({ out: JSON.stringify({ ...REPORT, reopenReminder: reminder }) })).toEqual({
      composition: { ...COMPOSED, reopenReminder: reminder },
    });
    expect(planCompositionOf({ out: JSON.stringify({ ...REPORT, reopenReminder: null }) })).toEqual({
      composition: COMPOSED,
    });
    const refused = { refused: "talk offer's report carries no well-formed reopen reminder" };
    expect([
      planCompositionOf({ out: JSON.stringify({ ...REPORT, reopenReminder: { ...reminder, text: "" } }) }),
      planCompositionOf({ out: JSON.stringify({ ...REPORT, reopenReminder: { ...reminder, previousCallId: 7 } }) }),
      planCompositionOf({ out: JSON.stringify({ ...REPORT, reopenReminder: "remind the owner" }) }),
    ]).toEqual([refused, refused, refused]);
  });

  it("refuses a report that is not an object, one with no launch, and one with no writers", () => {
    expect(planCompositionOf({ out: JSON.stringify(["not", "a", "report"]) })).toEqual({
      refused: "talk offer printed a report that is not a plan composition",
    });
    expect(planCompositionOf({ out: JSON.stringify({ ...REPORT, appServer: {} }) })).toEqual({
      refused: "talk offer's report carries no app-server launch",
    });
    expect(planCompositionOf({ out: JSON.stringify({ ...REPORT, writers: undefined }) })).toEqual({
      refused: "talk offer's report carries no tool names",
    });
  });

  // A report naming no routed home would launch on the ambient login — the plan the owner may have paused or capped.
  it("refuses a launch naming no routed plan home or alias, or an empty one", () => {
    const withLaunch = (appServer: Record<string, unknown>): string =>
      JSON.stringify({ ...REPORT, appServer: { ...REPORT.appServer, ...appServer } });
    const refused = { refused: "talk offer's report carries no routed plan home" };
    expect([
      planCompositionOf({ out: withLaunch({ codexHome: undefined }) }),
      planCompositionOf({ out: withLaunch({ codexHome: "" }) }),
      planCompositionOf({ out: withLaunch({ planAlias: undefined }) }),
      planCompositionOf({ out: withLaunch({ planAlias: 7 }) }),
    ]).toEqual([refused, refused, refused, refused]);
  });
});
