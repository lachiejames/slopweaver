/** {@link countChairAutoCompactions} — the five-auto-compaction trial's count, and when it refuses to give one. */
import { describe, expect, it } from "vitest";

import {
  AUTO_COMPACTION_HANDOFF_TRIAL_COUNT,
  countChairAutoCompactions,
} from "../../../supervisor/chairAutoCompaction.js";
import type { RawTranscriptLine } from "../../../transcripts/source.js";

/**
 * One boundary record in the shape Claude Code writes, with synthetic values.
 *
 * @param trigger the record's `compactMetadata.trigger`
 * @returns the JSONL line
 */
function boundary({ trigger }: { trigger: string }): string {
  return JSON.stringify({
    compactMetadata: { durationMs: 1000, postTokens: 100, preTokens: 1000, trigger },
    content: "Conversation compacted",
    subtype: "compact_boundary",
    type: "system",
    uuid: `boundary-${trigger}`,
  });
}

/** An ordinary line that is no boundary. */
const USER_LINE = JSON.stringify({ message: { content: "hello", role: "user" }, type: "user" });

/**
 * Number raw lines in file order.
 *
 * @param lines each line's text, or `"oversized"` for a line too long to read
 * @returns the lines as the transcript stream yields them
 */
function rawLines({ lines }: { lines: readonly string[] }): RawTranscriptLine[] {
  return lines.map((line, index) => {
    if (line === "oversized") {
      return { lineNumber: index + 1, oversized: true };
    }
    return { line, lineNumber: index + 1 };
  });
}

/**
 * `count` automatic boundaries, each after an ordinary line.
 *
 * @param count how many
 * @returns the lines
 */
function autos({ count }: { count: number }): string[] {
  return Array.from({ length: count }, () => [USER_LINE, boundary({ trigger: "auto" })]).flat();
}

describe("countChairAutoCompactions", () => {
  it("is a trial of five", () => {
    expect(AUTO_COMPACTION_HANDOFF_TRIAL_COUNT).toBe(5);
  });

  it("counts zero in a transcript with no boundary", () => {
    expect(countChairAutoCompactions({ lines: rawLines({ lines: [USER_LINE, USER_LINE] }) })).toEqual({
      autoCompactions: 0,
      kind: "below-trial",
    });
  });

  it("counts zero in an empty transcript", () => {
    expect(countChairAutoCompactions({ lines: [] })).toEqual({ autoCompactions: 0, kind: "below-trial" });
  });

  it("stays below the trial at four", () => {
    expect(countChairAutoCompactions({ lines: rawLines({ lines: autos({ count: 4 }) }) })).toEqual({
      autoCompactions: 4,
      kind: "below-trial",
    });
  });

  it("reaches the trial at exactly five", () => {
    expect(countChairAutoCompactions({ lines: rawLines({ lines: autos({ count: 5 }) }) })).toEqual({
      autoCompactionsAtLeast: 5,
      kind: "trial-reached",
    });
  });

  it("stops at five and claims a lower bound, never reading the tail", () => {
    let yielded = 0;
    const all = rawLines({ lines: autos({ count: 8 }) });
    function* counted(): Generator<RawTranscriptLine> {
      for (const line of all) {
        yielded += 1;
        yield line;
      }
    }
    expect(countChairAutoCompactions({ lines: counted() })).toEqual({
      autoCompactionsAtLeast: 5,
      kind: "trial-reached",
    });
    expect(yielded).toBe(10);
  });

  it("never advances the trial on a manual /compact", () => {
    const manual = Array.from({ length: 7 }, () => boundary({ trigger: "manual" }));
    expect(countChairAutoCompactions({ lines: rawLines({ lines: manual }) })).toEqual({
      autoCompactions: 0,
      kind: "below-trial",
    });
  });

  it("counts only the automatic boundaries in a mixed transcript", () => {
    const lines = [...autos({ count: 3 }), boundary({ trigger: "manual" }), boundary({ trigger: "manual" })];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      autoCompactions: 3,
      kind: "below-trial",
    });
  });

  it("reads a count below five UNMEASURED when a boundary carries an unknown trigger", () => {
    const lines = [...autos({ count: 2 }), boundary({ trigger: "idle" })];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      kind: "unmeasured",
      why: 'line 5 is a compaction boundary with an unknown trigger ("idle")',
    });
  });

  it("reads a count below five UNMEASURED when a boundary record will not parse", () => {
    const lines = [USER_LINE, '{"subtype":"compact_boundary",'];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      kind: "unmeasured",
      why: "line 2 could be a compaction boundary but is unreadable — it is not readable JSON",
    });
  });

  it("reads a count below five UNMEASURED when a torn record was cut before its marker", () => {
    // Torn mid-way through `compact_boundary`: the whole marker is gone, so only a parse can tell it might be one.
    const lines = [USER_LINE, '{"compactMetadata":{"trigger":"auto"},"subtype":"compact_boun'];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      kind: "unmeasured",
      why: "line 2 could be a compaction boundary but is unreadable — it is not readable JSON",
    });
  });

  it("counts a well-formed line that is not an object as no boundary", () => {
    expect(countChairAutoCompactions({ lines: rawLines({ lines: ['"compact_boundary"', "[]", USER_LINE] }) })).toEqual({
      autoCompactions: 0,
      kind: "below-trial",
    });
  });

  it("reaches the trial on five automatic boundaries that carry only their trigger", () => {
    // No durationMs or token counts, which the drift monitor needs and this count does not.
    const bare = JSON.stringify({ compactMetadata: { trigger: "auto" }, subtype: "compact_boundary", type: "system" });
    expect(countChairAutoCompactions({ lines: rawLines({ lines: Array.from({ length: 5 }, () => bare) }) })).toEqual({
      autoCompactionsAtLeast: 5,
      kind: "trial-reached",
    });
  });

  it("reads a count below five UNMEASURED when a boundary carries no trigger", () => {
    const lines = [USER_LINE, JSON.stringify({ compactMetadata: {}, subtype: "compact_boundary", type: "system" })];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      kind: "unmeasured",
      why: "line 2 could be a compaction boundary but is unreadable — a compact_boundary record carries no trigger",
    });
  });

  it("ignores a line that only mentions the marker in its text", () => {
    const quoted = JSON.stringify({ message: { content: "what is a compact_boundary?", role: "user" }, type: "user" });
    expect(countChairAutoCompactions({ lines: rawLines({ lines: [quoted, ...autos({ count: 2 })] }) })).toEqual({
      autoCompactions: 2,
      kind: "below-trial",
    });
  });

  it("reads a count below five UNMEASURED when a line is too long to read", () => {
    const lines = [...autos({ count: 1 }), "oversized"];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      kind: "unmeasured",
      why: "line 3 is too long to read, and could be an automatic compaction",
    });
  });

  it("reaches the trial on five verified boundaries despite an unreadable line before them", () => {
    const lines = ["oversized", ...autos({ count: 5 })];
    expect(countChairAutoCompactions({ lines: rawLines({ lines }) })).toEqual({
      autoCompactionsAtLeast: 5,
      kind: "trial-reached",
    });
  });
});
