/**
 * Plugin roots on disk for `doctor`'s plugin report, shared by its unit tests and its subprocess tests: a
 * `--plugin-dir`-shaped root with a manifest, and the hook mirror as `scripts/plugin-mirror-sync.sh` lays it out.
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A plugin root carrying the Claude manifest and the named skills, as a `--plugin-dir` checkout does.
 *
 * @param root the directory to build it in
 * @param skills the skill directories to give a `SKILL.md`
 * @returns `root`
 */
export function pluginRootWith({ root, skills }: { root: string; skills: readonly string[] }): string {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "slopweaver" }));
  for (const name of skills) {
    mkdirSync(join(root, "skills", name), { recursive: true });
    writeFileSync(join(root, "skills", name, "SKILL.md"), `# ${name}`);
  }
  return root;
}

/**
 * The hook mirror as `scripts/plugin-mirror-sync.sh` lays it out — a `.slot-a` under `mirror/by-root<key>/`,
 * carrying `bin/` and `hooks/` but no manifest or `skills/`, reached through `current`.
 *
 * @param data the plugin data directory the mirror sits under
 * @returns the root the way `bin/slopweaver` spells its own, `<…>/current/bin/..`
 */
export function hookMirrorRoot({ data }: { data: string }): string {
  const mirrorRoot = join(data, "mirror", "by-root", "work", "mirror", "slopweaver");
  const slot = join(mirrorRoot, ".slot-a");
  mkdirSync(join(slot, "hooks"), { recursive: true });
  writeFileSync(join(slot, "hooks", "hooks.json"), "{}");
  mkdirSync(join(slot, "bin"), { recursive: true });
  writeFileSync(join(slot, "bin", "slopweaver"), "#!/usr/bin/env bash\n");
  symlinkSync(".slot-a", join(mirrorRoot, "current"));
  return join(mirrorRoot, "current", "bin", "..");
}
