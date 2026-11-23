/**
 * Where a run is, for `./wholeTreeCheck.ts`: a Slopweaver checkout, or another project. Every test is on a
 * path's TEXT; the filesystem is never read.
 */

/**
 * A working directory inside a Slopweaver checkout or worktree, matched by DIRECTORY NAME, not anchored to this
 * repository: the hook sees a path and no project root. The hook runs on every Bash call on the machine, and
 * `yarn lint` or `yarn build` in another project is that project's own script, so a script NAME is judged only
 * here; `tsc`, `tsgolint` and type-aware `oxlint` build the checker wherever they run and are judged everywhere
 *. A directory that is unknown, or relative to an unknown one, is ours.
 */
const SLOPWEAVER_DIR = /(?:^|\/)slopweaver(?:\/|$)/u;

/**
 * Whether a package script's NAME carries this repository's meaning where a run is: a Slopweaver directory, or
 * one that is unknown or relative to an unknown one, which is the conservative reading.
 *
 * @param cwd the directory the run is in, when known
 * @returns true when `yarn typecheck` there is this repository's `typecheck`
 */
export function ownsScriptNames({ cwd }: { cwd: string | undefined }): boolean {
  return cwd === undefined || !cwd.startsWith("/") || SLOPWEAVER_DIR.test(cwd);
}
