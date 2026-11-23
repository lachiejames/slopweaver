/**
 * Reading one session's context depth off disk — the effectful half of {@link ./tokenDepth}.
 *
 * Deliberately not an incremental fold. A fold that sums every turn must never re-read a byte; this one wants
 * only the NEWEST turn, so it re-reads a bounded tail each call and holds no state at all. A cursor here would
 * buy nothing and would have to be invalidated on every rotation.
 *
 * Everything that can go wrong produces a reason rather than a zero — a session reported as shallow because
 * nobody could read its transcript is exactly the comforting-zero failure the gauge exists to remove.
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import { transcriptPathFor } from "./liveSessionStore.js";
import { type ContextDepth, DEPTH_TAIL_BYTES, latestContextDepth } from "./tokenDepth.js";

/**
 * Read at most the last {@link DEPTH_TAIL_BYTES} of a file, saying whether that reached the start.
 *
 * The flag is not a nicety: a tail that began mid-file began mid-LINE, and the fold has to drop that fragment
 * rather than fail to parse it. See {@link latestContextDepth}.
 *
 * @param path the file to read
 * @returns the tail as text, and whether it starts at byte 0
 */
function readDepthTail({ path }: { path: string }): { readonly text: string; readonly fromStart: boolean } {
  // Opened NON-BLOCKING and judged through the descriptor it is read from: a FIFO at the transcript path would
  // otherwise block whatever asked forever — a tick, a hook — and no swap can land between check and read.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      throw new Error(`${path} is not a regular file, so it is not read`);
    }
    const start = Math.max(0, stats.size - DEPTH_TAIL_BYTES);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return { fromStart: start === 0, text: buffer.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

/**
 * One session's current context depth, or the reason there is none.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the Claude Code session to measure
 * @returns the newest turn's depth, or why it could not be measured
 */
export function readContextDepth({
  projectsDir,
  sessionId,
}: {
  projectsDir: string;
  sessionId: string;
}): Measured<ContextDepth> {
  const path = transcriptPathFor({ projectsDir, sessionId });
  if (path === undefined) {
    return unmeasurable({
      why:
        sessionId === ""
          ? "the registry recorded no session id, so no transcript can be located"
          : "no transcript file exists for this session id yet",
    });
  }
  return readContextDepthAt({ path });
}

/**
 * The context depth in a transcript at a KNOWN path.
 *
 * Split out because a `PreToolUse` payload hands the guard `transcript_path` directly
 * (`../admit/sessionDepthWarningRunner.ts`), so resolving a session id back into a path would be throwing
 * away the answer in order to look it up again.
 *
 * @param path the transcript file to measure
 * @returns the newest turn's depth, or why it could not be measured
 */
export function readContextDepthAt({ path }: { path: string }): Measured<ContextDepth> {
  let tail: { readonly text: string; readonly fromStart: boolean };
  try {
    tail = readDepthTail({ path });
  } catch (error: unknown) {
    return unmeasurable({ why: `the transcript could not be read: ${String(error)}` });
  }
  const read = latestContextDepth({ fromStart: tail.fromStart, text: tail.text });
  return "why" in read ? unmeasurable({ why: read.why }) : measured({ value: read.depth });
}
