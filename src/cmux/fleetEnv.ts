/**
 * The environment a seat booting in a FLEET WORKTREE carries on its boot line — pure, no I/O.
 *
 * ## Why nx's daemon is off there
 *
 * An nx workspace starts a background daemon the first time a command in it runs, detached to `launchd`,
 * and that daemon outlives the seat that started it. An acme-admin worktree's daemon holds 230-400 MB, and on
 * one measured occasion five of them stood behind seats that had long closed, part of a machine held at
 * load 45.9, and had to be killed by hand. A worktree lives for one run, so the daemon buys it nothing a fresh
 * in-process project graph does not; `NX_DAEMON=false` is nx's own switch for that, and as an environment
 * prefix on the boot line it reaches every command the seat's tool calls run.
 *
 * The main checkout keeps its daemon: it is shared, long-lived and the place a daemon pays for itself. A seat
 * whose `cwd` IS its `repoRoot` — every ask and dispatch plan (`./plan.ts`) — gets an empty prefix, so its
 * boot line stays byte-identical to the one this repo has always sent.
 *
 * The reaper that clears a daemon which started anyway (a seat booted before this, a hand-opened shell) is
 * `../live/machine/worktreeResidue.ts`.
 */
import { worktreePathKey } from "../worktree/location.js";

/** nx's own switch, as the shell prefix the boot line carries — trailing space included, like every prefix. */
export const NX_DAEMON_OFF_PREFIX = "NX_DAEMON=false ";

/**
 * The environment prefix a seat's boot line carries for WHERE it boots: nx's daemon off in a fleet worktree,
 * nothing in the checkout itself.
 *
 * @param cwd the directory the seat's workspace opens in
 * @param repoRoot the main checkout that directory was created from
 * @returns the prefix, empty when the seat boots in the checkout itself
 */
export function fleetEnvPrefix({ cwd, repoRoot }: { cwd: string; repoRoot: string }): string {
  if (worktreePathKey({ path: cwd }) === worktreePathKey({ path: repoRoot })) {
    return "";
  }
  return NX_DAEMON_OFF_PREFIX;
}
