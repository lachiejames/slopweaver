/** {@link foldCompaction} — the doubling defence, and the two re-read counts either side of a boundary. */
import { describe, expect, it } from "vitest";

import { foldCompaction, type TranscriptCompaction } from "../../../sessions/compactionFold.js";

/** One assistant turn line, reading `targets` and quoting `id` as its message id. */
function turn({
  id,
  uuid,
  targets = [],
  cacheRead = 1_000,
  input = 0,
  sidechain = false,
  model = "claude-opus-5",
}: {
  id: string;
  uuid: string;
  targets?: readonly string[];
  cacheRead?: number;
  input?: number;
  sidechain?: boolean;
  model?: string;
}): string {
  return JSON.stringify({
    isSidechain: sidechain,
    message: {
      content: targets.map((path, index) => ({
        id: `t${String(index)}`,
        input: { file_path: path },
        name: "Read",
        type: "tool_use",
      })),
      id,
      model,
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: cacheRead,
        input_tokens: input,
        output_tokens: 10,
      },
    },
    type: "assistant",
    uuid,
  });
}

/** One boundary line, naming exactly which record uuids its summary kept. */
function boundary({ kept }: { kept: readonly string[] }): string {
  return JSON.stringify({
    compactMetadata: {
      durationMs: 100_000,
      postTokens: 10_000,
      preservedMessages: { uuids: kept },
      preTokens: 250_000,
      trigger: "auto",
    },
    subtype: "compact_boundary",
    type: "system",
    uuid: "b1",
  });
}

/** The single boundary a fold produced, or a throw when it produced another number of them. */
function onlyBoundary({ folded }: { folded: TranscriptCompaction }) {
  const [first] = folded.boundaries;
  if (first === undefined || folded.boundaries.length !== 1) {
    throw new Error(`expected exactly one boundary, got ${String(folded.boundaries.length)}`);
  }
  return first;
}

describe("foldCompaction", () => {
  it("counts one turn per message id, however many content-block lines quote it", () => {
    const folded = foldCompaction({
      lines: [
        turn({ id: "msg_1", targets: ["/a.ts"], uuid: "u1" }),
        turn({ id: "msg_1", targets: ["/a.ts"], uuid: "u1" }),
      ],
    });
    expect(folded.calls.length).toBe(1);
    expect(folded.duplicates).toBe(1);
    expect(folded.byModel.get("claude-opus-5")!.turns).toBe(1);
  });

  it("counts a read after a boundary of a file read before it as a re-read", () => {
    const folded = foldCompaction({
      lines: [
        turn({ id: "m1", targets: ["/a.ts"], uuid: "u1" }),
        boundary({ kept: [] }),
        turn({ id: "m2", targets: ["/a.ts"], uuid: "u2" }),
      ],
    });
    const measured = onlyBoundary({ folded });
    expect(measured.afterCalls).toBe(1);
    expect(measured.reReads).toBe(1);
  });

  it("counts it as a DROPPED re-read only when every earlier read sat in a record the summary threw away", () => {
    const dropped = foldCompaction({
      lines: [
        turn({ id: "m1", targets: ["/a.ts"], uuid: "u1" }),
        boundary({ kept: ["u9"] }),
        turn({ id: "m2", targets: ["/a.ts"], uuid: "u2" }),
      ],
    });
    expect(onlyBoundary({ folded: dropped }).droppedReReads).toBe(1);

    const kept = foldCompaction({
      lines: [
        turn({ id: "m1", targets: ["/a.ts"], uuid: "u1" }),
        boundary({ kept: ["u1"] }),
        turn({ id: "m2", targets: ["/a.ts"], uuid: "u2" }),
      ],
    });
    const keptBoundary = onlyBoundary({ folded: kept });
    expect(keptBoundary.reReads).toBe(1);
    expect(keptBoundary.droppedReReads).toBe(0);
  });

  it("does not count a first sighting after the boundary as a re-read", () => {
    const folded = foldCompaction({
      lines: [
        turn({ id: "m1", targets: ["/a.ts"], uuid: "u1" }),
        boundary({ kept: [] }),
        turn({ id: "m2", targets: ["/b.ts"], uuid: "u2" }),
      ],
    });
    const measured = onlyBoundary({ folded });
    expect(measured.afterCalls).toBe(1);
    expect(measured.reReads).toBe(0);
    expect(measured.droppedReReads).toBe(0);
  });

  it("marks the first call after a real boundary, so the replay knows where the trace reset", () => {
    const folded = foldCompaction({
      lines: [
        turn({ id: "m1", uuid: "u1" }),
        boundary({ kept: [] }),
        turn({ id: "m2", uuid: "u2" }),
        turn({ id: "m3", uuid: "u3" }),
      ],
    });
    expect(folded.calls.map((call) => call.afterRealBoundary)).toEqual([false, true, false]);
  });

  it("excludes a subagent's own turn from every count", () => {
    const folded = foldCompaction({
      lines: [turn({ id: "m1", sidechain: true, targets: ["/a.ts"], uuid: "u1" })],
    });
    expect(folded.calls.length).toBe(0);
    expect(folded.sidechainSkipped).toBe(1);
    expect(folded.byModel.size).toBe(0);
  });

  it("counts a line it could not read rather than dropping it silently", () => {
    const folded = foldCompaction({ lines: ['{"usage": not json'] });
    expect(folded.unreadable).toBe(1);
    expect(folded.calls.length).toBe(0);
  });

  it("carries each turn's context and cache draw through to the replay's input", () => {
    const folded = foldCompaction({ lines: [turn({ cacheRead: 90_000, id: "m1", input: 10_000, uuid: "u1" })] });
    expect(folded.calls).toEqual([{ afterRealBoundary: false, cacheReadTokens: 90_000, contextTokens: 100_000 }]);
  });
});
