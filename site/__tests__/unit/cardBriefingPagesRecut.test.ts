/**
 * A card rebuilt AFTER `rowsOf` drew its briefings still draws every briefing the voice reads through it. A recut
 * rewrites the card's question to name the seat acting on the owner's words (`recutRow`, `site/lib/queueLayout.ts`), and the
 * voice reads that question, so a page it names has to be a chip on the card the owner sees. Built through the
 * real board reader, row builder, landing reader and overlay.
 */
import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type CardLandings, readCardLandings } from "../../components/live/readCardLandings";
import type { LiveState } from "../../components/live/useLive";
import { cardLinksOf } from "../../lib/openCard";
import { standingRows } from "../../lib/queueLayout";
import { rowsOf } from "../../lib/queueRows";
import { NO_STEERS } from "../../lib/steeredCards";
import { ACME_PLACER } from "../organisationFixture";

const SLUG = "acme-widget-rollout-question";
const CARD = `ask:${SLUG}`;
/** A seat slug spelling a page identity, so the recut question names a briefing the original card never did. */
const SEAT = "page:recut-briefing";

const LOADING = { phase: "loading" } as const;

/** One ready register. */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-11-06T02:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The board: the ask, and the seat running the owner's words. */
function board(): LiveState<NonNullable<ReturnType<typeof readBoard>>> {
  const ask = {
    kind: "ask",
    ownerWait: "owner",
    priority: "p1",
    question: "Does the widget rollout go out this week?",
    questionAskedIso: "2026-11-05T01:00:00.000Z",
    reason: "waiting on the owner",
    section: "runnable",
    slug: SLUG,
    status: "waiting-on-owner",
  };
  const seat = {
    kind: "plan",
    ownerWait: "not-waiting",
    priority: "p0",
    reason: "a session holds the lease",
    run: "active",
    section: "IN FLIGHT",
    slug: SEAT,
    status: "in-flight",
  };
  const read = readBoard({ rows: [ask, seat], unresolved: 0 });
  if (read === undefined) {
    throw new Error("the fixture board did not read");
  }
  return ready({ value: read });
}

/** The owner's words landed on the card after it was asked, taken up by the seat. */
function spoken(): LiveState<CardLandings> {
  const landing = {
    anchor: "call:00000000-0000-4000-8000-000000000000#turn_FIXTURE",
    atIso: "2026-11-05T02:00:00.000Z",
    cardKey: CARD,
    decidedIso: "2026-11-05T02:00:00.000Z",
    source: "intake",
    words: "recut it smaller",
    workSlug: SEAT,
  };
  return ready({
    value: readCardLandings({
      landings: [landing],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    })!,
  });
}

describe("a recut card", () => {
  it("draws the briefing its recut question names, the one the voice reads through it", () => {
    const live = board();
    const every = rowsOf({
      acts: LOADING,
      board: live,
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
    const row = standingRows({ board: live, every, settled: [], spoken: spoken(), steers: NO_STEERS })[0];
    expect(row.card.question).toBe(`Recut in flight, ${SEAT}`);
    expect(cardLinksOf({ row }).briefings).toEqual(["recut-briefing"]);
    expect(row.card.pages).toEqual([{ slug: "recut-briefing", url: "/api/page/recut-briefing/index.html" }]);
  });
});
