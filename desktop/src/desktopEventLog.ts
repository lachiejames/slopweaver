/**
 * The shell's own event log: one JSON line per thing that happened to a window that nothing else would record — the
 * voice's renderer dying under a call, the reloaded page taking its recovery (`overlayRecovery.ts`). Before it, a crash
 * left only a macOS crash report, which names no call, and the transcript, which said nothing at all. It lives in the
 * app's own logs folder, `~/Library/Logs/Slopweaver/desktop-events.jsonl` on a packaged build. Reproduce a reading:
 * `tail -n 5 ~/Library/Logs/Slopweaver/desktop-events.jsonl`.
 *
 * Written synchronously, for the reason `stateStore.ts` gives: a line still pending when the app quits is never
 * written, and these lines are what a crash leaves behind.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { err, ok, type Result } from "neverthrow";

import { type DesktopLogError, DesktopLogErrors } from "./errors";
import type { DesktopEventEntry } from "./overlayRecovery";

/** The log's file name inside the app's logs folder. */
export const DESKTOP_EVENT_LOG = "desktop-events.jsonl";

/**
 * One entry as the line it is appended as.
 *
 * @param entry what happened
 * @returns the JSON line, newline-terminated
 */
export function desktopEventLogLine({ entry }: { entry: DesktopEventEntry }): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Append one line, making the folder on a first write.
 *
 * @param path the log file
 * @param line one newline-terminated line
 * @returns nothing once it is handed to the OS, or why it could not be
 */
export function appendDesktopEventLog({ path, line }: { path: string; line: string }): Result<void, DesktopLogError> {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line, "utf8");
    return ok(undefined);
  } catch (cause) {
    return err(DesktopLogErrors.unwritable({ detail: cause instanceof Error ? cause.message : String(cause), path }));
  }
}
