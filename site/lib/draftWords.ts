/**
 * The words a parked draft's card draws, as plain text: one function the card's chips and the console voice both
 * read, so what the owner hears of a draft is what they see of it rather than its notification fallback, which a
 * hand-written row may word differently.
 */
import type { DraftMention } from "../components/live/readSlackDrafts";
import type { DraftLine, DraftRun } from "../components/live/readSlackDraftsRuns";
import { groupLabel, mentionLabel, type PersonLabel, type SlackPeople } from "./slackPeople";

/**
 * Who a message's chips name: the roster member bronze read, and the mentions a draft recorded as it resolved them.
 * A message someone else wrote carries no recorded mentions, so its chips are named off the roster alone.
 */
export interface DraftRunLabels {
  readonly people: SlackPeople;
  readonly mentions: readonly DraftMention[];
}

/**
 * What a person's chip reads: the name member bronze holds, else the handle the author wrote, else the id —
 * never an invented name. The id is always the hover, so a reader can check who it really notifies.
 *
 * Residue, stated rather than closed: a key is checked for its kind and target, never against the name Slack
 * resolves, so a hand-written line recording two keys for one member draws the first on every chip of that member.
 * Slack draws one name for one member too; closing it would need the
 * roster this card does not get.
 *
 * @returns the chip's text and its hover
 */
export function draftUserLabel({ labels, userId }: { labels: DraftRunLabels; userId: string }): PersonLabel {
  // A group's key never labels a person.
  const recorded = labels.mentions.find((mention) => mention.kind === "person" && mention.target === userId);
  return mentionLabel({ id: userId, people: labels.people, recordedKey: recorded?.key });
}

/**
 * What a group's chip reads, by {@link groupLabel}: the key the author recorded, else the handle the message's wire
 * text carried, else "a group" — never the `S…` id, which is the hover. A group is never looked up as a person, and
 * no group roster reaches the card, so the key is drawn as recorded — the residue `draftUserLabel` states.
 *
 * @param handle the `@handle` Slack's wire wrote beside the id, when the message was read from mrkdwn text
 * @returns the chip's text and its hover
 */
export function draftGroupLabel({
  labels,
  groupId,
  handle,
}: {
  labels: DraftRunLabels;
  groupId: string;
  handle: string | undefined;
}): PersonLabel {
  const recorded = labels.mentions.find((mention) => mention.kind === "group" && mention.target === groupId);
  return groupLabel({ groupId, handle, recordedKey: recorded?.key });
}

/**
 * The text one run draws on the card, chip prefixes included.
 *
 * @returns what the reader sees of the run
 */
function runWords({ labels, run }: { labels: DraftRunLabels; run: DraftRun }): string {
  switch (run.kind) {
    case "text":
      return run.text;
    case "link":
    case "date":
      return run.label;
    case "user":
      return `@${draftUserLabel({ labels, userId: run.userId }).text}`;
    case "usergroup":
      return `@${draftGroupLabel({ groupId: run.groupId, handle: run.handle, labels }).text}`;
    case "emoji":
      return `:${run.name}:`;
    case "broadcast":
      return `@${run.range}`;
    case "channel":
      return `#${run.channelId}`;
    case "team":
      return run.teamId;
    case "color":
      return run.value;
    default: {
      const unhandled: never = run;
      return unhandled;
    }
  }
}

/**
 * A draft's drawn lines as plain text, one line per line, each list item led by its bullet or number. Two lines a break
 * run already parts (a section ending `\n\n`, a line after a list opening `\n`) join as Slack posts them, with no
 * newline added between, so the text never carries a blank line Slack does not.
 *
 * @returns the words the card draws, in the order it draws them
 */
export function draftLinesWords({ labels, lines }: { labels: DraftRunLabels; lines: readonly DraftLine[] }): string {
  return lines
    .map((line) => {
      const words = line.runs.map((run) => runWords({ labels, run })).join("");
      return line.marker === undefined ? words : `${line.marker} ${words}`;
    })
    .reduce((text, words, at) => {
      if (at === 0 || text.endsWith("\n") || words.startsWith("\n")) {
        return `${text}${words}`;
      }
      return `${text}\n${words}`;
    }, "");
}
