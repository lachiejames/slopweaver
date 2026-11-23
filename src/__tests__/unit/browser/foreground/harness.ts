/*
 * What the foreground test files share: a recording stand-in for the machine, the argv lines it keys its replies
 * by, the replies for Chrome or Slack in front, and the raise line as the recorder keys it.
 */
import type { ForegroundCommand, ForegroundRun } from "../../../../browser/foreground.js";

/**
 * A recording stand-in for the machine, built by hand rather than with `vi.fn` — a plain fake passed in is
 * a seam, and `testing.md` bans the mock helpers outright. Each command's reply is looked up by its argv;
 * one with no reply throws, which is exactly what a missing `lsappinfo` or a refused Apple Event does.
 *
 * @returns the run seam to pass in, and a read of every argv line it was asked to run, in order
 */
export function recorder({ replies }: { replies: Readonly<Record<string, string>> }): {
  readonly run: ForegroundRun;
  readonly ran: () => readonly string[];
} {
  const ran: string[] = [];
  const key = (command: ForegroundCommand): string => [command.file, ...command.args].join(" ");
  return {
    ran: () => [...ran],
    run: (command) => {
      const line = key(command);
      ran.push(line);
      const reply = replies[line];
      if (reply === undefined) {
        throw new Error(`no such command: ${line}`);
      }
      return reply;
    },
  };
}

/** The read of which app is in front, as the recorder keys it. */
export const FRONT_ASN = "lsappinfo front";
/** The read of the front app's bundle identifier, as the recorder keys it. */
export const BUNDLE_OF = "lsappinfo info -only bundleid ASN:0x0-0x18018:";
/** The read of Chrome's front window id, as the recorder keys it. */
export const CHROME_WINDOW = 'osascript -e tell application "Google Chrome" to get id of window 1';

/** The replies for Chrome in front, its front window 2109125256. */
export const CHROME_IN_FRONT: Readonly<Record<string, string>> = {
  [BUNDLE_OF]: '"CFBundleIdentifier"="com.google.Chrome"\n',
  [CHROME_WINDOW]: "2109125256\n",
  [FRONT_ASN]: "ASN:0x0-0x18018:\n",
};

/** The replies for Slack in front. */
export const SLACK_IN_FRONT: Readonly<Record<string, string>> = {
  [BUNDLE_OF]: '"CFBundleIdentifier"="com.tinyspeck.slackmacgap"\n',
  [FRONT_ASN]: "ASN:0x0-0x18018:\n",
};

/** The read of Chrome's window order, front to back, as the recorder keys it. */
export const WINDOW_IDS =
  'osascript -e if application "Google Chrome" is running then tell application "Google Chrome" to get id of every window';

/**
 * The raise as the recorder keys it: hide the window, then show it again.
 *
 * @returns the osascript argv line that raises that Chrome window
 */
export function raiseLine({ windowId }: { windowId: number }): string {
  const window = `window id ${String(windowId)}`;
  return `osascript -e tell application "Google Chrome" -e set visible of ${window} to false -e set visible of ${window} to true -e end tell`;
}
