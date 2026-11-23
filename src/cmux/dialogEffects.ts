/**
 * Read cmux's modal dialogs and press the one allowlisted button, through System Events from INSIDE a seat.
 *
 * ## Why a seat, and never the desktop app
 *
 * UI scripting needs the Accessibility grant of the process that runs `osascript`. cmux holds one
 * (`com.cmuxterm.app` in TCC), so a seat's `osascript` inherits it; Slopweaver.app holds none, and granting it is
 * new access that is the owner's to give, not the fleet's to build around. MEASURED from a seat:
 * `osascript -l JavaScript` listing cmux's windows printed `[{"name":"/slopweaver:supervisor","subrole":
 * "AXStandardWindow"}]` with no prompt.
 *
 * ## Why the programs are constants
 *
 * The title and button travel only as trailing argv into a fixed JXA `run(argv)`, never into program text, so no
 * dialog text and no caller can change what runs. The press program matches the exact title and the exact button
 * name inside an `AXDialog` of the cmux process and throws otherwise: no default button, no index, no partial match.
 *
 * ## What "title" means for an alert
 *
 * An `NSAlert` sheds its window title: its heading, cmux's "Run Project Action?", is the alert's message text, the
 * first `AXStaticText` of a window whose name is empty. So a dialog's title is its window name, or — only when that
 * name is empty — its first line of text, which for an alert IS its heading. A dialog carrying a non-empty name is
 * matched by that name alone. Either way it must be an `AXDialog` of cmux's own process and carry a button named
 * exactly "Cancel", and Cancel stores no trust, so the worst a mismatch can do is decline a cmux prompt.
 */
import { execFileSync } from "node:child_process";

import { err, ok, type Result } from "#lib/result.js";

import {
  type CmuxDialog,
  type CmuxDialogError,
  CmuxDialogErrors,
  type DialogDismissal,
  isAllowedDismissal,
  parseCmuxDialogs,
} from "./dialog.js";

/** How long one System Events call may take; a responsive one takes well under a second. */
export const DIALOG_OSASCRIPT_TIMEOUT_MS = 5_000;

/** One `osascript` run, as data. */
export interface DialogCommand {
  readonly file: "/usr/bin/osascript";
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

/** Run one command: what it printed, or why it failed. */
export type DialogCommandRun = (options: { command: DialogCommand }) => Result<string, string>;

/**
 * Every `AXDialog` of the cmux process, each with its title — the window's name, else an alert's heading. The process
 * is chosen by bundle id, never by name, so another app calling itself "cmux" is never pressed.
 * A name that cannot be READ is not an empty one: that dialog gets no title, so nothing matches it and it is never
 * pressed, rather than borrowing its first static text.
 * MEASURED from a seat: `processes.whose({ bundleIdentifier: "com.cmuxterm.app" })` named `["cmux"]`.
 */
const CMUX_DIALOGS = `
function cmuxDialogs() {
  var found = [];
  var procs = Application("System Events").processes.whose({ bundleIdentifier: "com.cmuxterm.app" })();
  for (var p = 0; p < procs.length; p++) {
    var windows = procs[p].windows();
    for (var w = 0; w < windows.length; w++) {
      var win = windows[w];
      var subrole = "";
      try { subrole = String(win.subrole()); } catch (e) {}
      if (subrole !== "AXDialog") { continue; }
      var texts = win.staticTexts().map(function (t) { try { return String(t.value()); } catch (e) { return ""; } });
      var buttons = win.buttons();
      var names = buttons.map(function (b) { try { return String(b.name()); } catch (e) { return ""; } });
      var name = null;
      try { name = String(win.name() || ""); } catch (e) {}
      var title = "";
      if (name !== null) { title = name !== "" ? name : (texts.length > 0 ? texts[0] : ""); }
      found.push({ buttons: buttons, names: names, texts: texts, title: title });
    }
  }
  return found;
}
`;

const READ_PROGRAM = `${CMUX_DIALOGS}
function run(argv) {
  return JSON.stringify(cmuxDialogs().map(function (d) { return { buttons: d.names, texts: d.texts, title: d.title }; }));
}
`;

const PRESS_PROGRAM = `${CMUX_DIALOGS}
function run(argv) {
  if (argv.length !== 2) { throw new Error("expected a title and a button"); }
  var dialogs = cmuxDialogs();
  for (var i = 0; i < dialogs.length; i++) {
    if (dialogs[i].title !== argv[0]) { continue; }
    for (var b = 0; b < dialogs[i].names.length; b++) {
      if (dialogs[i].names[b] === argv[1]) { dialogs[i].buttons[b].click(); return "pressed"; }
    }
  }
  throw new Error("no cmux dialog titled exactly that with a button named exactly that");
}
`;

/**
 * The read: every `AXDialog` cmux shows, as JSON.
 *
 * @returns the command
 */
export function readDialogsCommand(): DialogCommand {
  return {
    args: ["-l", "JavaScript", "-e", READ_PROGRAM],
    file: "/usr/bin/osascript",
    timeoutMs: DIALOG_OSASCRIPT_TIMEOUT_MS,
  };
}

/**
 * The press: the allowlisted button of the allowlisted dialog, the pair as trailing argv only.
 *
 * @param dismissal the allowlisted pair
 * @returns the command
 */
export function dismissDialogCommand({ dismissal }: { dismissal: DialogDismissal }): DialogCommand {
  return {
    args: ["-l", "JavaScript", "-e", PRESS_PROGRAM, dismissal.title, dismissal.button],
    file: "/usr/bin/osascript",
    timeoutMs: DIALOG_OSASCRIPT_TIMEOUT_MS,
  };
}

/**
 * Run one command with no shell, stdin closed, and its bound.
 *
 * @returns what it printed, or why it failed
 */
export function runDialogCommand({ command }: { command: DialogCommand }): Result<string, string> {
  try {
    const text = execFileSync(command.file, command.args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: command.timeoutMs,
    });
    return ok(text.trim());
  } catch (error: unknown) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Read every modal dialog cmux shows.
 *
 * @param run runs the read program
 * @returns the dialogs, or why they could not be read
 */
export function readCmuxDialogs({ run }: { run: DialogCommandRun }): Result<readonly CmuxDialog[], CmuxDialogError> {
  const printed = run({ command: readDialogsCommand() });
  if (printed.isErr()) {
    return err(CmuxDialogErrors.readFailed({ why: printed.error }));
  }
  return parseCmuxDialogs({ text: printed.value });
}

/**
 * Press the allowlisted button, re-checking the pair against the allowlist before anything runs.
 *
 * @param dismissal the pair to press
 * @param run runs the press program
 * @returns nothing, or why the press did not happen
 */
export function dismissCmuxDialog({
  dismissal,
  run,
}: {
  dismissal: DialogDismissal;
  run: DialogCommandRun;
}): Result<void, CmuxDialogError> {
  if (!isAllowedDismissal({ button: dismissal.button, title: dismissal.title })) {
    return err(CmuxDialogErrors.dismissFailed({ why: "the pair is not on the allowlist" }));
  }
  const pressed = run({ command: dismissDialogCommand({ dismissal }) });
  if (pressed.isErr()) {
    return err(CmuxDialogErrors.dismissFailed({ why: pressed.error }));
  }
  return ok(undefined);
}
