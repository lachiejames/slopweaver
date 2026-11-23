/**
 * The automation surface as SHIPPED, proved through the real binary: `seat` is the only path to a
 * spawn-shaped row, and no dispatcher is left to be one.
 *
 * This replaces `schedulerSurface.test.ts`, which held down the retirement of a private CLI on verbs that
 * are now deleted outright. Deleting a test because its subject is gone leaves nothing
 * holding the deletion down — a later change could reintroduce a scheduler verb and no lane would notice —
 * so the same file keeps doing the same job against the surface that actually ships.
 *
 * Each absence is paired with a POSITIVE assertion on the same output, per `testing.md`: a `not.toContain`
 * over an output that failed to render at all would pass for the wrong reason, so every case first proves
 * the output it is reading is really the noun's own.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately — `bin/slopweaver` otherwise resolves its checkout from an
 * ambient cwd, which in this lane is whatever vitest happened to start in.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Exit codes this verb family uses — see `src/cli/exitCodes.ts`. */
const EXIT_EXPECTED_EMPTY = 3;
const EXIT_USAGE = 2;

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, empty state home — no registration, no definitions, no claims. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "seat-surface-home-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * Run the shipped binary. `spawnSync` rather than `execFileSync` because this suite reads stderr on both a
 * zero and a non-zero exit.
 */
function runRecipe({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, ["recipe", ...args], {
    encoding: "utf8",
    env: {
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  // `status` is null when the child was KILLED rather than exiting, and coercing that to a number would let
  // a killed binary read as an ordinary non-zero exit — the substitution `no-silent-fallback` refuses.
  if (result.status === null) {
    throw new Error(`bin/slopweaver was killed by signal ${String(result.signal)} rather than exiting`);
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("bin/slopweaver automation — nothing on the shipped surface dispatches a spawn-shaped row", () => {
  it("routes the seven verbs that survived the retirement", () => {
    const result = runRecipe({ args: ["--help"] });

    expect(result.status).toBe(EXIT_USAGE);
    const printed = `${result.stdout}${result.stderr}`;
    for (const verb of ["blocker", "claim", "due", "register-resyncs", "resync", "run-due", "seat"]) {
      expect(printed).toContain(verb);
    }
  });

  // Each absence is paired with a POSITIVE assertion on the same output: a `not.toContain` over an output
  // that failed to render at all would pass for the wrong reason.
  it("routes no scheduler verb, so no session can register itself as one", () => {
    const result = runRecipe({ args: ["--help"] });

    expect(result.status).toBe(EXIT_USAGE);
    const printed = `${result.stdout}${result.stderr}`;
    expect(printed).toContain("seat");
    for (const verb of ["scheduler-tick", "scheduler-start", "scheduler-ready", "scheduler-status"]) {
      expect(printed).not.toContain(verb);
    }
  });

  // The verb NAMES go with the retirement; the prose printed one line below them did not, and this file read that
  // same output and passed anyway — it asserted only on hyphenated names, so the noun summary went on
  // reading "claim, dispatch, poll and complete a scheduled slot" for the whole retirement. A surface that
  // still DESCRIBES the dispatcher is the finding's own complaint, so it is held down beside the names.
  it("describes no dispatch-and-poll shape, so the retired machinery does not read as live prose", () => {
    const result = runRecipe({ args: ["--help"] });

    expect(result.status).toBe(EXIT_USAGE);
    const printed = `${result.stdout}${result.stderr}`;
    expect(printed).toContain("seat");
    expect(printed).not.toContain("dispatch");
    expect(printed).not.toContain("poll");
  });

  it("routes no slot verb, so no dispatched child has an entrance to report through", () => {
    const result = runRecipe({ args: ["--help"] });

    expect(result.status).toBe(EXIT_USAGE);
    const printed = `${result.stdout}${result.stderr}`;
    expect(printed).toContain("run-due");
    for (const verb of ["slot-start", "slot-post", "slot-finish", "slot-ignore"]) {
      expect(printed).not.toContain(verb);
    }
  });

  it("refuses `scheduler-tick` as an unknown verb rather than running one", () => {
    const result = runRecipe({ args: ["scheduler-tick", "--home", emptyHome()] });

    expect(result.status).toBe(EXIT_USAGE);
    expect(`${result.stdout}${result.stderr}`).toContain("seat");
  });

  // `automation seat` is the ONLY path to a spawn-shaped row now, and it refuses to guess either of its two
  // required choices — how many rows one session should take, and which model it runs on (AGENTS.md rule 5).
  it("refuses a seat that names neither a bound nor a model", () => {
    const result = runRecipe({ args: ["seat", "--home", emptyHome()] });

    expect(result.status).toBe(EXIT_USAGE);
    const printed = `${result.stdout}${result.stderr}`;
    expect(printed).toContain("--limit");
    expect(printed).toContain("--model");
  });

  it("exits 3 on a home with nothing to seat — a status, not a fault", () => {
    const result = runRecipe({ args: ["seat", "--limit", "1", "--model", "sonnet", "--home", emptyHome()] });

    expect(result.status).toBe(EXIT_EXPECTED_EMPTY);
    expect(`${result.stdout}${result.stderr}`).toContain("nothing needs a session");
  });
});
