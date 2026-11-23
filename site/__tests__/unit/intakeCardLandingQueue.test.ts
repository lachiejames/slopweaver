/**
 * A card the owner steered on cannot rank again. Measured: the owner rejected a card the voice had put in front of
 * them, the relay named no card, so nothing landed, and the next morning it was still number one on their Queue. `talk cards` publishes the
 * chair's intake mark on that turn as a landing (`src/talk/intakeCardLandings.ts`); this is the page's half, over the
 * real board reader, row builder and overlay.
 */
import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type CardLandings, readCardLandings } from "../../components/live/readCardLandings";
import type { LiveState } from "../../components/live/useLive";
import { carriesMachineId } from "../../lib/machineIds";
import { standingRows } from "../../lib/queueLayout";
import { rowsOf } from "../../lib/queueRows";
import { NO_STEERS } from "../../lib/steeredCards";
import { ACME_PLACER } from "../organisationFixture";

const SLUG = "owner-steer-console-card";
const CARD = `ask:${SLUG}`;
const RELAY = "talk-a00000280000";
/** When the question was last asked, after a restore lifted the six landings of the afternoon. */
const ASKED = "2026-10-13T14:33:35.000Z";

const LOADING = { phase: "loading" } as const;

/** One ready register. */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-14T02:48:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The board: the ask, and — when a seat has taken it up — the relay's row running. */
function boardWith({ relayRunning }: { relayRunning: boolean }) {
  const ask = {
    kind: "ask",
    options: [
      { letter: "A", option: "Keep the debug-logging cut", tradeoff: "CI logs stay the place to look" },
      { letter: "B", option: "Recut onto test optimization", tradeoff: "one more pass" },
    ],
    ownerWait: "owner",
    priority: "p1",
    question: "Does the integration-test logging PR ship as recut?",
    questionAskedIso: ASKED,
    reason: "waiting on the owner",
    section: "runnable",
    slug: SLUG,
    status: "waiting-on-owner",
  };
  const relay = {
    kind: "plan",
    ownerWait: "not-waiting",
    priority: "p0",
    reason: "a session holds the lease",
    run: "active",
    section: "IN FLIGHT",
    slug: RELAY,
    status: "in-flight",
  };
  const board = readBoard({ rows: relayRunning ? [ask, relay] : [ask], unresolved: 0 });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  return board;
}

/** `talk cards --json` carrying one landing on the card, the owner's words decided at `decidedIso`. */
function spokenAt({ decidedIso }: { decidedIso: string }): LiveState<CardLandings> {
  const landing = {
    anchor: "talk-call:c1#turn_A",
    atIso: "2026-10-13T23:38:42.192Z",
    cardKey: CARD,
    decidedIso,
    source: "intake",
    words: "that's my final feedback. I reject this card",
    workSlug: RELAY,
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

/** What the Queue stands, from the real builder, over that board and that reading. */
function standing({ relayRunning, spoken }: { relayRunning: boolean; spoken: LiveState<CardLandings> }) {
  const board = ready({ value: boardWith({ relayRunning }) });
  const every = rowsOf({
    acts: LOADING,
    board,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    imports: LOADING,
    standing: LOADING,
  });
  return standingRows({ board, every, settled: [], spoken, steers: NO_STEERS });
}

describe("a card the owner steered on", () => {
  it("is off the owner's Queue while no seat has taken the steer up", () => {
    const rows = standing({ relayRunning: false, spoken: spokenAt({ decidedIso: "2026-10-13T23:36:10.909Z" }) });
    expect(rows.map((row) => row.key)).toEqual([]);
  });

  it("reads as the recut in flight, off the badge, once the relay's row is running", () => {
    const rows = standing({ relayRunning: true, spoken: spokenAt({ decidedIso: "2026-10-13T23:36:10.909Z" }) });
    expect(rows.map((row) => [row.key, row.card.question, row.tier])).toEqual([
      [CARD, `Recut in flight, ${RELAY}`, "check-in"],
    ]);
    expect(carriesMachineId({ text: rows[0].card.question })).toBe(false);
  });

  it("comes back when the question is asked again after the owner's words, since they never answered the new one", () => {
    const rows = standing({ relayRunning: false, spoken: spokenAt({ decidedIso: "2026-10-13T14:07:00.000Z" }) });
    expect(rows.map((row) => [row.key, row.tier])).toEqual([[CARD, "fleet-blocked"]]);
  });
});
