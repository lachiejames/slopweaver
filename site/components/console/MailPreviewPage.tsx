"use client";

import type { ReactElement } from "react";

import { lookupMailPreview } from "../../lib/mailPreview";
import { ReadMark } from "../live/LiveMarks";
import { type Board, readBoard } from "../live/read";
import { useLive } from "../live/useLive";
import { MailActionPreview } from "./MailActionPreview";
import { MailThread } from "./MailThread";
import { PageHead } from "./PageHead";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/** The one quiet line the page prints instead of a mail it cannot draw. */
const STATE = "m-0 text-[0.75rem] text-muted-foreground";

/**
 * The whole-mail page: the board row's mail drawn in full, with its two presses — or a sentence saying why
 * this address no longer draws one.
 *
 * @param slug the board row off the address
 * @param digest the digest the address was minted for
 * @returns the page body
 */
export function MailPreviewPage({ slug, digest }: { slug: string; digest: string }): ReactElement {
  const board = useLive<Board>({ read: readBoard, slug: "board" });
  if (board.phase === "loading") {
    return <ReadingIndicator label="Reading the board" block />;
  }
  if (board.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "The board", why: board.why }]} block />;
  }
  const rows = board.value.rows.map((row) => {
    if (row.action.kind === "mail") {
      return { digest: row.action.mail.digest, slug: row.slug };
    }
    return { digest: undefined, slug: row.slug };
  });
  const found = lookupMailPreview({ digest, rows, slug });
  const row = board.value.rows.find((one) => one.slug === slug);
  let body: ReactElement;
  if (found.kind === "current" && row?.action.kind === "mail") {
    // A reply is read under the thread it answers, as every card offering the press draws it.
    const { replyTo } = row.action.mail;
    body = (
      <>
        {replyTo !== undefined && <MailThread id={replyTo} key={replyTo} />}
        <MailActionPreview mail={row.action.mail} slug={slug} whole />
      </>
    );
  } else if (found.kind === "superseded") {
    body = (
      <p className={STATE}>
        This preview is out of date: {slug} now offers a different mail (<code>{found.currentDigest}</code>). Open{" "}
        <a href={`/queue/mail/${encodeURIComponent(slug)}/${found.currentDigest}`}>the current one</a> and read it
        before creating a draft; a press from this address would be refused.
      </p>
    );
  } else if (found.kind === "no-mail") {
    body = <p className={STATE}>{slug} is on the board and offers no mail now. It was answered or re-asked.</p>;
  } else {
    body = <p className={STATE}>No board row is named {slug}.</p>;
  }
  return (
    <main className="grid max-w-[52rem] gap-4">
      <PageHead title="Mail preview" sub={slug} />
      <ReadMark state={board} subject="the board" row />
      {body}
    </main>
  );
}
