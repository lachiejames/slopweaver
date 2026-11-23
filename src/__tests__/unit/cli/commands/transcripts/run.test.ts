/**
 * The `transcripts` shell end to end over a REAL temporary projects directory this test writes and the
 * shipped code reads back — no mocks, and no dependence on the machine's own `~/.claude`.
 *
 * **These assert the EXIT CODE, and are named for that.** `logger.out` writes to file descriptor 1 directly
 * rather than through `process.stdout.write`, so nothing in this lane can observe what was printed without
 * inventing a seam that does not exist in production. What is RENDERED is asserted against the pure
 * renderers in `render.test.ts`, and that the shipped binary really prints the retention bound on stdout is
 * asserted in the subprocess lane, through the real door — see
 * `src/__tests__/subprocess/cli/commands/transcripts/retentionOutput.test.ts`.
 *
 * The exit codes are worth asserting on their own account: `EXIT_EXPECTED_EMPTY` is how a caller piping this
 * into an alert learns its window found nothing, and `EXIT_USAGE` is how the unscoped-sweep rail reads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runTranscriptsLatency,
  transcriptsLatencyCommand,
} from "../../../../../cli/commands/transcripts/latencyRun.js";
import {
  runTranscriptsErrors,
  runTranscriptsSessions,
  runTranscriptsSummary,
  runTranscriptsTurns,
  transcriptsErrorsCommand,
  transcriptsSessionsCommand,
  transcriptsSummaryCommand,
  transcriptsTurnsCommand,
} from "../../../../../cli/commands/transcripts/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const SESSION = "aaaaaaaa-0000-0000-0000-000000000001";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A projects directory holding one transcript with a human turn, a failing tool call and machine traffic. */
function seededProjects(): string {
  const projects = mkdtempSync(join(tmpdir(), "transcripts-run-"));
  fixtureDirs.push(projects);
  const dir = join(projects, "-repo-alpha");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${SESSION}.jsonl`),
    `${[
      JSON.stringify({
        cwd: "/repo",
        message: { content: "do the thing", role: "user" },
        origin: { kind: "human" },
        promptSource: "typed",
        timestamp: "2026-08-27T10:00:00.000Z",
        type: "user",
      }),
      JSON.stringify({
        message: {
          content: [{ id: "t1", input: {}, name: "Bash", type: "tool_use" }],
          model: "claude-opus-5",
          role: "assistant",
        },
        timestamp: "2026-08-27T10:00:01.000Z",
        type: "assistant",
      }),
      JSON.stringify({
        message: {
          content: [{ content: "Exit code 1", is_error: true, tool_use_id: "t1", type: "tool_result" }],
          role: "user",
        },
        timestamp: "2026-08-27T10:00:02.000Z",
        type: "user",
      }),
      JSON.stringify({ title: "housekeeping", type: "ai-title" }),
    ].join("\n")}\n`,
  );
  return projects;
}

/** An argv for one verb. */
function argv({ verb, tail }: { verb: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "transcripts", verb, ...tail];
}

describe("every verb's parse phase", () => {
  it("exits OK on --help without reading a transcript", () => {
    expect(runTranscriptsSessions(argv({ tail: ["--help"], verb: "sessions" }))).toBe(EXIT_OK);
    expect(runTranscriptsTurns(argv({ tail: ["--help"], verb: "turns" }))).toBe(EXIT_OK);
    expect(runTranscriptsSummary(argv({ tail: ["--help"], verb: "summary" }))).toBe(EXIT_OK);
    expect(runTranscriptsErrors(argv({ tail: ["--help"], verb: "errors" }))).toBe(EXIT_OK);
  });

  it("REFUSES an unknown flag on every verb", () => {
    expect(runTranscriptsSessions(argv({ tail: ["--grep", "x"], verb: "sessions" }))).toBe(EXIT_USAGE);
    expect(runTranscriptsTurns(argv({ tail: ["--grep", "x"], verb: "turns" }))).toBe(EXIT_USAGE);
    expect(runTranscriptsSummary(argv({ tail: ["--grep", "x"], verb: "summary" }))).toBe(EXIT_USAGE);
    expect(runTranscriptsErrors(argv({ tail: ["--grep", "x"], verb: "errors" }))).toBe(EXIT_USAGE);
  });

  it("REFUSES an unscoped sweep on every scanning verb rather than walking the whole machine", () => {
    expect(runTranscriptsTurns(argv({ tail: [], verb: "turns" }))).toBe(EXIT_USAGE);
    expect(runTranscriptsSummary(argv({ tail: [], verb: "summary" }))).toBe(EXIT_USAGE);
    expect(runTranscriptsErrors(argv({ tail: [], verb: "errors" }))).toBe(EXIT_USAGE);
  });

  it("does NOT require a scope for `sessions`, which stats files and reads none of them", () => {
    expect(runTranscriptsSessions(argv({ tail: ["--projects", seededProjects()], verb: "sessions" }))).toBe(EXIT_OK);
  });

  it("REFUSES a --limit that is not a positive whole number", () => {
    expect(
      runTranscriptsSessions(argv({ tail: ["--projects", seededProjects(), "--limit", "0"], verb: "sessions" })),
    ).toBe(EXIT_USAGE);
  });

  it("REFUSES a --since it cannot read", () => {
    expect(runTranscriptsTurns(argv({ tail: ["--since", "yesterday-ish"], verb: "turns" }))).toBe(EXIT_USAGE);
  });
});

describe("exit codes over a real transcript", () => {
  it("exits OK for a listing that found something", () => {
    expect(runTranscriptsSessions(argv({ tail: ["--projects", seededProjects()], verb: "sessions" }))).toBe(EXIT_OK);
  });

  it("signals expected-empty for a projects directory holding nothing", () => {
    const emptyProjects = mkdtempSync(join(tmpdir(), "transcripts-none-"));
    fixtureDirs.push(emptyProjects);
    expect(runTranscriptsSessions(argv({ tail: ["--projects", emptyProjects], verb: "sessions" }))).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("signals expected-empty for a window that predates every transcript on disk", () => {
    expect(
      runTranscriptsSessions(
        argv({
          tail: ["--projects", seededProjects(), "--since", "2026-01-01", "--until", "2026-02-01"],
          verb: "sessions",
        }),
      ),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits OK for the human turns of a session that has one", () => {
    expect(
      runTranscriptsTurns(argv({ tail: ["--projects", seededProjects(), "--session", SESSION], verb: "turns" })),
    ).toBe(EXIT_OK);
  });

  it("signals expected-empty for the turns of a session that is not there", () => {
    expect(
      runTranscriptsTurns(argv({ tail: ["--projects", seededProjects(), "--session", "nope"], verb: "turns" })),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits OK for a summary of a session that has one, in both output shapes", () => {
    expect(
      runTranscriptsSummary(argv({ tail: ["--projects", seededProjects(), "--session", SESSION], verb: "summary" })),
    ).toBe(EXIT_OK);
    expect(
      runTranscriptsSummary(
        argv({ tail: ["--projects", seededProjects(), "--session", SESSION, "--json"], verb: "summary" }),
      ),
    ).toBe(EXIT_OK);
  });

  it("signals expected-empty for a summary whose scope walked nothing", () => {
    expect(
      runTranscriptsSummary(argv({ tail: ["--projects", seededProjects(), "--session", "nope"], verb: "summary" })),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits OK for a session carrying a failing tool call, and expected-empty for one that is not there", () => {
    expect(
      runTranscriptsErrors(argv({ tail: ["--projects", seededProjects(), "--session", SESSION], verb: "errors" })),
    ).toBe(EXIT_OK);
    expect(
      runTranscriptsErrors(argv({ tail: ["--projects", seededProjects(), "--session", "nope"], verb: "errors" })),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("exits OK for a whole-corpus sweep scoped by --since, in both output shapes", () => {
    const projects = seededProjects();
    expect(runTranscriptsTurns(argv({ tail: ["--projects", projects, "--since", "3650d"], verb: "turns" }))).toBe(
      EXIT_OK,
    );
    expect(
      runTranscriptsTurns(
        argv({ tail: ["--projects", projects, "--since", "3650d", "--json", "--full"], verb: "turns" }),
      ),
    ).toBe(EXIT_OK);
    expect(
      runTranscriptsErrors(argv({ tail: ["--projects", projects, "--since", "3650d", "--json"], verb: "errors" })),
    ).toBe(EXIT_OK);
  });
});

describe("the manifest's exported commands", () => {
  it("are the run functions the manifest loads", () => {
    expect(transcriptsSessionsCommand).toBe(runTranscriptsSessions);
    expect(transcriptsTurnsCommand).toBe(runTranscriptsTurns);
    expect(transcriptsSummaryCommand).toBe(runTranscriptsSummary);
    expect(transcriptsErrorsCommand).toBe(runTranscriptsErrors);
    expect(transcriptsLatencyCommand).toBe(runTranscriptsLatency);
  });
});

describe("transcripts latency over a real transcript", () => {
  it("exits OK on --help without reading a transcript", () => {
    expect(runTranscriptsLatency(argv({ tail: ["--help"], verb: "latency" }))).toBe(EXIT_OK);
  });

  it("REFUSES an unscoped sweep, an unknown flag, a bad --bucket and a bad --split", () => {
    expect(runTranscriptsLatency(argv({ tail: [], verb: "latency" }))).toBe(EXIT_USAGE);
    expect(runTranscriptsLatency(argv({ tail: ["--grep", "x"], verb: "latency" }))).toBe(EXIT_USAGE);
    expect(
      runTranscriptsLatency(
        argv({ tail: ["--projects", seededProjects(), "--since", "3650d", "--bucket", "0"], verb: "latency" }),
      ),
    ).toBe(EXIT_USAGE);
    expect(
      runTranscriptsLatency(
        argv({
          tail: ["--projects", seededProjects(), "--since", "3650d", "--split", "the-other-day"],
          verb: "latency",
        }),
      ),
    ).toBe(EXIT_USAGE);
  });

  it("exits OK for a session whose one call was answered, in both output shapes", () => {
    const projects = seededProjects();
    expect(runTranscriptsLatency(argv({ tail: ["--projects", projects, "--session", SESSION], verb: "latency" }))).toBe(
      EXIT_OK,
    );
    expect(
      runTranscriptsLatency(
        argv({
          tail: ["--projects", projects, "--session", SESSION, "--json", "--split", "2026-08-27T10:00:00Z"],
          verb: "latency",
        }),
      ),
    ).toBe(EXIT_OK);
  });

  it("signals expected-empty when the tool filter keeps nothing", () => {
    expect(
      runTranscriptsLatency(
        argv({ tail: ["--projects", seededProjects(), "--since", "3650d", "--tool", "Notatool"], verb: "latency" }),
      ),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("signals expected-empty when the command prefix keeps nothing", () => {
    expect(
      runTranscriptsLatency(
        argv({
          tail: ["--projects", seededProjects(), "--since", "3650d", "--command-prefix", "kubectl "],
          verb: "latency",
        }),
      ),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });
});
