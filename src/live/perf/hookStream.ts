/**
 * What the cmux hook stream can honestly say about a seat's pace — a pure fold over decoded frames.
 *
 * ## The claim boundary, stated first because getting it wrong is the whole risk here
 *
 * cmux's own `received`→`completed` delta is NOT hook latency. MEASURED over 9,043 frames
 * (an 8 MB tail of `~/.cmuxterm/events.jsonl.1` plus the live `events.jsonl`): 1,383 pairs, p50 1 ms,
 * p95 1 ms, and the single 114,886 ms outlier is an `AskUserQuestion`, i.e. a human answering. That delta
 * measures cmux's own relay of the hook payload, which returns long before the ten `PreToolUse` shims
 * `hooks/hooks.json` registers have booted. Repro — pair the two phases on `payload._opencode_request_id`,
 * which is the same string on both:
 *
 * ```bash
 * grep -h '"agent.hook' ~/.cmuxterm/events.jsonl | node -e '…pair on _opencode_request_id, print occurred_at delta…'
 * ```
 *
 * There is no `agent.hook.PostToolUse` frame at all — the names cmux emits are `PreToolUse`, `Stop`,
 * `UserPromptSubmit`, `Notification`, `AskUserQuestion`, `SessionStart` and `SubagentStop` — so the tool's
 * END is not observable from this stream either, and this module has no hook duration to offer.
 *
 * **Claude Code's transcripts DO carry one, and this header used to say they did not.** 2.1.278 writes an
 * `attachment` line per hook call with its own `durationMs`, which `../../transcripts/hookDuration.ts`
 * reads and `./report.ts` now carries as `hookOverruns`. Repro:
 * `grep -rh -m1 'killed after 15s' ~/.claude/projects/`. The correction matters because the old claim was
 * the stated reason `perf` graded hooks from `ps` alone — and a `ps` sample cannot see a call that already
 * died, so the report printed `no hook over the line` while 34 `PreToolUse` calls went past the 15 s budget
 * in the same 3 h 27 m window. That record covers only hooks that EMITTED OUTPUT,
 * so it is an exact overrun census and never a latency distribution; `hookDuration.ts`'s header carries the
 * coverage measurement. The live instrument here is still `ps`, which `../machine/fleetLoad.ts` reads.
 *
 * So what this module measures is **TURNAROUND**: the gap between one seat's consecutive tool calls. It is
 * hook time plus tool time plus model time, and it is named that way everywhere it is printed. A hook that
 * holds a tool call for 27 minutes (a measurement by hand, on the chair) is visible here
 * as a p95 blow-out against that seat's own p50 — which is the question being asked — while the live `ps`
 * stall names the hook outright.
 *
 * ## Why a gap is only counted INSIDE one uninterrupted run
 *
 * A seat that finished its turn at 23:00 and was tagged again at 09:00 did not spend ten hours on a tool
 * call. Any frame in {@link TURN_BOUNDARY_NAMES} ends the run, so the next `PreToolUse` starts a fresh one
 * and contributes no gap. Without that, every overnight idle period lands in p95 and the gauge reports the
 * quietest seats as the slowest.
 */
import type { CmuxEvent } from "../../cmux/events.js";
import { type Distribution, summarise } from "./quantiles.js";

/** The one frame a tool call announces itself with. */
const PRE_TOOL_USE = "agent.hook.PreToolUse";

/**
 * The frames that END a run of tool calls, so the gap across them is idle time rather than turnaround.
 * `Stop` is the turn ending, `Notification` and `AskUserQuestion` are the seat waiting on a person, and
 * `UserPromptSubmit`/`SessionStart` begin a new one.
 */
const TURN_BOUNDARY_NAMES: ReadonlySet<string> = new Set([
  "agent.hook.Stop",
  "agent.hook.SubagentStop",
  "agent.hook.Notification",
  "agent.hook.AskUserQuestion",
  "agent.hook.UserPromptSubmit",
  "agent.hook.SessionStart",
]);

/** What the stream says about ONE seat over the window. */
export interface SeatStream {
  /** cmux's workspace id, when the frames carried one. */
  readonly workspaceId: string | undefined;
  /**
   * The Claude Code session id with cmux's `claude-` prefix stripped, so it joins `SessionLoad.sessionId`
   * (which comes off the process's own `--session-id` argv and carries no prefix).
   */
  readonly sessionId: string | undefined;
  /** The seat's own working directory — the only field that names a worktree a human recognises. */
  readonly cwd: string | undefined;
  /** How many tool calls fired in the window. */
  readonly firings: number;
  /** Turnaround in SECONDS between consecutive tool calls inside one run, or `undefined` when none paired. */
  readonly turnaround: Distribution | undefined;
  /**
   * Seconds since this seat's last tool call, when that call has not been followed by any frame at all —
   * an in-flight call's age. `undefined` once a turn boundary or a later call has closed it out.
   */
  readonly inFlightSeconds: number | undefined;
  /** The tool that in-flight call is for, when the frame named one. */
  readonly inFlightTool: string | undefined;
}

/** The whole window's reading. */
export interface HookStreamReading {
  /** One row per seat that fired at least one frame, busiest first. */
  readonly seats: readonly SeatStream[];
  /** How many frames of each `agent.hook.*` name the window held, descending by count. */
  readonly byName: readonly { readonly name: string; readonly count: number }[];
  /** How many frames were folded — zero means the log was unreadable or the window empty, never "quiet". */
  readonly frames: number;
  /** The window actually folded, in milliseconds. */
  readonly windowMs: number;
}

/** A seat's frames, in the order they were read, keyed by the best identity the frames carried. */
interface SeatFrames {
  readonly key: string;
  readonly events: CmuxEvent[];
}

/**
 * The key a frame's seat is grouped under — workspace id first, then the session id, then the cwd. A frame
 * carrying none of the three is not attributable to a seat and is counted in {@link HookStreamReading.byName}
 * only.
 */
function seatKeyOf({ event }: { event: CmuxEvent }): string | undefined {
  const workspaceId = event.workspaceId;
  if (workspaceId !== undefined && workspaceId.length > 0) {
    return `ws:${workspaceId}`;
  }
  const sessionId = event.sessionId;
  if (sessionId !== undefined && sessionId.length > 0) {
    return `session:${sessionId}`;
  }
  const cwd = event.cwd;
  if (cwd !== undefined && cwd.length > 0) {
    return `cwd:${cwd}`;
  }
  return undefined;
}

/**
 * The bare session id behind cmux's `claude-<uuid>` payload spelling, so a stream row joins a `ps` row.
 *
 * @param sessionId the payload's own value
 * @returns the uuid without the agent prefix, or `undefined` when the frame named no session
 */
export function bareSessionId({ sessionId }: { sessionId: string | undefined }): string | undefined {
  if (sessionId === undefined || sessionId.length === 0) {
    return undefined;
  }
  return sessionId.replace(/^(?:claude|codex)-/u, "");
}

/** One seat's turnaround samples and in-flight call, walked in stream order. */
function seatReading({ events, nowMs }: { events: readonly CmuxEvent[]; nowMs: number }): {
  readonly firings: number;
  readonly samples: readonly number[];
  readonly inFlightSeconds: number | undefined;
  readonly inFlightTool: string | undefined;
} {
  const samples: number[] = [];
  let firings = 0;
  let previousCallMs: number | undefined;
  let openCall: { ms: number; tool: string | undefined } | undefined;
  for (const event of events) {
    const at = Date.parse(event.occurredAtIso);
    if (Number.isNaN(at)) {
      continue;
    }
    if (TURN_BOUNDARY_NAMES.has(event.name)) {
      previousCallMs = undefined;
      openCall = undefined;
      continue;
    }
    if (event.name !== PRE_TOOL_USE || event.phase === "completed") {
      continue;
    }
    firings += 1;
    if (previousCallMs !== undefined && at >= previousCallMs) {
      samples.push(Math.round((at - previousCallMs) / 1000));
    }
    previousCallMs = at;
    openCall = { ms: at, tool: event.toolName };
  }
  if (openCall === undefined) {
    return { firings, inFlightSeconds: undefined, inFlightTool: undefined, samples };
  }
  return {
    firings,
    inFlightSeconds: Math.max(0, Math.round((nowMs - openCall.ms) / 1000)),
    inFlightTool: openCall.tool,
    samples,
  };
}

/**
 * Fold decoded cmux frames into the per-seat and per-hook reading.
 *
 * Frames are expected in the order the log holds them (ascending `seq`); each seat's own list is sorted by
 * `seq` anyway, because the two rotated log files are concatenated by the caller and an out-of-order pair
 * would otherwise produce a negative gap.
 *
 * @param events every decoded frame the caller read, already bounded to the window it wants
 * @param nowMs the instant an in-flight call's age is measured against
 * @param windowMs the window the caller bounded to, carried through so a reader can size the numbers
 * @returns the reading
 */
export function hookStreamReading({
  events,
  nowMs,
  windowMs,
}: {
  events: readonly CmuxEvent[];
  nowMs: number;
  windowMs: number;
}): HookStreamReading {
  const counts = new Map<string, number>();
  const seats = new Map<string, SeatFrames>();
  let frames = 0;
  for (const event of events) {
    if (!event.name.startsWith("agent.hook.")) {
      continue;
    }
    if (event.phase === "completed") {
      continue;
    }
    frames += 1;
    const seen = counts.get(event.name);
    counts.set(event.name, seen === undefined ? 1 : seen + 1);
    const key = seatKeyOf({ event });
    if (key === undefined) {
      continue;
    }
    const seat = seats.get(key);
    if (seat === undefined) {
      seats.set(key, { events: [event], key });
      continue;
    }
    seat.events.push(event);
  }
  const rows: SeatStream[] = [];
  for (const seat of seats.values()) {
    const ordered = seat.events.toSorted((a, b) => a.seq - b.seq);
    const last = ordered[ordered.length - 1]!;
    const reading = seatReading({ events: ordered, nowMs });
    rows.push({
      cwd: ordered.findLast((event) => event.cwd !== undefined)?.cwd,
      firings: reading.firings,
      inFlightSeconds: reading.inFlightSeconds,
      inFlightTool: reading.inFlightTool,
      sessionId: bareSessionId({ sessionId: ordered.findLast((event) => event.sessionId !== undefined)?.sessionId }),
      turnaround: summarise({ samples: reading.samples }),
      workspaceId: last.workspaceId,
    });
  }
  return {
    byName: [...counts.entries()]
      .map(([name, count]) => ({ count, name }))
      .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    frames,
    seats: rows.toSorted((a, b) => b.firings - a.firings),
    windowMs,
  };
}
