/**
 * The plugin mirror carries `.nvmrc`. A mirror slot is what `~/.local/bin/slopweaver` actually runs, and the
 * launcher resolves `.nvmrc`'s exact version under a version manager before it falls to whatever `node` PATH
 * names (`hooks/lib/node-resolve.sh`), so a slot without the file silently skips that tier. The mirror script
 * skips an entry the source does not have, so this is a POSITIVE witness: the file is in the source and
 * asserted present, byte for byte, in the slot `current` names.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stripGitEnv } from "../../../codex/gitRun.js";

const SCRIPT = new URL("../../../../scripts/plugin-mirror-sync.sh", import.meta.url).pathname;

let base: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "sw-mirror-nvmrc-")));
});
afterEach(() => {
  rmSync(base, { force: true, recursive: true });
});

describe("plugin-mirror-sync.sh", () => {
  it("copies .nvmrc into the slot current names", () => {
    const root = join(base, "root");
    const data = join(base, "data");
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "bin", "slopweaver"), "#!/bin/sh\necho MIRRORED\n", { mode: 0o755 });
    writeFileSync(join(root, "scripts", "hook.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, ".nvmrc"), "24.21.0\n");

    execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...stripGitEnv({ env: process.env }), BIN_DIR: join(base, "bin"), PLUGIN_DATA: data, PLUGIN_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // `by-root` + the root path appended whole: plugin-mirror-sync.sh's own `by-root$MIRROR_KEY`.
    const current = join(data, "mirror", `by-root${root}`, "current");
    expect(readFileSync(join(current, ".nvmrc"), "utf8")).toBe("24.21.0\n");
  });
});
