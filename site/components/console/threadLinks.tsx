"use client";

import type { ReactNode } from "react";

import type { CardPage } from "../../lib/queueCard";
import type { ParkedDraft } from "../live/readSlackDrafts";
import { CitationChip } from "./CitationChip";
import { PagesList } from "./QueueCardBodyFields";

/**
 * A thread reply's links row: the Slack thread it goes under, as its citation chip, so the owner reads the messages before
 * and after it without hunting for them. A row recorded before the permalink was, or a
 * top-level post, has none and draws no row. It reads "thread in dev-alerts" — no article, no `#`, the chip's Slack
 * mark says the rest (`../../lib/cardLinks.ts`).
 *
 * A card body draws its pages row only when no links strip is passed, so the strip carries the card's pages beside the
 * thread: without them a briefing the voice reads through a thread reply's card was drawn nowhere.
 *
 * @param post the parked draft the card is about
 * @param pages the card's pages, every briefing it links among them
 * @returns the card body's `links` prop, or nothing
 */
export function threadLinks({ post, pages }: { post: ParkedDraft; pages: readonly CardPage[] }): {
  links?: ReactNode;
} {
  const url = post.thread?.permalink;
  if (url === undefined) {
    return {};
  }
  let where = "thread";
  if (post.channelName !== undefined) {
    where = `thread in ${post.channelName}`;
  }
  return {
    links: (
      <>
        <CitationChip reference={{ kind: "address", url }}>{where}</CitationChip>
        {pages.length > 0 && <PagesList pages={pages} />}
      </>
    ),
  };
}
