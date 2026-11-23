/**
 * The durable per-pass heartbeat log.
 *
 * A local-state writer under `$SLOPWEAVER_HOME/orchestration`, which is why it is a sanctioned seam rather
 * than an open one — it never touches the repository and never leaves the machine.
 *
 * WHY IT EXISTS, measured rather than assumed. stderr alone is not enough: the harness caps a foreground
 * command at 600 seconds, so every real planning pass gets backgrounded, and a backgrounded pass's stderr
 * goes wherever the caller put it. On one run that was a file emptied by a `| tail`, so the heartbeat
 * was live and correct and completely invisible — the agent polled six times and read zero
 * bytes every time. A wake-up loop is only as useful as the thing it wakes up to read.
 *
 * Best-effort throughout: a pass must never fail because its log could not be written.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { absentAs } from "#lib/absent.js";
import { appendLines } from "#lib/appendSeparator.js";
import { slopweaverHome } from "../config.js";
import { type Logger, logger } from "../lib/logger.js";
import { stateHomePaths } from "../stateHome.js";
import type { CodexActivity } from "./progress.js";
import type { CodexPassId } from "./types.js";

/**
 * The two effects opening a stream log reaches: where the state home is, and where the path announcement goes.
 *
 * Both are FUNCTIONS rather than values, so the home is still resolved at the moment the path is built and the
 * announcement still lands after the file is created — a test swaps them without moving either effect.
 */
export interface StreamLogDeps {
  /** Resolve the state home the log is written under. */
  readonly home: () => string;
  /** Where the one-line "streaming to <path>" announcement goes. */
  readonly diagnostic: Logger["error"];
}

/** The real effects: the resolved `$SLOPWEAVER_HOME`, and the process logger's stderr channel. */
const PRODUCTION_STREAM_LOG_DEPS: StreamLogDeps = { diagnostic: logger.error, home: slopweaverHome };

/**
 * Open the durable stream log and announce its path, returning an appender.
 *
 * stderr alone is not enough, and this is measured rather than theoretical. The Bash tool caps a foreground
 * command at 600s, so EVERY real planning pass gets backgrounded — and a backgrounded pass's stderr goes
 * wherever the harness put it, which on one run was a file emptied by a `| tail`. The heartbeat
 * was live and correct and nobody could see it: the agent polled six times and read zero bytes each
 * time. A wake-up loop is only as good as the thing it wakes up to read.
 *
 * Best-effort throughout. A pass must never fail because its log could not be opened.
 *
 * @param pass which pass is running
 * @param deps the home resolver and announcement sink; omitted, the real home and stderr
 * @returns an appender, which does nothing if the log could not be opened
 */
export function openStreamLog({
  pass,
  deps = PRODUCTION_STREAM_LOG_DEPS,
}: {
  pass: CodexPassId;
  deps?: StreamLogDeps;
}): (line: { activity: CodexActivity; elapsedMs: number }) => void {
  const path = join(stateHomePaths({ home: deps.home() }).orchestration, `stream-${pass}-${String(process.pid)}.log`);
  try {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    writeFileSync(path, `# codex ${pass} — live heartbeat, appended per event\n`, { mode: 0o600 });
  } catch {
    return () => {};
  }
  // FIRST line on stderr, before any heartbeat, so a reader that arrives late still learns where to look.
  deps.diagnostic({ msg: `codex ${pass}: streaming to ${path}` });
  return ({ activity, elapsedMs }) => {
    try {
      appendLines({
        path,
        text: `${String(Math.round(elapsedMs / 1000))}s  ${String(activity.commands)} cmd  ${String(activity.failedCommands)} failed  ${absentAs({ value: activity.lastCommand, whenAbsent: "(no command yet)" })}\n`,
      });
    } catch {
      // A log that cannot be written must not take the pass down with it.
    }
  };
}
