/**
 * fseventsd's CPU, read the way a prune brakes on it.
 *
 * Load alone let a paced prune storm: with load1 at 10-12 and so under the 22 hold, one
 * background `rm` (pid 1959, nice 3) at 52% CPU drove fseventsd to 23-47% and mds to 58%. Every unlink is an
 * FSEvents record, so fseventsd's own CPU is the signal that the delete is outrunning it.
 * Repro: `ps -ax -o pid=,%cpu=,comm= | grep fseventsd`.
 *
 * Two bars, so a hold does not flap: a delete HOLDS at {@link FSEVENTSD_CPU_BAR} and RESUMES only under
 * {@link FSEVENTSD_RELEASE_BAR}. The proof hour passed under 20% only between deletes, which is where the
 * upper bar comes from; the lower one is half of it.
 *
 * mds is not gated: Spotlight indexes for reasons of its own (54% with no prune running,
 * `top -l 2 -s 3 -o cpu -n 12`), so a bar on it would starve every prune, and `worktrees.noindex` keeps it off the trees.
 */
import { execFileSync } from "node:child_process";

import { WATCHED_DAEMONS } from "../live/machine/daemonWatch.js";

/** fseventsd's %CPU at or above which a delete holds. */
export const FSEVENTSD_CPU_BAR = 20;

/** fseventsd's %CPU a held delete must fall under before it resumes. */
export const FSEVENTSD_RELEASE_BAR = 10;

/** One read of fseventsd's CPU: summed over every instance, none running, or why it could not be read. */
export type FseventsdCpu =
  | { readonly kind: "read"; readonly cpu: number; readonly pids: readonly number[] }
  | { readonly kind: "not-running" }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The first whitespace-separated field of `text`, and everything after the whitespace that follows it.
 *
 * @param text one line, or what is left of it
 * @returns the field and the rest, the rest empty when there is none
 */
function splitField({ text }: { text: string }): { field: string; rest: string } {
  const trimmed = text.trimStart();
  const end = trimmed.search(/\s/u);
  if (end === -1) {
    return { field: trimmed, rest: "" };
  }
  return { field: trimmed.slice(0, end), rest: trimmed.slice(end).trimStart() };
}

/**
 * One `pid <number> comm` row of a `ps -o pid=,<column>=,comm=` listing, or null when the line is not one. The
 * number is `%cpu` here and `rss` in `./fseventsdBalloon.ts`; the comm is everything after it, spaces included.
 *
 * @param line one line of the listing
 * @returns the row, or null
 */
export function parsePsRow({ line }: { line: string }): { pid: number; value: number; comm: string } | null {
  const pid = splitField({ text: line });
  const value = splitField({ text: pid.rest });
  const comm = value.rest.trimEnd();
  if (!/^\d+$/u.test(pid.field) || !/^\d+(?:\.\d+)?$/u.test(value.field) || comm === "") {
    return null;
  }
  return { comm, pid: Number(pid.field), value: Number(value.field) };
}

/**
 * fseventsd's CPU out of a `ps -ax -o pid=,%cpu=,comm=` listing, matched by its exact binary path so a lookalike
 * name is never read as the daemon (`../live/machine/daemonWatch.ts`). Two instances are summed: the bar is the
 * pressure on the machine, not on one process.
 *
 * @param text the listing; empty when `ps` failed
 * @returns the reading; a listing with no process in it at all is `unreadable`, never `not-running`
 */
export function parseFseventsdCpu({ text }: { text: string }): FseventsdCpu {
  const comm = WATCHED_DAEMONS.find((daemon) => daemon.label === "fseventsd")!.comm;
  const rows: { pid: number; value: number; comm: string }[] = [];
  for (const line of text.split("\n")) {
    const row = parsePsRow({ line });
    if (row !== null) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    return { kind: "unreadable", why: "`ps -ax -o pid=,%cpu=,comm=` listed no process at all" };
  }
  const matched = rows.filter((row) => row.comm === comm);
  if (matched.length === 0) {
    return { kind: "not-running" };
  }
  return {
    cpu: matched.reduce((sum, row) => sum + row.value, 0),
    kind: "read",
    pids: matched.map((row) => row.pid),
  };
}

/**
 * A reading as darwin must judge it. fseventsd always runs there, launchd restarting it within a second of a kill,
 * so a listing with no row at its binary path is a read that failed, never a quiet daemon.
 *
 * @param fseventsd the parsed reading
 * @param platform `process.platform`
 * @returns the reading, with darwin's missing row made `unreadable`
 */
export function onPlatform({
  fseventsd,
  platform,
}: {
  fseventsd: FseventsdCpu;
  platform: NodeJS.Platform;
}): FseventsdCpu {
  if (platform === "darwin" && fseventsd.kind === "not-running") {
    return { kind: "unreadable", why: "no process runs at fseventsd's binary path" };
  }
  return fseventsd;
}

/**
 * Why fseventsd alone stops a delete, or null when it is under the bar or does not exist on this platform.
 *
 * @param fseventsd one read of fseventsd's CPU
 * @param bar the %CPU at or above which a delete holds
 * @returns the reason to stop, or null; an unreadable read stops, because a busy daemon reads no different
 */
export function fseventsdStop({ fseventsd, bar }: { fseventsd: FseventsdCpu; bar: number }): string | null {
  if (fseventsd.kind === "unreadable") {
    return `fseventsd's CPU could not be read (${fseventsd.why}) — the rest wait for the next run`;
  }
  if (fseventsd.kind === "read" && fseventsd.cpu >= bar) {
    return `fseventsd (pid ${fseventsd.pids.join(", ")}) is at ${fseventsd.cpu.toFixed(1)}% CPU, at or above the ${String(bar)}% bar — the rest wait for the next run`;
  }
  return null;
}

/**
 * Whether a delete holds before its next chunk. Not holding, it holds at the upper bar; already holding, it stays
 * held until fseventsd falls under the lower one, so one quiet sample between two busy ones does not release it.
 *
 * @param cpu fseventsd's summed %CPU now
 * @param holding whether the delete is already holding
 * @returns true to wait and read again
 */
export function governorHolds({ cpu, holding }: { cpu: number; holding: boolean }): boolean {
  if (holding) {
    return cpu >= FSEVENTSD_RELEASE_BAR;
  }
  return cpu >= FSEVENTSD_CPU_BAR;
}

/** The longest one `ps` listing may take, whatever time its caller has left. */
const PS_TIMEOUT_MS = 10_000;

/**
 * How long one `ps` listing may take: its own cap, cut to what the caller has left so a stalled read cannot carry a
 * delete past its deadline, and never zero, which `execFileSync` reads as none.
 *
 * @param remainingMs the time the caller has left before its own deadline
 * @returns the `ps` timeout, in milliseconds
 */
export function gaugeTimeoutMs({ remainingMs }: { remainingMs: number }): number {
  return Math.max(1, Math.min(PS_TIMEOUT_MS, remainingMs));
}

/**
 * fseventsd's CPU on this machine now, from one `ps` listing. Off darwin there is no fseventsd to read.
 *
 * @param remainingMs the time the caller has left, which bounds the listing
 * @returns the reading
 */
export function readFseventsdCpu({ remainingMs }: { remainingMs: number }): FseventsdCpu {
  if (process.platform !== "darwin") {
    return { kind: "not-running" };
  }
  try {
    const text = execFileSync("/bin/ps", ["-ax", "-o", "pid=,%cpu=,comm="], {
      encoding: "utf8",
      timeout: gaugeTimeoutMs({ remainingMs }),
    });
    return onPlatform({ fseventsd: parseFseventsdCpu({ text }), platform: process.platform });
  } catch (error) {
    return { kind: "unreadable", why: error instanceof Error ? error.message : "`ps` failed" };
  }
}
