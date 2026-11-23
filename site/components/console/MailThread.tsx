"use client";

/*
 * The mail thread an email-born ask was born from, drawn the way Gmail draws a conversation and read LIVE when the
 * card opens, so the owner sees the actual email an ask refers to, the way a Slack-born ask shows the thread it
 * replies in (`./SlackThread.tsx`).
 *
 * The read goes through the door (`gmail read <id> --thread`, `../../app/api/mail-thread`) — never a browser and
 * never the corpus, which holds no drafts and no thread reader. The thread Gmail answers already holds the owner's unsent
 * reply as a message labelled DRAFT, so the card draws it UNDER the thread with Gmail's red "Draft", exactly where
 * Gmail's own client would. Layout and folding: `../../lib/mailThreadLayout.ts` (rule 7).
 */

import type { ReactElement } from "react";
import { dateTimeFormatOf, readerTimeZone } from "../../lib/dateTimeFormat";
import { mailThreadLayout, oneLine, senderName } from "../../lib/mailThreadLayout";
import type { MailMessage, MailThread as Thread } from "../live/readMailThread";
import { CitationChip } from "./CitationChip";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import { useMailThread } from "./useMailThread";

/** Gmail's draft red, as the console's own danger verdict colour, which each mode tunes to read on its glass. */
const DRAFT_RED = "text-danger";

/** The quiet line the thread's own notes are drawn in. */
const NOTE = "m-0 text-[0.78rem] text-muted-foreground";

/** How long a folded message's one-line preview runs. */
const ROW_CHARS = 110;

/** When a message was sent, the way Gmail's header reads it, in the reader's own zone: `Mon D, YYYY, h:mm PM`. */
function sentAt({ iso }: { iso: string }): string {
  return dateTimeFormatOf({
    locale: "en-US",
    options: {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: readerTimeZone(),
      year: "numeric",
    },
  }).format(new Date(iso));
}

/** The address that opens this thread in Gmail, in the mailbox the read was made from. */
function threadAddress({ thread }: { thread: Thread }): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(thread.account)}/#all/${thread.threadId}`;
}

/** A plural noun for a count: `1 older message`, `3 older messages`. */
function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The message's date, or that Gmail gave none. */
function When({ message }: { message: MailMessage }): ReactElement {
  if (message.sentAtIso === undefined) {
    return <span className="text-[12px] text-muted-foreground">no date</span>;
  }
  return (
    <span className="shrink-0 text-[12px] text-muted-foreground" title={message.sentAtIso}>
      {sentAt({ iso: message.sentAtIso })}
    </span>
  );
}

/** The sender's name, or that the message named none. */
function From({ message }: { message: MailMessage }): ReactElement {
  const name = senderName({ from: message.from });
  if (name === undefined) {
    return <b className="text-muted-foreground">no sender</b>;
  }
  return <b title={message.from}>{name}</b>;
}

/** A message drawn open: who, to whom, when, and what they wrote — the quoted history one click away. */
function OpenMessage({ message }: { message: MailMessage }): ReactElement {
  const recipients = [...message.to, ...message.cc]
    .map((to) => senderName({ from: to }))
    .filter((to) => to !== undefined);
  return (
    <article
      className="grid gap-[0.3rem] rounded-md border border-solid sw-glass-control px-3 py-2"
      data-kind="mail-open"
    >
      <header className="flex items-baseline justify-between gap-2 text-[14px]">
        <span className="flex min-w-0 items-baseline gap-2">
          {message.draft && <b className={DRAFT_RED}>Draft</b>}
          <From message={message} />
        </span>
        <When message={message} />
      </header>
      {recipients.length > 0 && <p className={NOTE}>to {recipients.join(", ")}</p>}
      <div className="text-[14px] leading-[21px] wrap-anywhere whitespace-pre-wrap">{message.authored}</div>
      {message.quotedCharsDropped > 0 && (
        <details className="text-[0.8rem]">
          <summary
            className="w-fit cursor-pointer rounded bg-muted px-[6px] text-muted-foreground"
            title="Show trimmed content"
          >
            ⋯
          </summary>
          <div className="mt-[0.3rem] text-[13px] leading-[19px] text-muted-foreground wrap-anywhere whitespace-pre-wrap">
            {message.body}
          </div>
        </details>
      )}
      {message.attachmentCount > 0 && (
        <p className={NOTE}>
          {counted({ count: message.attachmentCount, many: "attachments", one: "attachment" })}, not fetched. Open it in
          Gmail to see {message.attachmentCount === 1 ? "it" : "them"}.
        </p>
      )}
    </article>
  );
}

/** A message drawn as Gmail's collapsed row — sender, one line, date — that opens in place. */
function RowMessage({ message }: { message: MailMessage }): ReactElement {
  return (
    <details className="rounded-md border border-border px-3 py-[0.35rem]" data-kind="mail-row">
      <summary className="flex cursor-pointer items-baseline gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
        <span className="shrink-0">
          <From message={message} />
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {oneLine({ limit: ROW_CHARS, text: message.authored })}
        </span>
        <When message={message} />
      </summary>
      <div className="mt-[0.3rem] text-[14px] leading-[21px] wrap-anywhere whitespace-pre-wrap">{message.authored}</div>
    </details>
  );
}

/** The thread, read: its subject, where it opens, the history folded, the message the owner is answering, their draft. */
function Conversation({ thread, staleWhy }: { thread: Thread; staleWhy: string | undefined }): ReactElement {
  const { opener, folded, recent, open, drafts } = mailThreadLayout({ messages: thread.messages });
  const subject = thread.messages.find((message) => message.subject !== undefined)?.subject;
  return (
    <section aria-label="the mail thread it was asked from, read live" className="grid gap-[0.4rem]">
      <p className={`${NOTE} flex flex-wrap items-baseline gap-x-2`}>
        <span>The mail thread it was asked from, read live at {sentAt({ iso: thread.readAtIso })}</span>
        {staleWhy !== undefined && (
          <StaleMark
            facts={[{ observedAtIso: thread.readAtIso, subject: "The mail thread it was asked from", why: staleWhy }]}
          />
        )}
        <CitationChip reference={{ kind: "address", url: threadAddress({ thread }) }} look="inline">
          open in Gmail
        </CitationChip>
      </p>
      {subject !== undefined && <h4 className="m-0 text-[15px] font-normal">{subject}</h4>}
      {opener !== undefined && <RowMessage message={opener} />}
      {folded.length > 0 && (
        <details className="text-[0.8rem]">
          <summary className="cursor-pointer text-muted-foreground">
            {counted({ count: folded.length, many: "older messages", one: "older message" })}
          </summary>
          <div className="mt-[0.4rem] grid gap-[0.4rem]">
            {folded.map((message) => (
              <RowMessage key={message.id} message={message} />
            ))}
          </div>
        </details>
      )}
      {recent.map((message) => (
        <RowMessage key={message.id} message={message} />
      ))}
      {open !== undefined && <OpenMessage message={open} />}
      {drafts.map((message) => (
        <OpenMessage key={message.id} message={message} />
      ))}
      {drafts.length === 0 && <p className={NOTE}>No draft reply on this thread in Gmail yet.</p>}
    </section>
  );
}

/**
 * The mail thread an email-born ask names, read live, with the owner's Gmail draft under it.
 *
 * @param id the Gmail thread id, or the id of a message in it
 * @returns the thread, or the reading's state while it is not one
 */
export function MailThread({ id }: { id: string }): ReactElement {
  const state = useMailThread({ id });
  if (state.phase === "ready") {
    return <Conversation thread={state.thread} staleWhy={state.stale?.why} />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "The mail thread it was asked from", why: state.why }]} block />;
  }
  return <ReadingIndicator label="Reading the mail thread it was asked from, live from Gmail" block />;
}
