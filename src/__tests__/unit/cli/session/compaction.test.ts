/**
 * {@link runSessionCompaction} — the shipped runner, driven over a fixture corpus.
 *
 * `--projects-dir` and `--home` are the two seams that make this a unit test rather than a reading of the
 * operator's own machine: the corpus is a temp directory this file writes, and the readings ledger is a
 * throwaway home, so the three exit codes are exercised against state the test owns.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSessionCompaction } from "../../../../cli/commands/session/compaction.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";

let projectsDir = "";
let home = "";

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "compaction-cli-"));
  home = mkdtempSync(join(tmpdir(), "compaction-home-"));
});

afterEach(() => {
  rmSync(projectsDir, { force: true, recursive: true });
  rmSync(home, { force: true, recursive: true });
});

/** One assistant turn reading `target`. */
function turn({ id, uuid, target }: { id: string; uuid: string; target: string }): string {
  return JSON.stringify({
    isSidechain: false,
    message: {
      content: [{ id: "t1", input: { file_path: target }, name: "Read", type: "tool_use" }],
      id,
      model: "claude-opus-5",
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 200_000,
        input_tokens: 500,
        output_tokens: 10,
      },
    },
    type: "assistant",
    uuid,
  });
}

/** One boundary whose summary kept nothing, so every later re-read is a DROPPED one. */
function boundary({ index }: { index: number }): string {
  return JSON.stringify({
    compactMetadata: {
      durationMs: 120_000,
      postTokens: 14_000,
      preservedMessages: { uuids: [] },
      preTokens: 267_000,
      trigger: "auto",
    },
    subtype: "compact_boundary",
    type: "system",
    uuid: `b${String(index)}`,
  });
}

/**
 * A corpus of `boundaries` sessions, each one turn, a boundary, then a re-read of the same file.
 *
 * One boundary per session rather than many in one, because the fold credits a re-read to every OPEN
 * boundary — so a single transcript holding 25 of them would report a rate off a quadratic denominator.
 */
function writeCorpus({ boundaries }: { boundaries: number }): void {
  for (let index = 0; index < boundaries; index += 1) {
    const dir = join(projectsDir, `-repo-${String(index)}`);
    mkdirSync(dir, { recursive: true });
    const lines = [
      turn({ id: `m${String(index)}a`, target: "/a.ts", uuid: `u${String(index)}a` }),
      boundary({ index }),
      turn({ id: `m${String(index)}b`, target: "/a.ts", uuid: `u${String(index)}b` }),
    ];
    writeFileSync(join(dir, `session-${String(index)}.jsonl`), `${lines.join("\n")}\n`, "utf8");
  }
}

/** The runner's argv, with the two seams already pointed at this test's own state. */
function argv({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "compaction", "--projects-dir", projectsDir, "--home", home, ...flags];
}

describe("runSessionCompaction", () => {
  it("reports and exits 0 without --check, however the verdict reads", () => {
    writeCorpus({ boundaries: 2 });
    expect(runSessionCompaction(argv({ flags: [] }))).toBe(EXIT_OK);
  });

  it("defers under --check when the corpus holds too few boundaries to judge", () => {
    writeCorpus({ boundaries: 2 });
    expect(runSessionCompaction(argv({ flags: ["--check"] }))).toBe(EXIT_DEFERRED);
  });

  it("defers under --check when there are boundaries but no earlier reading to compare against", () => {
    writeCorpus({ boundaries: 25 });
    expect(runSessionCompaction(argv({ flags: ["--check"] }))).toBe(EXIT_DEFERRED);
  });

  it("records a reading, then HOLDS against it on the very next pass", () => {
    writeCorpus({ boundaries: 25 });
    expect(runSessionCompaction(argv({ flags: ["--record-reading", "a test"] }))).toBe(EXIT_OK);
    expect(runSessionCompaction(argv({ flags: ["--check"] }))).toBe(EXIT_OK);
  });

  it("fires under --check once the rate has risen past the tolerance", () => {
    writeCorpus({ boundaries: 25 });
    runSessionCompaction(argv({ flags: ["--record-reading", "a test"] }));
    expect(runSessionCompaction(argv({ flags: ["--check", "--tolerance", "-1"] }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses a --windows list that is not whole token counts", () => {
    expect(runSessionCompaction(argv({ flags: ["--windows", "300k,400k"] }))).toBe(EXIT_ERROR);
  });

  it("refuses a --tolerance that is not a number", () => {
    expect(runSessionCompaction(argv({ flags: ["--tolerance", "loose"] }))).toBe(EXIT_ERROR);
  });

  it("refuses an unknown flag with a usage code rather than running the pass", () => {
    expect(runSessionCompaction(argv({ flags: ["--not-a-flag"] }))).toBe(EXIT_USAGE);
  });

  it("prints usage and exits 0 for --help", () => {
    expect(runSessionCompaction(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("errors rather than reporting zero when the corpus directory is not there", () => {
    const missing = ["node", "slopweaver", "session", "compaction", "--projects-dir", join(projectsDir, "gone")];
    expect(runSessionCompaction(missing)).toBe(EXIT_ERROR);
  });
});
