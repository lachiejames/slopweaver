/**
 * The doc's own gate, proved through the real door: the SHIPPED `bin/slopweaver transcripts` binary prints
 * the retention bound on stdout, and a window older than every transcript on disk says the evidence was
 * DELETED rather than reporting an empty result.
 *
 * This cannot live on the unit lane. `logger.out` writes to file descriptor 1 directly rather than through
 * `process.stdout.write`, so an in-process test can only observe the exit code — and a verb that had lost
 * its retention line entirely would stay green there. Spawning the binary observes the bytes a person
 * actually sees.
 *
 * `HOME` is an isolated temp directory and `--projects` points at a fixture this test wrote, so a passing
 * run proves nothing about — and reads nothing from — the machine's own `~/.claude`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SESSION = "aaaaaaaa-0000-0000-0000-000000000001";

let isolatedHome: string;
let projects: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-transcripts-home-"));
  projects = join(isolatedHome, "projects");
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
        message: { content: [{ text: "on it", type: "text" }], model: "claude-opus-5", role: "assistant" },
        timestamp: "2026-08-27T10:00:01.000Z",
        type: "assistant",
      }),
    ].join("\n")}\n`,
  );
});

afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment. */
function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: isolatedHome,
      encoding: "utf8",
      env: { HOME: isolatedHome, PATH: process.env["PATH"]! },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    // `execFileSync` always sets these once the subprocess actually ran with `encoding` given; an undefined
    // status would mean it never spawned, which is a different failure this test is not exercising.
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("bin/slopweaver transcripts — the retention bound reaches stdout", () => {
  it("states the nominal window and the measured floor on an ordinary listing", { timeout: 60_000 }, () => {
    const result = run({ args: ["transcripts", "sessions", "--projects", projects] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Claude Code retains roughly 31 days");
    expect(result.stdout).toContain("Holding 1 transcripts");
    expect(result.stdout).toContain(SESSION);
  });

  it("says the evidence was DELETED for a window older than every transcript on disk", { timeout: 60_000 }, () => {
    const result = run({
      args: ["transcripts", "sessions", "--projects", projects, "--since", "2026-01-01", "--until", "2026-02-01"],
    });
    // 3 is EXIT_EXPECTED_EMPTY: the verb ran correctly and is reporting a legitimate non-success status.
    expect(result.status).toBe(3);
    expect(result.stdout).toContain("OUTSIDE THE WINDOW");
    expect(result.stdout).toContain("the evidence was DELETED, not that nothing happened");
  });

  it("carries the same verdict in --json, so a machine reader sees the bound too", { timeout: 60_000 }, () => {
    const result = run({ args: ["transcripts", "summary", "--projects", projects, "--session", SESSION, "--json"] });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly retention: { readonly verdict: string; readonly transcriptCount: number };
      readonly summary: { readonly humanTurns: number; readonly assistantTurns: number };
    };
    expect(payload.retention.verdict).toBe("within-retention");
    expect(payload.retention.transcriptCount).toBe(1);
    expect(payload.summary.humanTurns).toBe(1);
    expect(payload.summary.assistantTurns).toBe(1);
  });

  it("prints the human turn with every machine turn stripped", { timeout: 60_000 }, () => {
    const result = run({ args: ["transcripts", "turns", "--projects", projects, "--session", SESSION] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[typed]  do the thing");
    expect(result.stdout).toContain("1 human turns across 1 transcripts (0 unreadable), 1 shown");
  });

  it("has no search verb at all, and refuses one rather than quietly ignoring it", { timeout: 60_000 }, () => {
    const result = run({ args: ["transcripts", "grep", "anything"] });
    expect(result.status).not.toBe(0);
  });
});
