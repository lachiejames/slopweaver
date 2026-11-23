/**
 * `store import-owner-turn-dump`'s exit codes on the paths that never open a store: a clean dry run, a dump with a
 * refused row, a file that is not there, and a missing `--from`.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runImportOwnerTurnDump } from "../../../../cli/commands/store/importOwnerTurnDumpRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { DUMP_SECTIONS } from "../../../../store/ownerTurnDump/project.js";

const SHA = createHash("sha256").update("Merge it.").digest("hex");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "owner-turn-dump-run-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a one-body dump whose body row claims `length` bytes, and return its path. */
function dumpFile({ length }: { length: number }): string {
  const path = join(dir, "owner-tables.sql");
  writeFileSync(
    path,
    [
      `COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;`,
      `${SHA}\tMerge it.\t${String(length)}\t2026-09-25 12:18:54.838+00`,
      "\\.",
      `COPY public.owner_turn_location (${DUMP_SECTIONS.owner_turn_location}) FROM stdin;`,
      "\\.",
      "",
    ].join("\n"),
  );
  return path;
}

/** Run the verb as the router would, against the temp home. */
function run({ rest }: { rest: readonly string[] }): Promise<number> {
  return runImportOwnerTurnDump(["node", "cli", "store", "import-owner-turn-dump", ...rest, "--home", dir]);
}

describe("store import-owner-turn-dump", () => {
  it("exits 0 on a clean dry run, which opens no store", async () => {
    expect(await run({ rest: ["--from", dumpFile({ length: 9 }), "--dry-run", "--json"] })).toBe(EXIT_OK);
  });

  it("exits 1 on a refused row and writes nothing, dry run or not", async () => {
    expect(await run({ rest: ["--from", dumpFile({ length: 10 })] })).toBe(EXIT_ERROR);
  });

  it("exits 1 on a file that is not there", async () => {
    expect(await run({ rest: ["--from", join(dir, "absent.sql"), "--dry-run"] })).toBe(EXIT_ERROR);
  });

  it("exits 2 with no --from", async () => {
    expect(await run({ rest: ["--dry-run"] })).toBe(EXIT_USAGE);
  });
});
