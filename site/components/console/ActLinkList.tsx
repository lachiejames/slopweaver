"use client";

import type { ReactElement } from "react";

import type { ActLinkPending, ActLinks } from "../../lib/queueCardActLinks";
import { CitationChip } from "./CitationChip";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/**
 * A read the links wait on: its spinner while it reads, its staleness mark when it failed.
 *
 * @returns the mark
 */
function PendingMark({ pending }: { pending: ActLinkPending }): ReactElement {
  if (pending.read.phase === "loading") {
    return <ReadingIndicator label={`Reading ${pending.subject}`} />;
  }
  return <StaleMark facts={[{ subject: pending.subject, why: pending.read.why }]} />;
}

/** The links, wrapping as a row of chips. */
const ACT_LINKS = "m-0 mb-[0.6rem] flex flex-wrap gap-x-[0.4rem] gap-y-[0.35rem] text-[0.8rem]";

/**
 * An act card's links row — the pull request, the page, the board row's own queue card. It takes only a LINKED
 * value, so an act that names nothing that opens cannot reach it: the panel draws no links row at all, because a
 * links section with no links reads as broken.
 *
 * Every link is `actLinks` (`../../lib/queueCardActLinks.ts`) reading the ledger row and the board; this
 * only decides where it sits. An unread reading's spinner or staleness mark rides beside real links, so a partial
 * set never reads as the whole.
 *
 * @param links what the act links to
 * @returns the row
 */
export function ActLinkList({ links }: { links: Extract<ActLinks, { kind: "linked" }> }): ReactElement {
  return (
    <>
      <span className={ACT_LINKS}>
        {links.links.map((link) => (
          <CitationChip key={link.url} reference={{ kind: "address", url: link.url }}>
            {link.label}
          </CitationChip>
        ))}
        {links.boardNotice !== undefined && <PendingMark pending={links.boardNotice} />}
        {links.landingNotice !== undefined && <PendingMark pending={links.landingNotice} />}
      </span>
    </>
  );
}
