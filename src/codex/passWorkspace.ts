/**
 * What a Codex plan or review pass may write: its own per-pass scratch directory, and nothing else — not the
 * repository, and not the OS temp folder, where every snapshot pool slot a review reads lives.
 *
 * **Why the temp folder needs closing, not just the repository.** Codex's `workspace-write` sandbox makes
 * `$TMPDIR` and `/tmp` writable on top of the workspace unless it is told otherwise. A review pass reads a pooled
 * snapshot under `os.tmpdir()/slopweaver-snap-pool/` (`./snapshotPool.ts`), so that default let a pass write into
 * the very slot it was reading, and two did: a directory inside one slot's tree and a 284M one beside another's.
 * `./capabilities.ts` switches both writable defaults off with the legacy `sandbox_workspace_write.*` keys, the
 * spelling the SDK's `--sandbox workspace-write` launch reads.
 *
 * **Why the pass then needs a temp of its own.** With `$TMPDIR` and `/tmp` closed, a zsh heredoc and `mktemp`
 * both fail, so a pass's ordinary shell would break. Its shell temp moves to `<scratch>/.tmp`, inside the one
 * writable root: `TMPDIR` for `mktemp` and most tools, `TMPPREFIX` for zsh's heredoc files, which ignore
 * `TMPDIR`. Both are set on the CLI's own environment and again through `shell_environment_policy.set`, which
 * Codex applies after `inherit` and every exclude, so an ambient value cannot undo them. A home whose
 * `shell_environment_policy.include_only` drops them is refused per thread (`./scratchShellGuard.ts`).
 *
 * `./artifactStore.ts`'s `createPassScratch` mints `.tmp` with the scratch, and `./client.ts` mints it again,
 * idempotently, on every pass thread it builds, so a caller that makes its own scratch (`eval/turnProvider.ts`)
 * cannot launch with a temp that does not exist. Whatever removes the scratch removes `.tmp` with it, so no new
 * cleanup owner exists. The values are absolute and per scratch, which is why the client builds its
 * SDK per thread rather than once (`./client.ts`).
 *
 * MEASURED on the vendored codex-cli 0.163.0, run from a workspace directory with `TMPDIR` pointed outside it:
 * `codex sandbox -c sandbox_mode="workspace-write" -- /usr/bin/touch "$TMPDIR/x"` succeeds; adding
 * `-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c sandbox_workspace_write.exclude_slash_tmp=true`
 * makes it `Operation not permitted` while a write in the workspace still succeeds. Under `-P :workspace` the two
 * keys are ignored, so no permission profile is named anywhere here. The proof that runs on every darwin lap is
 * `src/__tests__/subprocess/codex/scratchConfinement.test.ts`; dropping `exclude_slash_tmp` turns it red (the
 * `/tmp` canary lands, exit 22). Dropping `exclude_tmpdir_env_var` alone does NOT, and that is stated rather than
 * hidden: the CLI's own `TMPDIR` is already this scratch's `.tmp`, so the root that key would open is inside the
 * workspace anyway. It stays as the second wall, should a later Codex read the temp root from anywhere else.
 */
import { join } from "node:path";

/** The directory inside a pass's scratch its shell uses as temp. */
export const PASS_TEMP_DIRNAME = ".tmp";

/** zsh's heredoc prefix inside {@link PASS_TEMP_DIRNAME}; zsh appends its own suffix to it. */
const ZSH_TEMP_PREFIX = "zsh";

/**
 * The absolute temp directory a pass's shell uses, inside its scratch.
 *
 * @param workingDirectory the pass's scratch, the thread's working directory
 * @returns `<scratch>/.tmp`
 */
export function passTempDirectory({ workingDirectory }: { workingDirectory: string }): string {
  return join(workingDirectory, PASS_TEMP_DIRNAME);
}

/**
 * The two temp variables a pass's shell must see, both pointing inside its scratch.
 *
 * @param workingDirectory the pass's scratch, the thread's working directory
 * @returns `TMPDIR` and `TMPPREFIX`, absolute
 */
export function passTempEnvironment({ workingDirectory }: { workingDirectory: string }): {
  readonly TMPDIR: string;
  readonly TMPPREFIX: string;
} {
  const temp = passTempDirectory({ workingDirectory });
  return { TMPDIR: temp, TMPPREFIX: join(temp, ZSH_TEMP_PREFIX) };
}

/**
 * The `-c` overrides that set a pass shell's temp inside its scratch, one `key=value` per entry. Each value is a
 * TOML basic string: `JSON.stringify`'s escapes are a subset of TOML's, so any path round-trips.
 *
 * @param workingDirectory the pass's scratch, the thread's working directory
 * @returns the overrides in a stable order
 */
export function codexPassScratchOverrides({ workingDirectory }: { workingDirectory: string }): readonly string[] {
  return Object.entries(passTempEnvironment({ workingDirectory })).map(
    ([name, value]) => `shell_environment_policy.set.${name}=${JSON.stringify(value)}`,
  );
}
