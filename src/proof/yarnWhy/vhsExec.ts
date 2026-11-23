/**
 * The one owned client for driving `vhs` — writing a tape to disk, running it, and reading back the frames
 * it recorded.
 *
 * Injected (see {@link VhsExec}) rather than called directly, so the capture ORDERING — write the tape,
 * run it in the worktree, pick the settled frame — is unit-testable against a recording fake with no `vhs`
 * process ever starting. AGENTS.md's own history is why: a shell called directly from an orchestrator hid
 * ordering defects elsewhere in this repo until the shell itself became an injectable seam.
 *
 * This replaced an `osascript` + `screencapture` client whose window could not be kept off the owner's
 * desktop — {@link ./tape.ts} carries that measurement and why VHS has no window at all.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";

/**
 * How long one `vhs` run may block. Generously past the tape's own `Set WaitTimeout`, so a tape that hits
 * its wait timeout fails with VHS's own message rather than being killed here with a vaguer one.
 */
const VHS_TIMEOUT_MS = 180_000;

/** The seam a capture orchestrator calls through, so its ordering is testable against a fake. */
export interface VhsExec {
  /**
   * Write a tape's source to disk, ready to run.
   *
   * @param path where to write it
   * @param source the complete tape source
   */
  readonly writeTape: (params: { readonly path: string; readonly source: string }) => void;
  /**
   * Run one tape with `vhs`, from `cwd` — which is how the pty gets the worktree, since a tape cannot
   * carry a path (see {@link ./tape.ts}). Throws when VHS fails, carrying its own diagnostic.
   *
   * @param tapePath the tape file to run
   * @param cwd the working directory the recorded pty inherits
   */
  readonly runTape: (params: { readonly tapePath: string; readonly cwd: string }) => void;
  /**
   * The file names in a recording's frames directory — empty when VHS recorded nothing at all, including
   * when the directory itself was never created.
   *
   * @param dir the frames directory the tape declared as its output
   * @returns the names it holds, in whatever order the filesystem reports
   */
  readonly listFrames: (params: { readonly dir: string }) => readonly string[];
}

/**
 * The real driver: `vhs <tape>` run from the worktree, with its output captured so a failure's own message
 * reaches the caller.
 *
 * @returns the production {@link VhsExec}
 */
export function realVhsExec(): VhsExec {
  return {
    listFrames: ({ dir }) => (existsSync(dir) ? readdirSync(dir) : []),
    runTape: ({ tapePath, cwd }) => {
      execFileSync("vhs", [tapePath], { cwd, encoding: "utf8", timeout: VHS_TIMEOUT_MS });
    },
    writeTape: ({ path, source }) => {
      writeFileSync(path, source, "utf8");
    },
  };
}
