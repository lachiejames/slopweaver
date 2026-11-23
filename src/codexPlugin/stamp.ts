/**
 * The commit a `codex plugin-sync` export was cut from, read back out of an installed plugin root — kept apart
 * from `./sync.ts` so `doctor`, which runs at every session start, loads no `child_process` to ask for it.
 */
import { join } from "node:path";

import { readJsonFile } from "#lib/jsonFile.js";

import { SOURCE_STAMP_RELATIVE, stampCommitOf } from "./plan.js";

/**
 * Append the exported commit to a release version as semver build metadata (`0.2.0+<sha>`), so a Codex
 * session's `doctor` names the build it runs and can be compared against `git rev-parse HEAD` on the main
 * checkout. A root with no stamp — a Claude Code install, a bare CLI, an export from before the stamp —
 * keeps the version exactly as given, because a release version alone names no build and a guess would.
 *
 * @param version the release version the host manifest or package reported
 * @param pluginRoot the loaded plugin root, when the host proved one
 * @returns the version, with `+<commit>` when the root carries a source stamp
 */
export function withSourceCommit({ version, pluginRoot }: { version: string; pluginRoot: string | undefined }): string {
  if (pluginRoot === undefined) {
    return version;
  }
  const commit = stampCommitOf({ document: readJsonFile({ path: join(pluginRoot, SOURCE_STAMP_RELATIVE) }) });
  if (commit === undefined) {
    return version;
  }
  return `${version}+${commit}`;
}
