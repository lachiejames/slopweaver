/**
 * `doctor`'s two readings of the exec-inode verdict — the human line and the JSON status — over the exec store
 * under the cache root (`src/cacheHome.ts`), and the home's pre-move one beside it. Apart from `run.ts` because the
 * store's move out of the home made the pair a seam of their own.
 */
import { esbuildInodeVerdict } from "../../../worktree/execInodesApply.js";

/** The two exec stores a checkout's esbuild may be private to: the cache root's, and the home's pre-move one. */
export interface ExecStores {
  readonly execStore: string;
  readonly homeExecStore: string;
}

/**
 * The sentinel's verdict across both stores: private to EITHER is private, because a checkout `worktree unshare`
 * privatised before the store moved stays hardlinked to the home's copy and yarn cannot write that inode either.
 *
 * @returns the verdict, or undefined when the checkout has no esbuild to judge
 */
function verdictAcross({
  cwd,
  execStore,
  homeExecStore,
}: ExecStores & { cwd: string }): "private" | "shared" | undefined {
  return esbuildInodeVerdict({ execStores: [execStore, homeExecStore], root: cwd });
}

/**
 * The exec-inode line: whether THIS checkout's native binaries are still on the inode yarn shares with every
 * other checkout on the machine.
 *
 * One `stat` of the esbuild sentinel plus a readdir of the exec store, so it stays inside the default run's
 * no-subprocess budget. `worktree/execInodes.ts` has the measurement: one in-place write to that shared inode
 * left 98 of 300 execs dead with SIGKILL and every exec after lap 203 dead, with byte-identical content — so
 * `stat` cannot see the damage and only this comparison can see the exposure.
 *
 * @param cwd the directory `doctor` is running in, or undefined when the caller has none
 * @param execStore the cache root's exec store, which a healthy checkout's binaries are linked into
 * @param homeExecStore the home's pre-move exec store, which an older privatised checkout is still linked into
 * @returns the report line, or undefined when this checkout has no esbuild to judge
 */
export function execInodeLine({
  cwd,
  execStore,
  homeExecStore,
}: ExecStores & { cwd: string | undefined }): string | undefined {
  if (cwd === undefined) {
    return undefined;
  }
  const verdict = verdictAcross({ cwd, execStore, homeExecStore });
  if (verdict === undefined) {
    return undefined;
  }
  return verdict === "private"
    ? "exec inodes: private — native binaries are on Slopweaver's exec store, not yarn's"
    : "exec inodes: SHARED with yarn's content store — a sibling checkout's install can leave every native binary here PERMANENTLY unexecutable; run `slopweaver worktree unshare`";
}

/**
 * `execInodes` for the JSON report.
 *
 * @param cwd the directory `doctor` is running in, or undefined when the caller has none
 * @param execStore the cache root's exec store, which a healthy checkout's binaries are linked into
 * @param homeExecStore the home's pre-move exec store, which an older privatised checkout is still linked into
 * @returns the verdict, or "unknown" whenever there is no `cwd`, or no esbuild there to judge
 */
export function execInodeStatus({ cwd, execStore, homeExecStore }: ExecStores & { cwd: string | undefined }): string {
  if (cwd === undefined) {
    return "unknown";
  }
  const verdict = verdictAcross({ cwd, execStore, homeExecStore });
  if (verdict === undefined) {
    return "unknown";
  }
  return verdict;
}
