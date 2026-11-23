/**
 * The two capture-time wrappers: `withQueueFile` appends the canonical mention JSON before the handler runs, and
 * `withCaptureReaction` reacts to the tag before the handler runs without ever stopping it.
 */
import { describe, expect, it } from "vitest";

import { withQueueFile } from "../../../../../../cli/commands/listen/capturingHandler.js";
import { emitOnly } from "../../../../../../cli/commands/listen/emit.js";
import { type CaptureReactionDeps, withCaptureReaction } from "../../../../../../cli/commands/listen/run.js";
import type { Mention, MentionHandler } from "../../../../../../live/listen/mention.js";

describe("withQueueFile and withCaptureReaction", () => {
  const MENTION: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  it("appends the canonical mention JSON to the queue path before calling the wrapped handler", async () => {
    const appended: { path: string; line: string }[] = [];
    const handledOrder: string[] = [];
    const handler: MentionHandler = async (mention) => {
      handledOrder.push(mention.messageTs);
    };

    await withQueueFile({
      appendLine: (args) => appended.push(args),
      handler,
      queuePath: "/tmp/listen-queue.jsonl",
    })(MENTION);

    expect(appended.length).toBe(1);
    expect(appended[0]!.path).toBe("/tmp/listen-queue.jsonl");
    expect(JSON.parse(appended[0]!.line)).toEqual({
      channel: "C_BOT",
      messageTs: "1785114398.557099",
      replyTarget: { channel: "C_BOT", threadTs: "1785114000.000100" },
      surface: "channel",
      text: "what are my open PRs?",
      threadTs: "1785114000.000100",
      userId: "U_ASKER",
    });
    expect(handledOrder).toEqual(["1785114398.557099"]);
  });

  it("appends the canonical JSON even when the wrapped handler is the READABLE-lines emitter", async () => {
    const appended: { path: string; line: string }[] = [];
    const readableLines: string[] = [];
    const handler = emitOnly({ json: false, sink: ({ line }) => readableLines.push(line) });

    await withQueueFile({ appendLine: (args) => appended.push(args), handler, queuePath: "/tmp/q.jsonl" })(MENTION);

    expect(readableLines).toEqual([
      "from: U_ASKER (channel)",
      "reply in: C_BOT thread 1785114000.000100",
      "asked: what are my open PRs?",
    ]);
    expect(JSON.parse(appended[0]!.line).userId).toBe("U_ASKER");
  });

  it("calls appendLine before the wrapped handler, so the queue is durable even if the handler throws", async () => {
    const appended: { path: string; line: string }[] = [];
    const handler: MentionHandler = async () => {
      throw new Error("handler blew up");
    };

    await expect(
      withQueueFile({ appendLine: (args) => appended.push(args), handler, queuePath: "/tmp/q.jsonl" })(MENTION),
    ).rejects.toThrow("handler blew up");
    expect(appended.length).toBe(1);
  });

  /** A recording fixture: every call to `addReaction` and to the wrapped handler, in order. */
  function fixture({ seeded = true, throwOnReact = false }: { seeded?: boolean; throwOnReact?: boolean }): {
    readonly calls: string[];
    readonly lines: string[];
    readonly wrapped: MentionHandler;
  } {
    const calls: string[] = [];
    const lines: string[] = [];
    const deps: CaptureReactionDeps = {
      addReaction: async ({ channel, name, ts }) => {
        calls.push(`react:${channel}:${ts}:${name}`);
        if (throwOnReact) {
          throw new Error("reactions.add: not_in_channel");
        }
        return seeded;
      },
      emoji: "eyes",
      // Only the capture emoji is in this set, so the convergence has nothing to retire and these cases stay
      // about the ADD alone — `live/listen/capture.test.ts` covers what a full lifecycle set retires.
      lifecycle: ["eyes"],
      log: ({ line }) => {
        lines.push(line);
      },
      removeReaction: async ({ channel, name, ts }) => {
        calls.push(`unreact:${channel}:${ts}:${name}`);
        return true;
      },
    };
    const handler: MentionHandler = async (mention) => {
      calls.push(`handled:${mention.messageTs}`);
    };
    return { calls, lines, wrapped: withCaptureReaction({ deps, handler }) };
  }

  it("reacts with the configured emoji, on the mention's own channel and message ts", async () => {
    const { calls, wrapped } = fixture({});
    await wrapped(MENTION);
    expect(calls[0]).toBe("react:C_BOT:1785114398.557099:eyes");
  });

  it("reacts BEFORE the handler runs — the whole point of a capture-time signal", async () => {
    const { calls, wrapped } = fixture({});
    await wrapped(MENTION);
    expect(calls).toEqual(["react:C_BOT:1785114398.557099:eyes", "handled:1785114398.557099"]);
  });

  it("still runs the handler when the reaction could not be seeded", async () => {
    const { calls, lines, wrapped } = fixture({ seeded: false });
    await wrapped(MENTION);
    expect(calls).toEqual(["react:C_BOT:1785114398.557099:eyes", "handled:1785114398.557099"]);
    expect(lines).toEqual(["could not react to the tag with :eyes: — continuing without it"]);
  });

  it("still runs the handler when the reaction THROWS — the property that matters most", async () => {
    const { calls, lines, wrapped } = fixture({ throwOnReact: true });
    await wrapped(MENTION);
    expect(calls).toEqual(["react:C_BOT:1785114398.557099:eyes", "handled:1785114398.557099"]);
    expect(lines).toEqual(["reacting to the tag threw — continuing without it: reactions.add: not_in_channel"]);
  });
});
