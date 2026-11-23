/**
 * A ballooned fseventsd stands the whole `worktree prune --apply` down, before its scan and before any delete.
 *
 * ## The owner's complaint, and what the measurement says about it
 *
 * fseventsd hogs memory every time a
 * worktree prune runs, and the fleet cannot pick up work. MEASURED across every supervisor capacity tick over ten days (`watchedProcesses`'s fseventsd row in `$SLOPWEAVER_HOME/supervisor-scratch/<handoff>/tick-<n>/capacity.json`,
 * ordered by its read instant): fseventsd sat at 4-16 MB throughout, bar two balloons, each a sharp onset and then a
 * straight ~25 MB/min climb until the owner ran `sudo killall fseventsd` — one reached 31 GB and the other 36.5 GB.
 *
 * The prune does not START one: the run beside the first balloon removed nothing (it paused at its first gate on fseventsd at
 * 63% CPU) and the balloon's `event table has grown too large` line comes after it; since the second killall
 * about 45 back-to-back threshold prunes removed trees with fseventsd flat at 4-5 MB. Repro of the run side:
 * `grep -n -E '^2026-11-0(4T0[3-6]|8T0[0-6])|removed .* worktree|paused' "$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log.1"`.
 *
 * But a balloon DOES drive the prune, which is the side effect the owner sees. Its swap eats the disk, free space falls
 * under the 100 GB floor, and the threshold trigger (`./pruneTrigger.ts`) launches an apply every ten minutes with
 * the cap and the load gate lifted (`./prunePressure.ts`): 30 launches in one night, each a scan of
 * some 226 worktrees plus governed deletes whose every unlink also lands in the stuck client's queue. It cannot win:
 * a run freed about 1 GB while swap grew about 2 GB an hour, and free space rose 70.4 to 86.4 GB within eleven
 * minutes of the killall. So while fseventsd is ballooned the apply does nothing and says why; the relief is the
 * restart the `fseventsd-bloated` monitor's card already asks for (`../monitor/fseventsdBloated.ts`).
 *
 * ## Why resident size, and why 1 GiB
 *
 * `ps` reads it without root and in one listing; at this line it cannot be confused with a healthy daemon, whose
 * largest reading in those eleven days was 16 MB, and a balloon passes it within about forty minutes of its onset.
 * It is the line `machine watch` already dispatches an investigation at. An unreadable size does NOT hold: the CPU
 * gates inside the apply (`./fseventsdGauge.ts`) already stop on an unreadable fseventsd.
 */
import { execFileSync } from "node:child_process";

import { WATCHED_DAEMONS } from "../live/machine/daemonWatch.js";
import { gaugeTimeoutMs, parsePsRow } from "./fseventsdGauge.js";

/** fseventsd's resident size, in KiB, at or above which an apply stands down. */
export const FSEVENTSD_BALLOON_KIB = 1024 * 1024;

/** One read of fseventsd's resident size: summed over every instance, none running, or why it could not be read. */
export type FseventsdRss =
  | { readonly kind: "read"; readonly kib: number; readonly pids: readonly number[] }
  | { readonly kind: "not-running" }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * fseventsd's resident size out of a `ps -ax -o pid=,rss=,comm=` listing, matched by its exact binary path so a
 * lookalike name is never read as the daemon, and summed over instances.
 *
 * @param text the listing; empty when `ps` failed
 * @returns the reading; a listing with no process in it at all is `unreadable`, never `not-running`
 */
export function parseFseventsdRss({ text }: { text: string }): FseventsdRss {
  const comm = WATCHED_DAEMONS.find((daemon) => daemon.label === "fseventsd")!.comm;
  const rows = text
    .split("\n")
    .map((line) => parsePsRow({ line }))
    .filter((row) => row !== null);
  if (rows.length === 0) {
    return { kind: "unreadable", why: "`ps -ax -o pid=,rss=,comm=` listed no process at all" };
  }
  const matched = rows.filter((row) => row.comm === comm);
  if (matched.length === 0) {
    return { kind: "not-running" };
  }
  return {
    kib: matched.reduce((sum, row) => sum + row.value, 0),
    kind: "read",
    pids: matched.map((row) => row.pid),
  };
}

/**
 * Why a ballooned fseventsd stands the apply down, or null when it is under the line, not running or unreadable.
 *
 * @param rss one read of fseventsd's resident size
 * @returns the one line the apply prints in place of its run, or null to run
 */
export function fseventsdBalloonHold({ rss }: { rss: FseventsdRss }): string | null {
  if (rss.kind !== "read" || rss.kib < FSEVENTSD_BALLOON_KIB) {
    return null;
  }
  const gb = (rss.kib / (1024 * 1024)).toFixed(1);
  const relief = WATCHED_DAEMONS.find((daemon) => daemon.label === "fseventsd")!.relief;
  return (
    `worktree prune: stood down, nothing scanned or deleted — fseventsd (pid ${rss.pids.join(", ")}) holds ${gb} GB, ` +
    `a stuck FSEvents client's queue that every delete would only add to, and the free-space deficit is its swap, ` +
    `which no prune reclaims. Relief, as the fseventsd-bloated card asks: \`${relief}\`, not during a call; ` +
    `the next run prunes as normal.`
  );
}

/**
 * fseventsd's resident size on this machine now, from one bounded `ps` listing. Off darwin there is no fseventsd.
 *
 * @returns the reading
 */
export function readFseventsdRss(): FseventsdRss {
  if (process.platform !== "darwin") {
    return { kind: "not-running" };
  }
  try {
    const text = execFileSync("/bin/ps", ["-ax", "-o", "pid=,rss=,comm="], {
      encoding: "utf8",
      // 73 KB measured (`ps -ax -o pid=,rss=,comm= | wc -c`); Node's 1 MiB default would turn a
      // machine with ten times the processes into an `unreadable` that lets the apply run.
      maxBuffer: 16 * 1024 * 1024,
      timeout: gaugeTimeoutMs({ remainingMs: Number.POSITIVE_INFINITY }),
    });
    return parseFseventsdRss({ text });
  } catch (error) {
    return { kind: "unreadable", why: error instanceof Error ? error.message : "`ps` failed" };
  }
}
