/**
 * The reader for `slopweaver slack channel-view <channel> --json` — a channel as it is now, read live off Slack when
 * the owner hovers its chip on the Workstreams page (what Slack desktop would show, images
 * included, so the owner never leaves localhost).
 *
 * Strict exactly as `./readDraftContext.ts` is, and over the same message envelope: a channel, a name, an instant, a
 * link, and every message's ts, time and author, or the whole reading is NOT MEASURED rather than a channel drawn with
 * a message missing. Every FILE is strict too — a picture names the hash the console serves it under, a card names
 * why it is a card — because a file the window silently dropped is the one the owner would have gone to Slack to see.
 */

import { type Bag, bags, bool, isBag, str } from "../../lib/bag";
import type { SlackPeople } from "../../lib/slackPeople";
import { botFlagsOf, type ContextMessage, messageEnvelopeOf } from "./readDraftContext";
import { peopleOf } from "./readSlackDraftsPeople";

/** Why a file is a card rather than a picture — the verb's own closed set. */
const UNSHOWN_REASONS = [
  "not-a-picture",
  "deleted",
  "external",
  "no-access",
  "no-preview",
  "past-the-limit",
  "fetch-failed",
  "lookup-failed",
] as const;

/** Why a file is a card rather than a picture. */
export type UnshownReason = (typeof UNSHOWN_REASONS)[number];

/** One file a message carries, as the window draws it. */
export type ChannelFile =
  | { readonly shown: "picture"; readonly id: string; readonly name: string | undefined; readonly sha256: string }
  | {
      readonly shown: "card";
      readonly id: string;
      readonly name: string | undefined;
      readonly mimetype: string | undefined;
      readonly reason: UnshownReason;
      readonly detail: string | undefined;
    };

/** One emoji under a message, and how many reacted with it. */
export interface ChannelReaction {
  readonly name: string;
  readonly count: number;
}

/** One message of the channel, as the window draws it. */
export type ChannelMessage = Omit<ContextMessage, "fileCount"> & {
  readonly files: readonly ChannelFile[];
  readonly reactions: readonly ChannelReaction[];
};

/** A channel as it stood when the window read it. */
export interface SlackChannelView {
  readonly channel: string;
  /** The channel's own name, no `#`. */
  readonly name: string;
  readonly observedAtIso: string;
  /** The channel itself in Slack. */
  readonly link: string;
  /** Whether the channel holds older messages than the page shows. */
  readonly earlierWithheld: boolean;
  /** Oldest first. */
  readonly messages: readonly ChannelMessage[];
  readonly people: SlackPeople;
  /** Whose token read it: the owner's own, or the bot's, which sees only what it was invited to. */
  readonly readAs: "user" | "bot";
}

/** A blob's name: its lowercase-hex SHA-256, the only address the media route answers. */
const SHA256 = /^[0-9a-f]{64}$/;

/** Whether a value is one of the verb's reasons. */
function isReason(value: unknown): value is UnshownReason {
  return UNSHOWN_REASONS.some((reason) => reason === value);
}

/** One file off a message, or `undefined` when it will not read. */
function fileOf({ row }: { row: Bag }): ChannelFile | undefined {
  const id = str({ bag: row, key: "id" });
  if (id === undefined) {
    return undefined;
  }
  const name = str({ bag: row, key: "name" });
  if (row["shown"] === "picture") {
    const sha256 = str({ bag: row, key: "sha256" });
    if (sha256 === undefined || !SHA256.test(sha256)) {
      return undefined;
    }
    return { id, name, sha256, shown: "picture" };
  }
  const reason = row["reason"];
  if (row["shown"] !== "card" || !isReason(reason)) {
    return undefined;
  }
  return {
    detail: str({ bag: row, key: "detail" }),
    id,
    mimetype: str({ bag: row, key: "mimetype" }),
    name,
    reason,
    shown: "card",
  };
}

/** One reaction off a message, or `undefined` when it will not read. */
function reactionOf({ row }: { row: Bag }): ChannelReaction | undefined {
  const name = str({ bag: row, key: "name" });
  const count = row["count"];
  if (name === undefined || typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    return undefined;
  }
  return { count, name };
}

/** One message off the document, or `undefined` when its envelope, any of its files or any reaction will not read. */
function messageOf({
  row,
  botFlags,
}: {
  row: Bag;
  botFlags: ReadonlyMap<string, boolean>;
}): ChannelMessage | undefined {
  const envelope = messageEnvelopeOf({ botFlags, row });
  const rows = bags({ bag: row, key: "files" });
  const reactionRows = bags({ bag: row, key: "reactions" });
  if (envelope === undefined || rows === undefined || reactionRows === undefined) {
    return undefined;
  }
  const files: ChannelFile[] = [];
  for (const fileRow of rows) {
    const file = fileOf({ row: fileRow });
    if (file === undefined) {
      return undefined;
    }
    files.push(file);
  }
  const reactions: ChannelReaction[] = [];
  for (const reactionRow of reactionRows) {
    const reaction = reactionOf({ row: reactionRow });
    if (reaction === undefined) {
      return undefined;
    }
    reactions.push(reaction);
  }
  return { ...envelope, files, reactions };
}

/**
 * Read a `slack channel-view --json` payload.
 *
 * @param payload the parsed stdout
 * @returns the channel, or `undefined` when the payload is not one the window can draw truthfully
 */
export function readSlackChannel(payload: unknown): SlackChannelView | undefined {
  if (!isBag(payload) || payload["kind"] !== "slopweaver.slack.channel-view" || payload["schemaVersion"] !== 1) {
    return undefined;
  }
  const channel = str({ bag: payload, key: "channel" });
  const name = str({ bag: payload, key: "name" });
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const link = str({ bag: payload, key: "link" });
  const earlierWithheld = bool({ bag: payload, key: "earlierWithheld" });
  const rows = bags({ bag: payload, key: "messages" });
  const people = peopleOf({ payload });
  const botFlags = botFlagsOf({ payload });
  const readAs = payload["readAs"];
  if (readAs !== "user" && readAs !== "bot") {
    return undefined;
  }
  if (
    channel === undefined ||
    name === undefined ||
    observedAtIso === undefined ||
    link === undefined ||
    earlierWithheld === undefined ||
    rows === undefined ||
    people === undefined ||
    botFlags === undefined
  ) {
    return undefined;
  }
  const messages: ChannelMessage[] = [];
  for (const row of rows) {
    const message = messageOf({ botFlags, row });
    if (message === undefined) {
      return undefined;
    }
    messages.push(message);
  }
  return { channel, earlierWithheld, link, messages, name, observedAtIso, people, readAs };
}
