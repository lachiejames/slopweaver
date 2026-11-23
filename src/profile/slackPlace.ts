/**
 * Whether one of the owner's turns is about Slack messages at all — the gate `steerKinds.ts` puts in front of every
 * kind's cue, since a cue without a place is about something else far more often than not.
 */

/**
 * A word placing a turn on Slack messages. The bot is named by role here, or by one of the install's own handles
 * ({@link namesTheBot}); a bare `bot` is some other system's far more often than the owner's.
 */
const SLACK_PLACE =
  /\b(?:slack|drafts?|messages?|replies|reply|posts?|posted|dms?|send|sent|the bot(?![-.][\p{L}\p{N}_]))\b/iu;

/** Anything that cannot sit inside a handle or its possessive, so a word ends there. */
const NOT_IN_A_HANDLE = /[^\p{L}\p{N}_.'’@-]+/u;

/** One word or handle as compared: a mention sigil, the dots, hyphens and apostrophes at its edges and a possessive trimmed. */
function bareHandle({ word }: { word: string }): string {
  return word
    .replace(/^[@.'’-]+/u, "")
    .replace(/[.'’-]+$/u, "")
    .replace(/['’]s$/iu, "")
    .replace(/[.'’-]+$/u, "")
    .toLowerCase();
}

/**
 * Whether one word of the turn is one of the bot's own handles. A word ends at anything a handle cannot hold —
 * whitespace, brackets, a comma, a slash, a dash — and is judged WHOLE, so a handle that carries on past the bot's
 * (`acme-bot-helper`, `acme-bot.prod`) is somebody else's, and so is any other `-bot` the install never declared.
 */
function namesTheBot({ text, botHandles }: { text: string; botHandles: readonly string[] }): boolean {
  const own = new Set(botHandles.map((handle) => bareHandle({ word: handle })).filter((handle) => handle.length > 0));
  return own.size > 0 && text.split(NOT_IN_A_HANDLE).some((word) => own.has(bareHandle({ word })));
}

/**
 * Whether a turn names a place on Slack: a message word, the bot by role, or the bot by one of its own handles.
 *
 * @param text one of the owner's turns, verbatim
 * @param botHandles the bot's own Slack handles, as the install's profile records them (`slackBot.selfHandles`)
 * @returns true when the turn is placed on Slack
 */
export function placesOnSlack({ text, botHandles }: { text: string; botHandles: readonly string[] }): boolean {
  return SLACK_PLACE.test(text) || namesTheBot({ botHandles, text });
}
