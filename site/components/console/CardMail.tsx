"use client";

/*
 * The mail an inbox-triage card asks about, drawn inside the card: a steer given without seeing the message it is
 * about risks being wrong or misaligned.
 *
 * One closed row per pinned message under the problem line, the way a Slack preview folds there: sender, date and
 * subject on the row, and the body as the sender laid it out once the owner opens it. Everything is read from the copy
 * stored beside the card's pin (`gmail card-mail`, `../../app/api/card-mail`), never Gmail live.
 *
 * An HTML body is a whole document the verb already sanitised — no script, no form, no link target, remote images
 * drawn without their source, and its own CSP allowing nothing but inline style and `data:` images. It is drawn in
 * an iframe with an EMPTY `sandbox`, so even a document the sanitiser missed something in runs no script, submits no
 * form, navigates nothing and shares no origin with this page. The iframe is only MOUNTED while its row is open: a
 * closed `<details>` still lays out its children, and a card of twenty mails must not parse twenty documents unseen.
 */

import { type ReactElement, useState } from "react";
import { readerTimeZone } from "../../lib/dateTimeFormat";
import { receivedAt, senderName, shownOr } from "../../lib/mailThreadLayout";
import type { CardMailBody, CardMailHeader } from "../live/readCardMail";
import { MailField } from "./QueueCardBody";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import { useCardMailBody, useCardMailIndex } from "./useCardMail";

/** The quiet line the card's own notes are drawn in. */
const NOTE = "m-0 text-[0.78rem] text-muted-foreground";

/** A fixed height for a drawn mail, which scrolls inside itself, so one long newsletter cannot stretch the card. */
const MAIL_FRAME = "block h-[28rem] w-full rounded border border-border bg-white";

/** The reader's own zone, which a received date is drawn in. */
const READER_ZONE = readerTimeZone();

/** A plural noun for a count. */
function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The notes under a drawn body: what was cut, and what was not fetched. */
function BodyNotes({ body }: { body: CardMailBody }): ReactElement | null {
  const notes: string[] = [];
  if (body.kind === "html" && body.remoteImagesBlocked > 0) {
    notes.push(
      `${counted({ count: body.remoteImagesBlocked, many: "remote images", one: "remote image" })} not loaded: ` +
        "drawn as dashed boxes, so opening this tells the sender nothing.",
    );
  }
  if (body.truncated && body.kind !== "none") {
    notes.push("Cut at the stored size. Open it in Gmail for the rest.");
  }
  if (notes.length === 0) {
    return null;
  }
  return <p className={NOTE}>{notes.join(" ")}</p>;
}

/** One message's body, read when its row opened. */
function OpenBody({ slug, id, subject }: { slug: string; id: string; subject: string | undefined }): ReactElement {
  const state = useCardMailBody({ id, slug });
  if (state.phase === "loading") {
    return <ReadingIndicator label="Reading the stored mail" block />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "The stored mail", why: state.why }]} block />;
  }
  const body = state.value;
  let drawn: ReactElement;
  if (body.kind === "html") {
    drawn = (
      <iframe
        className={MAIL_FRAME}
        data-kind="card-mail-frame"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={body.document}
        title={subject === undefined ? "the mail, as its sender laid it out" : `the mail: ${subject}`}
      />
    );
  } else if (body.kind === "text") {
    drawn = <div className="text-[14px] leading-[21px] wrap-anywhere whitespace-pre-wrap">{body.text}</div>;
  } else {
    const why = body.truncated ? "too large to store" : "none Gmail returned";
    drawn = <p className={NOTE}>No body to draw: {why}. Open it in Gmail.</p>;
  }
  return (
    <div className="grid gap-[0.3rem]">
      {drawn}
      <BodyNotes body={body} />
    </div>
  );
}

/** One pinned message as a row that folds: who, when and what about, and the body once the owner opens it. */
function MailRow({ slug, mail }: { slug: string; mail: CardMailHeader & { kind: "message" } }): ReactElement {
  const [open, setOpen] = useState(false);
  const name = senderName({ from: mail.from });
  const recipients = [...mail.to, ...mail.cc].map((to) => senderName({ from: to })).filter((to) => to !== undefined);
  return (
    <details
      className="rounded-md border border-border px-3 py-[0.35rem]"
      data-kind="card-mail-row"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="flex cursor-pointer items-baseline gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
        <b className="shrink-0" title={mail.from}>
          {shownOr({ value: name, whenAbsent: "no sender" })}
        </b>
        <span className="min-w-0 flex-1 truncate">{shownOr({ value: mail.subject, whenAbsent: "(no subject)" })}</span>
        <span className="shrink-0 text-[12px] text-muted-foreground" title={mail.receivedAtIso}>
          {mail.receivedAtIso === undefined
            ? "no date"
            : receivedAt({ iso: mail.receivedAtIso, timeZone: READER_ZONE })}
        </span>
      </summary>
      {open && (
        <div className="mt-[0.4rem] grid gap-[0.3rem]">
          {recipients.length > 0 && <p className={NOTE}>to {recipients.join(", ")}</p>}
          <OpenBody id={mail.id} slug={slug} subject={mail.subject} />
        </div>
      )}
    </details>
  );
}

/**
 * The mail an inbox-triage card pinned, one folded row per message, read from the copy stored beside its pin.
 *
 * @param slug the card's board slug
 * @returns the card's `mail` row: the messages, or the reading's state while it is not one; nothing at all, label
 *   included, for a row that pinned no mail — a finding
 *   whose slug happens to start `inbox-triage-` has none to show, and drawing that as a failed read would be a
 *   defect
 */
export function CardMail({ slug }: { slug: string }): ReactElement | null {
  const state = useCardMailIndex({ slug });
  if (state.phase === "loading") {
    return (
      <MailField>
        <ReadingIndicator label="Reading the mail this card is about" block />
      </MailField>
    );
  }
  if (state.phase === "not-measured") {
    return (
      <MailField>
        <StaleMark facts={[{ subject: "The mail this card is about", why: state.why }]} block />
      </MailField>
    );
  }
  if (state.value.kind === "unpinned") {
    return null;
  }
  const { mails, omittedCount, pinnedCount } = state.value.index;
  return (
    <MailField>
      <section aria-label="the mail this card is about" className="grid gap-[0.4rem]" data-kind="card-mail">
        {mails.map((mail) =>
          mail.kind === "gone" ? (
            <p className={NOTE} key={mail.id}>
              One pinned message was no longer in Gmail when the card stored its mail.
            </p>
          ) : (
            <MailRow key={mail.id} mail={mail} slug={slug} />
          ),
        )}
        {omittedCount > 0 && (
          <p className={NOTE}>
            Showing {String(mails.length)} of {String(pinnedCount)} pinned messages: this card was pinned before cards
            kept only what they show.
          </p>
        )}
      </section>
    </MailField>
  );
}
