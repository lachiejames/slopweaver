/*
 * A Queue card draws every briefing the voice reads through it (on the session-hosting card, the voice read
 * the off-cmux briefing while the owner's Queue drew no page). The incident's own shape is the first case: an ask whose question names no page and whose summary carries the briefing's `file://` address.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { readAutonomy } from "../../components/live/readAutonomy";
import type { LiveState } from "../../components/live/useLive";
import { withBriefingPages } from "../../lib/cardBriefingPages";
import { cardLinksOf } from "../../lib/openCard";
import { ACT_BOARD_SUBJECT, ACT_LANDING_SUBJECT } from "../../lib/queueCardActLinks";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

const BRIEFING = "file:///Users/someone/.slopweaver/pages/off-site-briefing/index.html";
const ROUTED = "http://localhost:3000/api/page/second-briefing/index.html";
/** The chip that spelling draws: the relative route, so it opens on whichever port the console serves now. */
const ROUTED_CHIP = "/api/page/second-briefing/index.html";

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-11-06T01:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** An ask waiting on the owner, its question naming no page — the incident's row. */
const ASK = {
  kind: "ask",
  ownerWait: "owner",
  question: "Does a hosted session meet rule 2 for you?",
  questionAskedIso: "2026-11-03T11:23:44.166Z",
  reason: "declared ready",
  section: "WAITING ON OWNER",
  slug: "hosted-session-ask",
  status: "ready",
  summary: `The owner's reaction reading page:off-site-briefing (${BRIEFING}) off the Queue card.`,
};

function askRow({ fields }: { fields: Record<string, unknown> }): QueueRow {
  const rows = rowsOf({
    acts: LOADING,
    board: ready({ value: readBoard({ rows: [{ ...ASK, ...fields }], unresolved: 0 })! }),
    drafts: LOADING,
    hands: LOADING,
    imports: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    standing: LOADING,
  });
  return rows.find((row) => row.id === ASK.slug)!;
}

/** The slugs a card's chips name. */
function chipSlugs({ row }: { row: QueueRow }): readonly string[] {
  return row.card.pages.map((page) => page.slug);
}

/** An act row's links strip; any other row is a fixture defect. */
function actLinks({ row }: { row: QueueRow }): unknown {
  if (row.record.kind !== "act") {
    throw new Error(`expected an act row, got ${row.record.kind}`);
  }
  return row.record.links;
}

describe("withBriefingPages", () => {
  it("draws the briefing an ask names only in its summary — the incident's shape, its first spelling winning", () => {
    const row = askRow({ fields: {} });
    expect(cardLinksOf({ row }).briefings).toEqual(["off-site-briefing"]);
    expect(row.card.pages).toEqual([{ slug: "off-site-briefing", url: "/api/page/off-site-briefing/index.html" }]);
  });

  it("draws a briefing a summary names only by its file address", () => {
    const row = askRow({ fields: { summary: `The owner's reaction reading ${BRIEFING} off the Queue card.` } });
    expect(row.card.pages).toEqual([{ slug: "off-site-briefing", url: BRIEFING }]);
  });

  it("draws a briefing a still-real line names only as page:<slug>, and the voice reads the same one", () => {
    const row = askRow({
      fields: {
        blastRadius: "this repository only",
        risk: "none measured",
        stillReal: "page:off-site-briefing republished on the re-cut.",
        summary: "no page here",
      },
    });
    expect(cardLinksOf({ row }).briefings).toEqual(["off-site-briefing"]);
    expect(row.card.pages).toEqual([{ slug: "off-site-briefing", url: "/api/page/off-site-briefing/index.html" }]);
  });

  it("draws a briefing spelled as the console route, which no builder's prose scan reads", () => {
    const row = askRow({ fields: { summary: "no page here", lean: `Yes, as ${ROUTED} lays out.` } });
    expect(cardLinksOf({ row }).briefings).toEqual(["second-briefing"]);
    expect(row.card.pages).toEqual([{ slug: "second-briefing", url: ROUTED_CHIP }]);
  });

  it("keeps the artifact chip first, and draws a briefing the artifact already is only once", () => {
    const row = askRow({ fields: { artifact: BRIEFING, lean: `See ${ROUTED}.` } });
    expect(row.card.pages).toEqual([
      { slug: "off-site-briefing", url: BRIEFING },
      { slug: "second-briefing", url: ROUTED_CHIP },
    ]);
  });

  it("points an artifact chip kept as an absolute console address at the console serving now", () => {
    const row = askRow({ fields: { artifact: ROUTED, summary: "no page here" } });
    // Named by the briefing it opens, never the address it was spelled by.
    expect(row.card.pages).toEqual([{ slug: "second-briefing", url: ROUTED_CHIP }]);
    expect(cardLinksOf({ row }).briefings).toEqual(["second-briefing"]);
  });

  it.each([
    ["a fully qualified localhost.", "http://localhost.:3000/api/page/second-briefing/index.html"],
    ["the IPv6 loopback", "http://[::1]:3000/api/page/second-briefing/index.html"],
  ])("reads an artifact on %s as this console, so its chip drops the port", (_host, artifact) => {
    const row = askRow({ fields: { artifact, summary: "no page here" } });
    expect(row.card.pages).toEqual([{ slug: "second-briefing", url: ROUTED_CHIP }]);
    expect(cardLinksOf({ row }).briefings).toEqual(["second-briefing"]);
  });

  it("routes an act's own link to a briefing kept on another port, the strip it draws in the card's place", () => {
    const ledger = readAutonomy([
      {
        action: {
          actionId: "act-on-a-page",
          doneIso: "2026-11-05T11:00:00.000Z",
          kind: "press-merge-when-ready",
          subject: ROUTED,
          why: "republished",
        },
      },
    ])!;
    const rows = rowsOf({
      acts: ready({ value: ledger }),
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      imports: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      standing: LOADING,
    });
    const act = rows.find((row) => row.record.kind === "act")!;
    expect(cardLinksOf({ row: act }).briefings).toEqual(["second-briefing"]);
    expect(actLinks({ row: act })).toEqual({
      boardNotice: { read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT },
      kind: "linked",
      landingNotice: { read: { phase: "loading" }, subject: ACT_LANDING_SUBJECT },
      links: [{ label: "second-briefing", url: ROUTED_CHIP }],
    });
  });

  it("leaves an artifact that names no briefing at its own address", () => {
    const pull = "https://github.com/acme/widgets/pull/12";
    const row = askRow({ fields: { artifact: pull, summary: "no page here" } });
    expect(row.card.pages.map((page) => page.url)).toEqual([pull]);
  });

  it("leaves a card linking no briefing as it was built", () => {
    const row = askRow({ fields: { summary: "no page here" } });
    expect(row.card.pages).toEqual([]);
    expect(cardLinksOf({ row }).briefings).toEqual([]);
  });

  it("is idempotent: a row passed twice draws each briefing once, in the order the voice finds them", () => {
    const row = askRow({ fields: { lean: `See ${ROUTED}.` } });
    expect(withBriefingPages({ row })).toBe(row);
    // The drawn lean is read before the summary the card folds, so the voice — and the chips — find it first.
    expect(chipSlugs({ row })).toEqual(["second-briefing", "off-site-briefing"]);
    expect(cardLinksOf({ row }).briefings).toEqual(["second-briefing", "off-site-briefing"]);
  });

  it("adds a briefing to an act's links strip, which an act panel draws in place of the card's chips", () => {
    const ledger = readAutonomy([
      {
        action: {
          actionId: "act-with-a-briefing",
          doneIso: "2026-11-05T11:00:00.000Z",
          kind: "press-merge-when-ready",
          subject: "https://github.com/acme/widgets/pull/12",
          why: `green, as ${ROUTED} measured`,
        },
      },
    ])!;
    const rows = rowsOf({
      acts: ready({ value: ledger }),
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      imports: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      standing: LOADING,
    });
    const act = rows.find((row) => row.record.kind === "act")!;
    expect(cardLinksOf({ row: act }).briefings).toEqual(["second-briefing"]);
    expect(chipSlugs({ row: act })).toEqual(["second-briefing"]);
    expect(actLinks({ row: act })).toEqual({
      boardNotice: { read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT },
      kind: "linked",
      landingNotice: { read: { phase: "loading" }, subject: ACT_LANDING_SUBJECT },
      links: [
        { label: "acme/widgets#12", url: "https://github.com/acme/widgets/pull/12" },
        { label: "second-briefing", url: ROUTED_CHIP },
      ],
    });
  });

  it("holds the invariant: every briefing the voice reads is a chip the Queue draws", () => {
    const row = askRow({ fields: { lean: `See ${ROUTED}.`, problem: `Background at ${BRIEFING}.` } });
    const briefings = cardLinksOf({ row }).briefings;
    expect(briefings.length).toBeGreaterThan(0);
    expect(briefings.filter((slug) => !chipSlugs({ row }).includes(slug))).toEqual([]);
  });
});
