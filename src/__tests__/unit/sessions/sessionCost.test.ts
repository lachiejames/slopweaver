/**
 * The cost fold — the arithmetic behind every figure on the trusted page.
 *
 * Two properties carry the whole file. Claude Code writes one transcript line per CONTENT BLOCK, all quoting
 * the same cumulative usage, so a fold that does not deduplicate by `message.id` roughly DOUBLES every
 * figure; and a chunk that caught the writer mid-line must leave the partial line for next time rather than
 * drop it, because a dropped line is missing spend nobody would ever notice.
 */
import { describe, expect, it } from "vitest";
import {
  addUsage,
  advanceCursor,
  compactTokens,
  EMPTY_CURSOR,
  groupedTokens,
  readUsageLine,
  sumUsage,
  type TurnUsage,
  ZERO_USAGE,
} from "../../../sessions/sessionCost.js";

/** One transcript line, shaped exactly as a live transcript shapes it. */
function line({
  id,
  output = 10,
  block = "text",
  model = "claude-opus-5",
}: {
  id: string;
  output?: number;
  block?: string;
  model?: string;
}): string {
  return JSON.stringify({
    message: {
      content: [{ type: block }],
      id,
      model,
      usage: {
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 2000,
        input_tokens: 2,
        output_tokens: output,
      },
    },
    type: "assistant",
  });
}

/** The turn a line read into, throwing rather than branching — the tests' equivalent of `unwrap`. */
function turnFrom({ text }: { text: string }): TurnUsage {
  const read = readUsageLine({ line: text });
  if (read.kind !== "usage") {
    throw new Error(`expected a usage line, got "${read.kind}"`);
  }
  return read.turn;
}

/** The refusal a line produced, throwing when it did not produce one. */
function whyFrom({ text }: { text: string }): string {
  const read = readUsageLine({ line: text });
  if (read.kind !== "unreadable") {
    throw new Error(`expected an unreadable line, got "${read.kind}"`);
  }
  return read.why;
}

describe("readUsageLine — three states, because 'not a usage line' is not a fault", () => {
  it("reads a usage line into a turn", () => {
    const turn = turnFrom({ text: line({ id: "msg_1", output: 42 }) });

    expect(turn.outputTokens).toBe(42);
    expect(turn.messageId).toBe("msg_1");
    expect(turn.model).toBe("claude-opus-5");
    expect(turn.cacheReadTokens).toBe(2000);
  });

  it("calls a line with no usage `other` rather than a failure", () => {
    expect(readUsageLine({ line: JSON.stringify({ type: "user" }) }).kind).toBe("other");
  });

  it("calls an unparseable line that mentions usage `unreadable`, with a reason", () => {
    expect(whyFrom({ text: '{"usage": broken' })).toContain("not readable JSON");
  });

  it("REFUSES a usage line with no message id rather than counting it", () => {
    expect(whyFrom({ text: JSON.stringify({ message: { usage: { output_tokens: 5 } } }) })).toContain("no message id");
  });

  it("REFUSES a usage object with no output_tokens rather than folding it to zero", () => {
    expect(whyFrom({ text: JSON.stringify({ message: { id: "msg_1", usage: { input_tokens: 1 } } }) })).toContain(
      "no output_tokens",
    );
  });
});

describe("advanceCursor — the deduplication that stops every figure doubling", () => {
  it("counts one turn once however many content blocks quote it", () => {
    const chunk = `${line({ block: "thinking", id: "msg_1" })}\n${line({ block: "tool_use", id: "msg_1" })}\n`;

    const cursor = advanceCursor({ chunk, cursor: EMPTY_CURSOR });

    expect(cursor.totals.turns).toBe(1);
    expect(cursor.totals.outputTokens).toBe(10);
    expect(cursor.duplicates).toBe(1);
  });

  it("keeps deduplicating ACROSS reads, so a sibling block in the next chunk is still skipped", () => {
    const first = advanceCursor({ chunk: `${line({ block: "thinking", id: "msg_1" })}\n`, cursor: EMPTY_CURSOR });

    const second = advanceCursor({ chunk: `${line({ block: "tool_use", id: "msg_1" })}\n`, cursor: first });

    expect(second.totals.turns).toBe(1);
    expect(second.totals.outputTokens).toBe(10);
    expect(second.duplicates).toBe(1);
  });

  it("adds two distinct turns", () => {
    const chunk = `${line({ id: "msg_1", output: 10 })}\n${line({ id: "msg_2", output: 25 })}\n`;

    const cursor = advanceCursor({ chunk, cursor: EMPTY_CURSOR });

    expect(cursor.totals.turns).toBe(2);
    expect(cursor.totals.outputTokens).toBe(35);
    expect(cursor.totals.cacheReadTokens).toBe(4000);
    expect(cursor.totals.cacheCreationTokens).toBe(600);
    expect(cursor.totals.inputTokens).toBe(4);
  });

  it("leaves a partial trailing line for the next read instead of dropping it", () => {
    // Exactly what a read that caught the writer mid-line sees: one whole line, then half of the next. The
    // offset must stop after the FIRST newline, so the next read starts at the truncated line's own first
    // byte and sees it whole. Drop it instead and 25 output tokens vanish with no symptom at all.
    const first = line({ id: "msg_1", output: 10 });
    const second = line({ id: "msg_2", output: 25 });

    const one = advanceCursor({ chunk: `${first}\n${second.slice(0, 20)}`, cursor: EMPTY_CURSOR });
    const two = advanceCursor({ chunk: `${second}\n`, cursor: one });

    expect(one.totals.turns).toBe(1);
    expect(one.offsetBytes).toBe(Buffer.byteLength(`${first}\n`, "utf8"));
    expect(two.totals.turns).toBe(2);
    expect(two.totals.outputTokens).toBe(35);
    expect(two.unreadable).toBe(0);
    expect(two.duplicates).toBe(0);
  });

  it("advances nothing at all when the chunk holds no complete line", () => {
    const cursor = advanceCursor({ chunk: '{"message":{"usage"', cursor: EMPTY_CURSOR });

    expect(cursor.offsetBytes).toBe(0);
    expect(cursor.totals.turns).toBe(0);
    expect(cursor.unreadable).toBe(0);
  });

  it("counts an offset in BYTES, so a multi-byte character cannot desynchronise the next read", () => {
    const text = `{"type":"user","text":"— an em dash"}\n`;

    const cursor = advanceCursor({ chunk: text, cursor: EMPTY_CURSOR });

    expect(cursor.offsetBytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(cursor.offsetBytes).toBeGreaterThan(text.length);
  });

  it("counts an unreadable usage line rather than dropping it silently", () => {
    const cursor = advanceCursor({ chunk: '{"usage": broken\n', cursor: EMPTY_CURSOR });

    expect(cursor.unreadable).toBe(1);
    expect(cursor.totals.turns).toBe(0);
  });

  it("collects every model it saw, sorted, and never the empty string", () => {
    const chunk =
      `${line({ id: "msg_1", model: "claude-sonnet-5" })}\n` +
      `${line({ id: "msg_2", model: "claude-opus-5" })}\n` +
      `${line({ id: "msg_3", model: "" })}\n`;

    expect(advanceCursor({ chunk, cursor: EMPTY_CURSOR }).models).toEqual(["claude-opus-5", "claude-sonnet-5"]);
  });
});

describe("addUsage and sumUsage", () => {
  it("adds one turn onto a zero total", () => {
    const totals = addUsage({
      totals: ZERO_USAGE,
      turn: {
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
        inputTokens: 1,
        messageId: "msg_1",
        model: "claude-opus-5",
        outputTokens: 2,
      },
    });

    expect(totals).toEqual({
      cacheCreationTokens: 3,
      cacheReadTokens: 4,
      inputTokens: 1,
      outputTokens: 2,
      turns: 1,
    });
  });

  it("sums two totals counter by counter, keeping them apart", () => {
    const left = { cacheCreationTokens: 1, cacheReadTokens: 2, inputTokens: 3, outputTokens: 4, turns: 1 };
    const right = { cacheCreationTokens: 10, cacheReadTokens: 20, inputTokens: 30, outputTokens: 40, turns: 2 };

    expect(sumUsage({ left, right })).toEqual({
      cacheCreationTokens: 11,
      cacheReadTokens: 22,
      inputTokens: 33,
      outputTokens: 44,
      turns: 3,
    });
  });
});

describe("token formatting", () => {
  it("groups digits exactly for the collapsed detail", () => {
    expect(groupedTokens({ count: 51_091_613_266 })).toBe("51,091,613,266");
    expect(groupedTokens({ count: 0 })).toBe("0");
  });

  it("shortens for the one-line row", () => {
    expect(compactTokens({ count: 812 })).toBe("812");
    expect(compactTokens({ count: 12_430 })).toBe("12.4k");
    expect(compactTokens({ count: 3_145_200 })).toBe("3.15M");
    expect(compactTokens({ count: 51_091_613_266 })).toBe("51.1B");
  });
});
