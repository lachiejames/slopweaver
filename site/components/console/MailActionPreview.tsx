"use client";

import type { ReactElement } from "react";

import { actLineFor } from "../../lib/actVerbs";
import { mailBodyFold } from "../../lib/mailPreview";
import type { BoardRowMail } from "../live/readAction";
import { BUTTON } from "./controls";
import { Outcome, usePress } from "./press";
import { PREVIEW, PREVIEW_HEAD } from "./SlackActionPreview";

/** A line of small print under the mail — how much is folded, and where the whole of it reads. */
const MAIL_NOTE = "m-0 text-[0.75rem] text-muted-foreground";

/** The act row that composes the draft and stores nothing — pressed first, always. */
const DRY_RUN_SLUG = "gmail-draft-board-dry-run";

/** The act row that stores the draft in the owner's own mailbox — enabled only by a clean dry run. */
const CREATE_SLUG = "gmail-draft-board";

/** The lines of the body a CARD shows before it points at the whole mail's own page. */
const CARD_BODY_LINES = 8;

/**
 * One header line of the mail, drawn the way a mail client draws it.
 *
 * @returns the line, or nothing for an empty Cc/Bcc — a client draws no empty header either
 */
function HeaderLine({ label, value }: { label: string; value: readonly string[] | string }): ReactElement | null {
  const text = typeof value === "string" ? value : value.join(", ");
  if (text === "") {
    return null;
  }
  return (
    <p className="m-0 text-[0.8rem] text-foreground">
      <span className="inline-block min-w-[2.6rem] text-muted-foreground">{label}</span> {text}
    </p>
  );
}

/**
 * The mail an ask offers, drawn as a mail client would draw it, with the two presses that turn it into a
 * Gmail DRAFT in the owner's own mailbox.
 *
 * It is a mail-native draft preview on the queue, whose Gmail draft is created
 * only when the owner presses. So:
 *
 * **It composes nothing** (`AGENTS.md` rule 2). Every header and every line of the body is a field the
 * verb recorded; the body is rendered as TEXT, never markup.
 *
 * **It sends nothing.** The first press runs `gmail draft --board … --dry-run` and shows what the verb
 * composed or why it refused; only a clean dry run enables the second press, which stores a draft. Sending
 * stays `gmail send`'s own act with its own approval digest — `site/lib/actVerbs.ts` says why.
 *
 * **A card folds; the page does not.** A card draws the headers and the first lines, then the address of
 * the page that draws the whole mail — rule 7's progressive disclosure, rather than a wall of text in a
 * drawer.
 *
 * @param mail the row's mail action, with its preview address and digest
 * @param slug the board row, which the press names so the verb reads the mail itself
 * @param whole draw the whole body (the preview page) rather than the card's fold
 * @returns the preview
 */
export function MailActionPreview({
  mail,
  slug,
  whole,
}: {
  mail: BoardRowMail;
  slug: string;
  whole: boolean;
}): ReactElement {
  const dry = usePress();
  const create = usePress();
  const slots = { digest: mail.digest, slug };
  let fold = mailBodyFold({ body: mail.body, lines: Number.POSITIVE_INFINITY });
  if (!whole) {
    fold = mailBodyFold({ body: mail.body, lines: CARD_BODY_LINES });
  }
  const checked = dry.state.phase === "done";
  const busy = dry.state.phase === "sending" || create.state.phase === "sending";
  // A reply says it is one, in the head and on the press: a reply drawn as a fresh mail would make a fresh mail
  // when pressed.
  let head = "The mail, as it would sit in Gmail (nothing is sent from here)";
  let createLabel = "2 · Create the Gmail draft";
  if (mail.replyTo !== undefined) {
    head = "Your reply, inside this thread in Gmail (nothing is sent from here)";
    createLabel = "2 · Save the reply to your Gmail drafts";
  }
  return (
    <section className={PREVIEW}>
      <h4 className={PREVIEW_HEAD}>{head}</h4>
      <div className="grid gap-[0.15rem] border-b border-border pb-[0.45rem]">
        <HeaderLine label="From" value={mail.from} />
        <HeaderLine label="To" value={mail.to} />
        <HeaderLine label="Cc" value={mail.cc} />
        <HeaderLine label="Bcc" value={mail.bcc} />
        <p className="mt-[0.25rem] mb-0 text-[0.95rem] font-bold text-foreground">{mail.subject}</p>
      </div>
      <div className="text-[0.85rem] leading-[1.5] whitespace-pre-wrap text-foreground">{fold.shown}</div>
      {fold.hiddenLines > 0 && (
        <p className={MAIL_NOTE}>
          {fold.hiddenLines} more line(s): <a href={mail.previewUrl}>read the whole mail</a>
        </p>
      )}
      <p className={MAIL_NOTE}>
        preview: <a href={mail.previewUrl}>{mail.previewUrl}</a>
      </p>
      <div className="grid justify-items-start gap-[0.35rem] border-t border-dashed border-border pt-[0.45rem]">
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={() => {
            void dry.press({ readsSlug: "board", slots, slug: DRY_RUN_SLUG });
          }}
        >
          1 · Check it (dry run, stores nothing)
        </button>
        <code>{actLineFor({ slug: DRY_RUN_SLUG })}</code>
        <Outcome state={dry.state} outputOpen={true} />
        <button
          type="button"
          className={BUTTON}
          disabled={busy || !checked}
          onClick={() => {
            void create.press({ readsSlug: "board", slots, slug: CREATE_SLUG });
          }}
        >
          {createLabel}
        </button>
        <code>{actLineFor({ slug: CREATE_SLUG })}</code>
        <Outcome state={create.state} />
      </div>
    </section>
  );
}
