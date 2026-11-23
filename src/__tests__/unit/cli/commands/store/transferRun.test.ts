/**
 * `store import`'s runner on the exits it takes BEFORE it opens the store: a missing export, a bad argv and a
 * request for help. A whole export goes on to plan against the live store, which a unit test may not reach;
 * that pipeline is tested pure in `unit/store/transfer/compare.test.ts`, and `store export`'s writer in
 * `unit/store/transfer/bundle.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runStoreImport } from "../../../../../cli/commands/store/transferRun.js";
import { STORE_EXPORT_USAGE, STORE_IMPORT_USAGE } from "../../../../../cli/commands/store/transferUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const ARGV0 = ["node", "slopweaver", "store", "import"];
const made: string[] = [];

/** A fresh parent directory for one test. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "transfer-run-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("runStoreImport", () => {
  it("fails on a directory that is not there", async () => {
    expect(await runStoreImport([...ARGV0, "--from", join(scratch(), "absent")])).toBe(EXIT_ERROR);
  });

  it("refuses an argv with no --from before reading anything", async () => {
    expect(await runStoreImport([...ARGV0])).toBe(EXIT_USAGE);
  });

  it("refuses an empty --home before opening the store", async () => {
    expect(await runStoreImport([...ARGV0, "--from", scratch(), "--home", ""])).toBe(EXIT_USAGE);
  });

  it("answers --help", async () => {
    expect(await runStoreImport([...ARGV0, "--help"])).toBe(EXIT_OK);
  });
});

describe("the transfer usage text", () => {
  it("opens on each verb's own usage line", () => {
    expect(STORE_EXPORT_USAGE.startsWith("usage: slopweaver store export --out <dir>")).toBe(true);
    expect(STORE_IMPORT_USAGE.startsWith("usage: slopweaver store import --from <dir>")).toBe(true);
  });
});
