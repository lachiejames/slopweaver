/**
 * Everything an act card links to, and the reads its links still wait on — split out of `./queueCard.ts`; the shapes
 * the links read are `./queueCardAct.ts`'s.
 */

import { opensNowhere } from "./citationDisplay";
import { subjectLabel } from "./queueCard";
import {
  type ActLinkLanding,
  type CardLink,
  type LinkedAct,
  type LinkedBoardRow,
  type LinkedPullRequest,
} from "./queueCardAct";

/**
 * The board as an act's links read it — the three states `LiveState` distinguishes, kept distinct.
 *
 * An empty row list cannot stand in for the other two: a board still being read and a board that could not
 * be read are different sentences on the card, and neither is "no board row names this act".
 */
export type ActLinkBoard =
  | { readonly phase: "loading" }
  | { readonly phase: "not-measured"; readonly why: string }
  | {
      readonly phase: "ready";
      /** The rows carrying any of `slugs`, in board order, read through an index (`./boardRowIndex.ts`). */
      readonly rowsNamed: (args: { slugs: ReadonlySet<string> }) => readonly LinkedBoardRow[];
    };

/**
 * A read an act's links wait on, drawn beside them as its spinner or staleness mark so a partial set never reads as
 * the whole — never a sentence, because a progress indicator says it better than text.
 */
export interface ActLinkPending {
  /** What the read would add, mid-sentence. */
  readonly subject: string;
  readonly read: Exclude<ActLinkLanding, { phase: "ready" }>;
}

/**
 * Every place an act links to, and — while the board or the pull-request reading is unread — the read that may add
 * more. `none` draws nothing: a links strip reading "The ledger row … names no
 * linkable address" looks broken and ugly, so a card with nothing to link draws no links row at all.
 */
export type ActLinks =
  | {
      readonly kind: "linked";
      readonly links: readonly CardLink[];
      readonly boardNotice: ActLinkPending | undefined;
      readonly landingNotice: ActLinkPending | undefined;
    }
  | {
      readonly kind: "none";
      readonly boardNotice: ActLinkPending | undefined;
      readonly landingNotice: ActLinkPending | undefined;
    };

/**
 * Every address a record's prose names — an `https://` one, or a local page's `file://…/pages/<slug>/index.html`
 * — starting a token (after the text's start, a space, a quote, an opening bracket, or Markdown bold that itself opens a token; never
 * inside another address) and running to the first space, quote, angle bracket or closing bracket, brace included. The query and
 * fragment are kept: they are where the address goes, and a page path must come BEFORE them — `file:///etc/passwd#/pages/…` is
 * /etc/passwd, not a page; and a slug of `.` or `..` names a directory, not a page. A page address must END there — `index.html.bak` is a
 * different file, not the page. Group 1 is a local page's slug.
 */
const ADDRESS =
  /(?<=^|[\s<>"'`([{]|(?:^|\s)\*+)(?:https:\/\/[^\s<>"'`)\]}]+|file:\/\/[^\s<>"'`)\]}?#]*?\/pages\/(?!\.\.?\/)([A-Za-z0-9._-]+)\/index\.html(?:[?#][^\s<>"'`)\]}]*)?(?=$|[\s<>"'`)\]}]|[.,;:!?*]+(?:$|\s)))/gu;

/**
 * What a BARE address in prose often ends on and never means: sentence punctuation and Markdown bold. An
 * underscore is NOT here — a path may legitimately end on one, and stripping it would link a different page.
 */
const URL_TRAILING = /[.,;:!?*]+$/u;

/** What the board read would add to an act's links. */
export const ACT_BOARD_SUBJECT = "the board, whose row may name a pull request or card for this act";

/** What the pull-request reading would add to an act's links. */
export const ACT_LANDING_SUBJECT = "your open pull requests, one of which this act may have opened";

/**
 * The read an unread board leaves the links waiting on, so a partial set of links never reads as the whole.
 *
 * @returns the pending read, or `undefined` once the board is read
 */
function boardNoticeOf({ board }: { board: ActLinkLanding }): ActLinkPending | undefined {
  if (board.phase === "ready") {
    return undefined;
  }
  return { read: board, subject: ACT_BOARD_SUBJECT };
}

/**
 * The read an unread pull-request reading leaves the links waiting on, for {@link boardNoticeOf}'s reason.
 *
 * @returns the pending read, or `undefined` once the reading is in
 */
function landingNoticeOf({ landing }: { landing: ActLinkLanding }): ActLinkPending | undefined {
  if (landing.phase === "ready") {
    return undefined;
  }
  return { read: landing, subject: ACT_LANDING_SUBJECT };
}

/**
 * Everything an act card can link to, derived from the ledger row, the owner's open pull requests and the board —
 * never typed.
 *
 * A finding-PR act card links the pull request and anything else linkable, so the owner can judge the
 * implementation and proof. The finding gate records its row BEFORE the pull request exists, so the ledger
 * alone can never carry the URL; {@link actPullRequests} joins the open one out of the landing reading, and
 * a board row's `prUrls` still carries one its doc names after it merged.
 *
 * In order: each joined pull request; the subject when it is an address; each board row the subject or run
 * names — its pull requests, then the row's own card on the queue; then every address and local page the
 * act's `said`, `why` and `witness` name. Each URL once, first occurrence winning.
 *
 * A board row links only to a card the queue can OPEN (`queueKeys` holds `ask:<slug>`, as a row key or a hand
 * step's alias). It never links the row itself: a board row has no page of its own, and a page holding only the
 * row's section, kind and reason is no use to the owner. A row with no card on the queue draws no chip — the pull request is
 * the real page — and nothing is guessed from a slug's shape.
 *
 * @param board the board in whichever of its three states it is in — an unread one is said, never read as empty
 * @param landing whether the open pull requests are in, so an unread reading is said rather than read as none
 * @param pulls the open pull requests {@link actPullRequests} joined to this act
 * @param queueKeys every `?open=` key the queue can resolve — each row's key and every alias
 * @returns the links, or `none`, with each unread reading's notice
 */
export function actLinks({
  act,
  board,
  landing,
  pulls,
  queueKeys,
}: {
  act: LinkedAct;
  board: ActLinkBoard;
  landing: ActLinkLanding;
  pulls: readonly LinkedPullRequest[];
  queueKeys: ReadonlySet<string>;
}): ActLinks {
  const links: CardLink[] = [];
  const push = ({ label, url }: CardLink): void => {
    // An address under a page the console no longer has opens nowhere, so it is no link (such as
    // `https://localhost:3000/machine` as an act's subject); the subject still reads on the card.
    if (opensNowhere({ reference: { kind: "address", url } })) {
      return;
    }
    if (!links.some((link) => link.url === url)) {
      links.push({ label, url });
    }
  };
  const addressesIn = ({ text }: { text: string }): void => {
    for (const match of text.matchAll(ADDRESS)) {
      // A delimiter closing the address — a backtick, a quote, a bracket — says where it ends, so it is kept
      // whole. Only a BARE address, ended by a space or the text, loses the punctuation of its sentence.
      const next = text.charAt(match.index + match[0].length);
      let url = match[0];
      if (next === "" || /\s/u.test(next)) {
        url = url.replace(URL_TRAILING, "");
      }
      const pageSlug = match.at(1);
      let label = subjectLabel({ subject: url });
      if (pageSlug !== undefined) {
        label = `the ${pageSlug} page`;
      }
      push({ label, url });
    }
  };
  for (const pull of pulls) {
    push({ label: subjectLabel({ subject: pull.url }), url: pull.url });
  }
  if (act.subject.startsWith("https://")) {
    push({ label: subjectLabel({ subject: act.subject }), url: act.subject });
  }
  let rows: readonly LinkedBoardRow[] = [];
  if (board.phase === "ready") {
    rows = board.rowsNamed({ slugs: new Set([act.subject, act.run].filter((slug) => slug !== undefined)) });
  }
  // A key the address cannot carry unchanged — a lone surrogate becomes U+FFFD — would open no card, so a row
  // whose key does not survive the round trip is not carded here.
  const carded = rows.filter((row) => {
    const key = `ask:${row.slug}`;
    const carried = new URLSearchParams(new URLSearchParams({ open: key }).toString()).get("open");
    return queueKeys.has(key) && carried === key;
  });
  for (const row of rows) {
    // `handover list` publishes only GitHub pull-request URLs here; anything else is not a pull request and
    // is not linked as one.
    for (const url of row.prUrls.filter((candidate) => candidate.startsWith("https://"))) {
      push({ label: subjectLabel({ subject: url }), url });
    }
    if (!carded.includes(row)) {
      continue;
    }
    // Two carded rows would otherwise read as two identical links; the slug is what tells them apart.
    // `URLSearchParams` rather than `encodeURIComponent`: it never throws.
    const label = carded.length === 1 ? "its card on the queue" : `the card for ${row.slug}`;
    push({ label, url: `/queue?${new URLSearchParams({ open: `ask:${row.slug}` }).toString()}` });
  }
  // A subject that is an address was linked whole above, and scanning it as prose too could link a trimmed
  // copy of it. Any other subject is read like the prose, for a page it names.
  const prose = [act.said, act.why, act.witness];
  if (!act.subject.startsWith("https://")) {
    prose.unshift(act.subject);
  }
  for (const text of prose) {
    if (text !== undefined) {
      addressesIn({ text });
    }
  }
  const boardNotice = boardNoticeOf({ board });
  const landingNotice = landingNoticeOf({ landing });
  if (links.length > 0) {
    return { boardNotice, kind: "linked", landingNotice, links };
  }
  return { boardNotice, kind: "none", landingNotice };
}

/**
 * An act's links with both notices re-read off the registers as the page holds them NOW. A card left open after its
 * row went is the snapshot taken when it was opened, whose "still being read" notices would otherwise outlive the
 * reads they describe, even ones that since failed.
 *
 * @param links the snapshot's links
 * @param board the board register's phase now
 * @param landing the owner's open pull requests' phase now
 * @returns the links, each notice current
 */
export function liveActNotices({
  links,
  board,
  landing,
}: {
  links: ActLinks;
  board: ActLinkLanding;
  landing: ActLinkLanding;
}): ActLinks {
  return { ...links, boardNotice: boardNoticeOf({ board }), landingNotice: landingNoticeOf({ landing }) };
}
