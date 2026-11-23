/**
 * A modal dialog cmux is holding open, and the one answer the fleet may give it.
 *
 * MEASURED: both hang samples (`~/Library/Logs/cmux/hangs/`) show cmux's main
 * thread in `-[NSAlert runModal]` at 0% CPU, and System Events read the alert as an `AXDialog` titled
 * "Run Project Action?" — a seat had copied the global `~/.config/cmux/cmux.json` (a notification hook) into a
 * scratchpad under its workspace's cwd, and cmux asked whether to trust it, 11 to 13 minutes after each reopen. While
 * the alert waits, every request handler waits with it: a fleet-wide hang that a restart only defers. Pressing Cancel
 * cleared it at once.
 *
 * Cancel denies that one run and stores no trust (cmux's `CmuxConfigExecutor.swift`), so the
 * prompt can come back and the fleet declines it again. Only Cancel, only on that title: "Trust and Run" would run a
 * hook from a scratch path, and "the default button" names whichever button cmux makes default. The allowlist is
 * closed, no flag widens it, and the effect boundary (`./dialogEffects.ts`) checks it again before it clicks.
 *
 * Pure: the read program's JSON in, a dialog list, a dismissal and a due decision out.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

/** One modal dialog cmux shows: its title, every line of text in it, and its buttons by name. */
export interface CmuxDialog {
  readonly title: string;
  readonly texts: readonly string[];
  readonly buttons: readonly string[];
}

/** The one dialog the fleet may answer, and the one button it may press there. */
const DECLINABLE = [{ button: "Cancel", title: "Run Project Action?" }] as const;

/** A press the allowlist names. */
export type DialogDismissal = (typeof DECLINABLE)[number];

/** How long a seat waits after one automatic attempt before another may try. */
export const AUTOMATIC_ATTEMPT_INTERVAL_MS = 60_000;

/** The dialog read returned nothing a dialog list can be built from. */
export interface DialogReplyInvalidError {
  readonly code: "DIALOG_REPLY_INVALID";
  readonly message: string;
}

/** The read program could not run, or failed. */
export interface DialogReadFailedError {
  readonly code: "DIALOG_READ_FAILED";
  readonly message: string;
}

/** The press could not run, found no matching dialog, or was refused before it ran. */
export interface DialogDismissFailedError {
  readonly code: "DIALOG_DISMISS_FAILED";
  readonly message: string;
}

/** The automatic attempt's claim could not be read or written. */
export interface DialogStateFailedError {
  readonly code: "DIALOG_STATE_FAILED";
  readonly message: string;
}

/** Why reading or answering a cmux dialog failed. */
export type CmuxDialogError =
  DialogDismissFailedError | DialogReadFailedError | DialogReplyInvalidError | DialogStateFailedError;

/** Build each {@link CmuxDialogError}. */
export const CmuxDialogErrors = {
  dismissFailed: ({ why }: { why: string }): DialogDismissFailedError => ({
    code: "DIALOG_DISMISS_FAILED",
    message: `could not press the dialog's button: ${why}`,
  }),
  readFailed: ({ why }: { why: string }): DialogReadFailedError => ({
    code: "DIALOG_READ_FAILED",
    message: `could not read cmux's dialogs: ${why}`,
  }),
  replyInvalid: ({ why }: { why: string }): DialogReplyInvalidError => ({
    code: "DIALOG_REPLY_INVALID",
    message: `the dialog read returned no dialog list: ${why}`,
  }),
  stateFailed: ({ why }: { why: string }): DialogStateFailedError => ({
    code: "DIALOG_STATE_FAILED",
    message: `could not claim the automatic dialog attempt: ${why}`,
  }),
} as const;

const dialogsSchema = z.array(
  z.object({ buttons: z.array(z.string()), texts: z.array(z.string()), title: z.string() }).strict(),
);

/**
 * Decode the read program's one JSON document: every `AXDialog` cmux shows.
 *
 * @param text what the read program printed
 * @returns the dialogs, or why the text holds no dialog list
 */
export function parseCmuxDialogs({ text }: { text: string }): Result<readonly CmuxDialog[], CmuxDialogError> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err(CmuxDialogErrors.replyInvalid({ why: "not JSON" }));
  }
  const parsed = dialogsSchema.safeParse(value);
  if (!parsed.success) {
    return err(CmuxDialogErrors.replyInvalid({ why: parsed.error.issues.map((issue) => issue.message).join("; ") }));
  }
  return ok(parsed.data);
}

/**
 * Whether a title and button are exactly a pair the allowlist names.
 *
 * @param title the dialog's title
 * @param button the button to press
 * @returns whether the press is allowed
 */
export function isAllowedDismissal({ title, button }: { title: string; button: string }): boolean {
  return DECLINABLE.some((allowed) => allowed.title === title && allowed.button === button);
}

/**
 * The press the allowlist names for one dialog: its exact title, with that exact button present.
 *
 * @param dialog the dialog as read
 * @returns the press, or `undefined` when the dialog is not one the fleet answers
 */
export function dismissalForDialog({ dialog }: { dialog: CmuxDialog }): DialogDismissal | undefined {
  return DECLINABLE.find((allowed) => allowed.title === dialog.title && dialog.buttons.includes(allowed.button));
}

/**
 * Whether an automatic attempt may run now: none was made, the last one is at least the interval old, or its stamp
 * names no instant. A stamp in the future is NOT due until the clock passes it by the interval, so a clock set back
 * never lets a second press through inside the minute. That fails closed: a far-future stamp
 * holds only the automatic decline, never `slopweaver cmux dialog --dismiss` or the revive's restart.
 *
 * What this does NOT close: a wall clock set FORWARD between two seats' timeouts makes the second attempt due early
 * The claim is shared by separate processes, and no clock they share is immune to the
 * adjustment, so spacing is by the wall clock. The cost is one more press of Cancel, which stores no trust in cmux.
 *
 * @param lastAttemptIso when the last automatic attempt was claimed, when a stamp reads
 * @param nowIso the instant judged
 * @param intervalMs the minimum spacing between attempts
 * @returns whether to attempt
 */
export function automaticDialogAttemptDue({
  lastAttemptIso,
  nowIso,
  intervalMs,
}: {
  lastAttemptIso: string | undefined;
  nowIso: string;
  intervalMs: number;
}): boolean {
  if (lastAttemptIso === undefined) {
    return true;
  }
  const lastMs = Date.parse(lastAttemptIso);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(lastMs)) {
    return true;
  }
  return nowMs - lastMs >= intervalMs;
}
