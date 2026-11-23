/*
 * What a channel chip reads on a Slack surface: `#dev`, the way Slack draws `<#C0123|dev>`, never the raw `#C0123` id.
 * Slack names a channel by the name it knows; the card knows two: the name the author WROTE into the message
 * (`<#C0123|dev>`), and the name the recording read gave the draft's own destination. The id stays the chip's hover,
 * so a reader can check which channel it really is. A channel neither names still draws its id, since a guessed name
 * is the one thing a chip must never draw.
 */

import { mrkdwnSpans, readableSpan } from "./slackMrkdwn";

/** The chip's words and its hover. */
export interface ChannelChipLabel {
  /** What the chip reads after its `#`: the channel's name, else its id. */
  readonly text: string;
  /** Always the channel id. */
  readonly title: string;
}

/** The parser's labels for a mention, which a channel read never consults: a person's name plays no part here. */
const NO_PEOPLE = { labelFor: (): undefined => undefined };

/**
 * The channels a message's texts name in writing — `<#C0123|dev>` — by id. A label that only repeats the id names
 * nothing, and the first name written for an id holds, so a later mention cannot rename an earlier chip.
 *
 * @param texts mrkdwn, still wire-escaped, in reading order
 * @returns each written name, by channel id
 */
function writtenNames({ texts }: { texts: readonly string[] }): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const written of texts.flatMap((text) => writtenChannels({ text }))) {
    if (written.name !== written.id && written.name.length > 0 && !names.has(written.id)) {
      names.set(written.id, written.name);
    }
  }
  return names;
}

/**
 * Every channel link in one mrkdwn text, in reading order, as its id and the name written after its `|` — including
 * one inside bold or italic, which the span reader leaves as text and the draft's reader reads again the same way.
 *
 * @param text mrkdwn, still wire-escaped
 * @returns each channel link's id and written label
 */
function writtenChannels({ text }: { text: string }): readonly { readonly id: string; readonly name: string }[] {
  return mrkdwnSpans({ labels: NO_PEOPLE, text }).flatMap((span) => {
    if ((span.kind === "bold" || span.kind === "italic") && span.text.includes("<")) {
      return writtenChannels({ text: span.text });
    }
    const readable = readableSpan({ span });
    if (readable.kind !== "channel") {
      return [];
    }
    // The parser draws a channel label as `#<written>`; the name is what follows that one sigil.
    return [{ id: readable.channelId, name: readable.label.slice(1) }];
  });
}

/**
 * Every channel name a Slack surface can honestly draw, by id: each known destination's name, then each name the
 * message's own words wrote — the author's spelling winning over the recording's, since it is what that message
 * says. A known pair with no name, or an empty one, names nothing.
 *
 * @param known the channels the recording read named, as id and name — the draft's own destination
 * @param texts the mrkdwn the drawn lines were parsed from, still wire-escaped, in reading order
 * @returns each channel's name, by id
 */
export function channelNames({
  known,
  texts,
}: {
  known: readonly { readonly id: string; readonly name: string | undefined }[];
  texts: readonly string[];
}): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const pair of known) {
    if (pair.name !== undefined && pair.name.length > 0) {
      names.set(pair.id, pair.name);
    }
  }
  for (const [id, name] of writtenNames({ texts })) {
    names.set(id, name);
  }
  return names;
}

/**
 * What one channel chip reads: its name when the surface knows one, else the id — and the id as its hover either way.
 *
 * @param channels the names the surface knows, from `channelNames`
 * @returns the chip's words and hover
 */
export function channelChipLabel({
  channelId,
  channels,
}: {
  channelId: string;
  channels: ReadonlyMap<string, string>;
}): ChannelChipLabel {
  const name = channels.get(channelId);
  if (name === undefined) {
    return { text: channelId, title: channelId };
  }
  return { text: name, title: channelId };
}
