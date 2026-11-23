/**
 * `emitOnly`, the handler that hands a mention to the visible session as one line of JSON or as readable lines,
 * and does nothing else.
 */
import { describe, expect, it } from "vitest";

import { emitOnly } from "../../../../../../cli/commands/listen/emit.js";
import type { Mention } from "../../../../../../live/listen/mention.js";

describe("emitOnly", () => {
  const MENTION: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  const capture = ({ json, mention = MENTION }: { json: boolean; mention?: Mention }): string[] => {
    const lines: string[] = [];
    void emitOnly({ json, sink: ({ line }) => lines.push(line) })(mention);
    return lines;
  };

  it("stays the bare unwrapped shape with wrapped omitted, exactly as every existing caller gets", () => {
    const lines: string[] = [];
    void emitOnly({ json: true, sink: ({ line }) => lines.push(line) })(MENTION);

    expect(Object.keys(JSON.parse(lines[0]!))).not.toContain("kind");
  });

  it("adds the slack-address discriminator only when wrapped is true — deadline mode's own envelope", () => {
    const unwrappedLines: string[] = [];
    void emitOnly({ json: true, sink: ({ line }) => unwrappedLines.push(line), wrapped: false })(MENTION);
    expect(Object.keys(JSON.parse(unwrappedLines[0]!))).not.toContain("kind");

    const wrappedLines: string[] = [];
    void emitOnly({ json: true, sink: ({ line }) => wrappedLines.push(line), wrapped: true })(MENTION);
    const wrapped = JSON.parse(wrappedLines[0]!);
    expect(wrapped.kind).toBe("slack-address");
    expect(wrapped.userId).toBe("U_ASKER");
    expect(wrapped.channel).toBe("C_BOT");
  });

  it("prints the whole mention as ONE line of JSON, which is what the loop parses", () => {
    const lines = capture({ json: true });

    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      channel: "C_BOT",
      messageTs: "1785114398.557099",
      replyTarget: { channel: "C_BOT", threadTs: "1785114000.000100" },
      surface: "channel",
      text: "what are my open PRs?",
      threadTs: "1785114000.000100",
      userId: "U_ASKER",
    });
  });

  /**
   * `replyTarget` is the reason the JSON is the WHOLE handoff.
   *
   * Every reply verb takes a channel and a thread, and getting the thread wrong is the classic Slack bug —
   * `thread_ts` is set only on a message already in a thread, so a top-level tag threads on its own `ts`.
   * The transport has already resolved that; pre-joining it here means the session cannot re-derive it, and
   * so cannot get it right in one place and wrong in another.
   */
  it("resolves replyTarget for a top-level tag to the message's own ts", () => {
    const top: Mention = { ...MENTION, messageTs: "1785114398.557099", threadTs: "1785114398.557099" };

    expect(JSON.parse(capture({ json: true, mention: top })[0]!).replyTarget).toEqual({
      channel: "C_BOT",
      threadTs: "1785114398.557099",
    });
  });

  it("prints readable lines when --json was not asked for", () => {
    const lines = capture({ json: false });

    expect(lines).toEqual([
      "from: U_ASKER (channel)",
      "reply in: C_BOT thread 1785114000.000100",
      "asked: what are my open PRs?",
    ]);
  });

  it("carries a dm surface through, because the turn names the agent thread only in a DM", () => {
    const dm: Mention = { ...MENTION, channel: "D_DM", surface: "dm" };

    expect(JSON.parse(capture({ json: true, mention: dm })[0]!).surface).toBe("dm");
  });

  /**
   * The whole point, asserted as an absence.
   *
   * This handler REPLACED one that spawned a detached `claude -p` to compose an answer. What makes the
   * replacement real is that it does nothing but write to its sink — no transport, no model, no door. A
   * handler that emitted AND posted would satisfy every other test here while reintroducing the thing the
   * command exists to remove, so the assertion is that emitting is all it does.
   */
  it("emits and nothing else — no second effect to hide an answer in", () => {
    expect(capture({ json: true }).length).toBe(1);
    expect(capture({ json: false }).length).toBe(3);
  });
});
