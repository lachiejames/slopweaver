/** {@link scanSpend} — sessions AND their subagents walked, a stale session skipped, an unlistable corpus fatal. */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { scanSpend } from "../../../sessions/spendStore.js";

let projectsDir = "";

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "spend-store-"));
});

afterEach(() => {
  rmSync(projectsDir, { force: true, recursive: true });
});

/** One assistant turn line. */
function turn({ id }: { id: string }): string {
  return JSON.stringify({
    message: {
      id,
      model: "claude-opus-5-5",
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 100, input_tokens: 1, output_tokens: 10 },
    },
    timestamp: "2026-09-27T10:00:00.000Z",
    type: "assistant",
  });
}

/** Write a transcript of one turn at `path`, last written at `mtimeMs`. */
function writeTranscript({ path, mtimeMs }: { path: string; mtimeMs: number }): void {
  writeFileSync(path, `${turn({ id: path })}\n`, "utf8");
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
}

describe("scanSpend", () => {
  const since = Date.parse("2026-09-27T00:00:00.000Z");

  it("walks a session and its subagents written since the instant, and skips a stale session with its own", () => {
    const project = join(projectsDir, "-repo");
    mkdirSync(join(project, "live", "subagents"), { recursive: true });
    mkdirSync(join(project, "stale", "subagents"), { recursive: true });
    writeTranscript({ mtimeMs: since + 1_000, path: join(project, "live.jsonl") });
    writeTranscript({ mtimeMs: since + 1_000, path: join(project, "live", "subagents", "agent-1.jsonl") });
    writeTranscript({ mtimeMs: since - 1_000, path: join(project, "live", "subagents", "agent-old.jsonl") });
    writeTranscript({ mtimeMs: since - 1_000, path: join(project, "stale.jsonl") });
    writeTranscript({ mtimeMs: since + 1_000, path: join(project, "stale", "subagents", "agent-2.jsonl") });
    const scan = unwrap(scanSpend({ botHandles: [], projectsDir, sinceMs: since }));
    expect(scan.problems).toEqual([]);
    expect(scan.transcripts.map((transcript) => [transcript.path.slice(project.length), transcript.seat])).toEqual([
      ["/live.jsonl", "other"],
      ["/live/subagents/agent-1.jsonl", "subagent"],
    ]);
    expect(scan.transcripts[1]!.contextFloor).toBe(101);
  });

  it("fails when the projects directory cannot be listed", () => {
    expect(unwrapErr(scanSpend({ botHandles: [], projectsDir: join(projectsDir, "gone"), sinceMs: since })).code).toBe(
      "PROJECTS_DIR_UNREADABLE",
    );
  });
});
