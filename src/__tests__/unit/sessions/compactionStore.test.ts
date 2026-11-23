/** {@link scanCompactions} — the one effectful edge, over a fixture corpus in a temp directory. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanCompactions } from "../../../sessions/compactionStore.js";

let projectsDir = "";

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "compaction-scan-"));
});

afterEach(() => {
  rmSync(projectsDir, { force: true, recursive: true });
});

/** One assistant turn, quoting `id` as its message id and reading `target`. */
function turn({ id, uuid, target }: { id: string; uuid: string; target: string }): string {
  return JSON.stringify({
    isSidechain: false,
    message: {
      content: [{ id: "t1", input: { file_path: target }, name: "Read", type: "tool_use" }],
      id,
      model: "claude-opus-5",
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100_000,
        input_tokens: 500,
        output_tokens: 10,
      },
    },
    type: "assistant",
    uuid,
  });
}

/** One boundary line, naming which record uuids its summary kept. */
function boundary({ kept }: { kept: readonly string[] }): string {
  return JSON.stringify({
    compactMetadata: {
      durationMs: 120_000,
      postTokens: 14_000,
      preservedMessages: { uuids: kept },
      preTokens: 267_000,
      trigger: "auto",
    },
    subtype: "compact_boundary",
    type: "system",
    uuid: "b1",
  });
}

/** Write one transcript into a project directory of the fixture corpus. */
function writeTranscript({
  project,
  sessionId,
  lines,
}: {
  project: string;
  sessionId: string;
  lines: readonly string[];
}): void {
  const dir = join(projectsDir, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

/** The value of a scan, or a throw naming the failure — the `unwrap` shape. */
function scan({ sinceMs }: { sinceMs: number }) {
  const result = scanCompactions({ projectsDir, sinceMs });
  if (result.isErr()) {
    throw new Error(`expected a scan, got: ${result.error.message}`);
  }
  return result.value;
}

describe("scanCompactions", () => {
  it("folds every transcript in the window into one entry each", () => {
    writeTranscript({
      lines: [
        turn({ id: "m1", target: "/a.ts", uuid: "u1" }),
        boundary({ kept: [] }),
        turn({ id: "m2", target: "/a.ts", uuid: "u2" }),
      ],
      project: "-repo-one",
      sessionId: "aaaa",
    });
    writeTranscript({
      lines: [turn({ id: "m3", target: "/b.ts", uuid: "u3" })],
      project: "-repo-two",
      sessionId: "bbbb",
    });

    const scanned = scan({ sinceMs: 0 });
    expect(scanned.transcripts.length).toBe(2);
    expect(scanned.considered).toBe(2);
    expect(scanned.problems).toEqual([]);
  });

  it("carries a boundary's own aftermath through the fold to the caller", () => {
    writeTranscript({
      lines: [
        turn({ id: "m1", target: "/a.ts", uuid: "u1" }),
        boundary({ kept: [] }),
        turn({ id: "m2", target: "/a.ts", uuid: "u2" }),
      ],
      project: "-repo-one",
      sessionId: "aaaa",
    });
    const only = scan({ sinceMs: 0 }).transcripts[0]!;
    expect(only.boundaries.length).toBe(1);
    expect(only.boundaries[0]!.droppedReReads).toBe(1);
    expect(only.boundaries[0]!.boundary.droppedTokens).toBe(253_000);
  });

  it("excludes a transcript written before the window, and says how many it considered", () => {
    writeTranscript({
      lines: [turn({ id: "m1", target: "/a.ts", uuid: "u1" })],
      project: "-repo-one",
      sessionId: "aaaa",
    });
    const scanned = scan({ sinceMs: Date.now() + 60_000 });
    expect(scanned.considered).toBe(0);
    expect(scanned.transcripts).toEqual([]);
  });

  it("reports the window's own start instant when nothing in it was walked", () => {
    const sinceMs = Date.now() + 60_000;
    expect(scan({ sinceMs }).oldestWriteMs).toBe(sinceMs);
  });

  it("fails, naming the directory, only when the projects directory itself cannot be listed", () => {
    const missing = join(projectsDir, "not-there");
    const result = scanCompactions({ projectsDir: missing, sinceMs: 0 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(missing);
  });

  it("reads a corpus holding no transcript at all as an empty pass, not a failure", () => {
    const scanned = scan({ sinceMs: 0 });
    expect(scanned.transcripts).toEqual([]);
    expect(scanned.considered).toBe(0);
    expect(scanned.problems).toEqual([]);
  });
});
