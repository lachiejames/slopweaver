/**
 * A slot is stamped with its commit only once a verification proves it holds the whole source.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  commitAll,
  fixture,
  fixtureDirs,
  MATCH_LINE,
  mirrorRoot,
  runOnce,
  stampOf,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

/**
 * An `rsync` on PATH that copies every mirrored entry but `bin`, standing in for anything that deletes inside a
 * slot mid-copy. Dry runs pass straight through, so the verification the stamp depends on is the real one.
 *
 * @returns the directory to prepend to PATH
 */
function binLosingRsyncDir(): string {
  const real = execFileSync("bash", ["-c", "command -v rsync"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(join(tmpdir(), "sw-rsync-lossy-"));
  const body = [
    "#!/bin/sh",
    `case "$*" in *--dry-run*) exec "${real}" "$@" ;; esac`,
    `case "$2" in */bin) exit 0 ;; esac`,
    `exec "${real}" "$@"`,
  ].join("\n");
  writeFileSync(join(dir, "rsync"), `${body}\n`, { mode: 0o755 });
  return dir;
}

describe("a slot is stamped only when it provably holds the source", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("leaves a slot that lost files mid-copy unstamped, so the next boot rebuilds it whole", () => {
    const { root, data, bin } = fixture();
    commitAll({ message: "one", root });
    const shim = binLosingRsyncDir();
    fixtureDirs.push(shim);
    const lossyEnv = { PATH: `${shim}:${process.env["PATH"]!}` };
    runOnce({ bin, data, extraEnv: lossyEnv, root });
    const current = join(mirrorRoot({ data, root }), "current");
    // The damage is real: the slot current names is missing the file every hook command's bin resolves.
    expect(existsSync(join(current, "bin", "slopweaver"))).toBe(false);
    expect(existsSync(stampOf({ data, root, slot: ".slot-a" }))).toBe(false);

    expect(runOnce({ bin, data, root })).not.toContain(MATCH_LINE);
    expect(existsSync(join(current, "bin", "slopweaver"))).toBe(true);
    expect(runOnce({ bin, data, root })).toContain(MATCH_LINE);
  });
});
