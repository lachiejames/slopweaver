/**
 * The System Events commands, as data: a fixed program, the pair only as trailing argv, the allowlist checked again
 * before anything runs. A recording runner stands in for `osascript`; nothing here touches Accessibility.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";

import type { DialogDismissal } from "../../../cmux/dialog.js";
import {
  DIALOG_OSASCRIPT_TIMEOUT_MS,
  type DialogCommand,
  dismissCmuxDialog,
  dismissDialogCommand,
  readCmuxDialogs,
  readDialogsCommand,
} from "../../../cmux/dialogEffects.js";

/** A runner that records each command and answers with `reply`. */
function recorder({ reply }: { reply: Result<string, string> }): {
  ran: DialogCommand[];
  run: (options: { command: DialogCommand }) => Result<string, string>;
} {
  const ran: DialogCommand[] = [];
  return {
    ran,
    run: ({ command }) => {
      ran.push(command);
      return reply;
    },
  };
}

const CANCEL: DialogDismissal = { button: "Cancel", title: "Run Project Action?" };

describe("dismissDialogCommand", () => {
  it("runs osascript's JavaScript with a fixed program and the pair only as the two trailing arguments", () => {
    const command = dismissDialogCommand({ dismissal: CANCEL });
    expect([command.file, command.args.slice(0, 3), command.args.slice(4), command.timeoutMs]).toEqual([
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e"],
      ["Run Project Action?", "Cancel"],
      DIALOG_OSASCRIPT_TIMEOUT_MS,
    ]);
  });

  it("keeps the title and button out of the program text", () => {
    const program = dismissDialogCommand({ dismissal: CANCEL }).args[3]!;
    expect([program.includes("Run Project Action?"), program.includes('"Cancel"')]).toEqual([false, false]);
  });

  it("matches by exact equality inside an AXDialog, with no default-button branch", () => {
    const program = dismissDialogCommand({ dismissal: CANCEL }).args[3]!;
    expect([program.includes('subrole !== "AXDialog"'), program.includes("default")]).toEqual([true, false]);
  });

  it("chooses cmux by its bundle id, never by a process name another app could carry", () => {
    const programs = [readDialogsCommand().args[3]!, dismissDialogCommand({ dismissal: CANCEL }).args[3]!];
    expect(
      programs.map((program) => [
        program.includes('whose({ bundleIdentifier: "com.cmuxterm.app" })'),
        program.includes("whose({ name:"),
      ]),
    ).toEqual([
      [true, false],
      [true, false],
    ]);
  });
});

describe("readCmuxDialogs", () => {
  it("runs the read program and decodes what it printed", () => {
    const runner = recorder({ reply: ok('[{"buttons":["OK"],"texts":["Hi"],"title":"Hi"}]') });
    expect(unwrap(readCmuxDialogs({ run: runner.run }))).toEqual([{ buttons: ["OK"], texts: ["Hi"], title: "Hi" }]);
    expect(runner.ran).toEqual([readDialogsCommand()]);
  });

  it("names a failed run as a read failure", () => {
    const runner = recorder({ reply: err("Command failed: osascript — not authorised") });
    expect(unwrapErr(readCmuxDialogs({ run: runner.run }))).toEqual({
      code: "DIALOG_READ_FAILED",
      message: "could not read cmux's dialogs: Command failed: osascript — not authorised",
    });
  });
});

describe("dismissCmuxDialog", () => {
  it("presses the allowlisted pair through one command", () => {
    const runner = recorder({ reply: ok("pressed") });
    expect(dismissCmuxDialog({ dismissal: CANCEL, run: runner.run }).isOk()).toBe(true);
    expect(runner.ran).toEqual([dismissDialogCommand({ dismissal: CANCEL })]);
  });

  it("refuses a pair off the allowlist before anything runs", () => {
    const runner = recorder({ reply: ok("pressed") });
    const forged = { button: "Trust and Run", title: "Run Project Action?" } as unknown as DialogDismissal;
    expect(unwrapErr(dismissCmuxDialog({ dismissal: forged, run: runner.run })).message).toBe(
      "could not press the dialog's button: the pair is not on the allowlist",
    );
    expect(runner.ran).toEqual([]);
  });

  it("names a press that found no matching dialog as a failure", () => {
    const runner = recorder({ reply: err("Error: no cmux dialog titled exactly that") });
    expect(unwrapErr(dismissCmuxDialog({ dismissal: CANCEL, run: runner.run })).code).toBe("DIALOG_DISMISS_FAILED");
  });
});
