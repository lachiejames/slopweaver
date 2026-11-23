/**
 * Why `witness help` refused or failed — its own failure domain beside the journal, dispatch and settle unions
 * in `./errors.ts`, per `.claude/rules/error-handling.md`. Every refusal lands before any Slack WRITE; the two
 * faults after `helped` is journalled (`CAPTURE_DROPPED`) are never retried.
 */
import type { WitnessJournalError } from "./errors.js";
import type { WitnessKey, WitnessOutcome } from "./types.js";

/** Why `witness help` refused or failed — every refusal before any Slack call, the last two after none. */
export type WitnessHelpError =
  | { readonly code: "NOT_OWN_THREAD"; readonly message: string }
  | { readonly code: "NO_RESPONDER_TAG"; readonly message: string }
  | { readonly code: "NOT_IN_THREAD"; readonly message: string }
  | { readonly code: "AUTHOR_MISMATCH"; readonly message: string; readonly actual: string | undefined }
  | { readonly code: "ADDRESSED_TO_BOT"; readonly message: string }
  | { readonly code: "THREAD_UNREADABLE"; readonly message: string }
  | { readonly code: "RESPONDER_REFUSED"; readonly message: string; readonly userId: string }
  | { readonly code: "IGNORED"; readonly message: string; readonly registry: "ask" | "conversation" }
  | { readonly code: "HIGH_STAKES_REFUSED"; readonly message: string }
  | { readonly code: "ALREADY_AN_ASK"; readonly message: string }
  | { readonly code: "THREAD_ASK_ACTIVE"; readonly message: string; readonly activeMessageTs: string }
  | { readonly code: "HELP_BUDGET_SPENT"; readonly message: string; readonly day: string }
  | { readonly code: "THREAD_STOOD_DOWN"; readonly message: string; readonly stoodDownAt: string }
  | { readonly code: "ALREADY_SETTLED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "ALREADY_DISPATCHED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "HELP_LOCKED"; readonly message: string }
  | { readonly code: "JOURNAL"; readonly message: string; readonly cause: WitnessJournalError }
  | { readonly code: "STATE"; readonly message: string }
  | { readonly code: "CAPTURE_DROPPED"; readonly message: string; readonly witnessId: string };

/** Who Slack says wrote a message, for a refusal: its user id, or a plain phrase when there is none. */
function authorPhrase({ actual }: { actual: string | undefined }): string {
  if (actual === undefined) {
    return "a bot or nobody";
  }
  return actual;
}

/** Factories for {@link WitnessHelpError}. */
export const WitnessHelpErrors = {
  addressedToBot: ({ key }: { key: WitnessKey }) =>
    ({
      code: "ADDRESSED_TO_BOT",
      message:
        `${key.channel}/${key.messageTs} tags this bot itself — that is a real tag, answered by the listener's address ` +
        "path, never helped unprompted",
    }) as const satisfies WitnessHelpError,
  authorMismatch: ({ actual, claimed, key }: { actual: string | undefined; claimed: string; key: WitnessKey }) =>
    ({
      actual,
      code: "AUTHOR_MISMATCH",
      message:
        `Slack says ${key.channel}/${key.messageTs} was written by ${authorPhrase({ actual })}, ` +
        `not --user ${claimed} — the asker is read off the thread, never taken on the caller's word`,
    }) as const satisfies WitnessHelpError,
  noResponderTag: ({ key }: { key: WitnessKey }) =>
    ({
      code: "NO_RESPONDER_TAG",
      message:
        `no message before ${key.messageTs} in thread ${key.channel}/${key.threadTs} is a responder PERSON tagging this ` +
        "bot — a bot's tag, or a tag the whitelist refused, never asks the bot into a thread",
    }) as const satisfies WitnessHelpError,
  notInThread: ({ key }: { key: WitnessKey }) =>
    ({
      code: "NOT_IN_THREAD",
      message:
        `${key.channel}/${key.messageTs} is not a reply in thread ${key.threadTs} — Slack's own read of the thread ` +
        "does not hold it, so there is no own thread to help in",
    }) as const satisfies WitnessHelpError,
  threadUnreadable: ({ why }: { why: string }) =>
    ({
      code: "THREAD_UNREADABLE",
      message: `the thread could not be read from Slack, so nothing proves it is the bot's own — nothing was posted: ${why}`,
    }) as const satisfies WitnessHelpError,
  alreadyAnAsk: ({ key }: { key: WitnessKey }) =>
    ({
      code: "ALREADY_AN_ASK",
      message:
        `${key.channel}/${key.messageTs} is already an ask — it was tagged or captured, so it is answered on that ` +
        "path and a second card would duplicate it",
    }) as const satisfies WitnessHelpError,
  alreadyDispatched: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "ALREADY_DISPATCHED",
      message: `witness ${witnessId} already has a worker checking its claim — a help would answer the same message twice`,
      witnessId,
    }) as const satisfies WitnessHelpError,
  alreadySettled: ({ outcome, witnessId }: { outcome: WitnessOutcome; witnessId: string }) =>
    ({
      code: "ALREADY_SETTLED",
      message: `witness ${witnessId} is already settled (${outcome}) — a message is helped at most once`,
      witnessId,
    }) as const satisfies WitnessHelpError,
  budgetSpent: ({ cap, day, key }: { cap: number; day: string; key: WitnessKey }) =>
    ({
      code: "HELP_BUDGET_SPENT",
      day,
      message:
        `thread ${key.channel}/${key.threadTs} already had ${String(cap)} unprompted helps on ${day} (UTC) — past ` +
        "that the bot waits to be tagged there, so a busy thread never becomes the bot replying to everything",
    }) as const satisfies WitnessHelpError,
  captureDropped: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "CAPTURE_DROPPED",
      message:
        `witness ${witnessId} is journalled helped, but the capture chain dropped the message before it became an ` +
        "ask — no card went up; it is NOT retried, because the helped row is what stops a second card",
      witnessId,
    }) as const satisfies WitnessHelpError,
  highStakesRefused: ({ lines }: { lines: readonly string[] }) =>
    ({ code: "HIGH_STAKES_REFUSED", message: lines.join("\n") }) as const satisfies WitnessHelpError,
  ignored: ({ key, registry }: { key: WitnessKey; registry: "ask" | "conversation" }) =>
    ({
      code: "IGNORED",
      message:
        registry === "ask"
          ? `${key.channel}/${key.messageTs} is on the permanent ask-ignore registry`
          : `${key.channel} is a permanently ignored conversation`,
      registry,
    }) as const satisfies WitnessHelpError,
  journal: ({ cause }: { cause: WitnessJournalError }) =>
    ({ cause, code: "JOURNAL", message: cause.message }) as const satisfies WitnessHelpError,
  locked: ({ reason }: { reason: string }) =>
    ({
      code: "HELP_LOCKED",
      message: `a witness dispatch, settle or help is in progress on this home, so nothing was recorded or posted — run it again once that finishes: ${reason}`,
    }) as const satisfies WitnessHelpError,
  notOwnThread: ({ key }: { key: WitnessKey }) =>
    ({
      code: "NOT_OWN_THREAD",
      message:
        `thread ${key.channel}/${key.threadTs} is not one a person tagged this bot in within the witness window — ` +
        "unprompted help is only for a thread the bot was already asked into",
    }) as const satisfies WitnessHelpError,
  responderRefused: ({ userId, why }: { userId: string; why: string }) =>
    ({
      code: "RESPONDER_REFUSED",
      message: `${userId} is not admitted as a responder, so the bot does not answer them unprompted either: ${why}`,
      userId,
    }) as const satisfies WitnessHelpError,
  state: ({ why }: { why: string }) =>
    ({
      code: "STATE",
      message: `the witnessed-thread snapshot could not be read, so whether this is the bot's own thread is unknown: ${why}`,
    }) as const satisfies WitnessHelpError,
  threadStoodDown: ({ key, stoodDownAt }: { key: WitnessKey; stoodDownAt: string }) =>
    ({
      code: "THREAD_STOOD_DOWN",
      message:
        `the bot stood down in thread ${key.channel}/${key.threadTs} at ${stoodDownAt}, when somebody said it ` +
        "was in the way — it is witnessed no further and helps nobody unprompted; an explicit tag is still answered",
      stoodDownAt,
    }) as const satisfies WitnessHelpError,
  threadAskActive: ({ activeMessageTs, key }: { activeMessageTs: string; key: WitnessKey }) =>
    ({
      activeMessageTs,
      code: "THREAD_ASK_ACTIVE",
      message:
        `thread ${key.channel}/${key.threadTs} already has a live ask (${activeMessageTs}) — its worker answers there, ` +
        "and a second card would race it",
    }) as const satisfies WitnessHelpError,
} as const;
