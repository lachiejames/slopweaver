/**
 * `transcripts draw`'s shell: the text report over a real fold, and the exit codes over a REAL temporary projects
 * directory this test writes. What the fold computes is asserted in `unit/transcripts/draw.test.ts`; this file
 * asserts what the shell renders from it and how it refuses a tick flag it cannot read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { drawLines, runTranscriptsDraw } from "../../../../../cli/commands/transcripts/draw.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { summariseDraw } from "../../../../../transcripts/draw.js";
import { drawReading } from "../../../../../transcripts/drawFold.js";

const SESSION = "aaaaaaaa-0000-0000-0000-000000000002";

// Two API calls around one `slopweaver board list` whose result grew the prompt by 1,100 − 1,000 − 20 = 80 tokens.
const LINES = [
  JSON.stringify({
    message: {
      content: [{ id: "t1", input: { command: "slopweaver board list" }, name: "Bash", type: "tool_use" }],
      id: "m1",
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, input_tokens: 0, output_tokens: 20 },
    },
    timestamp: "2026-10-26T01:00:00.000Z",
    type: "assistant",
  }),
  JSON.stringify({
    message: { content: [{ content: "x".repeat(320), tool_use_id: "t1", type: "tool_result" }], role: "user" },
    timestamp: "2026-10-26T01:00:01.000Z",
    type: "user",
  }),
  JSON.stringify({
    message: {
      content: [],
      id: "m2",
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 1100, input_tokens: 0, output_tokens: 5 },
    },
    timestamp: "2026-10-26T01:00:02.000Z",
    type: "assistant",
  }),
];

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A projects directory holding the one transcript above. */
function seededProjects(): string {
  const projects = mkdtempSync(join(tmpdir(), "transcripts-draw-"));
  fixtureDirs.push(projects);
  const dir = join(projects, "-repo-alpha");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION}.jsonl`), `${LINES.join("\n")}\n`);
  return projects;
}

/** An argv for `transcripts draw`. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "transcripts", "draw", ...tail];
}

describe("drawLines", () => {
  it("renders the totals and one row per verb, its measured tokens in the mean column", () => {
    const summary = summariseDraw({
      fromTick: 0,
      readings: [drawReading({ lines: LINES })],
      toTick: Number.MAX_SAFE_INTEGER,
    });
    const lines = drawLines({ limit: 20, summary });
    expect(lines[0]).toBe("1 tick(s), 2 API calls, 1 tool calls, 0 compaction(s)");
    expect(lines[5]).toBe(
      [
        "slopweaver board list".padEnd(40),
        "1".padStart(5),
        "1.0".padStart(6),
        "80".padStart(9),
        "80".padStart(8),
        "80".padStart(9),
        "80".padStart(13),
        "0%".padStart(9),
        "0".padStart(7),
      ].join(" "),
    );
  });

  it("prints no verb row past the limit", () => {
    const summary = summariseDraw({
      fromTick: 0,
      readings: [drawReading({ lines: LINES })],
      toTick: Number.MAX_SAFE_INTEGER,
    });
    expect(drawLines({ limit: 0, summary })[5]).toBe("");
  });
});

describe("runTranscriptsDraw", () => {
  it("exits OK on --help without reading a transcript", () => {
    expect(runTranscriptsDraw(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("REFUSES a --from-tick that is not a whole number", () => {
    expect(
      runTranscriptsDraw(argv({ tail: ["--projects", seededProjects(), "--session", SESSION, "--from-tick", "x"] })),
    ).toBe(EXIT_USAGE);
  });

  it("exits OK over a session holding a call, in both output shapes", () => {
    expect(runTranscriptsDraw(argv({ tail: ["--projects", seededProjects(), "--session", SESSION] }))).toBe(EXIT_OK);
    expect(runTranscriptsDraw(argv({ tail: ["--projects", seededProjects(), "--session", SESSION, "--json"] }))).toBe(
      EXIT_OK,
    );
  });

  it("signals expected-empty when the kept ticks hold no call", () => {
    expect(
      runTranscriptsDraw(argv({ tail: ["--projects", seededProjects(), "--session", SESSION, "--from-tick", "1"] })),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });
});
