import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CostCursor } from "../../../sessions/sessionCost.js";
import { readTranscriptUsage } from "../../../sessions/transcriptUsageStore.js";

/**
 * One assistant transcript line carrying usage.
 *
 * @returns the JSON line, without its newline
 */
function usageLine({ id, model, output }: { id: string; model: string; output: number }): string {
  return JSON.stringify({
    message: {
      id,
      model,
      usage: { cache_creation_input_tokens: 7, cache_read_input_tokens: 100, input_tokens: 3, output_tokens: output },
    },
    type: "assistant",
  });
}

describe("readTranscriptUsage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transcript-usage-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("folds the whole file, counting a turn written across two lines once and reporting the duplicate", () => {
    const path = join(dir, "session.jsonl");
    const text =
      [
        JSON.stringify({ message: { content: "hello" }, type: "user" }),
        usageLine({ id: "msg-alpha", model: "claude-opus-5", output: 40 }),
        usageLine({ id: "msg-alpha", model: "claude-opus-5", output: 40 }),
        usageLine({ id: "msg-bravo", model: "claude-sonnet-5", output: 2 }),
      ].join("\n") + "\n";
    writeFileSync(path, text);
    const result = readTranscriptUsage({ path });
    expect(result.known).toBe(true);
    const cursor = (result as { readonly known: true; readonly value: CostCursor }).value;
    expect(cursor.totals).toEqual({
      cacheCreationTokens: 14,
      cacheReadTokens: 200,
      inputTokens: 6,
      outputTokens: 42,
      turns: 2,
    });
    expect(cursor.duplicates).toBe(1);
    expect(cursor.unreadable).toBe(0);
    expect(cursor.models).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect([...cursor.counted]).toEqual(["msg-alpha", "msg-bravo"]);
    expect(cursor.usageByModel.get("claude-opus-5")).toEqual({
      cacheCreationTokens: 7,
      cacheReadTokens: 100,
      inputTokens: 3,
      outputTokens: 40,
      turns: 1,
    });
  });

  it("counts a usage line that will not parse as unreadable rather than dropping it silently", () => {
    const path = join(dir, "torn.jsonl");
    writeFileSync(path, `${usageLine({ id: "msg-charlie", model: "claude-opus-5", output: 5 })}\n{"usage": torn\n`);
    const result = readTranscriptUsage({ path });
    expect(result.known).toBe(true);
    const cursor = (result as { readonly known: true; readonly value: CostCursor }).value;
    expect(cursor.unreadable).toBe(1);
    expect(cursor.totals.turns).toBe(1);
  });

  it("answers a measured zero cursor for an empty file", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "");
    const result = readTranscriptUsage({ path });
    expect(result.known).toBe(true);
    const cursor = (result as { readonly known: true; readonly value: CostCursor }).value;
    expect(cursor.totals).toEqual({
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
    });
    expect(cursor.duplicates).toBe(0);
    expect(cursor.unreadable).toBe(0);
    expect(cursor.models).toEqual([]);
    expect(cursor.counted.size).toBe(0);
    expect(cursor.usageByModel.size).toBe(0);
  });

  // CURRENT behaviour, pinned rather than endorsed: `readJsonlLines` delivers the empty slice after a final
  // newline as one more line, and this fold re-appends a newline to every line it is handed, so the cursor's
  // offset runs ONE byte past the file. Its only caller (`session depth`) never reads `offsetBytes`.
  it("reports an offset one byte past the file's length, because the trailing empty slice is folded too", () => {
    const path = join(dir, "offset.jsonl");
    const text = `${usageLine({ id: "msg-delta", model: "claude-opus-5", output: 1 })}\n`;
    writeFileSync(path, text);
    const empty = join(dir, "offset-empty.jsonl");
    writeFileSync(empty, "");
    const whole = readTranscriptUsage({ path });
    const none = readTranscriptUsage({ path: empty });
    expect(whole.known).toBe(true);
    expect(none.known).toBe(true);
    expect((whole as { readonly known: true; readonly value: CostCursor }).value.offsetBytes).toBe(
      Buffer.byteLength(text, "utf8") + 1,
    );
    expect((none as { readonly known: true; readonly value: CostCursor }).value.offsetBytes).toBe(1);
  });

  it("answers unmeasurable, never a zero cursor, for a path that cannot be read", () => {
    const path = join(dir, "absent.jsonl");
    const result = readTranscriptUsage({ path });
    expect(result.known).toBe(false);
    const why = (result as { readonly known: false; readonly why: string }).why;
    expect(why.startsWith("transcript could not be read (")).toBe(true);
    expect(why).toContain("ENOENT");
    expect(why).toContain(path);
  });
});
