/**
 * The `slopweaver` command as it actually resolves for a plugin install, through the symlink
 * `scripts/plugin-path-shim.sh` installs at `~/.local/bin/slopweaver`.
 *
 * `bin/slopweaver` used to compute `HERE` from `dirname` on `${BASH_SOURCE[0]}` without resolving the
 * symlink first — so through the shim, `HERE` landed on the LINK's own directory (`~/.local/bin`) rather
 * than the mirrored checkout, and `source "$HERE/../hooks/lib/resolve-root.sh"` died on every invocation.
 * This link can never have worked; nobody noticed because the owner's interactive shells resolve
 * `slopweaver` to a shell function that bypasses the symlink entirely.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const REAL_BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;
let linkDir: string;
beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-bin-symlink-home-"));
  linkDir = mkdtempSync(join(tmpdir(), "slop-bin-symlink-bin-"));
});
afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
  rmSync(linkDir, { force: true, recursive: true });
});

describe("bin/slopweaver run through a symlink", () => {
  it("resolves HERE against the symlink's target, not the link's own directory", { timeout: 30_000 }, () => {
    const link = join(linkDir, "slopweaver");
    symlinkSync(REAL_BIN, link);
    const stdout = execFileSync(link, ["catalog"], {
      encoding: "utf8",
      env: { ...accountSandboxChildEnv(), HOME: isolatedHome, PATH: process.env["PATH"]! },
      maxBuffer: 4 * 1024 * 1024,
    });
    const direct = execFileSync(REAL_BIN, ["catalog"], {
      encoding: "utf8",
      env: { ...accountSandboxChildEnv(), HOME: isolatedHome, PATH: process.env["PATH"]! },
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(stdout).toBe(direct);
  });
});
