/**
 * The `slopweaver` command a colleague actually gets.
 *
 * 221 lines of this repository's docs and skills tell a reader to run `slopweaver <verb>`. On the owner's
 * machine a shell function resolves that; on a plugin install nothing does, so `scripts/plugin-path-shim.sh`
 * installs the command those lines already name. What it must never do is take a name somebody else owns —
 * a shim that silently replaced a real binary would be a worse defect than the one it fixes.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = new URL("../../../../scripts/plugin-path-shim.sh", import.meta.url).pathname;

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A HOME with a valid plugin mirror in it, and nothing else. */
function fixture(): { home: string; mirrorCurrent: string; target: string } {
  const home = mkdtempSync(join(tmpdir(), "sw-shim-"));
  fixtureDirs.push(home);
  const slot = join(home, ".claude", "plugins", "data", "slopweaver", "mirror", "a");
  mkdirSync(join(slot, "bin"), { recursive: true });
  const cli = join(slot, "bin", "slopweaver");
  writeFileSync(cli, "#!/bin/sh\necho MIRRORED\n", { mode: 0o755 });
  const mirrorCurrent = join(home, ".claude", "plugins", "data", "slopweaver", "mirror", "current");
  symlinkSync("a", mirrorCurrent);
  return { home, mirrorCurrent, target: join(mirrorCurrent, "bin", "slopweaver") };
}

/** A valid mirror built somewhere that is NOT under any real plugin data root — a throwaway reproduction. */
function outOfRootMirror(): { mirrorCurrent: string } {
  const base = mkdtempSync(join(tmpdir(), "sw-shim-scratch-"));
  fixtureDirs.push(base);
  const slot = join(base, "mirror", "a");
  mkdirSync(join(slot, "bin"), { recursive: true });
  writeFileSync(join(slot, "bin", "slopweaver"), "#!/bin/sh\necho SCRATCH\n", { mode: 0o755 });
  const mirrorCurrent = join(base, "mirror", "current");
  symlinkSync("a", mirrorCurrent);
  return { mirrorCurrent };
}

/**
 * Run the shim as a session start does.
 *
 * @param home the HOME it writes into
 * @param mirrorCurrent the mirror link the caller passes it
 * @param path the PATH the user's shell would have
 * @returns whatever the script wrote to stderr
 */
function runShim({ home, mirrorCurrent, path }: { home: string; mirrorCurrent: string; path: string }): string {
  const result = execFileSync("bash", [SCRIPT, mirrorCurrent], {
    encoding: "utf8",
    env: { HOME: home, PATH: path },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result;
}

/** Everything the shim wrote to stderr, which is where its one notice goes. */
function stderrOf({ home, mirrorCurrent, path }: { home: string; mirrorCurrent: string; path: string }): string {
  const proc = execFileSync("bash", ["-c", `"$0" "$1" 2>&1 1>/dev/null`, SCRIPT, mirrorCurrent], {
    encoding: "utf8",
    env: { HOME: home, PATH: path },
  });
  return proc;
}

const SAFE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

describe("plugin-path-shim.sh", () => {
  it("installs a `slopweaver` that runs the mirrored CLI", () => {
    const { home, mirrorCurrent, target } = fixture();
    runShim({ home, mirrorCurrent, path: SAFE_PATH });
    const link = join(home, ".local", "bin", "slopweaver");
    expect(readlinkSync(link)).toBe(target);
    expect(execFileSync(link, [], { encoding: "utf8" }).trim()).toBe("MIRRORED");
  });

  it("points at the mirror, never at a versioned cache directory a version bump would prune", () => {
    const { home, mirrorCurrent } = fixture();
    runShim({ home, mirrorCurrent, path: SAFE_PATH });
    expect(readlinkSync(join(home, ".local", "bin", "slopweaver"))).toContain("/mirror/current/");
  });

  it("names the missing PATH entry once, and not on every later session", () => {
    const { home, mirrorCurrent } = fixture();
    const first = stderrOf({ home, mirrorCurrent, path: SAFE_PATH });
    const second = stderrOf({ home, mirrorCurrent, path: SAFE_PATH });
    expect(first).toContain("is not on your PATH");
    expect(second).toBe("");
  });

  it("says nothing at all when ~/.local/bin is already on PATH", () => {
    const { home, mirrorCurrent } = fixture();
    const out = stderrOf({ home, mirrorCurrent, path: `${join(home, ".local", "bin")}:${SAFE_PATH}` });
    expect(out).toBe("");
  });

  it("never replaces a real file somebody else installed under that name", () => {
    const { home, mirrorCurrent } = fixture();
    const link = join(home, ".local", "bin", "slopweaver");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(link, "#!/bin/sh\necho SOMEBODY ELSE\n", { mode: 0o755 });
    runShim({ home, mirrorCurrent, path: SAFE_PATH });
    expect(readFileSync(link, "utf8")).toBe("#!/bin/sh\necho SOMEBODY ELSE\n");
  });

  it("never repoints a symlink that is not ours", () => {
    const { home, mirrorCurrent } = fixture();
    const link = join(home, ".local", "bin", "slopweaver");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    symlinkSync("/usr/bin/true", link);
    runShim({ home, mirrorCurrent, path: SAFE_PATH });
    expect(readlinkSync(link)).toBe("/usr/bin/true");
  });

  it("does nothing when the mirror has no CLI to point at yet", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-shim-empty-"));
    fixtureDirs.push(home);
    const mirrorCurrent = join(home, "mirror", "current");
    mkdirSync(mirrorCurrent, { recursive: true });
    runShim({ home, mirrorCurrent, path: SAFE_PATH });
    expect(existsSync(join(home, ".local", "bin", "slopweaver"))).toBe(false);
  });

  it("installs nothing when the mirror it is given lives outside the real plugin data root", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-shim-outofroot-"));
    fixtureDirs.push(home);
    const { mirrorCurrent } = outOfRootMirror();
    runShim({ home, mirrorCurrent, path: SAFE_PATH });
    expect(existsSync(join(home, ".local", "bin", "slopweaver"))).toBe(false);
  });

  it("never repoints the real shim at a scratch reproduction's mirror — a past incident", () => {
    const { home, mirrorCurrent, target } = fixture();
    runShim({ home, mirrorCurrent, path: SAFE_PATH }); // simulates the shim already correctly installed
    const link = join(home, ".local", "bin", "slopweaver");
    expect(readlinkSync(link)).toBe(target);

    const { mirrorCurrent: scratchMirror } = outOfRootMirror();
    runShim({ home, mirrorCurrent: scratchMirror, path: SAFE_PATH }); // a reproduction, same $HOME
    expect(readlinkSync(link)).toBe(target); // still the operator's own mirror, never the scratch one
  });

  it("writes to an explicit BIN_DIR override instead of ~/.local/bin", () => {
    const { home, mirrorCurrent, target } = fixture();
    const customBinDir = mkdtempSync(join(tmpdir(), "sw-shim-bindir-"));
    fixtureDirs.push(customBinDir);
    execFileSync("bash", [SCRIPT, mirrorCurrent], {
      encoding: "utf8",
      env: { BIN_DIR: customBinDir, HOME: home, PATH: SAFE_PATH },
    });
    expect(readlinkSync(join(customBinDir, "slopweaver"))).toBe(target);
    expect(existsSync(join(home, ".local", "bin", "slopweaver"))).toBe(false);
  });
});
