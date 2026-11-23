/**
 * A slot missing, emptying or un-executing a hook entry file is never made current.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  currentTree,
  fixture,
  fixtureDirs,
  hookExecuteBits,
  mirrorRoot,
  runOnce,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

/**
 * An `rsync` on PATH that copies every mirrored entry but one, so the slot it builds is short of exactly that entry.
 * Dry runs pass straight through, as in `binLosingRsyncDir`.
 *
 * @param entry the mirrored entry the copy silently drops, e.g. `hooks` or `scripts`
 * @returns the PATH value with the shim's directory in front
 */
function entryLosingPath({ entry }: { entry: string }): string {
  const real = execFileSync("bash", ["-c", "command -v rsync"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(join(tmpdir(), "sw-rsync-drop-"));
  fixtureDirs.push(dir);
  const body = [
    "#!/bin/sh",
    `case "$*" in *--dry-run*) exec "${real}" "$@" ;; esac`,
    `case "$2" in */${entry}) exit 0 ;; esac`,
    `exec "${real}" "$@"`,
  ].join("\n");
  writeFileSync(join(dir, "rsync"), `${body}\n`, { mode: 0o755 });
  return `${dir}:${process.env["PATH"]!}`;
}

/**
 * An `rsync` on PATH that copies everything and reports success, but damages one of the slot's entries: leaves it
 * zero bytes, a present entry that exits 0 before any gate, or drops its executable bit, so the host's exec of it
 * fails 126. Dry runs pass straight through, as in `binLosingRsyncDir`.
 *
 * @param entry the top-level directory holding it, as the sync copies one per call
 * @param file the entry under `entry` the copy damages, e.g. `hook.sh` or `pretooluse.ts`
 * @param damage `empty` truncates it, `unexecutable` keeps its bytes and clears every execute bit
 * @returns the PATH value with the shim's directory in front
 */
function entryDamagingPath({
  entry = "scripts",
  file,
  damage,
}: {
  entry?: "scripts" | "hooks";
  file: string;
  damage: "empty" | "unexecutable";
}): string {
  const real = execFileSync("bash", ["-c", "command -v rsync"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(join(tmpdir(), "sw-rsync-damage-"));
  fixtureDirs.push(dir);
  const target = `"$3/${entry}/${file}"`;
  const act = damage === "empty" ? `: > ${target}` : `chmod a-x ${target}`;
  const body = [
    "#!/bin/sh",
    `case "$*" in *--dry-run*) exec "${real}" "$@" ;; esac`,
    `"${real}" "$@" || exit $?`,
    `case "$2" in */${entry}) ${act} ;; esac`,
  ].join("\n");
  writeFileSync(join(dir, "rsync"), `${body}\n`, { mode: 0o755 });
  return `${dir}:${process.env["PATH"]!}`;
}

/** What the sync prints when the slot it just built fails the entry check and `current` stays where it was. */
const ENTRY_KEPT_LINE =
  ".slot-b is missing or differs from the source in scripts/hook.sh, scripts/pretooluse.sh or a library they source";

/** Give a fixture root the hook entry point's libraries, as the real source carries them. */
function withHookLibs({ root, libs }: { root: string; libs: readonly string[] }): void {
  mkdirSync(join(root, "hooks", "lib"), { recursive: true });
  for (const lib of libs) {
    writeFileSync(join(root, "hooks", "lib", lib), `# ${lib}\n`);
  }
}

// A slot short of `bin` is flipped and rebuilt next boot (above), but one short of the hook entry point or what it
// sources is a seat whose hooks cannot run: the entry or `bounded-run.sh` gone exits 127 and the host runs the tool
// past every gate; `profile-delivered.sh` gone refuses every call with no profile and no reload.
// So that slot is never made current, and a `current` just as short is re-seeded to the root.
describe("a slot missing or emptying a hook entry file is never current", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("keeps current on the complete slot when a build loses the libraries, then flips once one carries them", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh", "profile-delivered.sh"], root });
    runOnce({ bin, data, root });
    const lossy = runOnce({ bin, data, extraEnv: { PATH: entryLosingPath({ entry: "hooks" }) }, root });
    const afterLossy = currentTree({ data, root }).slot;
    const current = join(mirrorRoot({ data, root }), "current");

    expect(lossy).toContain(`${ENTRY_KEPT_LINE}, so current stays on the tree`);
    expect(afterLossy).toBe(".slot-a");
    expect(existsSync(join(current, "hooks", "lib", "profile-delivered.sh"))).toBe(true);
    runOnce({ bin, data, root });
    expect(currentTree({ data, root }).slot).toBe(".slot-b");
  });

  it("never flips to a slot that lost the entry point itself", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh", "profile-delivered.sh"], root });
    runOnce({ bin, data, root });
    const lossy = runOnce({ bin, data, extraEnv: { PATH: entryLosingPath({ entry: "scripts" }) }, root });

    expect(lossy).toContain(ENTRY_KEPT_LINE);
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
    expect(existsSync(join(mirrorRoot({ data, root }), "current", "scripts", "hook.sh"))).toBe(true);
  });

  // A copy that reports success over a zero-byte entry is a slot whose every hook exits 0 before any gate, so the
  // host runs the tool unprofiled. Presence alone accepted it; the entry must match.
  it("never flips to a slot whose entry point was copied empty, though every file is present", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh", "profile-delivered.sh"], root });
    runOnce({ bin, data, root });
    const emptied = runOnce({
      bin,
      data,
      extraEnv: { PATH: entryDamagingPath({ damage: "empty", file: "hook.sh" }) },
      root,
    });
    const slotB = join(mirrorRoot({ data, root }), ".slot-b", "scripts", "hook.sh");

    expect(statSync(slotB).size).toBe(0);
    expect(emptied).toContain(ENTRY_KEPT_LINE);
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
    expect(statSync(join(mirrorRoot({ data, root }), "current", "scripts", "hook.sh")).size).toBeGreaterThan(0);
  });

  // `hooks.json` EXECUTES the entry point, so a byte-identical copy without its execute bit fails 126 before any gate,
  // which the host treats like a missing one and runs the tool.
  it("never flips to a slot whose entry point was copied without its execute bit", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh", "profile-delivered.sh"], root });
    runOnce({ bin, data, root });
    const stripped = runOnce({
      bin,
      data,
      extraEnv: { PATH: entryDamagingPath({ damage: "unexecutable", file: "hook.sh" }) },
      root,
    });
    const mirror = mirrorRoot({ data, root });

    expect(hookExecuteBits({ path: join(mirror, ".slot-b", "scripts", "hook.sh") })).toBe("0");
    expect(stripped).toContain(ENTRY_KEPT_LINE);
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
    expect(hookExecuteBits({ path: join(mirror, "current", "scripts", "hook.sh") })).toBe("111");
  });

  // The PreToolUse target too: missing, it lands in a recovery lane, but empty and executable it exits 0 before any
  // check, so the host runs the tool unprofiled.
  it("never flips to a slot whose PreToolUse target was copied empty", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh", "profile-delivered.sh"], root });
    writeFileSync(join(root, "scripts", "pretooluse.sh"), "#!/bin/sh\nexit 2\n", { mode: 0o755 });
    runOnce({ bin, data, root });
    const emptied = runOnce({
      bin,
      data,
      extraEnv: { PATH: entryDamagingPath({ damage: "empty", file: "pretooluse.sh" }) },
      root,
    });
    const slotB = join(mirrorRoot({ data, root }), ".slot-b", "scripts", "pretooluse.sh");

    expect(statSync(slotB).size).toBe(0);
    expect(emptied).toContain(ENTRY_KEPT_LINE);
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
  });

  // Node's entry too: `tsx` runs an empty `hooks/pretooluse.ts` as an empty program, exit 0, so the dispatcher's checks
  // never run.
  it("never flips to a slot whose node dispatcher entry was copied empty", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh", "profile-delivered.sh"], root });
    writeFileSync(join(root, "hooks", "pretooluse.ts"), "process.exit(2);\n");
    runOnce({ bin, data, root });
    const emptied = runOnce({
      bin,
      data,
      extraEnv: { PATH: entryDamagingPath({ damage: "empty", entry: "hooks", file: "pretooluse.ts" }) },
      root,
    });
    const slotB = join(mirrorRoot({ data, root }), ".slot-b", "hooks", "pretooluse.ts");

    expect(statSync(slotB).size).toBe(0);
    expect(emptied).toContain(ENTRY_KEPT_LINE);
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
  });

  // An upgrade: the slot current names was built before `profile-delivered.sh` was required, and the build that
  // would replace it lost `hooks`. Keeping the old slot keeps a tree short of the source's entry surface.
  it("re-seeds current to the root when the slot it names predates a library the source now requires", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh"], root });
    runOnce({ bin, data, root });
    withHookLibs({ libs: ["profile-delivered.sh"], root });
    const lossy = runOnce({ bin, data, extraEnv: { PATH: entryLosingPath({ entry: "hooks" }) }, root });
    const seeded = currentTree({ data, root }).slot;

    expect(lossy).toContain("so current is re-seeded to the plugin root");
    expect(seeded).toBe(root);
    runOnce({ bin, data, root });
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
    expect(existsSync(join(mirrorRoot({ data, root }), "current", "hooks", "lib", "profile-delivered.sh"))).toBe(true);
  });

  // The re-seed is the recovery, so it is reported only once it holds: an `ln` that will not replace the link
  // leaves the short tree behind `current`, and claiming recovery over it would hide every hook exiting 127.
  it("says the re-seed failed, rather than claiming it, when the link cannot be replaced", () => {
    const { root, data, bin } = fixture();
    withHookLibs({ libs: ["bounded-run.sh"], root });
    runOnce({ bin, data, root });
    withHookLibs({ libs: ["profile-delivered.sh"], root });
    const lnDir = mkdtempSync(join(tmpdir(), "sw-ln-refuse-"));
    fixtureDirs.push(lnDir);
    writeFileSync(join(lnDir, "ln"), `#!/bin/sh\ncase "$2" in "${root}") exit 1 ;; esac\nexec /bin/ln "$@"\n`, {
      mode: 0o755,
    });
    const path = `${lnDir}:${entryLosingPath({ entry: "hooks" })}`;
    const refused = runOnce({ bin, data, extraEnv: { PATH: path }, root });

    expect(refused).toContain("and current could not be re-seeded to the plugin root");
    expect(refused).not.toContain("so current is re-seeded to the plugin root");
    expect(currentTree({ data, root }).slot).toBe(".slot-a");
  });
});
