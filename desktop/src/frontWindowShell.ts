/**
 * The effectful half of the front-window read: one `osascript -l JavaScript` run of `frontWindow.ts`'s fixed program,
 * by absolute path with the program in argv, bounded in time and output. Every failure is an answer, never a throw.
 */
import { execFile } from "node:child_process";

import { FRONT_WINDOW_PROGRAM, type FrontWindowReply, frontWindowPidOf, frontWindowReplyOf } from "./frontWindow";

/** How long one read may take: it names two things, so anything slower is a hang. */
const FRONT_WINDOW_TIMEOUT_MS = 3_000;

/** The most output taken: one JSON line of three bounded names, with room for a window list it never prints. */
const FRONT_WINDOW_MAX_BUFFER = 64 * 1024;

/**
 * Read which application is in front, its window's title, and its process id.
 *
 * @returns the bounded front window, or why it could not be read, beside the process id for the main process alone
 */
export async function readFrontWindowAndPid(): Promise<{
  readonly reply: FrontWindowReply;
  readonly pid: number | undefined;
}> {
  return new Promise((resolve) => {
    // The system's own `osascript`, never one on PATH — spelled here, not in a constant, because rule 2's
    // `no-headless` gate recognises this call by the program it names.
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", FRONT_WINDOW_PROGRAM],
      { maxBuffer: FRONT_WINDOW_MAX_BUFFER, timeout: FRONT_WINDOW_TIMEOUT_MS },
      (error, stdout) => {
        if (error !== null) {
          resolve({ pid: undefined, reply: { why: `the front window could not be read: ${error.message}` } });
          return;
        }
        resolve({ pid: frontWindowPidOf({ stdout }), reply: frontWindowReplyOf({ stdout }) });
      },
    );
  });
}

/**
 * Read which application is in front and its window's title.
 *
 * @returns the bounded front window, or why it could not be read
 */
export async function readFrontWindow(): Promise<FrontWindowReply> {
  const { reply } = await readFrontWindowAndPid();
  return reply;
}
