/**
 * The shell's event log, wired to Electron: one entry appended to `desktop-events.jsonl` in the app's own logs folder
 * (`desktopEventLog.ts` is the file half). Shared by every shell module that records what nothing else would.
 */
import { join } from "node:path";

import { app } from "electron";

import { appendDesktopEventLog, DESKTOP_EVENT_LOG, desktopEventLogLine } from "./desktopEventLog";
import type { DesktopEventEntry } from "./overlayRecovery";

/**
 * Append one entry to the shell's event log. A log it cannot write goes to stderr, which is all a crash path has
 * left: the tray's problem line belongs to the saved state.
 *
 * @param entry what happened
 */
export function logDesktopEvent({ entry }: { entry: DesktopEventEntry }): void {
  const written = appendDesktopEventLog({
    line: desktopEventLogLine({ entry }),
    path: join(app.getPath("logs"), DESKTOP_EVENT_LOG),
  });
  if (written.isErr()) {
    process.stderr.write(`${written.error.message}\n`);
  }
}
