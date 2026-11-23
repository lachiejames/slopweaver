/**
 * Whether a call the owner starts themselves is a REOPEN — their last call ended within a minute of this mint — and,
 * when it is, the one reminder the console hands the voice if the owner stays silent for its opening window.
 *
 * A call reopened a minute later reminds the owner where they left off rather than resuming with no greeting. A new
 * question from the owner goes first: what they are saying takes priority over giving a reminder. To tell who goes
 * first, if the owner is silent for a few seconds the voice gives the reminder, and if they come in straight away
 * within those seconds they do not get it; the window is three seconds. The three seconds are the transport's
 * (`site/lib/planCallContract.ts`, `reopenReminderSilenceMs`); the minute and the words are here.
 *
 * The reminder is a developer message the voice answers in its own words, never a fixed line read out: the owner's last
 * words are speech transcribed ("Um ,yeah, well, …"), and reading them back verbatim is not a colleague saying where they
 * were. It carries the exchange itself, so what the voice recaps is what was said, whatever its prompt quoted.
 *
 * Pure: every input is already read.
 */
import type { TalkContinuity } from "./continuity.js";
import { type ContinuityCall, lastSpokenCall } from "./continuityCalls.js";
import { type MintMode, previousExchange } from "./mintOpener.js";

/**
 * How recently the owner's last call must have ENDED for a call they start to be a reopen: a minute later. From
 * the recorded end, never the last spoken line, so a quiet stretch before the owner hung up does not spend the minute.
 */
export const REOPEN_REMINDER_WINDOW_MS = 60_000;

/** What a reopened call's console hands the voice after its silent window. */
export interface ReopenReminder {
  /** The call the owner hung up on, which the reminder recaps. */
  readonly previousCallId: string;
  /** When that call's end was written. */
  readonly previousEndedIso: string;
  /** The developer message, its exchange included. */
  readonly text: string;
}

/**
 * The reminder a fresh call is minted with when it is a reopen, or `null` when it is not: an automatic reconnect or
 * rollover (each stays silent by its own opener), no spoken call, an unread call file (it may be the newer call), no
 * recorded end, or an end not strictly inside {@link REOPEN_REMINDER_WINDOW_MS} before the read.
 *
 * @param continuity the read, whose `builtIso` is the mint's instant
 * @param mode why the console minted this call
 * @returns the reminder, or `null`
 */
export function reopenReminderOf({
  continuity,
  mode,
}: {
  continuity: TalkContinuity;
  mode: MintMode;
}): ReopenReminder | null {
  return reopenReminderFrom({
    builtIso: continuity.builtIso,
    callsUnread: continuity.unread.some((entry) => entry.section === "calls"),
    last: lastSpokenCall({ continuity }),
    mode,
  });
}

/**
 * The reminder computed from a last call already chosen — {@link reopenReminderOf}'s rule, with the selection left to
 * the caller, so the desktop test instance can feed its OWN last call (`./continuityCalls.ts`'s `testCallsSince`)
 * through the exact same window and wording without any of the owner's calls entering it.
 *
 * @param builtIso the mint's instant
 * @param callsUnread whether a call file could not be read (it may be the newer call)
 * @param last the newest spoken call, or `undefined` when there is none
 * @param mode why the console minted this call
 * @returns the reminder, or `null`
 */
export function reopenReminderFrom({
  builtIso,
  callsUnread,
  last,
  mode,
}: {
  builtIso: string;
  callsUnread: boolean;
  last: ContinuityCall | undefined;
  mode: MintMode;
}): ReopenReminder | null {
  if (mode !== "fresh" || callsUnread) {
    return null;
  }
  if (last === undefined || last.lines.length === 0 || last.endedIso === undefined) {
    return null;
  }
  const age = Date.parse(builtIso) - Date.parse(last.endedIso);
  if (Number.isNaN(age) || age <= 0 || age > REOPEN_REMINDER_WINDOW_MS) {
    return null;
  }
  const exchange = previousExchange({ heading: "The call the owner just hung up on", previous: last });
  const text = [
    "The owner reopened the call a moment after hanging up, and has said nothing for the first few seconds of this one.",
    "Remind them where you left off, in one short sentence of your own, from the exchange quoted below, the way a",
    "colleague picks a conversation back up ('So, where we were: …'). No greeting, never say a call ended or that",
    "you are back, and add nothing after it but at most a short 'want to carry on?'. If they start talking, stop and",
    "answer them instead.",
    ...exchange,
  ].join("\n");
  return { previousCallId: last.callId, previousEndedIso: last.endedIso, text };
}
