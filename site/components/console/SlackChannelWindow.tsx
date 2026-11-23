"use client";

/*
 * A window into one Slack channel as it is now, drawn inside a channel chip's hover card on the Workstreams page.
 *
 * Hovering a Slack channel on a workstream timeline
 * opens a scrollable window into that channel as it is now, what Slack desktop would show, images included, so the
 * owner never leaves localhost. So the read is live, through the door (`slack channel-view`, `../../app/api/slack-channel`),
 * nothing is read until the card opens, and the window opens scrolled to the newest message, the way Slack does.
 *
 * Each picture is Slack's own preview of it, kept by its hash and served by `/api/slack-channel-media/<sha256>`; a
 * click opens it full size in the chip's modal, which outlives the card closing under it. Every other file is a card
 * saying why it is not drawn, so a gap never reads as "nothing attached". Reactions sit under it, as in Slack.
 */

import { type ReactElement, useState } from "react";
import { consoleHref } from "../../lib/localPageHref";
import type { ChannelFile, ChannelMessage, SlackChannelView, UnshownReason } from "../live/readSlackChannel";
import type { CardPreviewClick } from "./CitationChip";
import type { RunLabels } from "./DraftLines";
import { ReadingIndicator } from "./ReadingIndicator";
import { LINK, NOTE, SlackMessageRow, sentAt } from "./SlackMessageRow";
import { StaleMark } from "./StaleMark";
import { useSlackChannel } from "./useSlackChannel";

/** The rounded, hairline-bordered frame Slack draws round an inline picture or a file. */
const FRAME = "rounded-[8px] border border-border";

/** What a file card says about why it is not drawn as a picture. */
const UNSHOWN_WORDS: Readonly<Record<UnshownReason, string>> = {
  deleted: "deleted in Slack",
  external: "lives outside Slack",
  "fetch-failed": "Slack's preview did not arrive",
  "lookup-failed": "Slack would not say what this file is",
  "no-access": "this token cannot see it",
  "no-preview": "Slack made no preview of it",
  "not-a-picture": "not a picture",
  "past-the-limit": "past the pictures one read fetches",
};

/** One kept preview's address on the console. */
function pictureSrc({ sha256 }: { sha256: string }): string {
  return `/api/slack-channel-media/${sha256}`;
}

/** What a file is called on the window: its name, or its id when Slack gave none. */
function fileLabel({ file }: { file: ChannelFile }): string {
  if (file.name === undefined) {
    return file.id;
  }
  return file.name;
}

/** A file drawn as the card Slack draws for one it shows no picture of: its name, and why. */
function FileCard({ file, undrawn }: { file: ChannelFile; undrawn: boolean }): ReactElement {
  let why = "this browser could not draw the preview";
  if (file.shown === "card") {
    why = UNSHOWN_WORDS[file.reason];
  }
  const detail = file.shown === "card" ? file.detail : undefined;
  return (
    <p className={`${FRAME} m-0 grid w-[min(100%,310px)] px-3 py-2`} title={detail}>
      <b className="truncate text-[0.9rem]">{fileLabel({ file })}</b>
      <span className={`text-[0.78rem] ${undrawn ? "text-warning" : "text-muted-foreground"}`}>{why}</span>
    </p>
  );
}

/** A picture as Slack draws it inline, opening full size in the chip's modal; one the browser refuses is its card. */
function Picture({
  file,
  clickFor,
}: {
  file: Extract<ChannelFile, { shown: "picture" }>;
  clickFor: CardPreviewClick;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <FileCard file={file} undrawn />;
  }
  const src = pictureSrc({ sha256: file.sha256 });
  const name = fileLabel({ file });
  return (
    <a
      className="block max-w-full cursor-zoom-in"
      href={src}
      onClick={clickFor({ preview: { kind: "image", src, title: name } })}
      rel="noreferrer"
      target="_blank"
      title={`open ${name} full size`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served locally from the channel-media store; nothing to optimise */}
      <img
        alt={name}
        className={`${FRAME} block max-h-[240px] max-w-full object-contain`}
        loading="lazy"
        onError={() => {
          setFailed(true);
        }}
        src={src}
      />
    </a>
  );
}

/** Every file a message carries, pictures and cards alike, in the order Slack gave them. */
function Files({ message, clickFor }: { message: ChannelMessage; clickFor: CardPreviewClick }): ReactElement | null {
  if (message.files.length === 0) {
    return null;
  }
  return (
    <div className="mt-1 grid max-w-[480px] justify-items-start gap-2" aria-label="attached under the message">
      {message.files.map((file, at) => {
        const key = `${String(at)}-${file.id}`;
        if (file.shown === "picture") {
          return <Picture key={key} clickFor={clickFor} file={file} />;
        }
        return <FileCard key={key} file={file} undrawn={false} />;
      })}
    </div>
  );
}

/** The reaction row Slack draws under a message: each emoji, as the console names one, and how many reacted. */
function Reactions({ message }: { message: ChannelMessage }): ReactElement | null {
  if (message.reactions.length === 0) {
    return null;
  }
  return (
    <ul className="m-0 mt-1 flex list-none flex-wrap gap-1 p-0" aria-label="reactions">
      {message.reactions.map((reaction) => (
        <li
          key={reaction.name}
          className="rounded-full border border-border px-2 text-[0.78rem] text-muted-foreground"
          title={`${String(reaction.count)} reacted with :${reaction.name}:`}
        >
          :{reaction.name}: <b className="text-foreground">{reaction.count}</b>
        </li>
      ))}
    </ul>
  );
}

/** The channel, read: where it is, when it was read, and its messages oldest first, scrolled to the newest. */
function Channel({
  view,
  channels,
  clickFor,
}: {
  view: SlackChannelView;
  channels: ReadonlyMap<string, string>;
  clickFor: CardPreviewClick;
}): ReactElement {
  const labels: RunLabels = { channels, mentions: [], people: view.people };
  return (
    <section aria-label={`#${view.name}, read live`} className="grid gap-[0.4rem]">
      <p className={`${NOTE} flex flex-wrap items-baseline gap-x-2`}>
        <span>
          <b className="text-foreground">#{view.name}</b>, read live at {sentAt({ iso: view.observedAtIso })}
        </span>
        <a className={LINK} href={consoleHref({ url: view.link })} rel="noreferrer" target="_blank">
          open in Slack →
        </a>
      </p>
      {view.readAs === "bot" && (
        <p className={`${NOTE} text-warning`}>
          Read as the bot, because no user token is set. It sees only what it was invited to, so this may not be the
          channel as you see it.
        </p>
      )}
      {/* Reversed, so the window opens scrolled to its newest message and scrolls back through the older ones. */}
      <div data-channel-window="" className="flex max-h-[min(28rem,60vh)] flex-col-reverse overflow-y-auto pr-1">
        <div className="grid gap-[0.6rem]">
          {view.earlierWithheld && <p className={NOTE}>Older messages than these are in Slack.</p>}
          {view.messages.length === 0 && <p className={NOTE}>Nothing has been said here yet.</p>}
          {view.messages.map((message) => (
            <SlackMessageRow
              key={message.ts}
              files={
                <>
                  <Files clickFor={clickFor} message={message} />
                  <Reactions message={message} />
                </>
              }
              hasFiles={message.files.length > 0}
              labels={labels}
              message={message}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One channel as it is now, read when the hover card opens.
 *
 * @param channel the conversation id off the chip's link
 * @param workspace the lowercase workspace host off the same link, so the read refuses another workspace's channel
 * @param channels the words each conversation is known by, so a channel the messages mention reads by name
 * @param clickFor the chip's own preview click, so a picture opens full size over the page
 * @returns the window
 */
export function SlackChannelWindow({
  channel,
  workspace,
  channels,
  clickFor,
}: {
  channel: string;
  workspace: string;
  channels: ReadonlyMap<string, string>;
  clickFor: CardPreviewClick;
}): ReactElement {
  const state = useSlackChannel({ channel, workspace });
  if (state.phase === "loading") {
    return <ReadingIndicator label="Reading the channel live from Slack" block />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "this channel, live", why: state.why }]} block />;
  }
  return <Channel channels={channels} clickFor={clickFor} view={state.view} />;
}
