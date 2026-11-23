/** {@link readCompactionLine} — the three kinds of line a compaction measurement reads, and the refusals. */
import { describe, expect, it } from "vitest";

import {
  type CompactionBoundary,
  type CompactionTurn,
  contextTokensOf,
  readCompactionLine,
} from "../../../sessions/compactionRecord.js";

/**
 * A real boundary record, trimmed to the fields this reads.
 *
 * Copied from `~/.claude/projects/…-291-29/a0000104-….jsonl` on Claude Code 2.1.278 — note `preTokens`
 * 267,547 against a 300,000 window, which is the measurement behind the replay's "floor" assumption.
 */
const BOUNDARY_LINE = JSON.stringify({
  compactMetadata: {
    cumulativeDroppedTokens: 900_000,
    durationMs: 133_385,
    postTokens: 14_251,
    preservedMessages: { anchorUuid: "anchor", uuids: ["kept-a", "kept-b", 7] },
    preTokens: 267_547,
    trigger: "auto",
  },
  content: "Conversation compacted",
  isSidechain: false,
  subtype: "compact_boundary",
  type: "system",
  uuid: "boundary-1",
});

/** One assistant turn, with usage and two tool calls. */
function turnLine({
  id = "msg_1",
  uuid = "turn-1",
  sidechain = false,
  filePath = "/repo/src/a.ts",
  command = "cat /repo/README.md",
}: {
  id?: string;
  uuid?: string;
  sidechain?: boolean;
  filePath?: string;
  command?: string;
} = {}): string {
  return JSON.stringify({
    isSidechain: sidechain,
    message: {
      content: [
        { id: "t1", input: { file_path: filePath }, name: "Read", type: "tool_use" },
        { id: "t2", input: { command }, name: "Bash", type: "tool_use" },
      ],
      id,
      model: "claude-opus-5",
      usage: {
        cache_creation_input_tokens: 2_000,
        cache_read_input_tokens: 100_000,
        input_tokens: 500,
        output_tokens: 300,
      },
    },
    type: "assistant",
    uuid,
  });
}

/** The boundary that line decodes to, or a throw naming what it was instead — the `unwrap` shape. */
function boundaryOf({ line }: { line: string }): CompactionBoundary {
  const read = readCompactionLine({ line });
  if (read.kind !== "boundary") {
    throw new Error(`expected a boundary, got ${read.kind}`);
  }
  return read.boundary;
}

/** The turn that line decodes to, or a throw naming what it was instead. */
function turnOf({ line }: { line: string }): CompactionTurn {
  const read = readCompactionLine({ line });
  if (read.kind !== "turn") {
    throw new Error(`expected a turn, got ${read.kind}`);
  }
  return read.turn;
}

/** The reason that line was refused, or a throw naming what it was instead. */
function whyOf({ line }: { line: string }): string {
  const read = readCompactionLine({ line });
  if (read.kind !== "unreadable") {
    throw new Error(`expected an unreadable line, got ${read.kind}`);
  }
  return read.why;
}

describe("readCompactionLine", () => {
  it("decodes a boundary's metadata and the uuids its summary kept", () => {
    const boundary = boundaryOf({ line: BOUNDARY_LINE });
    expect(boundary.trigger).toBe("auto");
    expect(boundary.preTokens).toBe(267_547);
    expect(boundary.postTokens).toBe(14_251);
    expect(boundary.durationMs).toBe(133_385);
    expect(boundary.preservedUuids).toEqual(["kept-a", "kept-b"]);
  });

  it("takes droppedTokens as this compaction's own pre minus post, never the session's running total", () => {
    const boundary = boundaryOf({ line: BOUNDARY_LINE });
    expect(boundary.droppedTokens).toBe(253_296);
    expect(boundary.cumulativeDroppedTokens).toBe(900_000);
  });

  it("refuses a boundary that has lost its durationMs rather than folding it to zero", () => {
    const line = JSON.stringify({ compactMetadata: { preTokens: 1 }, subtype: "compact_boundary", type: "system" });
    expect(whyOf({ line })).toContain("durationMs");
  });

  it("decodes an assistant turn's usage and both of its read targets", () => {
    const turn = turnOf({ line: turnLine() });
    expect(turn.usage.messageId).toBe("msg_1");
    expect(turn.usage.model).toBe("claude-opus-5");
    expect(turn.usage.cacheReadTokens).toBe(100_000);
    expect(turn.uuid).toBe("turn-1");
    expect(turn.sidechain).toBe(false);
    expect(turn.targets.map((entry) => entry.target)).toEqual(["/repo/src/a.ts", "/repo/README.md"]);
  });

  it("counts every tier the model was handed as the turn's context", () => {
    expect(contextTokensOf({ turn: turnOf({ line: turnLine() }) })).toBe(102_500);
  });

  it("marks a subagent's own turn, so a fold can leave it out", () => {
    expect(turnOf({ line: turnLine({ sidechain: true }) }).sidechain).toBe(true);
  });

  it("names no target for a Bash command it cannot parse", () => {
    const turn = turnOf({ line: turnLine({ command: "yarn build --watch" }) });
    expect(turn.targets.map((entry) => entry.target)).toEqual(["/repo/src/a.ts"]);
  });

  it("refuses a usage line carrying no message id, because it can be neither counted nor deduplicated", () => {
    const line = JSON.stringify({ message: { usage: { output_tokens: 1 } }, type: "assistant" });
    expect(whyOf({ line })).toContain("deduplicated");
  });

  it("refuses a usage object with no output_tokens, so shape drift cannot read as spend falling", () => {
    const line = JSON.stringify({ message: { id: "msg_2", usage: { input_tokens: 5 } }, type: "assistant" });
    expect(whyOf({ line })).toContain("output_tokens");
  });

  it("is `other` for a line mentioning neither usage nor a boundary, without parsing it", () => {
    expect(readCompactionLine({ line: '{"type":"user","message":{not json at all' }).kind).toBe("other");
  });

  it("is `unreadable` for a line that DOES mention usage and will not parse", () => {
    expect(whyOf({ line: '{"usage": broken' })).toContain("readable JSON");
  });
});
