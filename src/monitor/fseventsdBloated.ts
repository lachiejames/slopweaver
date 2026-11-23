/**
 * `fseventsd-bloated` — fseventsd's footprint past 2 GiB puts its restart on the owner's queue as a hand step, never while a
 * voice call is live.
 *
 * MEASURED: fseventsd (root) held 10.34 GB at about 110% CPU after it dropped a client at 93% disk, and
 * every hook on the machine queued behind it. Only a restart clears that buffer, and only the owner can run it
 * (root), so the card puts `sudo killall fseventsd` on the owner's pasteboard.
 *
 * ## Never during a call, because the restart itself drops one
 *
 * MEASURED in a configd spin report (`/Library/Logs/DiagnosticReports/configd_*.spin`): configd sat
 * about 60 s inside an FSEvents call waiting on the NEW fseventsd while it rebuilt, watchdogd killed it, and the
 * IPv4 routes dropped for about 370 ms — every pause in the owner's call fell in that window. So while a call lease
 * is live (`../desktop/callLeases.ts`) the reading is `unmeasurable`: the pass posts nothing new and settles nothing,
 * so a card already up stays, and its `where` says not during a call. A lease listing that could not be read is
 * `unmeasurable` too, never "no call".
 *
 * ## One card per balloon
 *
 * The key is fseventsd's pid. A restart yields a new pid, so a later balloon is a fresh card; the same balloon keeps
 * its one card across passes, and the pass settles it the first measured pass it reads under the line or gone.
 *
 * ## Why 2 GiB, beside `machine watch`'s 1 GB
 *
 * `../live/machine/anomaly.ts` dispatches an INVESTIGATION at 1 GB, which costs a seat's time. This line asks the owner
 * for an act that stalls configd for a minute, so it sits higher, at about 2 GB.
 *
 * Not floating: every floating monitor cites a ruling asking for the note, and this one was asked for as a hand step.
 *
 * Pure: the reads are `./fseventsdBloatedSource.ts`.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { WATCHED_DAEMONS, type WatchedDaemonSpec } from "../live/machine/daemonWatch.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** The monitor's id, named once. */
const MONITOR_ID = "fseventsd-bloated";

/** The footprint strictly over which the restart is worth its configd stall. */
export const FSEVENTSD_RESTART_LINE_BYTES = 2 * 1024 * 1024 * 1024;

/** The bytes in one GB as `top` and `machine capacity` print them. */
const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * fseventsd's entry in the watched daemons, read rather than restated, so the binary path and the relief have one home.
 *
 * @returns the spec `machine watch` reads fseventsd by
 */
export function fseventsdSpec(): WatchedDaemonSpec {
  const spec = WATCHED_DAEMONS.find((daemon) => daemon.label === "fseventsd");
  if (spec === undefined) {
    throw new Error("WATCHED_DAEMONS names no fseventsd — the fseventsd-bloated monitor reads it from there");
  }
  return spec;
}

/** What one read of fseventsd's footprint found. */
export type FseventsdFootprint =
  | { readonly kind: "unreadable"; readonly why: string }
  | { readonly kind: "not-running" }
  | { readonly kind: "read"; readonly pid: number; readonly bytes: number };

/** What one read of the voice call leases found: how many are live, or why they could not be read. */
export type LiveCallCount =
  { readonly kind: "read"; readonly live: number } | { readonly kind: "unreadable"; readonly why: string };

/**
 * A footprint as a card prints it: GB to one decimal place.
 *
 * @param bytes the footprint
 * @returns the number, without its unit
 */
function gbOf({ bytes }: { bytes: number }): string {
  return (bytes / BYTES_PER_GB).toFixed(1);
}

/**
 * Judge one read: firing over the line with no call live, clear under it or with fseventsd not running.
 *
 * Under the line reads clear even when the leases could not be read: nothing is being proposed, so whether a call
 * is on does not matter.
 *
 * @param footprint fseventsd's footprint, or why it could not be read
 * @param calls the live voice call count, or why the leases could not be read
 * @returns the reading — a call live or unreadable leases over the line is `unmeasurable`, never `firing`
 */
export function evaluateFseventsdBloated({
  footprint,
  calls,
}: {
  footprint: FseventsdFootprint;
  calls: LiveCallCount;
}): MonitorReading {
  if (footprint.kind === "unreadable") {
    return { because: footprint.why, monitorId: MONITOR_ID, state: "unmeasurable" };
  }
  if (footprint.kind === "not-running" || footprint.bytes <= FSEVENTSD_RESTART_LINE_BYTES) {
    return { monitorId: MONITOR_ID, state: "clear" };
  }
  const held = `fseventsd holds ${gbOf({ bytes: footprint.bytes })} GB`;
  if (calls.kind === "unreadable") {
    return {
      because: `${held}, and whether a voice call is live could not be read (${calls.why}), so its restart is not proposed`,
      monitorId: MONITOR_ID,
      state: "unmeasurable",
    };
  }
  if (calls.live > 0) {
    return {
      because: `${held}, and a voice call is live (${String(calls.live)} lease(s)) — its restart is held until the call ends`,
      monitorId: MONITOR_ID,
      state: "unmeasurable",
    };
  }
  const subject: MonitorSubject = {
    footprintBytes: footprint.bytes,
    id: "fseventsd",
    key: String(footprint.pid),
    label: `${gbOf({ bytes: footprint.bytes })} GB`,
    literal: fseventsdSpec().relief,
  };
  return { monitorId: MONITOR_ID, state: "firing", subjects: [subject] };
}

/** What the card says either side of the footprint. */
const RESTART_WHAT_OPEN = "Restart fseventsd in your terminal when no call is on — it holds ";
const RESTART_WHAT_CLOSE = " and slows every hook";

/**
 * The card's sentence, with the footprint fitted to the room the cap leaves it. The evaluator's label is a few
 * characters, but a label is data, so the cap is held by arithmetic rather than by trusting it.
 *
 * @param subject the bloated fseventsd, whose `label` is its footprint
 * @returns the one sentence, never longer than the cap
 */
function restartWhat({ subject }: { subject: MonitorSubject }): string {
  const room = WHAT_CAP - RESTART_WHAT_OPEN.length - RESTART_WHAT_CLOSE.length;
  return `${RESTART_WHAT_OPEN}${fitLine({ cap: room, text: subject.label })}${RESTART_WHAT_CLOSE}`;
}

/** `fseventsd-bloated`: fseventsd's restart, the owner's to run once its footprint passes 2 GiB and no call is live. */
export const FSEVENTSD_BLOATED: MonitorDefinition = {
  blurb:
    "fseventsd's footprint passed 2 GiB: its restart is the owner's one root step, proposed only while no voice call is live.",
  id: MONITOR_ID,
  plainWhat: "Restart fseventsd in your terminal when no call is on — it has grown past 2 GB and slows every hook",
  prefix: "fsev",
  resolves: "fseventsd's footprint falls back to 2 GiB or under, or it runs under a new pid, which a restart gives it",
  source:
    "`ps -ax -o pid=,comm=` for fseventsd's exact binary path, `top -l 1 -pid <pid> -stats pid,mem` for its footprint, and the voice call leases under the cache root's docs-site/*.hold/calls",
  unblocks: ({ subject }) =>
    fitLine({
      cap: UNBLOCKS_CAP,
      text: `every hook and file watcher on the machine waits on fseventsd (pid ${subject.key}), which holds ${subject.label}; only a restart frees it`,
    }),
  what: ({ subject }) => restartWhat({ subject }),
  where: "Your own terminal, never during a call — the restart stalls configd about a minute while fseventsd rebuilds",
  worsens: { direction: "higher", measure: ({ subject }) => subject.footprintBytes, unit: "bytes" },
};
