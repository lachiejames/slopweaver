/**
 * The effectful edge of `slopweaver perf` — the three real readings, and nothing that decides anything.
 *
 * Two of the three are already built: `../machine/read.ts`'s `ps`/`top`/`sysctl` seams and the
 * `readMachineCapacity` fold over them. The third is the cmux hook stream, and the one design decision
 * here is WHERE it is read from.
 *
 * ## Why the LOG rather than the socket
 *
 * `slopweaver cmux events` drains cmux's live subscription and ADVANCES its stored cursor
 * (`../../cmux/eventState/`), so a supervisor's next `events tail` resumes after whatever this gauge
 * consumed. A statistics read must not eat the events the supervisor exists to act on. cmux persists the
 * same frames to `~/.cmuxterm/events.jsonl` (rotating to `events.jsonl.1`), so reading the file is the
 * non-destructive way to take the same reading — and it reaches further back than the socket's 4,096-event
 * in-memory buffer, which is what a p95 needs.
 *
 * ## Why a bounded TAIL, streamed
 *
 * Measured: `events.jsonl` was 144 KB and the rotated `events.jsonl.1` 16 MB. Reading either
 * through one string is the class `.claude/rules/typescript-patterns.md` bans outright, so this seeks to
 * `size - `{@link TAIL_BYTES} and streams from there with `readJsonlLines`, dropping the first line because
 * a byte offset lands mid-record. Frames outside the window are discarded as they are decoded, so the only
 * thing held in memory is the window itself.
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { type CmuxEvent, parseEventFrame } from "../../cmux/events.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { slopweaverHome } from "../../homeDir.js";
import {
  type HookCall,
  type HookOverrunReading,
  hookBudgetMs,
  hookOverrunReading,
  readHookCall,
  readRefusedOverrun,
} from "../../transcripts/hookDuration.js";
import { claudeProjectsDir, findTranscript, transcriptLines } from "../../transcripts/source.js";
import { DEFAULT_TOP_N } from "../machine/capacity.js";
import { readMachineCapacity } from "../machine/capacityWait.js";
import { readStrayDevServers } from "../machine/devServerRead.js";
import type { StrayDevServer } from "../machine/devServers.js";
import { type MachineCapacityDeps, productionMachineCapacityDeps } from "../machine/read.js";
import { type HookStreamReading, hookStreamReading } from "./hookStream.js";
import { type LoadReading, type PerfReport, perfReport } from "./report.js";

/**
 * How far back from each log file's end the tail starts, in bytes.
 *
 * 8 MiB holds roughly 5,000 frames at the measured line size (~1.6 KB for an `agent.hook`
 * frame with its redacted payload), which covers hours of a busy fleet — comfortably past the default
 * window — while staying a bounded read on a log that has been observed at 16 MB. Repro:
 * `ls -l ~/.cmuxterm/events.jsonl*; wc -l ~/.cmuxterm/events.jsonl`.
 */
const TAIL_BYTES = 8 * 1024 * 1024;

/** The default window the stream half folds, in minutes. */
export const DEFAULT_WINDOW_MINUTES = 60;

/** The cmux event log's own directory, which is not configurable in cmux and so is not a flag here. */
const CMUX_DIR = ".cmuxterm";

/** Every `perf` reading, injected so the whole decision path is testable without a machine. */
export interface PerfDeps {
  /** The `ps`/`top`/`sysctl` seams `machine capacity` already owns. */
  readonly machine: MachineCapacityDeps;
  /** Decoded cmux frames, newest last, already bounded to the window the caller asked for. */
  readonly frames: (options: { windowMs: number; nowMs: number }) => readonly CmuxEvent[];
  /**
   * Hook calls recorded in the transcripts of the sessions named, bounded to the window — or `undefined`
   * when not one transcript could be opened, which is a different answer from "no hook overran".
   */
  readonly hookCalls: (options: {
    windowMs: number;
    nowMs: number;
    sessionIds: readonly string[];
  }) => readonly HookCall[] | undefined;
  /**
   * Docs dev servers with no seat behind them, or `undefined` when the class could not be measured. One
   * `ps`, one bounded `lsof` over the pids that matched, and one board row per worktree that actually has
   * a server — see `../machine/devServerRead.ts`.
   */
  readonly devServers: () => readonly StrayDevServer[] | undefined;
  /** The instant the report is taken at. */
  readonly nowMs: () => number;
}

/*
 * The newest-first log paths cmux writes, filtered to the ones that exist — oldest first, so the two
 * concatenated files keep their frames in sequence order.
 *
 * `userHome`, never `home`: this file now holds TWO homes, and only the other one is `$SLOPWEAVER_HOME`.
 * cmux writes its log under the OS home and makes that path configurable nowhere, so this one is
 * `homedir()` and is outside the single-contract guard's subject (`unit/stateHome.guard.test.ts`), which
 * matches on the NAME. Calling it `home` read as a state-home derivation to that guard and to a human.
 */
function cmuxEventLogPaths({ userHome }: { userHome: string }): readonly string[] {
  const dir = join(userHome, CMUX_DIR);
  return [join(dir, "events.jsonl.1"), join(dir, "events.jsonl")].filter((path) => existsSync(path));
}

/*
 * Stream one log file's bounded tail and decode every frame inside the window, pushing into the CALLER’s
 * accumulator rather than returning a list to spread into it. Two files are concatenated here and each tail
 * is data-sized, so a spread-append would recopy the whole accumulator per frame — the `unbounded-spread`
 * class.
 */
function appendTailFrames({ path, sinceMs, into }: { path: string; sinceMs: number; into: CmuxEvent[] }): void {
  const size = statSync(path).size;
  const startByteOffset = Math.max(0, size - TAIL_BYTES);
  readJsonlLines({
    onLine: ({ line, index }) => {
      // A byte offset lands mid-record, so the first line of a seeked read is a fragment.
      if (index === 0 && startByteOffset > 0) {
        return;
      }
      const event = parseEventFrame({ line });
      if (event === undefined) {
        return;
      }
      const at = Date.parse(event.occurredAtIso);
      if (Number.isNaN(at) || at < sinceMs) {
        return;
      }
      into.push(event);
    },
    path,
    startByteOffset,
  });
}

/*
 * Decode one line as a hook call, by its attachment or, failing that, by a refused call's error result. A
 * refused call leaves no attachment at all — `readRefusedOverrun`'s header says why.
 */
function readAnyHookCall({ line, lineNumber }: { line: string; lineNumber: number }): HookCall | undefined {
  const attached = readHookCall({ line, lineNumber });
  if (attached !== undefined) {
    return attached;
  }
  return readRefusedOverrun({ line, lineNumber });
}

/*
 * Decode one opened transcript's hook calls inside the window, pushing into the CALLER's accumulator.
 *
 * Split out of `readHookCalls` rather than inlined: opening a seat's file and decoding its lines are two
 * folds, and holding both in one body put it past the cognitive-complexity ceiling. Pushing rather than
 * returning a list to spread keeps the accumulator from being recopied per seat — the `unbounded-spread`
 * class `./hookStream.ts`'s caller already avoids.
 */
function appendSessionHookCalls({
  lines,
  sinceMs,
  into,
}: {
  lines: Iterable<{ readonly line: string; readonly lineNumber: number } | { readonly lineNumber: number }>;
  sinceMs: number;
  into: HookCall[];
}): void {
  for (const entry of lines) {
    if (!("line" in entry)) {
      continue;
    }
    const call = readAnyHookCall({ line: entry.line, lineNumber: entry.lineNumber });
    if (call === undefined) {
      continue;
    }
    const at = Date.parse(call.timestamp);
    if (Number.isNaN(at) || at < sinceMs) {
      continue;
    }
    into.push(call);
  }
}

/*
 * Every hook call inside the window, read from the transcripts of the sessions `ps` already attributed.
 *
 * BOUNDED BY THE SEAT LIST, not by the corpus. `~/.claude/projects` held 2,656 transcripts over 4.1 GB when
 * this was written, and `perf` is the cheapest gauge in the repo precisely so a tick can afford it every
 * time — so this opens only the ~20 files the live fleet is writing, located by
 * `../../transcripts/source.ts`'s `findTranscript` rather than by reconstructing a mangled directory name.
 * The walk is `transcriptLines`, which chunks the file and never holds it whole.
 *
 * Answers `undefined` when not one transcript could be opened: the caller must be able to tell "no hook
 * overran" from "nothing was measured", and a zeroed reading says the first while meaning the second.
 */
function readHookCalls({
  sessionIds,
  sinceMs,
}: {
  sessionIds: readonly string[];
  sinceMs: number;
}): readonly HookCall[] | undefined {
  const projectsDir = claudeProjectsDir();
  const calls: HookCall[] = [];
  let opened = 0;
  for (const sessionId of sessionIds) {
    const path = findTranscript({ projectsDir, sessionId });
    if (path.isErr()) {
      continue;
    }
    const stream = transcriptLines({ path: path.value });
    if (stream.isErr()) {
      continue;
    }
    opened += 1;
    appendSessionHookCalls({ into: calls, lines: stream.value.lines, sinceMs });
  }
  if (opened === 0) {
    return undefined;
  }
  return calls;
}

/**
 * The real seams: the machine gauges, the cmux log and the wall clock.
 *
 * @param topN how many processes `top` is asked to rank
 * @param home the Slopweaver state home whose volume the machine half measures — NOT the OS home the cmux
 *   event log sits under, which is `homedir()` because cmux owns that path and does not make it configurable
 * @returns the production {@link PerfDeps}
 */
export function productionPerfDeps({
  topN = DEFAULT_TOP_N,
  home = slopweaverHome(),
}: { topN?: number; home?: string } = {}): PerfDeps {
  return {
    devServers: () => readStrayDevServers(),
    frames: ({ windowMs, nowMs }) => {
      const sinceMs = nowMs - windowMs;
      const frames: CmuxEvent[] = [];
      for (const path of cmuxEventLogPaths({ userHome: homedir() })) {
        try {
          appendTailFrames({ into: frames, path, sinceMs });
        } catch {
          // A rotation mid-read makes one file unreadable; the other still carries the window, and a
          // frame count of zero is what tells the reader the stream half saw nothing.
        }
      }
      return frames;
    },
    hookCalls: ({ windowMs, nowMs, sessionIds }) => readHookCalls({ sessionIds, sinceMs: nowMs - windowMs }),
    machine: productionMachineCapacityDeps({ home, topN }),
    nowMs: () => Date.now(),
  };
}

/**
 * Take the whole reading.
 *
 * @param deps the injected seams
 * @param windowMinutes how far back the stream half folds
 * @param topN how many processes `top` is asked to rank
 * @returns the report, and the stream fold the `hook` drill-down also needs
 */
export function readPerf({
  deps,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
  topN = DEFAULT_TOP_N,
}: {
  deps: PerfDeps;
  windowMinutes?: number;
  topN?: number;
}): { readonly report: PerfReport; readonly stream: HookStreamReading } {
  const nowMs = deps.nowMs();
  const windowMs = windowMinutes * 60_000;
  const capacity = readMachineCapacity({ deps: deps.machine, topN });
  const stream = hookStreamReading({ events: deps.frames({ nowMs, windowMs }), nowMs, windowMs });
  const load: LoadReading = { cores: deps.machine.cpuCount(), load1: capacity.load?.load1 };
  const calls = deps.hookCalls({
    nowMs,
    sessionIds: capacity.fleet.sessions.map((session) => session.sessionId),
    windowMs,
  });
  let hookOverruns: HookOverrunReading | undefined;
  if (calls !== undefined) {
    hookOverruns = hookOverrunReading({ budgetMs: hookBudgetMs({ env: process.env }), calls });
  }
  return {
    report: perfReport({
      fleet: capacity.fleet,
      hookOverruns,
      load,
      strayDevServers: deps.devServers(),
      stream,
    }),
    stream,
  };
}
