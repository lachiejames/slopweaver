/**
 * `supervisor tick open --home <scratch>` against the shipped binary, with every reading's child a recorder: each one
 * runs with `SLOPWEAVER_HOME` set to the scratch home rather than the sentinel ambient one this process carries, no
 * withheld reading launches at all, no monitor is handed `--fire`, and the open says which readings it withheld.
 * The defect it holds down: an installed-app trial's `tick open --home` ran every child against the owner's real home,
 * advancing its events cursor and pressing its pull requests (`../../../../../supervisor/scratch/tickConfinement.ts`).
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** The two-word verbs of every reading a confined open withholds. */
const WITHHELD_VERBS = [
  "events tail",
  "session close-done",
  "handover wake",
  "github landing",
  "github bump-drive",
  "turn dispatch",
  "codex reset",
  "claude gauge",
  "codex route",
  "queue refusals",
  "queue stopping",
  "org-health read",
  "hand recheck",
  "hand wake",
  "handover register",
  "cmux spawn",
];

let workspace: string;
let ambient: string;
let scratch: string;
let seatDir: string;
let recorderLog: string;
let recorder: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "tick-confined-"));
  ambient = join(workspace, "ambient-home");
  scratch = join(workspace, "scratch-home");
  seatDir = join(workspace, "seat");
  mkdirSync(ambient, { recursive: true });
  mkdirSync(join(scratch, "handovers"), { recursive: true });
  mkdirSync(seatDir, { recursive: true });
  recorderLog = join(workspace, "children.tsv");
  recorder = join(workspace, "recorder");
  // Stands in for every reading's `slopweaver`: one line per child, its home then its argv, and an empty document.
  writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\t%s\\n' "$SLOPWEAVER_HOME" "$*" >> '${recorderLog}'\necho '{}'\n`);
  chmodSync(recorder, 0o755);
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/** Run the shipped CLI with the sentinel ambient home, and no cmux or Claude config of the operator's. */
function cli({ args }: { args: readonly string[] }): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(workspace, "claude"),
    CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"),
    SLOPWEAVER_HOME: ambient,
  };
  const run = spawnSync(BIN, args, { cwd: workspace, encoding: "utf8", env, timeout: 240_000 });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

/** Every child the recorder saw, as its home and its argv joined by spaces. */
function children(): readonly { home: string; argv: string }[] {
  return readFileSync(recorderLog, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const [home, argv] = line.split("\t");
      return { argv: argv!, home: home! };
    });
}

describe("supervisor tick open --home, through the shipped binary", () => {
  it("runs every reading's child under the scratch home, launching no withheld reading and firing no monitor", () => {
    const seated = cli({
      args: [
        "supervisor",
        "tick",
        "seat",
        "--dir",
        seatDir,
        // The seat directory carries no chair number in its name, so the seat is told it.
        "--handoff",
        "handoff-9007",
        "--workspace",
        "workspace:93",
        "--model",
        "fable",
        "--pinned-at",
        "2026-09-23T14:36:00Z",
        "--loop-session-key",
        "k",
        "--landing-repos",
        "acme/widgets",
      ],
    });
    // Its stderr rides in the diff a failed seat prints, never in the comparison.
    expect({ status: seated.status, stderr: seated.stderr }).toEqual({ status: 0, stderr: seated.stderr });

    const opened = cli({
      args: ["supervisor", "tick", "open", "--dir", seatDir, "--home", scratch, "--bin", recorder],
    });
    // As with the seat: stderr shows in a failure's diff, and may carry a behind-trunk banner on a passing one.
    expect({ status: opened.status, stderr: opened.stderr }).toEqual({ status: 0, stderr: opened.stderr });

    const seen = children();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((child) => child.home !== scratch)).toEqual([]);
    expect(seen.filter((child) => child.argv.split(" ").includes("--fire"))).toEqual([]);
    expect(
      WITHHELD_VERBS.filter((verb) => seen.some((child) => child.argv.split(" ").slice(0, 2).join(" ") === verb)),
    ).toEqual([]);
    expect(seen.map((child) => child.argv)).toContain(
      "monitor check --only fleet-unhealthy --by-session supervisor --json",
    );

    expect(opened.stdout).toContain(
      `CONFINED tick: every reading ran with SLOPWEAVER_HOME=${scratch}, not the ambient ${ambient}`,
    );
    expect(opened.stdout).toContain(
      "withheld landing: it presses, enqueues and registers the owner's pull requests on GitHub",
    );
    expect(opened.stdout).toContain(
      "withheld stopped-recipe seating: it registers a board row and runs a real cmux spawn",
    );

    const capture = readFileSync(join(seatDir, "tick-1", "capture.json"), "utf8");
    expect(['"events"', '"landing"', '"handover-wake"'].filter((name) => capture.includes(name))).toEqual([]);
    expect(existsSync(ambient)).toBe(true);
    expect(readdirSync(ambient)).toEqual([]);
  });
});
