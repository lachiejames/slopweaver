/**
 * `cmux dialog`'s lines, exit codes and flag handling over fake effects in a temp home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";

import { dialogExit, dialogLines, dialogPass, runCmuxDialog } from "../../../../../cli/commands/cmux/dialog.js";
import { type CmuxDialog, CmuxDialogErrors, type DialogDismissal } from "../../../../../cmux/dialog.js";
import type { DialogRecoveryDeps } from "../../../../../cmux/dialogRecovery.js";
import type { FleetPort } from "../../../../../fleet/port.js";
import { memoryFleetPort } from "../../../../fleetStoreFixture.js";

const PROMPT: CmuxDialog = {
  buttons: ["Run Once", "Cancel", "Trust and Run"],
  texts: ["Run Project Action?", "It will run: [payload-log] log-notification.sh"],
  title: "Run Project Action?",
};
const CANCEL: DialogDismissal = { button: "Cancel", title: "Run Project Action?" };

let homes: string[] = [];

afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** A fresh home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "dialog-cli-"));
  homes.push(home);
  return home;
}

/** Fake effects showing `dialogs`, collecting each press, journalling through `fleet`. */
function deps({
  fleet,
  dialogs,
  pressed,
}: {
  fleet: FleetPort;
  dialogs: readonly CmuxDialog[];
  pressed: DialogDismissal[];
}): DialogRecoveryDeps {
  return {
    append: ({ event, home }) => fleet.appendCmuxReviveEvent({ event, home }),
    dismiss: ({ dismissal }) => {
      pressed.push(dismissal);
      return ok(undefined);
    },
    nowIso: () => "2026-10-11T07:28:00.000Z",
    read: () => ok(dialogs),
  };
}

describe("dialogLines", () => {
  it("says so when cmux shows no dialog", () => {
    expect(dialogLines({ dismiss: true, report: { dialogs: [], dismissed: null } })).toEqual([
      "cmux dialog: cmux shows no modal dialog",
    ]);
  });

  it("lists the dialog, its text and buttons, then the press", () => {
    expect(dialogLines({ dismiss: true, report: { dialogs: [PROMPT], dismissed: CANCEL } })).toEqual([
      'cmux dialog: "Run Project Action?" — buttons: Run Once, Cancel, Trust and Run',
      "  Run Project Action?",
      "  It will run: [payload-log] log-notification.sh",
      'pressed Cancel on "Run Project Action?", and journalled it',
    ]);
  });

  it("says nothing was pressed, and why, in both modes", () => {
    const report = { dialogs: [{ ...PROMPT, title: "Quit cmux?" }], dismissed: null };
    expect([dialogLines({ dismiss: true, report }).at(-1), dialogLines({ dismiss: false, report }).at(-1)]).toEqual([
      "pressed nothing: no dialog shown is one the fleet may answer",
      "pressed nothing (read only)",
    ]);
  });
});

describe("dialogExit", () => {
  it("exits 0 on a look or a press, 3 on a press with nothing to press, 1 on a failure", () => {
    expect([
      dialogExit({ dismiss: false, result: ok({ dialogs: [], dismissed: null }) }),
      dialogExit({ dismiss: true, result: ok({ dialogs: [PROMPT], dismissed: CANCEL }) }),
      dialogExit({ dismiss: true, result: ok({ dialogs: [], dismissed: null }) }),
      dialogExit({ dismiss: true, result: err(CmuxDialogErrors.readFailed({ why: "not authorised" })) }),
    ]).toEqual([0, 0, 3, 1]);
  });
});

describe("dialogPass", () => {
  it("presses exactly once and journals it", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const pressed: DialogDismissal[] = [];
    const code = await dialogPass({
      deps: deps({ dialogs: [PROMPT], fleet, pressed }),
      request: { dismiss: true, home, json: true },
    });
    const journalled = unwrap(await fleet.readCmuxReviveJournal({ home })).events.map((event) => event.kind);
    expect([code, pressed, journalled]).toEqual([0, [CANCEL], ["dialog-dismissed"]]);
  });

  it("presses nothing without --dismiss", async () => {
    const home = freshHome();
    const pressed: DialogDismissal[] = [];
    const code = await dialogPass({
      deps: deps({ dialogs: [PROMPT], fleet: memoryFleetPort(), pressed }),
      request: { dismiss: false, home, json: false },
    });
    expect([code, pressed]).toEqual([0, []]);
  });
});

describe("runCmuxDialog", () => {
  it("refuses a positional before touching anything — no flag or argument names a button", async () => {
    const home = freshHome();
    expect(await runCmuxDialog(["node", "slopweaver", "cmux", "dialog", "Trust and Run", "--home", home])).toBe(2);
  });

  it("refuses an unknown flag", async () => {
    const home = freshHome();
    expect(await runCmuxDialog(["node", "slopweaver", "cmux", "dialog", "--button", "OK", "--home", home])).toBe(2);
  });
});
