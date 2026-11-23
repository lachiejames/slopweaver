/**
 * A mirror sync cannot drop a path a live `hooks.json` still names.
 *
 * A seat reads `hooks.json` once at boot and resolves its command paths against the mirror forever after,
 * so reshaping the hook surface strands every seat already running: the new tree is mirrored over the old
 * layout, and the old layout's paths simply stop existing. MEASURED once:
 * ten `scripts/pretooluse-*.sh` entries became one, and nine of ten live seats spent the rest of their
 * lives with every PreToolUse guard failing — non-blocking, so with no symptom but noise. The ten shims
 * that fix it are only a fix while they are still there, and nothing checked that.
 *
 * This is the check. It runs the REAL `scripts/plugin-mirror-sync.sh` over a root carrying the shipped
 * `hooks/`, `scripts/` and `bin/`, and asks the built tree for every path a live seat can name. The
 * negative control is what makes it evidence rather than a restatement: a file the entry list does not
 * cover has to come back ABSENT from the same check.
 */
import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { HOOK_MANIFESTS } from "../../../canon/hookManifests.js";
import { stripGitEnv } from "../../../codex/gitRun.js";
import { mirroredHookCommands, PRE_FOLD_PRETOOLUSE_COMMANDS } from "../../liveHookCommands.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "plugin-mirror-sync.sh");
const SYNC_TIMEOUT_MS = 60_000;

/** A file the sync's entry list does not cover — the negative control's subject. */
const UNMIRRORED_PATH = "docs/not-a-mirrored-entry.md";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A plugin root carrying the SHIPPED hook surface, plus one file outside the mirrored entry list.
 *
 * No `.git`, deliberately: `plugin-checkout-sync.sh` exits at its `rev-parse --show-toplevel` on a
 * directory that is not a checkout, so this fixture reaches no network and fast-forwards nothing.
 *
 * @returns the plugin root, the plugin-data root beside it, and a throwaway bin dir for the path shim
 */
function shippedHookSurface(): { root: string; data: string; bin: string } {
  const base = mkdtempSync(join(tmpdir(), "sw-mirror-cmds-"));
  fixtureDirs.push(base);
  const root = join(base, "root");
  for (const entry of ["bin", "hooks", "scripts"]) {
    cpSync(join(repoRoot, entry), join(root, entry), { recursive: true });
  }
  cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
  mkdirSync(join(root, dirname(UNMIRRORED_PATH)), { recursive: true });
  writeFileSync(join(root, UNMIRRORED_PATH), "a file the mirror is not asked to carry\n");
  return { bin: join(base, "bin"), data: join(base, "data"), root };
}

/**
 * Run the sync once, exactly as a session start does, and answer where its `current` landed.
 *
 * @returns the directory a seat's frozen command would resolve its paths against
 */
function syncedMirror({ root, data, bin }: { root: string; data: string; bin: string }): string {
  execFileSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...stripGitEnv({ env: process.env }), BIN_DIR: bin, PLUGIN_DATA: data, PLUGIN_ROOT: root },
    timeout: SYNC_TIMEOUT_MS,
  });
  return join(data, "mirror", `by-root${root}`, "current");
}

/**
 * Which of the given paths a built mirror does NOT carry as an existing, executable-or-readable file.
 *
 * @param paths plugin-relative, exactly as a `hooks.json` command names them
 * @returns the missing ones, so a failure names them rather than reporting a count
 */
function absentFrom({ mirror, paths }: { mirror: string; paths: readonly string[] }): readonly string[] {
  return paths.filter((path) => {
    try {
      accessSync(join(mirror, path), constants.R_OK);
      return false;
    } catch {
      return true;
    }
  });
}

describe("a mirror sync cannot drop a path a live hooks.json names", { timeout: SYNC_TIMEOUT_MS }, () => {
  it("carries every path each shipped hook manifest reaches for", () => {
    const fixture = shippedHookSurface();
    const mirror = syncedMirror(fixture);
    const named = HOOK_MANIFESTS.flatMap((manifest) =>
      mirroredHookCommands({ hooksJson: readFileSync(join(repoRoot, manifest), "utf8") }),
    );
    // A registry guard: `absentFrom(...)` is empty for an EMPTY list of paths, which would mean the parser
    // stopped finding commands rather than that the mirror carries them.
    expect(named.length).toBeGreaterThan(0);
    expect(named).toContain("scripts/pretooluse.sh");
    expect(absentFrom({ mirror, paths: named })).toEqual([]);
  });

  it("carries every pre-fold PreToolUse path, which only a seat booted before the fold still names", () => {
    const fixture = shippedHookSurface();
    expect(PRE_FOLD_PRETOOLUSE_COMMANDS.length).toBeGreaterThan(0);
    expect(absentFrom({ mirror: syncedMirror(fixture), paths: PRE_FOLD_PRETOOLUSE_COMMANDS })).toEqual([]);
  });

  it("reports a path outside the mirrored entry list as absent, so the check can say no", () => {
    const fixture = shippedHookSurface();
    expect(absentFrom({ mirror: syncedMirror(fixture), paths: [UNMIRRORED_PATH] })).toEqual([UNMIRRORED_PATH]);
  });

  it("leaves the mirrored tree able to RUN what it carries, which a tree with no node_modules cannot", () => {
    const fixture = shippedHookSurface();
    const mirror = syncedMirror(fixture);
    // The LINK, not what it resolves to: `cli-deps` is installed by a sibling SessionStart hook this test
    // never runs, and a dangling link is the documented first-boot state rather than a failure.
    expect(readlinkSync(join(mirror, "node_modules"))).toBe(join(fixture.data, "cli-deps", "node_modules"));
  });
});
