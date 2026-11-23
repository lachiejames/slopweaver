/**
 * `transcripts boot-hooks` end to end over a REAL temporary projects directory — no mocks, and no dependence
 * on the machine's own `~/.claude`. Asserts the EXIT CODE, which is the probe's whole contract: `run.test.ts`
 * says why stdout is not observable in this lane.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bootHooksExitCode,
  runTranscriptsBootHooks,
  transcriptsBootHooksCommand,
} from "../../../../../cli/commands/transcripts/bootHooks.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { CHUNK_BYTES, MAX_LINE_BYTES } from "../../../../../transcripts/source.js";

const SESSION = "aaaaaaaa-0000-0000-0000-000000000001";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A SessionStart 127 record in the shape a real seat wrote, at the instant given. */
function bootFailure({ timestamp }: { timestamp: string }): string {
  return JSON.stringify({
    attachment: {
      command: '"${PLUGIN_DATA}/mirror/by-root${PLUGIN_ROOT}/current/scripts/hook.sh" 10 profile-context "…"',
      exitCode: 127,
      hookEvent: "SessionStart",
      hookName: "SessionStart:startup",
      stderr:
        "Failed with non-blocking status code: /bin/sh: /d/mirror/by-root/r/current/scripts/hook.sh: No such file or directory",
      type: "hook_non_blocking_error",
    },
    cwd: "/repo/wt",
    timestamp,
    type: "attachment",
  });
}

/** A projects directory holding one transcript made of the given lines. */
function projectsWith({ lines }: { lines: readonly string[] }): string {
  const projects = mkdtempSync(join(tmpdir(), "transcripts-boot-"));
  fixtureDirs.push(projects);
  const dir = join(projects, "-repo-wt");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION}.jsonl`), `${lines.join("\n")}\n`);
  return projects;
}

const CLEAN_LINE = JSON.stringify({
  attachment: { exitCode: 0, hookEvent: "SessionStart", hookName: "SessionStart:startup", type: "hook_success" },
  timestamp: "2026-10-03T13:51:30.000Z",
  type: "attachment",
});

/** An argv for the verb. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "transcripts", "boot-hooks", ...tail];
}

describe("transcripts boot-hooks", () => {
  it("exits OK on --help, and REFUSES an unknown flag and an unscoped sweep", () => {
    expect(runTranscriptsBootHooks(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
    expect(runTranscriptsBootHooks(argv({ tail: ["--grep", "x"] }))).toBe(EXIT_USAGE);
    expect(runTranscriptsBootHooks(argv({ tail: [] }))).toBe(EXIT_USAGE);
  });

  it("FAILS on a seat whose SessionStart hook exited 127, in both output shapes", () => {
    const projects = projectsWith({ lines: [bootFailure({ timestamp: "2026-10-03T13:51:30.851Z" })] });
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--session", SESSION] }))).toBe(EXIT_ERROR);
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--session", SESSION, "--json"] }))).toBe(
      EXIT_ERROR,
    );
  });

  it("passes a seat whose boot hooks all ran", () => {
    const projects = projectsWith({ lines: [CLEAN_LINE] });
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--session", SESSION] }))).toBe(EXIT_OK);
  });

  it("FAILS beside a clean seat when a project directory could not be listed, since its transcripts went unread", () => {
    const projects = projectsWith({ lines: [CLEAN_LINE] });
    const hidden = join(projects, "-repo-hidden");
    mkdirSync(hidden);
    chmodSync(hidden, 0o000);
    try {
      expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--since", "1d"] }))).toBe(EXIT_ERROR);
      expect(
        runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--since", "1d", "--project", "-wt"] })),
      ).toBe(EXIT_OK);
    } finally {
      chmodSync(hidden, 0o755);
    }
  });

  it("judges each RECORD by the window, so an old boot failure in a live transcript does not fail a later probe", () => {
    // The file was written just now, so --since selects it; the 127 inside it is from 2020.
    const projects = projectsWith({ lines: [bootFailure({ timestamp: "2020-01-01T00:00:00.000Z" }), CLEAN_LINE] });
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--since", "1d"] }))).toBe(EXIT_OK);
  });

  it("FAILS on an in-window boot failure in a transcript last written AFTER --until", () => {
    // The file's mtime is now, past --until; the 127 inside it sits inside the window.
    const projects = projectsWith({ lines: [bootFailure({ timestamp: "2026-10-01T12:00:00.000Z" }), CLEAN_LINE] });
    const window = ["--since", "2026-10-01T00:00:00Z", "--until", "2026-10-02T00:00:00Z"];
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, ...window] }))).toBe(EXIT_ERROR);
  });

  it("FAILS on a transcript holding a line past the walker's limit, which could hide a 127", () => {
    // A line still unfinished once the buffer passes the per-line ceiling at a chunk boundary is yielded
    // with no text at all, so the padding clears the ceiling by a whole chunk.
    const padded = JSON.stringify({ padding: "x".repeat(MAX_LINE_BYTES + 2 * CHUNK_BYTES), type: "attachment" });
    const projects = projectsWith({ lines: [CLEAN_LINE, padded] });
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--session", SESSION] }))).toBe(EXIT_ERROR);
  });

  it("signals expected-empty when the scope holds no transcript, rather than a clean bill over nothing", () => {
    const projects = projectsWith({ lines: [CLEAN_LINE] });
    expect(runTranscriptsBootHooks(argv({ tail: ["--projects", projects, "--session", "not-a-seat"] }))).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("is the registered command", () => {
    expect(transcriptsBootHooksCommand).toBe(runTranscriptsBootHooks);
  });
});

describe("bootHooksExitCode", () => {
  it("is 1 on any failure or unreadable transcript, 3 over nothing walked, 0 over a clean walk", () => {
    const clean = { failures: 0, seats: [], sessionsWalked: 2 };
    expect(bootHooksExitCode({ reading: { failures: 1, seats: [], sessionsWalked: 1 }, unreadable: 0 })).toBe(
      EXIT_ERROR,
    );
    expect(bootHooksExitCode({ reading: clean, unreadable: 1 })).toBe(EXIT_ERROR);
    expect(bootHooksExitCode({ reading: { failures: 0, seats: [], sessionsWalked: 0 }, unreadable: 0 })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(bootHooksExitCode({ reading: clean, unreadable: 0 })).toBe(EXIT_OK);
  });
});
