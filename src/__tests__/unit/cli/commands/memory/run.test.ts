/**
 * The `memory sweep` shell: flag resolution and the exit code it picks.
 *
 * The parse path is asserted through the REAL exported parser plus the verb's own `--stale-after` validation,
 * because that validation is where a silent fallback would hide — a verb that quietly reviewed against 50 days
 * when told `--stale-after ninety` would be reporting a threshold that appears nowhere on screen.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMORY_SWEEP_FLAG_NAMES,
  parseMemorySweepArgs,
  runMemorySweep,
} from "../../../../../cli/commands/memory/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** `[node, cli, memory, sweep, ...]` — the offset the verb slices from. */
function argvFor({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "cli", "memory", "sweep", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A one-leaf corpus in a fresh temp directory. Returns the directory. */
function corpusOnDisk({ files }: { files: Readonly<Record<string, string>> }): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-sweep-cli-"));
  fixtureDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf8");
  }
  return dir;
}

describe("the advertised flags", () => {
  it("are exactly the three the usage line names", () => {
    expect(MEMORY_SWEEP_FLAG_NAMES).toEqual(["--dir", "--json", "--stale-after"]);
  });
});

describe("rejecting an invocation", () => {
  it("refuses with no --dir, because there is no default to fall back to", async () => {
    expect(await runMemorySweep(argvFor({ rest: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses a relative --dir", async () => {
    expect(await runMemorySweep(argvFor({ rest: ["--dir", "memory"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a --stale-after that is not a whole number of days", async () => {
    expect(await runMemorySweep(argvFor({ rest: ["--dir", "/tmp", "--stale-after", "ninety"] }))).toBe(EXIT_USAGE);
    expect(await runMemorySweep(argvFor({ rest: ["--dir", "/tmp", "--stale-after", "1.5"] }))).toBe(EXIT_USAGE);
    expect(await runMemorySweep(argvFor({ rest: ["--dir", "/tmp", "--stale-after", "-3"] }))).toBe(EXIT_USAGE);
  });

  it("accepts a whole-number --stale-after through the real parser", () => {
    const parsed = parseMemorySweepArgs({ rest: ["--dir", "/tmp", "--stale-after", "90"] });

    expect(parsed.isOk()).toBe(true);
  });

  it("refuses an unknown flag", async () => {
    expect(await runMemorySweep(argvFor({ rest: ["--dir", "/tmp", "--strict"] }))).toBe(EXIT_USAGE);
  });

  it("prints usage and succeeds for --help", async () => {
    expect(await runMemorySweep(argvFor({ rest: ["--help"] }))).toBe(EXIT_OK);
  });
});

describe("the exit code", () => {
  it("is 0 when there are memories to lay out", async () => {
    const dir = corpusOnDisk({
      files: {
        "MEMORY.md": "# Index\n\n- [Thing](thing.md) — a thing\n",
        "thing.md": "---\nname: thing\ndescription: a thing\nmetadata:\n  type: reference\n---\n\nBody.\n",
      },
    });

    expect(await runMemorySweep(argvFor({ rest: ["--dir", dir, "--json"] }))).toBe(EXIT_OK);
  });

  it("is 3 when the directory is not a memory corpus", async () => {
    const dir = corpusOnDisk({ files: { "notes.md": "no frontmatter, no index\n" } });

    expect(await runMemorySweep(argvFor({ rest: ["--dir", dir] }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("is 3 for an index with no memories beside it", async () => {
    const dir = corpusOnDisk({ files: { "MEMORY.md": "# Index\n" } });

    expect(await runMemorySweep(argvFor({ rest: ["--dir", dir] }))).toBe(EXIT_EXPECTED_EMPTY);
  });
});
