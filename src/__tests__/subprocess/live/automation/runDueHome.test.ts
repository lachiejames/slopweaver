/**
 * `automation run-due --home <dir>` runs a `verb-run` row's verb against `<dir>`, never the ambient home — proved
 * through the shipped binary.
 *
 * MEASURED: `run-due --recipe store-backup-sweep-hourly --home <throwaway>` read the throwaway's rows
 * and swept the REAL install, because a `verb-run` row's argv carries no `--home` and the verb resolved
 * `$SLOPWEAVER_HOME`. A unit test with a fake `runVerb` cannot see that: the defect lives in the environment the
 * REAL verb child inherits, so this lane spawns the binary with two homes and looks at both.
 *
 * The witness row runs `init run`, which scaffolds whichever home it resolves — `profile.json` is the file it
 * writes there and nowhere else. Each case asserts the positive half (the tick's home got it) beside the
 * negative one (the ambient home did not), so a tick that ran nothing cannot pass by writing nothing anywhere.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const RECIPE_ID = "home-witness";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fresh, empty directory.
 *
 * @param prefix names what the directory stands for, so a leaked one says which it was
 * @returns its absolute path
 */
function freshDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** A row whose own words run a second `run-due`, naming no home: the nested tick a review found. */
const NESTED_RECIPE_ID = "nested-tick";

/**
 * Write one never-run `verb-run` row into a home's definition store.
 *
 * @param home the state home whose store gets the row
 * @param recipeId the row's id, and its file name
 * @param argv the slopweaver words the row runs, carrying no home of their own
 */
function writeVerbRunRow({ argv, home, recipeId }: { argv: readonly string[]; home: string; recipeId: string }): void {
  const definitions = join(home, "live", "recipe", "definitions");
  mkdirSync(definitions, { recursive: true });
  const row = {
    cadence: "30 9 * * *",
    destination: { kind: "local-atlas" },
    effect: "write",
    enabled: true,
    kind: "verb-run",
    onMissed: "backfill",
    params: { argv },
    recipeId,
    schemaVersion: 1,
  };
  writeFileSync(join(definitions, `${recipeId}.json`), JSON.stringify(row), "utf8");
}

/**
 * A tick home carrying one never-run `verb-run` row whose verb scaffolds the home it resolves.
 *
 * @returns the tick home
 */
function tickHomeWithWitnessRow(): string {
  const home = freshDir({ prefix: "run-due-tick-" });
  writeVerbRunRow({ argv: ["init", "run"], home, recipeId: RECIPE_ID });
  return home;
}

/**
 * Run one `run-due` tick through the shipped binary with `$SLOPWEAVER_HOME` naming `ambient`.
 *
 * @param ambient the home the environment names
 * @param tick the home `--home` names
 * @returns the exit status and both streams
 */
function runDue({ ambient, recipeId = RECIPE_ID, tick }: { ambient: string; recipeId?: string; tick: string }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BIN, ["automation", "run-due", "--recipe", recipeId, "--home", tick], {
    encoding: "utf8",
    env: {
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
      SLOPWEAVER_HOME: ambient,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  // `status` is null when the child was KILLED rather than exiting, and coercing that to a number would let a
  // killed binary read as an ordinary non-zero exit.
  if (result.status === null) {
    throw new Error(`bin/slopweaver was killed by signal ${String(result.signal)} rather than exiting`);
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("bin/slopweaver automation run-due --home — a verb-run row runs against the tick's home", () => {
  // ONE spawn proves both shapes, because each spawn of the binary costs ~15s and the subprocess lane is ratcheted
  // on wall time: the outer row starts a second run-due in its verb child, and that inner tick runs the
  // witness row in a child of its own — so the witness's line, `profile.json` in the tick and an empty ambient home
  // prove both the direct and the nested case.
  it("scaffolds the --home it was given through a nested run-due, and writes nothing into the ambient home", () => {
    const ambient = freshDir({ prefix: "run-due-ambient-" });
    const tick = tickHomeWithWitnessRow();
    writeVerbRunRow({
      argv: ["automation", "run-due", "--recipe", RECIPE_ID],
      home: tick,
      recipeId: NESTED_RECIPE_ID,
    });

    const result = runDue({ ambient, recipeId: NESTED_RECIPE_ID, tick });

    expect(result.stderr).not.toContain("still open");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`recipe ${NESTED_RECIPE_ID} · ran · slopweaver automation run-due`);
    expect(result.stdout).toContain(`recipe ${RECIPE_ID} · ran · slopweaver init run · exit 0`);
    expect(existsSync(join(tick, "profile.json"))).toBe(true);
    expect(readdirSync(ambient)).toEqual([]);
  }, 120_000);

  it("leaves the ambient variable naming the ambient home for a tick that names no --home", () => {
    const ambient = tickHomeWithWitnessRow();
    const result = spawnSync(BIN, ["automation", "run-due", "--recipe", RECIPE_ID], {
      encoding: "utf8",
      env: {
        HOME: process.env["HOME"]!,
        PATH: process.env["PATH"]!,
        SLOPWEAVER_CLI_DIR: repoRoot,
        SLOPWEAVER_HOME: ambient,
      },
      maxBuffer: 4 * 1024 * 1024,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`recipe ${RECIPE_ID} · ran · slopweaver init run · exit 0`);
    expect(existsSync(join(ambient, "profile.json"))).toBe(true);
  }, 120_000);
});
