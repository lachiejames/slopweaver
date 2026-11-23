/**
 * What `fseventsd-bloated` keeps the first time it reads a balloon: fseventsd's own unified log and the client
 * pids it names, written once per fseventsd pid before the log ages out. Pure; `./capture.ts`
 * runs the reads and writes the file.
 *
 * MEASURED: the stuck FSEvents client behind a balloon was
 * unnameable, because the unified log from its onset had expired by the next day. fseventsd logs about 400
 * `Resolve user group list` lines a second, so the store keeps only about five hours of it, and the line that
 * names a client (`SLOWDOWN: client … (pid N)`, `fsevent_add_client: no bundle id available for pid N`) is in
 * the rest. So the capture drops that one noise line and keeps every other: on a healthy daemon that read took
 * 5.4 s and printed 978 lines, 136 KB. Reproduce:
 * `/usr/bin/log show --last 5h --predicate 'process == "fseventsd" AND NOT eventMessage CONTAINS "Resolve user group"' --style compact | wc -lc`.
 *
 * The pids are named the same moment, with `ps`, because a client that exits is as unnameable as a log that
 * aged out.
 */
import { join } from "node:path";

import { stateHomePaths } from "../../stateHome.js";

/** The arguments to `/usr/bin/log`: every fseventsd line still retained, bar the one line that floods it. */
export const ONSET_LOG_ARGS: readonly string[] = [
  "show",
  "--last",
  "24h",
  "--predicate",
  'process == "fseventsd" AND NOT eventMessage CONTAINS "Resolve user group"',
  "--style",
  "compact",
];

/** How many client pids one capture names with `ps` — a log of client registrations can name hundreds. */
const ONSET_CLIENT_PID_CAP = 64;

/**
 * Where one balloon's capture lives: one file per fseventsd pid, so a restart's new pid captures afresh, in a
 * `fseventsd-onset` directory under the machine readings' own root (`$home/live/machine`).
 *
 * @param home the state home
 * @param pid the ballooned fseventsd's pid
 * @returns the capture file's path
 */
export function onsetCapturePath({ home, pid }: { home: string; pid: number }): string {
  return join(stateHomePaths({ home }).live.machine.root, "fseventsd-onset", `${String(pid)}.log`);
}

/**
 * Every client pid fseventsd's log names, in first-seen order, without fseventsd's own and capped at
 * {@link ONSET_CLIENT_PID_CAP}. Only the two forms its client lines are known to print count — `for pid N`
 * (`fsevent_add_client`) and `(pid N)` (`SLOWDOWN`); the `fseventsd[N:T]` prefix and any other number never
 * match. Those two forms are the whole of what this tree has seen; a third would be missed, not misread.
 *
 * @param text the captured log
 * @param daemonPid fseventsd's own pid, never a client
 * @returns the client pids
 */
export function clientPidsOf({ text, daemonPid }: { text: string; daemonPid: number }): readonly number[] {
  const seen = new Set<number>();
  for (const match of text.matchAll(/(?:\bfor pid |\(pid )(\d+)\b/g)) {
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0 && pid !== daemonPid && seen.size < ONSET_CLIENT_PID_CAP) {
      seen.add(pid);
    }
  }
  return [...seen];
}

/**
 * The capture file's contents: what was read and when, the client pids as `ps` named them, then the log.
 *
 * @param pid the ballooned fseventsd's pid
 * @param bytes its footprint as read
 * @param nowIso the instant of the capture
 * @param clients the client pids the log names
 * @param psText `ps -o pid=,lstart=,comm=` over those pids, or why it could not be read
 * @param logText the captured log
 * @returns the whole file
 */
export function renderOnsetCapture({
  pid,
  bytes,
  nowIso,
  clients,
  psText,
  logText,
}: {
  pid: number;
  bytes: number;
  nowIso: string;
  clients: readonly number[];
  psText: string;
  logText: string;
}): string {
  const gb = (bytes / 1024 ** 3).toFixed(1);
  return [
    `# fseventsd onset capture — pid ${String(pid)} at ${gb} GB, read ${nowIso}`,
    `# log: /usr/bin/log ${ONSET_LOG_ARGS.join(" ")}`,
    `# client pids the log names (${String(clients.length)}, cap ${String(ONSET_CLIENT_PID_CAP)}): ${clients.join(" ")}`,
    "",
    "## ps -o pid=,lstart=,comm= over those pids",
    psText.trimEnd(),
    "",
    "## log",
    logText.trimEnd(),
    "",
  ].join("\n");
}
