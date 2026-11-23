/*
 * Which voice relays the sweep still owes a look. The incident: five relays registered their row,
 * failed the cmux hop, and nothing made the chair read them. Each case pins one thing that does, or does not,
 * count as somebody having acted — `status: ready` is the trap.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import {
  type ChairHasRelay,
  HELD_OVERDUE_AFTER_MS,
  malformedHeldInstant,
  type RelayRowEvidence,
  reachedSupervisorChat,
  relayMarkCommand,
  type UndeliveredRelay,
  undeliveredRelays,
  voiceRelayClause,
} from "../../../talk/relayIntake.js";
import type { TurnRecord } from "../../../talk/relayStore.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const ANCHOR = `talk:${TURN}`;
const SLUG = "talk-a00000170000";
const REGISTERED = "2026-09-23T23:22:09.000Z";
/** A day after registration: every held batch is long overdue. */
const NOW = "2026-09-24T23:22:09.000Z";

const FAILED: Delivery = {
  atIso: "2026-09-23T23:22:09.395Z",
  detail: "cmux could not list workspaces: cmux refused the connection: Access denied",
  kind: "failed",
  refusal: "cmux-access-denied",
  via: "direct",
};

/** One registered relay record, overridable field by field. */
const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  about: "",
  anchor: ANCHOR,
  delivery: FAILED,
  digest: "d",
  heard: "",
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: REGISTERED,
  slug: SLUG,
  stagedAtIso: REGISTERED,
  state: "registered",
  turnId: TURN,
  words: "steer the next pass at the talk tab",
  typed: false,
  wordsAlone: false,
  ...over,
});

/** The relay's own row, unsettled and with an empty journal. */
const row = (over: Partial<RelayRowEvidence> = {}): RelayRowEvidence => ({
  anchor: ANCHOR,
  events: [],
  settled: false,
  slug: SLUG,
  ...over,
});

const NONE: ReadonlySet<string> = new Set();

/** A chair that holds no relay, so only the delivery grade and the board decide. */
const NEVER_HELD: ChairHasRelay = () => false;

/** A chair that holds every relay — its line in a chair turn, or the owner's words read through `talk unread`. */
const ALWAYS_HELD: ChairHasRelay = () => true;

const dispatched = ({ atIso }: { atIso: string }): RunEvent => ({
  atIso,
  by: "supervisor",
  kind: "dispatched",
  target: undefined,
});

describe("reachedSupervisorChat", () => {
  it.each([
    ["typed", true],
    ["queued", true],
    ["stranded", false],
    ["unconfirmed", false],
    ["attempting", false],
  ] as const)("reads a %s delivery as reached=%s", (kind, reached) => {
    expect(reachedSupervisorChat({ delivery: { atIso: REGISTERED, detail: "d", kind, via: "direct" } })).toBe(reached);
  });

  it.each(["failed", "skipped"] as const)("reads a %s delivery as not reached", (kind) => {
    expect(
      reachedSupervisorChat({
        delivery: { atIso: REGISTERED, detail: "d", kind, refusal: "courier-unavailable", via: "courier" },
      }),
    ).toBe(false);
  });

  it("reads no delivery at all as not reached", () => {
    expect(reachedSupervisorChat({ delivery: null })).toBe(false);
  });
});

describe("undeliveredRelays", () => {
  it("owes a look at a registered relay whose cmux hop failed and whose row nobody took up — the incident", () => {
    expect(
      undeliveredRelays({
        nowIso: NOW,
        chairHas: NEVER_HELD,
        markedPointers: NONE,
        records: [record()],
        rows: [row()],
      }),
    ).toEqual([
      {
        about: "",
        anchor: ANCHOR,
        delivery: FAILED,
        heard: "",
        registeredAtIso: REGISTERED,
        rowPresent: true,
        slug: SLUG,
      },
    ]);
  });

  it("carries the card the owner was looking at as they said it, so currency files it to that card", () => {
    const [relay] = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record({ about: "hand:try-now-page" })],
      rows: [row()],
    });

    expect(relay!.about).toBe("hand:try-now-page");
  });

  it("carries what the voice heard, and says so when it kept only the tail", () => {
    const heard = "ship the bump once the video lands";
    const [whole] = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record({ heard })],
      rows: [row()],
    });
    const [tail] = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record({ heard, heardTruncated: true })],
      rows: [row()],
    });
    const [unknown] = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record({ heard, heardTruncated: false })],
      rows: [row()],
    });

    expect(whole!.heard).toBe(heard);
    expect(Object.keys(whole!)).not.toContain("heardTruncated");
    expect(tail!.heardTruncated).toBe(true);
    expect(Object.keys(unknown!)).not.toContain("heardTruncated");
  });

  it("owes nothing for a line cmux typed or queued", () => {
    const typed = record({ delivery: { atIso: REGISTERED, detail: "typed", kind: "typed", via: "direct" } });
    const queued = record({ delivery: { atIso: REGISTERED, detail: "queued", kind: "queued", via: "courier" } });

    expect(
      undeliveredRelays({
        nowIso: NOW,
        chairHas: NEVER_HELD,
        markedPointers: NONE,
        records: [typed, queued],
        rows: [row()],
      }),
    ).toEqual([]);
  });

  it("owes a look at a relay that never attempted a delivery", () => {
    const owed = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record({ delivery: null })],
      rows: [row()],
    });

    expect(owed.map((relay) => relay.delivery)).toEqual([null]);
  });

  it("owes nothing for a relay held for the chair's batch until that batch is overdue, then owes a look", () => {
    const held = record({
      delivery: { atIso: REGISTERED, detail: "held", kind: "held", via: "courier" },
    });
    const at = ({ ms }: { ms: number }): string => new Date(Date.parse(REGISTERED) + ms).toISOString();
    const owedAt = ({ ms }: { ms: number }): number =>
      undeliveredRelays({
        chairHas: NEVER_HELD,
        markedPointers: NONE,
        nowIso: at({ ms }),
        records: [held],
        rows: [row()],
      }).length;

    expect(HELD_OVERDUE_AFTER_MS).toBe(12 * 60_000);
    expect([owedAt({ ms: HELD_OVERDUE_AFTER_MS - 1 }), owedAt({ ms: HELD_OVERDUE_AFTER_MS })]).toEqual([0, 1]);
  });

  it("ignores a turn that never reached the board", () => {
    const staged = record({ registeredAtIso: null, state: "registering" });

    expect(
      undeliveredRelays({ nowIso: NOW, chairHas: NEVER_HELD, markedPointers: NONE, records: [staged], rows: [row()] }),
    ).toEqual([]);
  });

  it.each<[string, Delivery]>([
    ["stranded (talk-a00000100000, 19 Oct 2026)", { atIso: REGISTERED, detail: "d", kind: "stranded", via: "direct" }],
    [
      "skipped as composer-busy (talk-a00000870000)",
      { atIso: REGISTERED, detail: "d", kind: "skipped", refusal: "composer-busy", via: "direct" },
    ],
    ["failed", FAILED],
  ])("clears a relay graded %s that the chair holds anyway", (_name, delivery) => {
    const records = [record({ delivery })];
    expect([
      undeliveredRelays({ nowIso: NOW, chairHas: ALWAYS_HELD, markedPointers: NONE, records, rows: [row()] }).length,
      undeliveredRelays({ nowIso: NOW, chairHas: NEVER_HELD, markedPointers: NONE, records, rows: [row()] }).length,
    ]).toEqual([0, 1]);
  });

  it("asks the chair about each relay by its own record", () => {
    const held: ChairHasRelay = ({ record: asked }) => asked.slug === SLUG;
    const other = record({ anchor: "talk:a0000043-0000-4000-8000-000000000046", slug: "talk-a00000430000" });
    const owed = undeliveredRelays({
      nowIso: NOW,
      chairHas: held,
      markedPointers: NONE,
      records: [record(), other],
      rows: [],
    });

    expect(owed.map((relay) => relay.slug)).toEqual(["talk-a00000430000"]);
  });

  it("clears a relay an intake mark names by its talk: anchor", () => {
    expect(
      undeliveredRelays({
        nowIso: NOW,
        chairHas: NEVER_HELD,
        markedPointers: new Set([ANCHOR]),
        records: [record()],
        rows: [row()],
      }),
    ).toEqual([]);
  });

  it("clears a relay whose row was settled, though its status still reads ready", () => {
    expect(
      undeliveredRelays({
        nowIso: NOW,
        chairHas: NEVER_HELD,
        markedPointers: NONE,
        records: [record()],
        rows: [row({ settled: true })],
      }),
    ).toEqual([]);
  });

  it("clears a relay whose row was dispatched at or after it registered", () => {
    const rows = [row({ events: [dispatched({ atIso: REGISTERED })] })];

    expect(
      undeliveredRelays({ nowIso: NOW, chairHas: NEVER_HELD, markedPointers: NONE, records: [record()], rows }),
    ).toEqual([]);
  });

  it("does not clear on a dispatch from BEFORE the relay registered", () => {
    const rows = [row({ events: [dispatched({ atIso: "2026-09-23T23:00:00.000Z" })] })];

    expect(
      undeliveredRelays({ nowIso: NOW, chairHas: NEVER_HELD, markedPointers: NONE, records: [record()], rows }).map(
        (r) => r.slug,
      ),
    ).toEqual([SLUG]);
  });

  it("does not clear on a passive event — a probe can happen to a row nobody is working", () => {
    const probed: RunEvent = { atIso: "2026-09-24T00:00:00.000Z", failed: 1, kind: "probed", passed: 0 };

    expect(
      undeliveredRelays({
        nowIso: NOW,
        chairHas: NEVER_HELD,
        markedPointers: NONE,
        records: [record()],
        rows: [row({ events: [probed] })],
      }).map((relay) => relay.slug),
    ).toEqual([SLUG]);
  });

  it("reports a relay with no row as rowPresent: false, never as acknowledged", () => {
    const owed = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record()],
      rows: [],
    });

    expect(owed.map((relay) => relay.rowPresent)).toEqual([false]);
  });

  it("does not let a same-slug row whose anchor names another turn clear it, even settled", () => {
    const other = row({ anchor: "talk:a0000043-0000-4000-8000-000000000046", settled: true });
    const owed = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record()],
      rows: [other],
    });

    expect(owed.map((relay) => relay.rowPresent)).toEqual([false]);
  });

  it("clears it off its own settled row even when a later same-slug row names another turn", () => {
    const own = row({ settled: true });
    const other = row({ anchor: "talk:a0000043-0000-4000-8000-000000000046", settled: false });
    const owed = undeliveredRelays({
      nowIso: NOW,
      chairHas: NEVER_HELD,
      markedPointers: NONE,
      records: [record()],
      rows: [own, other],
    });

    expect(owed).toEqual([]);
  });
});

/** An owed relay with a given slug. */
const owedRelay = ({ slug }: { slug: string }): UndeliveredRelay => ({
  about: "",
  anchor: ANCHOR,
  delivery: FAILED,
  heard: "",
  registeredAtIso: REGISTERED,
  rowPresent: true,
  slug,
});

describe("malformedHeldInstant", () => {
  it("says which relay is held at an instant that does not parse, rather than judging it overdue", () => {
    const bad = record({ delivery: { atIso: "not-an-instant", detail: "held", kind: "held", via: "courier" } });

    expect(malformedHeldInstant({ records: [bad] })).toBe(
      `relay ${bad.turnId} is held at "not-an-instant", which is not an instant`,
    );
  });

  it("passes held relays whose instants parse, and deliveries that are not held", () => {
    const held = record({ delivery: { atIso: REGISTERED, detail: "held", kind: "held", via: "courier" } });

    expect(malformedHeldInstant({ records: [held, record({}), record({ delivery: null })] })).toBe(undefined);
  });
});

describe("voiceRelayClause", () => {
  it("is empty when nothing is owed, so a clean install's intake line reads as it always did", () => {
    expect(voiceRelayClause({ report: { kind: "read", relays: [] } })).toBe("");
  });

  it("names every owed relay up to five", () => {
    expect(
      voiceRelayClause({
        report: { kind: "read", relays: [owedRelay({ slug: "talk-a" }), owedRelay({ slug: "talk-b" })] },
      }),
    ).toBe(
      "2 voice relay(s) never reached your chat and nothing has acted on them: talk-a, talk-b — the owner's word; read " +
        "each with slopweaver talk log.",
    );
  });

  it("names five and counts the rest", () => {
    const relays = ["a", "b", "c", "d", "e", "f", "g"].map((id) => owedRelay({ slug: `talk-${id}` }));

    expect(voiceRelayClause({ report: { kind: "read", relays } })).toBe(
      "7 voice relay(s) never reached your chat and nothing has acted on them: talk-a, talk-b, talk-c, talk-d, " +
        "talk-e, and 2 more — the owner's word; read each with slopweaver talk log.",
    );
  });

  it("says the relays could not be read, rather than reading as none", () => {
    expect(voiceRelayClause({ report: { kind: "unavailable", why: "turn file unreadable" } })).toBe(
      "Voice relays unread: turn file unreadable.",
    );
  });
});

describe("relayMarkCommand", () => {
  it("names the relay by its talk: anchor", () => {
    expect(relayMarkCommand({ relay: owedRelay({ slug: SLUG }) })).toBe(
      `slopweaver supervisor intake-mark --turn ${ANCHOR} --as answered|card|no-ask --witness "<what it became>"`,
    );
  });
});
