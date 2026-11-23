/*
 * A card the owner has just steered on: collapsed the moment the relay starts, one line saying what was recorded and when,
 * gone for good when something acts on it, and back in the list — saying nothing on the page — when nothing did. Each
 * case pins one of those promises, and the joins that keep a steer from collapsing a card it was never about.
 */
import { describe, expect, it } from "vitest";

import type { CardLanding, CardLandings, CardLedgerGap, TriageMark } from "../../components/live/readCardLandings";
import { readSteeredCards, type SteeredCardsReading } from "../../components/live/readSteeredCards";
import type { LiveState } from "../../components/live/useLive";
import { landingVerdict, type MarkedRow, parkedRow, spokenGap, unlandedRows } from "../../lib/cardLandings";
import {
  keptSteers,
  type LocalSteer,
  mergedSteers,
  mutationBase,
  NO_STEERS,
  parseStoredSteers,
  REGISTER_GRACE_MS,
  relayInFlightOf,
  type SteerLine,
  steerOverlay,
  steersWithLine,
} from "../../lib/steeredCards";

describe("relayInFlightOf", () => {
  const row = ({ turnId, relaySlug }: { turnId: string; relaySlug: string | undefined }) => ({
    cardKey: "pr:1",
    heard: "",
    relaySlug,
    sentAtIso: "2026-10-04T00:36:58.000Z",
    turnId,
  });

  it("is in flight only while a sending relay's card is still collapsed and the verb has not seen it registered", () => {
    const sending = [{ outcome: "sending" as const, turnId: "t1" }];
    expect([
      relayInFlightOf({ held: sending, overlay: { collapsed: [row({ relaySlug: undefined, turnId: "t1" })] } }),
      relayInFlightOf({ held: sending, overlay: { collapsed: [row({ relaySlug: "talk-t1", turnId: "t1" })] } }),
      relayInFlightOf({ held: sending, overlay: { collapsed: [] } }),
      relayInFlightOf({
        held: [{ outcome: "relayed", turnId: "t1" }],
        overlay: { collapsed: [row({ relaySlug: undefined, turnId: "t1" })] },
      }),
    ]).toEqual([true, false, false, false]);
  });
});

const TURN = "ed674c0e-d0f9-49da-8764-42c1b8fce1e6";
const SLUG = "talk-ed674c0ed0f9";
const CARD = "pr:acme.widgets.1779";
const OTHER = "pr:acme.widgets.1780";
const SENT = "2026-10-04T00:36:58.000Z";
const SENT_MS = Date.parse(SENT);
/** The window start every reading here carries: well before the owner spoke. */
const SINCE = "2026-09-27T00:36:58.000Z";

/** An instant `ms` after the owner spoke. */
const after = ({ ms }: { ms: number }): string => new Date(SENT_MS + ms).toISOString();

/** A reading that has arrived. */
function ready<T>({ value, at }: { value: T; at: string }): LiveState<T> {
  return { fixture: undefined, observedAtIso: at, phase: "ready", stampedByRoute: false, value };
}

/** One relay line, overridable field by field. */
const line = (over: Partial<SteerLine> = {}): SteerLine => ({
  about: CARD,
  detail: "running talk relay",
  heard: "merge it once CI is green",
  outcome: "sending",
  turnId: TURN,
  ...over,
});

/** A steer the page collapsed, overridable field by field. */
const steer = (over: Partial<LocalSteer> = {}): LocalSteer => ({
  cardKey: CARD,
  detail: "relayed",
  heard: "merge it once CI is green",
  outcome: "relayed",
  sentAtIso: SENT,
  turnId: TURN,
  ...over,
});

/** The verb's reading carrying this steer under one verdict, read through the real reader. */
const verbSaid = ({ verdict, at }: { verdict: unknown; at: string }): LiveState<SteeredCardsReading> => {
  const value = readSteeredCards({
    observedAtIso: at,
    ok: true,
    steers: [
      {
        cardKey: CARD,
        heard: "merge it",
        registeredAtIso: after({ ms: 1000 }),
        relaySlug: SLUG,
        turnId: TURN,
        verdict,
      },
    ],
    sinceIso: SINCE,
    undecodedRelays: 0,
  });
  if (value === undefined) {
    throw new Error("the steers fixture did not read");
  }
  return ready({ at, value });
};

/** The `talk cards` reading with this relay's own landing on the card, and optionally another's. */
const landedOn = ({ also = false }: { also?: boolean } = {}): LiveState<CardLandings> => {
  const own = {
    anchor: `talk:${TURN}`,
    atIso: SENT,
    cardKey: CARD,
    decidedIso: SENT,
    source: "relay",
    words: "merge it",
    workSlug: SLUG,
  } as const;
  const other = {
    anchor: "talk:other",
    atIso: SENT,
    cardKey: CARD,
    decidedIso: SENT,
    source: "relay",
    words: "and ping Ari",
    workSlug: "talk-other",
  } as const;
  return ready({
    at: SENT,
    value: {
      landings: also ? [own, other] : [own],
      moves: [],
      triageUnreadable: 0,
      unreadable: 0,
      unreadableLines: [],
    },
  });
};

/** A landing on the card, overridable field by field. */
const landing = (over: Partial<CardLanding> = {}): CardLanding => ({
  anchor: `talk:${TURN}`,
  atIso: SENT,
  cardKey: CARD,
  decidedIso: SENT,
  source: "relay",
  words: "park it",
  workSlug: SLUG,
  ...over,
});

/** The `talk cards` reading carrying these landings and these two unread counts. */
const readingOf = ({
  landings,
  triageUnreadable = 0,
  unreadableLines = [],
}: {
  landings: readonly CardLanding[];
  triageUnreadable?: number;
  unreadableLines?: readonly CardLedgerGap[];
}): LiveState<CardLandings> =>
  ready({
    at: SENT,
    value: { landings, moves: [], triageUnreadable, unreadable: unreadableLines.length, unreadableLines },
  });

/** A ledger line the verb could not read, recording `cardKey` when one is given. */
const gapLine = ({ lineNumber, cardKey }: { lineNumber: number; cardKey?: string }): CardLedgerGap => ({
  atIso: undefined,
  cardKey,
  lineNumber,
});

/** The owner's park to a working session, with the label they gave beside it. */
const PARK: TriageMark = { label: "waiting-on-them", verdict: "park-working-session" };

describe("steersWithLine — which relays collapse a card", () => {
  it("takes the line that starts a relay about the card open as it was sent", () => {
    expect(steersWithLine({ atIso: SENT, held: [], line: line(), openCard: CARD })).toEqual([
      steer({ detail: "running talk relay", outcome: "sending" }),
    ]);
  });

  it("collapses nothing for no card, another card, or a bare pr:<number> two repositories can share", () => {
    expect(steersWithLine({ atIso: SENT, held: [], line: line({ about: "" }), openCard: CARD })).toEqual([]);
    expect(steersWithLine({ atIso: SENT, held: [], line: line(), openCard: OTHER })).toEqual([]);
    expect(steersWithLine({ atIso: SENT, held: [], line: line(), openCard: undefined })).toEqual([]);
    expect(steersWithLine({ atIso: SENT, held: [], line: line({ about: "pr:42" }), openCard: "pr:42" })).toEqual([]);
  });

  it("collapses nothing for an Automations card, which no Queue register holds", () => {
    const recipe = line({ about: "recipe:nightly" });
    expect(steersWithLine({ atIso: SENT, held: [], line: recipe, openCard: "recipe:nightly" })).toEqual([]);
  });

  it("collapses nothing for a relay the gate shut, or one with no turn", () => {
    expect(steersWithLine({ atIso: SENT, held: [], line: line({ outcome: "shut" }), openCard: CARD })).toEqual([]);
    expect(steersWithLine({ atIso: SENT, held: [], line: line({ turnId: undefined }), openCard: CARD })).toEqual([]);
  });

  it("updates a known steer's outcome from a later line even once the card is no longer open", () => {
    const held = [steer({ outcome: "sending" })];
    const next = steersWithLine({
      atIso: after({ ms: 5000 }),
      held,
      line: line({ detail: "the gate refused it", outcome: "refused" }),
      openCard: undefined,
    });
    expect(next).toEqual([steer({ detail: "the gate refused it", outcome: "refused" })]);
  });

  it("reads a board-only row as recorded", () => {
    const next = steersWithLine({
      atIso: SENT,
      held: [steer()],
      line: line({ outcome: "board-only" }),
      openCard: CARD,
    });
    expect(next.map((one) => one.outcome)).toEqual(["relayed"]);
  });

  it("copies the triage verdict a relay line carried onto the steer it starts", () => {
    const next = steersWithLine({
      atIso: SENT,
      held: [],
      line: line({ triageVerdict: "park-slow-triage" }),
      openCard: CARD,
    });
    expect(next).toEqual([
      steer({ detail: "running talk relay", outcome: "sending", triageVerdict: "park-slow-triage" }),
    ]);
  });

  it("starts a steer with no triageVerdict key when the line carried none", () => {
    const next = steersWithLine({ atIso: SENT, held: [], line: line(), openCard: CARD });
    expect(Object.keys(next[0])).not.toContain("triageVerdict");
  });
});

describe("steerOverlay — collapse, settle, come back", () => {
  const spoken = landedOn();

  it("collapses the card at once, before any reading has arrived", () => {
    const overlay = steerOverlay({
      held: [steer({ outcome: "sending" })],
      reading: { phase: "loading" },
      spoken,
    });
    expect([...overlay.hidden]).toEqual([CARD]);
    expect(overlay.collapsed.map((row) => [row.turnId, row.relaySlug])).toEqual([[TURN, undefined]]);
    expect(overlay.cameBack).toEqual([]);
  });

  it("carries the relay row while it waits on the chair", () => {
    const reading = verbSaid({ at: after({ ms: 60_000 }), verdict: { kind: "awaiting" } });
    const overlay = steerOverlay({ held: [steer()], reading, spoken });
    expect(overlay.collapsed).toEqual([
      {
        cardKey: CARD,
        heard: "merge it once CI is green",
        relaySlug: SLUG,
        sentAtIso: SENT,
        turnId: TURN,
      },
    ]);
    expect([...overlay.hidden]).toEqual([CARD]);
  });

  it("forgets a settled steer, for good, and the landing holds the card", () => {
    const reading = verbSaid({
      at: after({ ms: 120_000 }),
      verdict: {
        action: { atIso: after({ ms: 90_000 }), kind: "intake-mark", markKind: "card", witness: "ask:a-steer" },
        kind: "settled",
      },
    });
    const overlay = steerOverlay({ held: [steer()], reading, spoken });
    expect(overlay.forgotten).toEqual([TURN]);
    expect(overlay.collapsed).toEqual([]);
    expect([...overlay.hidden]).toEqual([]);
    expect([...overlay.revealed]).toEqual([]);
  });

  it("brings the card back, saying nothing, when the chair's next pass did nothing with it", () => {
    const reading = verbSaid({
      at: after({ ms: 25 * 60_000 }),
      verdict: { kind: "reverted", passFinalisedIso: after({ ms: 21 * 60_000 }), reason: "missed-pass" },
    });
    const overlay = steerOverlay({ held: [steer()], reading, spoken });
    expect(overlay.cameBack.map((one) => one.turnId)).toEqual([TURN]);
    expect(overlay.collapsed).toEqual([]);
    // Its own landing still holds the card, so the steer is kept until that is lifted.
    expect(overlay.forgotten).toEqual([]);
    expect([...overlay.revealed]).toEqual([CARD]);
    expect([...overlay.hidden]).toEqual([]);
    expect([...overlay.stillHeld]).toEqual([]);
  });

  it("does not draw a card another steer still holds, though this one came back", () => {
    const reading = verbSaid({ at: after({ ms: 50 * 60_000 }), verdict: { kind: "reverted", reason: "chair-down" } });
    const overlay = steerOverlay({
      held: [steer()],
      reading,
      spoken: landedOn({ also: true }),
    });
    expect(overlay.cameBack.length).toBe(1);
    expect([...overlay.revealed]).toEqual([]);
    expect([...overlay.stillHeld]).toEqual([CARD]);
  });

  it("is never settled by a same-turn row on another card", () => {
    const reading = verbSaid({
      at: after({ ms: 10 * 60_000 }),
      verdict: {
        action: { atIso: after({ ms: 90_000 }), kind: "intake-mark", markKind: "card", witness: "ask:a-steer" },
        kind: "settled",
      },
    });
    const elsewhere = steer({ cardKey: "pr:acme.widgets.1780" });
    const overlay = steerOverlay({ held: [elsewhere], reading, spoken });
    // The settling row is on another card, so this steer comes back rather than settling.
    expect(overlay.cameBack.map((one) => one.cardKey)).toEqual(["pr:acme.widgets.1780"]);
  });

  it("keeps a kept card off the list while another landing still holds it", () => {
    const reading = verbSaid({
      at: after({ ms: 10 * 60_000 }),
      verdict: { kind: "reverted", reason: "kept", why: "answered in thread" },
    });
    const overlay = steerOverlay({
      held: [steer()],
      reading,
      spoken: landedOn({ also: true }),
    });
    expect(overlay.cameBack.map((one) => one.turnId)).toEqual([TURN]);
    expect([...overlay.stillHeld]).toEqual([CARD]);
  });

  it("brings a refused relay's card back at once, drawing nothing about the refusal", () => {
    const overlay = steerOverlay({
      held: [steer({ detail: "refused: the owner had not spoken since the last relay", outcome: "refused" })],
      reading: { phase: "loading" },
      spoken,
    });
    expect(overlay.cameBack.map((one) => one.turnId)).toEqual([TURN]);
    expect(overlay.collapsed).toEqual([]);
    expect([...overlay.hidden]).toEqual([]);
    expect([...overlay.revealed]).toEqual([CARD]);
  });

  it("forgets a refused relay at once when no landing holds its card", () => {
    const overlay = steerOverlay({
      held: [steer({ detail: "the gate refused it", outcome: "refused" })],
      reading: { phase: "loading" },
      spoken: ready({
        at: SENT,
        value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
      }),
    });
    expect(overlay.forgotten).toEqual([TURN]);
  });

  it("forgets a refused relay sent before the window, though another landing still holds its card", () => {
    const later = ready<SteeredCardsReading>({
      at: after({ ms: 8 * 24 * 60 * 60_000 }),
      value: { sinceIso: after({ ms: 24 * 60 * 60_000 }), steers: [], undecodedRelays: 0 },
    });
    const overlay = steerOverlay({
      held: [steer({ detail: "the gate refused it", outcome: "refused" })],
      reading: later,
      spoken: landedOn({ also: true }),
    });
    expect(overlay.forgotten).toEqual([TURN]);
    expect(overlay.cameBack).toEqual([]);
  });

  it("brings it back when a reading taken after the grace has no row for it", () => {
    const empty = ready<SteeredCardsReading>({
      at: after({ ms: REGISTER_GRACE_MS }),
      value: { sinceIso: SINCE, steers: [], undecodedRelays: 0 },
    });
    const overlay = steerOverlay({ held: [steer()], reading: empty, spoken });
    expect(overlay.cameBack.map((one) => one.turnId)).toEqual([TURN]);
    const early = ready<SteeredCardsReading>({
      at: after({ ms: REGISTER_GRACE_MS - 1 }),
      value: { sinceIso: SINCE, steers: [], undecodedRelays: 0 },
    });
    expect(steerOverlay({ held: [steer()], reading: early, spoken }).cameBack).toEqual([]);
  });

  it("forgets a steer sent before the window the verb judges, never calling it unrecorded", () => {
    const later = ready<SteeredCardsReading>({
      at: after({ ms: 8 * 24 * 60 * 60_000 }),
      value: { sinceIso: after({ ms: 24 * 60 * 60_000 }), steers: [], undecodedRelays: 0 },
    });
    const overlay = steerOverlay({ held: [steer()], reading: later, spoken });
    expect(overlay.cameBack).toEqual([]);
    expect(overlay.collapsed).toEqual([]);
    expect(overlay.forgotten).toEqual([TURN]);
  });

  it("keeps it collapsed when no row is found but a relay line did not read", () => {
    const partial = ready<SteeredCardsReading>({
      at: after({ ms: REGISTER_GRACE_MS }),
      value: { sinceIso: SINCE, steers: [], undecodedRelays: 1 },
    });
    const overlay = steerOverlay({ held: [steer()], reading: partial, spoken });
    expect(overlay.cameBack).toEqual([]);
    expect(overlay.collapsed.map((row) => row.turnId)).toEqual([TURN]);
  });

  it("keeps the card collapsed while the reading fails, never re-asking (an owner steer)", () => {
    const failed = { phase: "not-measured", why: "the verb exited 1" } as const;
    const overlay = steerOverlay({ held: [steer()], reading: failed, spoken });
    expect(overlay.cameBack).toEqual([]);
    expect(overlay.collapsed.map((row) => row.turnId)).toEqual([TURN]);
    expect([...overlay.hidden]).toEqual([CARD]);
  });

  it("keeps a verdict the verb could not reach collapsed, however long it lasts", () => {
    const unread = { kind: "unread", why: "the run journal did not read" };
    const late = verbSaid({ at: after({ ms: 6 * 60 * 60_000 }), verdict: unread });
    const overlay = steerOverlay({ held: [steer()], reading: late, spoken });
    expect(overlay.cameBack).toEqual([]);
    expect(overlay.collapsed.map((row) => row.turnId)).toEqual([TURN]);
  });

  it("keeps a card collapsed under the owner's newer steer, though an older one on it came back", () => {
    const reading = verbSaid({ at: after({ ms: 50 * 60_000 }), verdict: { kind: "reverted", reason: "chair-down" } });
    const waiting = steer({ outcome: "sending", sentAtIso: after({ ms: 50 * 60_000 }), turnId: "second" });
    const overlay = steerOverlay({ held: [steer(), waiting], reading, spoken });
    expect([...overlay.hidden]).toEqual([CARD]);
    expect([...overlay.revealed]).toEqual([]);
    expect([...overlay.stillHeld]).toEqual([CARD]);
    expect(overlay.collapsed.map((row) => row.turnId)).toEqual(["second"]);
    expect(overlay.cameBack.map((one) => one.turnId)).toEqual([TURN]);
  });

  it("picks the owner's newer steer by when they spoke, not by where storage held it", () => {
    const reading = verbSaid({ at: after({ ms: 50 * 60_000 }), verdict: { kind: "reverted", reason: "chair-down" } });
    const waiting = steer({ outcome: "sending", sentAtIso: after({ ms: 50 * 60_000 }), turnId: "second" });
    const overlay = steerOverlay({ held: [waiting, steer()], reading, spoken });
    expect([...overlay.hidden]).toEqual([CARD]);
    expect([...overlay.revealed]).toEqual([]);
  });

  it("lets the steer that came back win a tie in either order, never hiding the card on storage order", () => {
    const unlanded = ready({
      at: SENT,
      value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
    });
    const refused = steer({ detail: "the gate refused it", outcome: "refused", turnId: "refused" });
    const sending = steer({ outcome: "sending", turnId: "sending" });
    const loading: LiveState<SteeredCardsReading> = { phase: "loading" };
    const forward = steerOverlay({ held: [refused, sending], reading: loading, spoken: unlanded });
    const backward = steerOverlay({ held: [sending, refused], reading: loading, spoken: unlanded });
    expect([[...forward.hidden], [...forward.revealed]]).toEqual([[], [CARD]]);
    expect([[...backward.hidden], [...backward.revealed]]).toEqual([[], [CARD]]);
    expect(forward.collapsed.map((row) => row.turnId)).toEqual(["sending"]);
  });

  it("lets the owner's newest steer that came back put the card in the list, the older one still collapsed", () => {
    const reading = verbSaid({ at: after({ ms: 60_000 }), verdict: { kind: "awaiting" } });
    const refused = steer({
      detail: "the gate refused it",
      outcome: "refused",
      sentAtIso: after({ ms: 30_000 }),
      turnId: "second",
    });
    const unlanded = ready({
      at: SENT,
      value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
    });
    const overlay = steerOverlay({ held: [refused, steer()], reading, spoken: unlanded });
    expect([...overlay.hidden]).toEqual([]);
    expect([...overlay.revealed]).toEqual([CARD]);
    expect(overlay.collapsed.map((row) => row.turnId)).toEqual([TURN]);
    expect(overlay.cameBack.map((one) => one.turnId)).toEqual(["second"]);
  });

  it("keeps a park still awaiting its landing in collapsed but hides nothing, whichever park it is", () => {
    const overlays = (["park-working-session", "park-slow-triage"] as const).map((triageVerdict) =>
      steerOverlay({
        held: [steer({ outcome: "sending", triageVerdict })],
        reading: { phase: "loading" },
        spoken,
      }),
    );
    expect(overlays.map((overlay) => [...overlay.hidden])).toEqual([[], []]);
    expect(overlays.map((overlay) => overlay.collapsed.map((row) => row.turnId))).toEqual([[TURN], [TURN]]);
  });

  it("keeps a park the verb says is awaiting collapsed, carrying its relay row, and hides nothing", () => {
    const reading = verbSaid({ at: after({ ms: 60_000 }), verdict: { kind: "awaiting" } });
    const overlay = steerOverlay({ held: [steer({ triageVerdict: "park-working-session" })], reading, spoken });
    expect(overlay.collapsed.map((row) => [row.turnId, row.relaySlug])).toEqual([[TURN, SLUG]]);
    expect([...overlay.hidden]).toEqual([]);
  });

  it("hides the card under every non-park triage verdict still awaiting", () => {
    const overlays = (["send-it", "rewrite", "needs-more-info", "drop"] as const).map((triageVerdict) =>
      steerOverlay({
        held: [steer({ outcome: "sending", triageVerdict })],
        reading: { phase: "loading" },
        spoken,
      }),
    );
    expect(overlays.map((overlay) => [...overlay.hidden])).toEqual([[CARD], [CARD], [CARD], [CARD]]);
  });

  it("hides the card under a newer plain steer although an older park on it hides nothing", () => {
    const newer = steer({ outcome: "sending", sentAtIso: after({ ms: 30_000 }), turnId: "second" });
    const overlay = steerOverlay({
      held: [steer({ outcome: "sending", triageVerdict: "park-slow-triage" }), newer],
      reading: { phase: "loading" },
      spoken,
    });
    expect([...overlay.hidden]).toEqual([CARD]);
    expect(overlay.collapsed.map((row) => row.turnId)).toEqual([TURN, "second"]);
  });
});

describe("landingVerdict — a card the owner's triage ruling parked", () => {
  const none: ReadonlySet<string> = new Set();
  const verdictOf = ({
    landings,
    inFlight = none,
    row = { key: CARD },
    steers = NO_STEERS,
  }: {
    landings: readonly CardLanding[] | undefined;
    inFlight?: ReadonlySet<string>;
    row?: { key: string; landingFloorIso?: string };
    steers?: Pick<typeof NO_STEERS, "hidden" | "revealed">;
  }) => landingVerdict({ inFlight, landings, moves: undefined, row, steers });

  // Eighteen landings, the first a greeting, once hid a Twilio step.
  it("draws a hand step whatever landing or waiting steer would hold it, and holds the same landing off any other card", () => {
    const hand = "hand:twilio-and-knock-read-only-keys";
    const steers = { hidden: new Set([hand, CARD]), revealed: new Set<string>() };
    const landings = [landing({ cardKey: hand, words: "Uh, good morning" })];
    expect([
      verdictOf({ landings, row: { key: hand } }),
      verdictOf({ landings: undefined, row: { key: hand }, steers }),
      verdictOf({ landings: [landing({ words: "Uh, good morning" })] }),
      verdictOf({ landings: undefined, steers }),
    ]).toEqual([{ kind: "shown" }, { kind: "shown" }, { kind: "hidden" }, { kind: "hidden" }]);
  });

  it("draws a staged import question whatever landing or waiting steer would hold it: only import-resolve settles one", () => {
    const question = "import:import-q-00000000000000a1";
    const steers = { hidden: new Set([question]), revealed: new Set<string>() };
    const landings = [landing({ cardKey: question, words: "keep the current one" })];
    expect([
      verdictOf({ landings, row: { key: question } }),
      verdictOf({ landings: undefined, row: { key: question }, steers }),
    ]).toEqual([{ kind: "shown" }, { kind: "shown" }]);
  });

  it("draws it parked since the instant the owner decided, carrying the whole ruling", () => {
    expect(verdictOf({ landings: [landing({ atIso: after({ ms: 5000 }), triage: PARK })] })).toEqual({
      kind: "parked",
      sinceIso: SENT,
      triage: { label: "waiting-on-them", verdict: "park-working-session" },
    });
  });

  it("draws a park to the slow triage hour with no label parked too, carrying no label", () => {
    const verdict = verdictOf({ landings: [landing({ triage: { verdict: "park-slow-triage" } })] });
    expect(verdict).toStrictEqual({ kind: "parked", sinceIso: SENT, triage: { verdict: "park-slow-triage" } });
  });

  it("still hides the card for every verdict that is not a park, and for a landing with no ruling", () => {
    const verdicts = (["send-it", "rewrite", "needs-more-info", "drop"] as const).map((verdict) =>
      verdictOf({ landings: [landing({ triage: { verdict } })] }),
    );
    expect(verdicts).toEqual([{ kind: "hidden" }, { kind: "hidden" }, { kind: "hidden" }, { kind: "hidden" }]);
    expect(verdictOf({ landings: [landing()] })).toEqual({ kind: "hidden" });
  });

  it("follows the owner's newest landing: an older park under a newer send-it hides, an older send-it under a park parks", () => {
    const park = landing({ decidedIso: SENT, triage: PARK });
    const send = landing({ anchor: "talk:later", decidedIso: after({ ms: 60_000 }), triage: { verdict: "send-it" } });
    expect(verdictOf({ landings: [park, send] })).toEqual({ kind: "hidden" });
    const sendFirst = { ...send, decidedIso: after({ ms: -60_000 }) };
    expect(verdictOf({ landings: [sendFirst, park] })).toEqual({ kind: "parked", sinceIso: SENT, triage: PARK });
  });

  it("draws a park parked even while a session runs its row, and any other ruling as a recut carrying it", () => {
    const inFlight = new Set([SLUG]);
    expect(verdictOf({ inFlight, landings: [landing({ triage: PARK })] })).toStrictEqual({
      kind: "parked",
      sinceIso: SENT,
      triage: PARK,
    });
    expect(verdictOf({ inFlight, landings: [landing({ triage: { verdict: "rewrite" } })] })).toStrictEqual({
      kind: "recut",
      seat: SLUG,
      triage: { verdict: "rewrite" },
    });
  });

  it("draws a recut with no triage key when the landing carried no ruling", () => {
    expect(verdictOf({ inFlight: new Set([SLUG]), landings: [landing()] })).toStrictEqual({
      kind: "recut",
      seat: SLUG,
    });
  });

  it("draws a park parked over a steer still collapsed and one that came back alike", () => {
    const landings = [landing({ triage: PARK })];
    const hidden = { hidden: new Set([CARD]), revealed: new Set<string>() };
    const revealed = { hidden: new Set<string>(), revealed: new Set([CARD]) };
    const parked = { kind: "parked", sinceIso: SENT, triage: PARK };
    expect([verdictOf({ landings, steers: hidden }), verdictOf({ landings, steers: revealed })]).toEqual([
      parked,
      parked,
    ]);
  });

  // A plain steer spoken before the park may have a relay that reached the page after the park landed. A park
  // older than the row's floor holds nothing, so the waiting steer hides the card as it would any other.
  it("draws a park parked under a waiting plain steer whenever its relay arrived, until a newer landing or the row's floor", () => {
    const verdictUnder = ({
      landings,
      row = { key: CARD },
    }: {
      landings: readonly CardLanding[];
      row?: { key: string; landingFloorIso?: string };
    }) => {
      const steers = steerOverlay({
        held: [steer({ outcome: "sending", turnId: "plain" })],
        reading: { phase: "loading" },
        spoken: readingOf({ landings }),
      });
      return verdictOf({ landings, row, steers }).kind;
    };
    const parkAfter = landing({ decidedIso: after({ ms: 60_000 }), triage: PARK });
    const parkSameInstant = landing({ decidedIso: after({ ms: 0 }), triage: PARK });
    const parkBefore = landing({ decidedIso: after({ ms: -60_000 }), triage: PARK });
    const plainAfterPark = landing({
      anchor: "talk:later",
      decidedIso: after({ ms: 120_000 }),
      workSlug: "talk-later",
    });
    const floored = { key: CARD, landingFloorIso: after({ ms: 90_000 }) };
    expect([
      verdictUnder({ landings: [parkAfter] }),
      verdictUnder({ landings: [parkSameInstant] }),
      verdictUnder({ landings: [parkBefore] }),
      verdictUnder({ landings: [parkAfter, plainAfterPark] }),
      verdictUnder({ landings: [parkAfter], row: floored }),
      verdictUnder({ landings: [] }),
    ]).toEqual(["parked", "parked", "parked", "hidden", "hidden", "hidden"]);
  });

  it("draws the card plainly when no landing holds it: none, or a park older than the row's floor", () => {
    expect(verdictOf({ landings: undefined })).toEqual({ kind: "shown" });
    const floored = { key: CARD, landingFloorIso: after({ ms: 1 }) };
    expect(verdictOf({ landings: [landing({ triage: PARK })], row: floored })).toEqual({ kind: "shown" });
  });
});

describe("parkedRow — a row the owner's ruling put off", () => {
  it("puts a row with no deferral off since the owner parked it and marks it with the ruling", () => {
    expect(parkedRow<MarkedRow & { key: string }>({ row: { key: CARD }, sinceIso: SENT, triage: PARK })).toEqual({
      deferredIso: SENT,
      key: CARD,
      triage: PARK,
    });
  });

  it("keeps an earlier deferral, so parking a card the owner had put off never moves it up, and still marks it", () => {
    const earlier = after({ ms: -60_000 });
    expect(parkedRow({ row: { deferredIso: earlier, key: CARD }, sinceIso: SENT, triage: PARK })).toEqual({
      deferredIso: earlier,
      key: CARD,
      triage: PARK,
    });
  });

  it("keeps a deferral at the very instant the owner parked it", () => {
    expect(parkedRow({ row: { deferredIso: SENT, key: CARD }, sinceIso: SENT, triage: PARK }).deferredIso).toBe(SENT);
  });

  it("replaces a later deferral with the earlier instant the owner parked it", () => {
    const later = after({ ms: 60_000 });
    expect(parkedRow({ row: { deferredIso: later, key: CARD }, sinceIso: SENT, triage: PARK })).toEqual({
      deferredIso: SENT,
      key: CARD,
      triage: PARK,
    });
  });

  it("replaces the ruling a row already carried", () => {
    const row = { key: CARD, triage: { verdict: "send-it" } as TriageMark };
    expect(parkedRow({ row, sinceIso: SENT, triage: PARK }).triage).toEqual(PARK);
  });
});

describe("spokenGap — what the page says it did not read", () => {
  const LANDING_GAP = "1 landing line(s) did not read, so a card you steered may still show";
  const RELAY_GAP = "2 relay line(s) did not read, so a card you parked may not show as parked";

  const DRAWN = new Set([CARD]);

  it("says nothing when every line read", () => {
    expect(spokenGap({ cardKeys: DRAWN, spoken: readingOf({ landings: [] }) })).toBe(undefined);
  });

  it("names the landing gap alone for a line recording no card key, on any surface", () => {
    const spoken = readingOf({ landings: [], unreadableLines: [gapLine({ lineNumber: 4 })] });
    expect(spokenGap({ cardKeys: DRAWN, spoken })).toBe(LANDING_GAP);
    expect(spokenGap({ cardKeys: new Set(), spoken })).toBe(LANDING_GAP);
  });

  it("names a line recording a card the surface draws, and only that one", () => {
    const spoken = readingOf({
      landings: [],
      unreadableLines: [gapLine({ cardKey: CARD, lineNumber: 1 }), gapLine({ cardKey: "ask:abc-2", lineNumber: 2 })],
    });
    expect(spokenGap({ cardKeys: DRAWN, spoken })).toBe(LANDING_GAP);
  });

  // The measured regression: a one-off sanitiser left 18 lines that would not read, 13 with a space in their card key
  // and 5 about real cards no longer drawn, and the voice said "some recorded steers were unreadable" over a card none
  // of them was about.
  it("says nothing for lines about cards the surface does not draw, or recording a key that is no card key", () => {
    const unreadableLines = [
      ...Array.from({ length: 13 }, (_, index) =>
        gapLine({ cardKey: `ask:acme-Fixture 1-${String(index)}`, lineNumber: index + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        gapLine({ cardKey: `ask:abc-${String(index)}`, lineNumber: index + 14 }),
      ),
    ];
    expect(unreadableLines).toHaveLength(18);
    const spoken = readingOf({ landings: [], unreadableLines });
    expect(spokenGap({ cardKeys: DRAWN, spoken })).toBe(undefined);
    expect(spokenGap({ cardKeys: new Set(["ask:acme-Fixture 1-0"]), spoken })).toBe(undefined);
  });

  it("names the relay gap alone when only relay lines did not read, whatever the surface draws", () => {
    expect(spokenGap({ cardKeys: new Set(), spoken: readingOf({ landings: [], triageUnreadable: 2 }) })).toBe(
      RELAY_GAP,
    );
  });

  it("names both, the landing gap first, joined with a semicolon", () => {
    const spoken = readingOf({ landings: [], triageUnreadable: 2, unreadableLines: [gapLine({ lineNumber: 1 })] });
    expect(spokenGap({ cardKeys: DRAWN, spoken })).toBe(`${LANDING_GAP}; ${RELAY_GAP}`);
  });

  it("says why a reading that never arrived did not", () => {
    expect(spokenGap({ cardKeys: DRAWN, spoken: { phase: "not-measured", why: "the verb exited 1" } })).toBe(
      "the verb exited 1",
    );
  });
});

describe("unlandedRows — the overlay laid over the landings", () => {
  const rows = [{ key: CARD }, { key: "pr:acme.widgets.1780" }];

  it("hides a collapsed card before its landing has been read", () => {
    const steers = { hidden: new Set([CARD]), revealed: new Set<string>() };
    expect(unlandedRows({ rows, spoken: { phase: "loading" }, steers })).toEqual([{ key: "pr:acme.widgets.1780" }]);
  });

  it("draws a card a steer gave back though a landing holds it", () => {
    const steers = { hidden: new Set<string>(), revealed: new Set([CARD]) };
    expect(unlandedRows({ rows, spoken: landedOn(), steers })).toEqual(rows);
    expect(unlandedRows({ rows, spoken: landedOn(), steers: NO_STEERS })).toEqual([{ key: "pr:acme.widgets.1780" }]);
  });

  it("draws a card whose news is newer than the owner's landing, and hides it once they speak past that news", () => {
    // `landedOn()` lands the owner's words at SENT: news one millisecond later is news they never saw.
    const newsAfter = { key: CARD, landingFloorIso: new Date(Date.parse(SENT) + 1).toISOString() };
    const newsBefore = { key: CARD, landingFloorIso: SENT };
    expect(unlandedRows({ rows: [newsAfter], spoken: landedOn(), steers: NO_STEERS })).toEqual([newsAfter]);
    expect(unlandedRows({ rows: [newsBefore], spoken: landedOn(), steers: NO_STEERS })).toEqual([]);
    const steers = { hidden: new Set([CARD]), revealed: new Set<string>() };
    expect(unlandedRows({ rows: [newsAfter], spoken: landedOn(), steers })).toEqual([]);
  });

  it("keeps a card the owner parked, put off since they decided and marked with the ruling, in the voice's list", () => {
    const spoken = readingOf({ landings: [landing({ triage: PARK })] });
    expect(unlandedRows({ rows, spoken, steers: NO_STEERS })).toEqual([
      { deferredIso: SENT, key: CARD, triage: PARK },
      { key: "pr:acme.widgets.1780" },
    ]);
  });

  it("keeps a parked card's earlier deferral, and still drops one a non-park ruling landed on", () => {
    const earlier = after({ ms: -60_000 });
    const parked = readingOf({ landings: [landing({ triage: PARK })] });
    expect(unlandedRows({ rows: [{ deferredIso: earlier, key: CARD }], spoken: parked, steers: NO_STEERS })).toEqual([
      { deferredIso: earlier, key: CARD, triage: PARK },
    ]);
    const sent = readingOf({ landings: [landing({ triage: { verdict: "send-it" } })] });
    expect(unlandedRows({ rows, spoken: sent, steers: NO_STEERS })).toEqual([{ key: "pr:acme.widgets.1780" }]);
  });
});

describe("parseStoredSteers and keptSteers", () => {
  it("round-trips the steers, and refuses the whole list when one entry is off shape", () => {
    expect(parseStoredSteers({ raw: JSON.stringify([steer()]) })).toEqual([steer()]);
    expect(parseStoredSteers({ raw: null })).toEqual([]);
    expect(parseStoredSteers({ raw: JSON.stringify([steer(), { turnId: "x" }]) })).toBe(undefined);
    expect(parseStoredSteers({ raw: "not json" })).toBe(undefined);
  });

  it("round-trips a steer that carried a triage verdict, and reads one stored without it", () => {
    const parked = steer({ triageVerdict: "park-working-session" });
    expect(parseStoredSteers({ raw: JSON.stringify([parked]) })).toEqual([parked]);
    expect(parseStoredSteers({ raw: JSON.stringify([steer()]) })).toStrictEqual([steer()]);
  });

  it("refuses the whole list when a steer's triage verdict is present and is not a verdict", () => {
    expect(
      parseStoredSteers({ raw: JSON.stringify([steer(), { ...steer({ turnId: "x" }), triageVerdict: "park" }]) }),
    ).toBe(undefined);
    expect(parseStoredSteers({ raw: JSON.stringify([{ ...steer(), triageVerdict: 3 }]) })).toBe(undefined);
    expect(parseStoredSteers({ raw: JSON.stringify([{ ...steer(), triageVerdict: null }]) })).toBe(undefined);
  });

  it("still reads a steer a window stored with the acknowledgement it no longer keeps", () => {
    expect(parseStoredSteers({ raw: JSON.stringify([{ ...steer(), acknowledged: true }]) })).toEqual([steer()]);
  });

  it("refuses a list repeating one turn, so forgetting it never drops another card's steer", () => {
    const other = steer({ cardKey: "pr:acme.widgets.1780" });
    expect(parseStoredSteers({ raw: JSON.stringify([steer(), other]) })).toBe(undefined);
    expect(parseStoredSteers({ raw: JSON.stringify([steer(), { ...other, turnId: "second" }]) })!.length).toBe(2);
  });

  it("forgets only the steers the overlay forgot, however many or old the rest", () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      steer({ sentAtIso: after({ ms: -30 * 24 * 60 * 60_000 }), turnId: `old-${String(index)}` }),
    );
    const kept = keptSteers({ forgotten: ["old-3"], held: [...many, steer()] });
    expect(kept.length).toBe(80);
    expect(kept.map((held) => held.turnId).includes("old-3")).toBe(false);
    expect(kept.at(-1)).toEqual(steer());
  });
});

describe("a steer that came back", () => {
  const missed = verbSaid({
    at: after({ ms: 25 * 60_000 }),
    verdict: { kind: "reverted", passFinalisedIso: after({ ms: 21 * 60_000 }), reason: "missed-pass" },
  });

  it("is held while its landing still holds the card, so the card stays back on the list", () => {
    const overlay = steerOverlay({
      held: [steer()],
      reading: missed,
      spoken: landedOn(),
    });
    expect(overlay.forgotten).toEqual([]);
    expect(overlay.collapsed).toEqual([]);
    expect([...overlay.revealed]).toEqual([CARD]);
  });

  it("puts the card back when the only landing holding it carries this relay as a later segment", () => {
    const earlier = {
      anchor: "talk:earlier",
      atIso: SENT,
      cardKey: CARD,
      decidedIso: SENT,
      laterAnchors: [`talk:${TURN}`],
      source: "relay",
      words: "merge it",
      workSlug: "talk-earlier",
    } as const;
    const overlay = steerOverlay({
      held: [steer()],
      reading: missed,
      spoken: ready({
        at: SENT,
        value: { landings: [earlier], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
      }),
    });
    expect([...overlay.revealed]).toEqual([CARD]);
    expect([...overlay.stillHeld]).toEqual([]);
  });

  it("keeps the card held when another relay's landing shares this relay's work row", () => {
    const own = {
      anchor: `talk:${TURN}`,
      atIso: SENT,
      cardKey: CARD,
      decidedIso: SENT,
      source: "relay",
      words: "merge it",
      workSlug: SLUG,
    } as const;
    const sharing = { ...own, anchor: "talk:other", words: "and ping Ari" };
    const overlay = steerOverlay({
      held: [steer()],
      reading: missed,
      spoken: ready({
        at: SENT,
        value: { landings: [own, sharing], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
      }),
    });
    expect([...overlay.revealed]).toEqual([]);
    expect([...overlay.stillHeld]).toEqual([CARD]);
  });

  it("is forgotten once no landing holds its card", () => {
    const overlay = steerOverlay({
      held: [steer()],
      reading: missed,
      spoken: ready({
        at: SENT,
        value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
      }),
    });
    expect(overlay.forgotten).toEqual([TURN]);
  });
});

describe("mergedSteers — a window whose storage refused", () => {
  it("keeps a steer only it holds when another window writes without it, its own copy winning", () => {
    const mine = [steer({ outcome: "refused" }), steer({ turnId: "only-here" })];
    const stored = [steer(), steer({ turnId: "from-there" })];
    expect(mergedSteers({ mine, stored })).toEqual([
      steer({ outcome: "refused" }),
      steer({ turnId: "only-here" }),
      steer({ turnId: "from-there" }),
    ]);
    expect(mergedSteers({ mine, stored: [] })).toEqual(mine);
  });
});

describe("mutationBase — what a change starts from", () => {
  const mine = [steer({ turnId: "only-here" })];
  const stored = [steer({ turnId: "from-there" })];

  it("merges in a window whose last write was refused, so the other window's steer is never overwritten", () => {
    expect(mutationBase({ keeping: "this-window", mine, stored })).toEqual([
      steer({ turnId: "only-here" }),
      steer({ turnId: "from-there" }),
    ]);
  });

  it("adopts storage in a window whose writes reach it, and keeps its own copy when storage does not read", () => {
    expect(mutationBase({ keeping: "shared", mine, stored })).toEqual(stored);
    expect(mutationBase({ keeping: "this-window", mine, stored: undefined })).toEqual(mine);
  });
});
