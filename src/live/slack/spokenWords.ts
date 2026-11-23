/**
 * One Slack message as the console voice may say it: every word a reader of the thread sees, and its author by
 * name — never an id. Shared by `talk slack-after`, `talk slack-open` and `slack unread`, so the voice hears one
 * message the same way whichever tool fetched it.
 *
 * Two things a bare `text` read gets wrong are handled here: an app card's words live in its blocks (the bot's
 * replies carry an empty `text`), so the words are `text` plus {@link flattenSlackVisibleProse}; and a `<@U…>`
 * mention is named from the local member rows, one they do not hold reading as "someone".
 */
import { flattenSlackVisibleProse, resolveSlackMarkup, type SlackNameMaps } from "../../corpus/slack/visibleProse.js";
import type { VisibleSlackAuthor, VisibleSlackMessage } from "./types.js";

/**
 * Every word a reader of the message sees, mentions named.
 *
 * @param message the projected message
 * @param maps the id → name maps the mentions are named from
 * @returns the words, paragraphs joined by a blank line
 */
export function messageWords({ message, maps }: { message: VisibleSlackMessage; maps: SlackNameMaps }): string {
  const text = resolveSlackMarkup({ maps, text: message.text });
  const prose = flattenSlackVisibleProse({
    dedupeAgainst: [text],
    maps,
    raw: { attachments: message.attachments, blocks: message.blocks },
  });
  return unescapeEntities({ text: [text, ...prose].filter((part) => part.trim().length > 0).join("\n\n") });
}

/** Slack's three escaped characters, as a reader sees them — measured on a live row reading `under &lt; 50s`. */
function unescapeEntities({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * Who wrote a message, in words: a member's name, a bot's own username, else "someone" or "an app".
 *
 * @param author the projected author
 * @param names Slack user id → display name
 * @returns the name to say
 */
export function spokenAuthorName({
  author,
  names,
}: {
  author: VisibleSlackAuthor;
  names: Readonly<Record<string, string>>;
}): string {
  if (author.userId !== undefined) {
    const name = names[author.userId];
    if (name !== undefined) {
      return name;
    }
  }
  if (author.username !== undefined) {
    return author.username;
  }
  if (author.botId !== undefined) {
    return "an app";
  }
  return "someone";
}

/**
 * Words cut to one line a voice reads in a breath: whitespace collapsed, cut at `maxChars` with an ellipsis.
 *
 * @param text the words to cut
 * @param maxChars the most characters kept
 * @returns the one line
 */
export function oneLine({ text, maxChars }: { text: string; maxChars: number }): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  if (flat.length <= maxChars) {
    return flat;
  }
  return `${flat.slice(0, maxChars).trimEnd()} …`;
}
