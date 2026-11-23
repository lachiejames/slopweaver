"use client";

/*
 * One Slack message drawn as Slack draws it — the face, the name, the APP badge, the clock linking to the message, its
 * rich text, its files, and its reply count. Shared by the two places the console draws a live conversation: a queue
 * card's draft in the conversation it lands in (`./DraftConversation.tsx`) and a channel chip's hover window on the
 * Workstreams page (`./SlackChannelWindow.tsx`). Each passes how its files are told: the card counts them, the window
 * draws them.
 */

import type { ReactElement, ReactNode } from "react";
import { dateTimeFormatOf, readerTimeZone } from "../../lib/dateTimeFormat";
import { consoleHref } from "../../lib/localPageHref";
import { avatarOf, personLabel, type SlackPeople } from "../../lib/slackPeople";
import type { ContextMessage } from "../live/readDraftContext";
import { Line, type RunLabels } from "./DraftLines";
import { Face } from "./SlackDraft";
import { MSG, MSG_BODY } from "./SlackThread";

/** A link, in the console's measured link colour (`VERDICT_INKS.info`) — the same one the draft's own links take. */
export const LINK = "text-info no-underline hover:underline";

/** The quiet line a conversation's own notes are drawn in. */
export const NOTE = "m-0 text-[0.78rem] text-muted-foreground";

/**
 * When a message was sent, the way Slack's hover reads it: the day and the clock, in the reader's own zone.
 *
 * @param iso the instant
 * @returns the label
 */
export function sentAt({ iso }: { iso: string }): string {
  return dateTimeFormatOf({
    locale: "en-US",
    options: { day: "numeric", hour: "numeric", minute: "2-digit", month: "short", timeZone: readerTimeZone() },
  }).format(new Date(iso));
}

/**
 * A plural noun for a count: `1 reply`, `3 replies`.
 *
 * @returns the phrase
 */
export function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The author's name: the member bronze names, else the name an app posted under, else that an app sent it. */
function authorName({ message, people }: { message: SlackMessageRowMessage; people: SlackPeople }): string {
  if (message.userId !== undefined) {
    return personLabel({ id: message.userId, people }).text;
  }
  if (message.username !== undefined) {
    return message.username;
  }
  return "an app";
}

/** A message as both readers give it, before its files are told. */
type SlackMessageRowMessage = Omit<ContextMessage, "fileCount">;

/**
 * One message, drawn as Slack draws it. `anchor` tags the earlier ask a draft repeats, so the card says which message
 * the draft follows up.
 *
 * @param files how this message's files are told, drawn under its text
 * @param hasFiles whether it carries any, so a message with no text but a file is not called empty
 * @returns the message
 */
export function SlackMessageRow({
  message,
  labels,
  files,
  hasFiles,
  anchor = false,
}: {
  message: SlackMessageRowMessage;
  labels: RunLabels;
  files: ReactNode;
  hasFiles: boolean;
  anchor?: boolean;
}): ReactElement {
  const name = authorName({ message, people: labels.people });
  const lines = message.lines.map((line, at) => ({ key: `${message.ts}-${String(at)}`, line }));
  return (
    <div className={MSG} data-kind={anchor ? "asked-before" : "context"}>
      <Face name={name} size="message" url={avatarOf({ id: message.userId, people: labels.people })} />
      <div className={MSG_BODY}>
        <p className="mt-0 mb-[0.1rem] flex items-baseline gap-2 text-[15px] leading-[22px]">
          <b title={message.userId}>{name}</b>
          {message.bot && (
            <span className="rounded-[3px] bg-muted px-[3px] text-[10px] font-bold text-muted-foreground">APP</span>
          )}
          {anchor && (
            <span className="rounded-[3px] border border-solid border-warning px-[3px] text-[10px] font-bold tracking-[0.04em] text-warning uppercase">
              asked before
            </span>
          )}
          <a
            className="text-[12px] text-muted-foreground no-underline hover:underline"
            href={consoleHref({ url: message.permalink })}
            rel="noreferrer"
            target="_blank"
            title={message.tsIso}
          >
            {sentAt({ iso: message.tsIso })}
          </a>
          {message.edited && <span className="text-[12px] text-muted-foreground">(edited)</span>}
        </p>
        <div className="grid text-[15px] leading-[22px] wrap-anywhere whitespace-pre-wrap">
          {lines.map((entry) => (
            <Line key={entry.key} labels={labels} line={entry.line} />
          ))}
        </div>
        {message.lines.length === 0 && !hasFiles && (
          <p className={NOTE}>Slack gave no text for this message; open it in Slack to see it.</p>
        )}
        {files}
        {message.replyCount > 0 && (
          <a
            className={`${LINK} text-[13px] font-bold`}
            href={consoleHref({ url: message.permalink })}
            rel="noreferrer"
            target="_blank"
          >
            {counted({ count: message.replyCount, many: "replies", one: "reply" })}
          </a>
        )}
      </div>
    </div>
  );
}
