/**
 * The dialog read's decoding, the closed allowlist, and when an automatic attempt is due — the "Run
 * Project Action?" alert is the shape.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  AUTOMATIC_ATTEMPT_INTERVAL_MS,
  automaticDialogAttemptDue,
  type CmuxDialog,
  dismissalForDialog,
  isAllowedDismissal,
  parseCmuxDialogs,
} from "../../../cmux/dialog.js";

/** The alert as System Events read it. */
const PROMPT: CmuxDialog = {
  buttons: ["Run Once", "Cancel", "Trust and Run"],
  texts: [
    "Run Project Action?",
    "This project action comes from: /tmp/scratchpad/cmux.json",
    "It will run: [payload-log] ~/.config/cmux/hooks/log-notification.sh",
  ],
  title: "Run Project Action?",
};

describe("parseCmuxDialogs", () => {
  it("decodes the read program's list exactly", () => {
    expect(unwrap(parseCmuxDialogs({ text: JSON.stringify([PROMPT]) }))).toEqual([PROMPT]);
  });

  it("decodes no dialogs as an empty list", () => {
    expect(unwrap(parseCmuxDialogs({ text: "[]" }))).toEqual([]);
  });

  it("keeps quotes and newlines in dialog text as data", () => {
    const hostile = { ...PROMPT, texts: ['"; do shell script "rm" --', "two\nlines"] };
    expect(unwrap(parseCmuxDialogs({ text: JSON.stringify([hostile]) }))[0]!.texts).toEqual([
      '"; do shell script "rm" --',
      "two\nlines",
    ]);
  });

  it("refuses text that is not JSON", () => {
    expect(unwrapErr(parseCmuxDialogs({ text: "Run Project Action?, Cancel" })).message).toBe(
      "the dialog read returned no dialog list: not JSON",
    );
  });

  it("refuses a dialog missing a field, or carrying one it does not know", () => {
    expect([
      unwrapErr(parseCmuxDialogs({ text: JSON.stringify([{ buttons: [], title: "x" }]) })).code,
      unwrapErr(parseCmuxDialogs({ text: JSON.stringify([{ ...PROMPT, defaultButton: "Trust and Run" }]) })).code,
    ]).toEqual(["DIALOG_REPLY_INVALID", "DIALOG_REPLY_INVALID"]);
  });
});

describe("dismissalForDialog", () => {
  it("names Cancel on the exact prompt", () => {
    expect(dismissalForDialog({ dialog: PROMPT })).toEqual({ button: "Cancel", title: "Run Project Action?" });
  });

  it("names nothing on the prompt when Cancel is missing — never Run Once or Trust and Run", () => {
    expect(dismissalForDialog({ dialog: { ...PROMPT, buttons: ["Run Once", "Trust and Run"] } })).toBeUndefined();
  });

  it("names nothing on any other title, however close", () => {
    expect([
      dismissalForDialog({ dialog: { ...PROMPT, title: "Run Project Action" } }),
      dismissalForDialog({ dialog: { ...PROMPT, title: "run project action?" } }),
      dismissalForDialog({ dialog: { ...PROMPT, title: "Quit cmux?" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("isAllowedDismissal", () => {
  it("allows only the one exact pair", () => {
    expect([
      isAllowedDismissal({ button: "Cancel", title: "Run Project Action?" }),
      isAllowedDismissal({ button: "Trust and Run", title: "Run Project Action?" }),
      isAllowedDismissal({ button: "Run Once", title: "Run Project Action?" }),
      isAllowedDismissal({ button: "Cancel", title: "Quit cmux?" }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("automaticDialogAttemptDue", () => {
  const due = ({ last, now }: { last: string | undefined; now: string }): boolean =>
    automaticDialogAttemptDue({ intervalMs: AUTOMATIC_ATTEMPT_INTERVAL_MS, lastAttemptIso: last, nowIso: now });

  it("is due with no attempt before", () => {
    expect(due({ last: undefined, now: "2026-10-11T07:28:00.000Z" })).toBe(true);
  });

  it("is not due inside the minute, and due once it has passed", () => {
    expect([
      due({ last: "2026-10-11T07:28:00.000Z", now: "2026-10-11T07:28:59.999Z" }),
      due({ last: "2026-10-11T07:28:00.000Z", now: "2026-10-11T07:29:00.000Z" }),
    ]).toEqual([false, true]);
  });

  it("is due over a stamp that names no instant", () => {
    expect(due({ last: "not a time", now: "2026-10-11T07:28:00.000Z" })).toBe(true);
  });

  it("holds a stamp from the future until the clock passes it by the minute, so a clock set back never presses twice", () => {
    expect([
      due({ last: "2026-10-11T07:28:30.000Z", now: "2026-10-11T07:28:00.000Z" }),
      due({ last: "2026-10-11T07:28:30.000Z", now: "2026-10-11T07:29:29.999Z" }),
      due({ last: "2026-10-11T07:28:30.000Z", now: "2026-10-11T07:29:30.000Z" }),
    ]).toEqual([false, false, true]);
  });
});
