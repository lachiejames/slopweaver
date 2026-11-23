/**
 * Whether the legacy autonomy register is there decides whether the store-backed ledger reads as a fresh register
 * or refuses as unimported, so only a path with NOTHING on the way to it may read as absent: a dangling symlink,
 * at the register or a directory above it, is an install whose register went somewhere, never a fresh one. Each case builds the shape in a throwaway directory.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AutonomyErrors } from "../../../autonomy/errors.js";
import { readAutonomyRegisterFile } from "../../../autonomy/importRegister.js";
import { filePresence } from "../../../autonomy/storeRows.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Every directory this file has minted, so `afterEach` can remove them. */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "autonomy-presence-"));
  dirs.push(dir);
  return dir;
}

describe("filePresence", () => {
  it("reads a register that is there as present", () => {
    const path = join(scratch(), "autonomy.jsonl");
    writeFileSync(path, "\n");
    expect(filePresence({ path })).toEqual({ kind: "present" });
  });

  it("reads a path with nothing on the way to it as absent", () => {
    expect(filePresence({ path: join(scratch(), "ledgers", "autonomy.jsonl") })).toEqual({ kind: "absent" });
  });

  it("reads a dangling symlink at the register as unknown, never absent", () => {
    const dir = scratch();
    const path = join(dir, "autonomy.jsonl");
    symlinkSync(join(dir, "unmounted", "autonomy.jsonl"), path);
    expect(filePresence({ path })).toEqual({ kind: "unknown", reason: `${path} is behind a dangling symlink` });
  });

  it("reads a dangling symlink at the directory above the register as unknown, never absent", () => {
    const dir = scratch();
    symlinkSync(join(dir, "unmounted"), join(dir, "ledgers"));
    const path = join(dir, "ledgers", "autonomy.jsonl");
    expect(filePresence({ path })).toEqual({ kind: "unknown", reason: `${path} is behind a dangling symlink` });
  });
});

describe("readAutonomyRegisterFile", () => {
  it("refuses a register behind a dangling symlink even where an absent one reads as empty", () => {
    const dir = scratch();
    mkdirSync(join(dir, "ledgers"));
    const path = join(dir, "ledgers", "autonomy.jsonl");
    symlinkSync(join(dir, "unmounted", "autonomy.jsonl"), path);
    expect(unwrapErr(readAutonomyRegisterFile({ missing: "empty", path }))).toEqual(
      AutonomyErrors.storeUnreadable({ cause: "the register could not be reached — check its permissions", path }),
    );
  });

  it("reads an absent register as empty when asked to", () => {
    const path = join(scratch(), "autonomy.jsonl");
    expect(unwrap(readAutonomyRegisterFile({ missing: "empty", path }))).toEqual({ records: [], unparsed: [] });
  });

  it("refuses an absent register when its absence is an error", () => {
    const path = join(scratch(), "autonomy.jsonl");
    expect(unwrapErr(readAutonomyRegisterFile({ missing: "error", path }))).toEqual(
      AutonomyErrors.storeUnreadable({ cause: "the file does not exist", path }),
    );
  });

  it("refuses a register that is present but cannot be read as lines, rather than reading it as empty", () => {
    const path = join(scratch(), "autonomy.jsonl");
    mkdirSync(path);
    const refused = unwrapErr(readAutonomyRegisterFile({ missing: "empty", path }));
    expect(refused.code).toBe("STORE_UNREADABLE");
    expect(refused.message).toBe(
      `could not read the autonomy ledger at ${path} — refusing rather than reporting it empty`,
    );
  });
});
