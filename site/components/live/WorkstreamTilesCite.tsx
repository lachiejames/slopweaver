/**
 * A workstream's cited sources: the register's Slack channel names, and a citation chip inside a sentence, each Slack
 * chip opening a window into its channel.
 */
import { createContext, type ReactElement, useContext } from "react";

import { citedSource } from "../../lib/citationDisplay";
import { namedSlackPlace, slackArchiveOf } from "../../lib/citationPlaces";
import { CitationChip } from "../console/CitationChip";
import { SlackChannelWindow } from "../console/SlackChannelWindow";

/**
 * The register's Slack channel names by conversation id, so a citation says `#platform-squad` rather than an id
 *. Provided once by {@link Page}; empty only outside it.
 */
export const ChannelNames = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * A citation's words: the Slack conversation by the name the register gives it, else the record's own place.
 *
 * @returns the place
 */
function placeOf({ channels, href }: { channels: ReadonlyMap<string, string>; href: string }): string {
  const named = namedSlackPlace({ channels, href });
  if (named !== undefined) {
    return named;
  }
  return citedSource({ reference: { kind: "address", url: href } }).place;
}

/**
 * What a Slack chip's hover card opens on: a wide window into its channel as it is now, read live when the card opens
 * (what Slack desktop would show, images included, so the owner never leaves localhost) — for a
 * channel link and a message link alike, since both name the channel the owner hovers. Nothing for any other address.
 *
 * @returns the chip's card and detail, spread onto it
 */
function channelWindowOf({
  channels,
  href,
}: {
  channels: ReadonlyMap<string, string>;
  href: string;
}): Pick<Parameters<typeof CitationChip>[0], "card" | "detail"> {
  const archive = slackArchiveOf({ href });
  if (archive === undefined) {
    return {};
  }
  return {
    card: "wide",
    detail: ({ clickFor }) => (
      <SlackChannelWindow
        channel={archive.channel}
        channels={channels}
        clickFor={clickFor}
        workspace={archive.workspace}
      />
    ),
  };
}

/**
 * A cited source inside a sentence: the console's citation chip, its words the record's own place — a Slack
 * message's place named by its channel, its hover card a window into that channel.
 *
 * @returns the chip
 */
export function Cite({ href }: { href: string }): ReactElement {
  const reference = { kind: "address", url: href } as const;
  const channels = useContext(ChannelNames);
  const place = placeOf({ channels, href });
  return (
    <CitationChip reference={reference} look="inline" place={place} {...channelWindowOf({ channels, href })}>
      {place}
    </CitationChip>
  );
}
