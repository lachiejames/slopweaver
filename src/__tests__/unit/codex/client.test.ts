import { describe, expect, it } from "vitest";
import { admittedCodexClient } from "../../../codex/admittedClient.js";
import {
  type CodexSdkPort,
  type CodexSdkStreamEvent,
  type CodexSdkThread,
  makeLockedCodexClient,
} from "../../../codex/client.js";
import { CODEX_MODEL, CODEX_REASONING_EFFORT } from "../../../codex/profiles.js";
import type { CodexUsage } from "../../../codex/types.js";
import { err, ok } from "../../../lib/result.js";
import { assertInstanceOf } from "../../assertInstanceOf.js";

/**
 * A capturing fake SDK. Records the EXACT options object handed to it, which is what lets these tests
 * assert the safety policy rather than merely trusting the wrapper's comments.
 *
 * A plain class, deliberately — `vi.mock`/`vi.fn`/`vi.spyOn` are lint-banned in this repo.
 */
class CapturingSdk implements CodexSdkPort {
  readonly startCalls: Record<string, unknown>[] = [];
  readonly resumeCalls: { threadId: string; options: Record<string, unknown> }[] = [];

  private readonly turn: CodexSdkThread;

  constructor(turn: CodexSdkThread) {
    this.turn = turn;
  }

  startThread(options: Record<string, unknown>): CodexSdkThread {
    this.startCalls.push(options);
    return this.turn;
  }

  // named-object-params-exempt: implements CodexSdkPort, which mirrors the SDK's resumeThread(id, options)
  resumeThread(threadId: string, options: Record<string, unknown>): CodexSdkThread {
    this.resumeCalls.push({ options, threadId });
    return this.turn;
  }
}

/** Replay a fixed event sequence as the SDK's stream would. */
async function* replay({ events }: { events: readonly CodexSdkStreamEvent[] }): AsyncGenerator<CodexSdkStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

/** A thread that streams one turn: the given items, then a `turn.completed` carrying the usage. */
function fixedThread({
  usage,
  items,
  finalText = "{}",
}: {
  usage: CodexUsage | null;
  items: readonly { readonly type: string }[];
  finalText?: string;
}): CodexSdkThread {
  // The caller's items are the whole truth — the counts they assert must not be inflated by this helper.
  // `finalText` rides on the LAST agent_message among them; one is added only when they supplied none.
  const lastMessage = items.map((item) => item.type).lastIndexOf("agent_message");
  const supplied = items.map((item, index) =>
    index === lastMessage
      ? ({ item: { text: finalText, type: item.type }, type: "item.completed" } satisfies CodexSdkStreamEvent)
      : ({ item: { type: item.type }, type: "item.completed" } satisfies CodexSdkStreamEvent),
  );
  const events: CodexSdkStreamEvent[] = [
    { thread_id: "thread-1", type: "thread.started" },
    ...supplied,
    ...(lastMessage === -1
      ? [{ item: { text: finalText, type: "agent_message" }, type: "item.completed" } satisfies CodexSdkStreamEvent]
      : []),
    ...(usage === null ? [] : [{ type: "turn.completed", usage } satisfies CodexSdkStreamEvent]),
  ];
  return { id: "thread-1", runStreamed: async () => ({ events: replay({ events }) }) };
}

const FIVE_FIELD_USAGE: CodexUsage = {
  cache_write_input_tokens: 3,
  cached_input_tokens: 2,
  input_tokens: 1,
  output_tokens: 4,
  reasoning_output_tokens: 5,
};

/** Every option the locked policy must set, with the exact value it must set it to. */
const LOCKED_OPTIONS = {
  additionalDirectories: [],
  approvalPolicy: "never",
  model: CODEX_MODEL,
  modelReasoningEffort: CODEX_REASONING_EFFORT,
  networkAccessEnabled: true,
  sandboxMode: "workspace-write",
  skipGitRepoCheck: true,
  // Added to `ThreadOptions` by @openai/codex-sdk 0.151.0. It is a classification, not a control — the SDK
  // forwards it as `--thread-source` on first creation — but it is stated rather than omitted for the same
  // reason as every line here: an absent option inherits from `~/.codex/config.toml`.
  threadSource: "slopweaver",
  webSearchEnabled: true,
  webSearchMode: "live",
  workingDirectory: "/repo",
};

describe("the locked policy", () => {
  it("hands the SDK the EXACT closed options object on startThread", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/repo" });
    expect(sdk.startCalls).toHaveLength(1);
    expect(sdk.startCalls[0]).toEqual(LOCKED_OPTIONS);
  });

  it("hands the SDK the SAME closed options on resumeThread — the predecessor's sharpest edge", () => {
    // The old CLI transport REJECTED --sandbox on `exec resume`, so dropping it there silently ran every
    // steered turn under the machine's own config. This asserts resume is not a weaker path than start.
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).resumeThread({ threadId: "t9", workingDirectory: "/repo" });
    expect(sdk.resumeCalls).toHaveLength(1);
    expect(sdk.resumeCalls[0]!.threadId).toBe("t9");
    expect(sdk.resumeCalls[0]!.options).toEqual(LOCKED_OPTIONS);
  });

  it("sets sandboxMode to workspace-write on both paths", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    const client = makeLockedCodexClient({ sdk });
    client.startThread({ workingDirectory: "/a" });
    client.resumeThread({ threadId: "t", workingDirectory: "/a" });
    expect(sdk.startCalls[0]!["sandboxMode"]).toBe("workspace-write");
    expect(sdk.resumeCalls[0]!.options["sandboxMode"]).toBe("workspace-write");
  });

  it("sets approvalPolicy to never — measured to be what actually blocks an MCP tool dispatch", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    expect(sdk.startCalls[0]!["approvalPolicy"]).toBe("never");
  });

  it("enables network and LIVE web search — a brain that cannot look anything up is a worse brain", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    expect(sdk.startCalls[0]!["networkAccessEnabled"]).toBe(true);
    expect(sdk.startCalls[0]!["webSearchEnabled"]).toBe(true);
    expect(sdk.startCalls[0]!["webSearchMode"]).toBe("live");
  });

  /**
   * The single most important assertion in this file. `sandboxMode` is `workspace-write`, so writes are
   * allowed — and the ONLY thing keeping them out of the repository is that the repository is neither the
   * working directory nor an additional directory. An entry here would silently hand back that write access.
   */
  it("grants NO additional writable directories — this is what keeps the repo unwritable", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/scratch/pass-1" });
    expect(sdk.startCalls[0]!["additionalDirectories"]).toEqual([]);
    expect(sdk.startCalls[0]!["workingDirectory"]).toBe("/scratch/pass-1");
  });

  // LITERALS on purpose, on BOTH paths. `LOCKED_OPTIONS` above reads the same two constants the production
  // code does, so it cannot tell a correct pin from a reverted one — only a spelled-out value can, and
  // resume needs its own because it is the path the predecessor silently weakened.
  it("pins the model as well as the effort on start — an effort alone would let a config default drift", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    expect(sdk.startCalls[0]!["model"]).toBe("gpt-5.6-sol");
    expect(sdk.startCalls[0]!["modelReasoningEffort"]).toBe("medium");
  });

  it("pins the same model and effort on resume, spelled out rather than derived", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    makeLockedCodexClient({ sdk }).resumeThread({ threadId: "t1", workingDirectory: "/a" });
    expect(sdk.resumeCalls[0]!.options["model"]).toBe("gpt-5.6-sol");
    expect(sdk.resumeCalls[0]!.options["modelReasoningEffort"]).toBe("medium");
  });

  // The per-pass override (an owner ruling): a pass that names a model gets it on BOTH paths, and the
  // client says which one it carries so the artifact can disclose it without retyping it.
  it("carries a per-pass model override onto start and resume, and reports it as the client model", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    const client = makeLockedCodexClient({ model: "gpt-6-astra", sdk });
    client.startThread({ workingDirectory: "/a" });
    client.resumeThread({ threadId: "t1", workingDirectory: "/a" });
    expect(client.model).toBe("gpt-6-astra");
    expect(sdk.startCalls[0]!["model"]).toBe("gpt-6-astra");
    expect(sdk.resumeCalls[0]!.options["model"]).toBe("gpt-6-astra");
    expect(sdk.resumeCalls[0]!.options["modelReasoningEffort"]).toBe("medium");
  });

  it("REFUSES a caller-supplied sandbox at compile time", () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: FIVE_FIELD_USAGE }));
    const client = makeLockedCodexClient({ sdk });
    client.startThread({
      // @ts-expect-error the seam accepts only workingDirectory — sandbox policy is closed and not a parameter
      sandboxMode: "danger-full-access",
      workingDirectory: "/a",
    });
    // If anyone later adds a sandbox parameter to the seam, the @ts-expect-error above becomes unused and
    // TypeScript fails the build. That is the regression alarm, not this assertion.
    expect(sdk.startCalls[0]!["sandboxMode"]).toBe("workspace-write");
  });
});

describe("mapping the SDK's turn onto honest observations", () => {
  it("passes all five usage counters through verbatim", async () => {
    const sdk = new CapturingSdk(fixedThread({ items: [{ type: "agent_message" }], usage: FIVE_FIELD_USAGE }));
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().usage).toEqual({ kind: "measured", usage: FIVE_FIELD_USAGE });
  });

  it("maps a null usage to NOT MEASURED, never to zeros", async () => {
    const sdk = new CapturingSdk(fixedThread({ items: [], usage: null }));
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result._unsafeUnwrap().usage).toEqual({ kind: "not-measured", reason: "sdk-reported-none" });
  });

  it("counts items by kind, and a measured empty set is `measured` with no counts", async () => {
    const sdk = new CapturingSdk(
      fixedThread({
        items: [{ type: "agent_message" }, { type: "reasoning" }, { type: "agent_message" }],
        usage: FIVE_FIELD_USAGE,
      }),
    );
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result._unsafeUnwrap().items).toEqual({
      counts: { agent_message: 2, reasoning: 1 },
      kind: "measured",
    });
  });

  it("labels a Codex throw with provider codex, so it is never mistaken for a Claude failure", async () => {
    const sdk: CodexSdkPort = {
      resumeThread: () => failingThread(),
      startThread: () => failingThread(),
    };
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().provider).toBe("codex");
    expect(result._unsafeUnwrapErr().kind).toBe("llm");
  });

  it("preserves an AbortError's identity through the boundary, so the bound can act on it", async () => {
    const sdk: CodexSdkPort = {
      resumeThread: () => abortingThread(),
      startThread: () => abortingThread(),
    };
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result.isErr()).toBe(true);
    const cause = result._unsafeUnwrapErr().cause;
    assertInstanceOf(cause, Error);
    expect(cause.name).toBe("AbortError");
  });
});

describe("a synchronous thread-creation failure (found by reviewing this diff)", () => {
  it("does not throw out of startThread — it returns a thread whose run reports the failure", async () => {
    const sdk: CodexSdkPort = {
      resumeThread: () => {
        throw new Error("resume refused");
      },
      startThread: () => {
        throw new Error("start refused");
      },
    };
    const client = makeLockedCodexClient({ sdk });
    // The creation itself must NOT throw: an escaping exception bypasses the attempt record entirely.
    const thread = client.startThread({ workingDirectory: "/a" });
    expect(thread.currentId()).toBe(null);
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().operation).toBe("codex.startThread");
    expect(result._unsafeUnwrapErr().provider).toBe("codex");
  });

  it("does the same for resumeThread, which is the path the warn point uses", async () => {
    const sdk: CodexSdkPort = {
      resumeThread: () => {
        throw new Error("resume refused");
      },
      startThread: () => fixedThread({ items: [], usage: FIVE_FIELD_USAGE }),
    };
    const thread = makeLockedCodexClient({ sdk }).resumeThread({ threadId: "t1", workingDirectory: "/a" });
    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().operation).toBe("codex.resumeThread");
  });
});

// The browser door's seat on a pass: every thread is admitted in the directory it would run in, and a
// refused one never reaches the SDK — it comes back poisoned, its run reporting the refusal.
describe("admittedCodexClient", () => {
  it("asks the gate with each thread's own directory, and only an admitted thread reaches the SDK", async () => {
    const started: string[] = [];
    const sdk: CodexSdkPort = {
      resumeThread: (_threadId, options) => {
        started.push(`resume ${options.workingDirectory}`);
        return fixedThread({ items: [], usage: FIVE_FIELD_USAGE });
      },
      startThread: (options) => {
        started.push(`start ${options.workingDirectory}`);
        return fixedThread({ items: [], usage: FIVE_FIELD_USAGE });
      },
    };
    const asked: string[] = [];
    const client = admittedCodexClient({
      admitThread: ({ workingDirectory }) => {
        asked.push(workingDirectory);
        return workingDirectory === "/refused" ? err("cua_repl would start") : ok(undefined);
      },
      client: makeLockedCodexClient({ sdk }),
    });

    client.startThread({ workingDirectory: "/scratch" });
    const refused = client.startThread({ workingDirectory: "/refused" });
    const refusedResume = client.resumeThread({ threadId: "t1", workingDirectory: "/refused" });
    const signal = new AbortController().signal;
    const startResult = await refused.run({ input: "p", outputSchema: {}, signal });
    const resumeResult = await refusedResume.run({ input: "p", outputSchema: {}, signal });

    expect(asked).toEqual(["/scratch", "/refused", "/refused"]);
    expect(started).toEqual(["start /scratch"]);
    expect(startResult._unsafeUnwrapErr().message).toBe("cua_repl would start");
    expect(startResult._unsafeUnwrapErr().operation).toBe("codex.startThread");
    expect(resumeResult._unsafeUnwrapErr().operation).toBe("codex.resumeThread");
  });
});

function failingThread(): CodexSdkThread {
  return {
    id: null,
    runStreamed: async () => {
      throw new Error("codex binary missing");
    },
  };
}

function abortingThread(): CodexSdkThread {
  return {
    id: "t1",
    runStreamed: async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    },
  };
}

/**
 * The stream reconstruction. `runStreamed` replaced the blocking `run`, so the completed turn is now
 * REBUILT from events rather than handed over — and a mistake here is the silent kind: a plausible verdict
 * assembled from the wrong parts. Each field is asserted against a stream that would expose a shortcut.
 */
describe("rebuilding a turn from the event stream", () => {
  it("takes the LAST agent_message as the final response, never the first", async () => {
    const sdk = new CapturingSdk({
      id: "t",
      runStreamed: async () => ({
        events: replay({
          events: [
            { item: { text: "a mid-turn thought", type: "agent_message" }, type: "item.completed" },
            { item: { text: '{"verdict":"CLEAN"}', type: "agent_message" }, type: "item.completed" },
            { type: "turn.completed", usage: FIVE_FIELD_USAGE },
          ],
        }),
      }),
    });
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });

    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result._unsafeUnwrap().finalResponse).toBe('{"verdict":"CLEAN"}');
  });

  it("reports usage as NOT MEASURED when the turn never completes — never as zero", async () => {
    const sdk = new CapturingSdk({
      id: "t",
      runStreamed: async () => ({
        events: replay({ events: [{ item: { text: "{}", type: "agent_message" }, type: "item.completed" }] }),
      }),
    });
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });

    const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
    expect(result._unsafeUnwrap().usage).toEqual({ kind: "not-measured", reason: "sdk-reported-none" });
  });

  it("reports activity NOT MEASURED when an item started and never completed", async () => {
    const run = async ({ events }: { events: readonly CodexSdkStreamEvent[] }): Promise<unknown> => {
      const sdk = new CapturingSdk({ id: "t", runStreamed: async () => ({ events: replay({ events }) }) });
      const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });
      const result = await thread.run({ input: "p", outputSchema: {}, signal: new AbortController().signal });
      return result._unsafeUnwrap().items;
    };
    const command = { command: "cat register.jsonl", type: "command_execution" };
    const answer = { item: { text: "{}", type: "agent_message" }, type: "item.completed" };
    const done = { type: "turn.completed", usage: FIVE_FIELD_USAGE };
    const started = { item: command, type: "item.started" };
    expect(await run({ events: [started, answer, done] })).toEqual({ kind: "not-measured", reason: "item-unfinished" });
    expect(await run({ events: [started, { item: command, type: "item.completed" }, answer, done] })).toEqual({
      counts: { agent_message: 1, command_execution: 1 },
      kind: "measured",
    });
  });

  it("emits an observed event per item, carrying the command and its exit code", async () => {
    const seen: string[] = [];
    const sdk = new CapturingSdk({
      id: "t",
      runStreamed: async () => ({
        events: replay({
          events: [
            { thread_id: "th-9", type: "thread.started" },
            { item: { command: "rg foo /elsewhere", exit_code: 2, type: "command_execution" }, type: "item.completed" },
            { item: { query: "codex sdk", type: "web_search" }, type: "item.completed" },
            { item: { text: "{}", type: "agent_message" }, type: "item.completed" },
            { type: "turn.completed", usage: FIVE_FIELD_USAGE },
          ],
        }),
      }),
    });
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });

    await thread.run({
      input: "p",
      onEvent: (event) => {
        seen.push(event.kind === "item" ? `item:${event.item.itemKind}` : event.kind);
      },
      outputSchema: {},
      signal: new AbortController().signal,
    });

    expect(seen).toEqual([
      "thread-started",
      "item:command_execution",
      "item:web_search",
      "item:agent_message",
      "turn-completed",
    ]);
  });

  it("surfaces the exit code, which is the tripwire's structured signal", async () => {
    const exits: (number | undefined)[] = [];
    const sdk = new CapturingSdk({
      id: "t",
      runStreamed: async () => ({
        events: replay({
          events: [
            { item: { command: "cat missing.md", exit_code: 1, type: "command_execution" }, type: "item.completed" },
            { item: { command: "cat found.md", exit_code: 0, type: "command_execution" }, type: "item.completed" },
            { item: { text: "{}", type: "agent_message" }, type: "item.completed" },
          ],
        }),
      }),
    });
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });

    await thread.run({
      input: "p",
      onEvent: (event) => {
        if (event.kind === "item" && event.item.itemKind === "command_execution") {
          exits.push(event.item.exitCode);
        }
      },
      outputSchema: {},
      signal: new AbortController().signal,
    });

    expect(exits).toEqual([1, 0]);
  });

  /**
   * A pass costs real money and up to an hour. A broken progress relay must not be able to destroy one, so
   * the adapter swallows anything the sink throws — the same rule `src/lib/progressRichEmitter.ts` applies to its sinks.
   */
  it("completes the turn even when the event sink throws on every event", async () => {
    const sdk = new CapturingSdk(fixedThread({ items: [{ type: "reasoning" }], usage: FIVE_FIELD_USAGE }));
    const thread = makeLockedCodexClient({ sdk }).startThread({ workingDirectory: "/a" });

    const result = await thread.run({
      input: "p",
      onEvent: () => {
        throw new Error("the relay is broken");
      },
      outputSchema: {},
      signal: new AbortController().signal,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().items).toEqual({
      counts: { agent_message: 1, reasoning: 1 },
      kind: "measured",
    });
  });
});
