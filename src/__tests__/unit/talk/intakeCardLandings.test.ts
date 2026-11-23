/**
 * The landings the chair's intake marks prove for a card the voice put in front of the owner:
 * a card turned down by voice over a voice-opened ask, relayed with no card named, so no ledger row was ever written.
 */
import { describe, expect, it } from "vitest";

import type { IntakeMark } from "../../../supervisor/intake.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import type { CardLandedRow, CardLandingRow, CardRestoredRow } from "../../../talk/cardLanding.js";
import {
  activeCardLandingsWithIntake,
  type CallRead,
  deriveIntakeCardLandings,
  markedCallIds,
} from "../../../talk/intakeCardLandings.js";

const CALL = "a0000044-0000-4000-8000-000000000047";
const SEGMENT = "turn_000000000000000000021";
const CARD = "ask:owner-steer-console-call-5a50c50e-01-56z-01";
const RELAY = "talk-a00000280000";
const BEGAN = "2026-10-13T23:36:10.909Z";
const MARKED = "2026-10-13T23:38:42.192Z";
/** Every slug `talk relay`'s receipt ledger carries. */
const RELAYS: ReadonlySet<string> = new Set([RELAY]);

/** One line of the owner's segment, as the page posts it. */
function segment({
  final = true,
  byVoice = true,
  open = CARD,
  text = "that is all from me. I turn this card down",
}: {
  final?: boolean;
  byVoice?: boolean;
  open?: string;
  text?: string;
} = {}): Extract<CallEntry, { kind: "segment" }> {
  const line = {
    atIso: "2026-10-13T23:37:40.000Z",
    beganIso: BEGAN,
    final,
    id: SEGMENT,
    kind: "segment",
    open,
    text,
    who: "owner",
  } as const;
  return byVoice ? { ...line, openBy: "voice" } : line;
}

/** The chair's mark on that turn. */
function mark({
  kind = "answered",
  witness = RELAY,
}: { kind?: IntakeMark["kind"]; witness?: string } = {}): IntakeMark {
  return { byClaudeSessionId: "chair", kind, markedAtIso: MARKED, pointer: `talk-call:${CALL}#${SEGMENT}`, witness };
}

/** One call read whole. */
function calls({ entries }: { entries: readonly CallEntry[] }): ReadonlyMap<string, CallRead> {
  return new Map<string, CallRead>([[CALL, { entries, kind: "read" }]]);
}

const LANDED: CardLandedRow = {
  anchor: `call:${CALL}#${SEGMENT}`,
  atIso: MARKED,
  cardKey: CARD,
  decidedIso: BEGAN,
  kind: "landed",
  source: "intake",
  words: "that is all from me. I turn this card down",
  workSlug: RELAY,
};

describe("deriveIntakeCardLandings — the chair's mark over a voice-opened card", () => {
  it("lands the owner's words on the card the voice had open, with the relay's row as the work", () => {
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment({ final: false, text: "that is all" }), segment()] }),
      ledgerRows: [],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [LANDED] });
  });

  it("keeps the owner's final words when a partial snapshot of the segment arrives after it", () => {
    const latePartial: CallEntry = { ...segment({ final: false, text: "" }), atIso: "2026-10-13T23:37:20.000Z" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment(), latePartial] }),
      ledgerRows: [],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [LANDED] });
  });

  it("lands nothing on a segment whose earliest line is the voice's, whatever a later line claims", () => {
    const voiceFirst: CallEntry = {
      atIso: "2026-10-13T23:36:00.000Z",
      final: false,
      id: SEGMENT,
      kind: "segment",
      text: "",
      who: "voice",
    };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [voiceFirst, segment()] }),
      ledgerRows: [],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [] });
  });

  it("takes no segment the voice began as a sibling, so its ledger landing holds nothing back", () => {
    const other = "turn_VoiceBegan";
    const voiceFirst: CallEntry = {
      atIso: "2026-10-13T23:36:00.000Z",
      final: false,
      id: other,
      kind: "segment",
      text: "",
      who: "voice",
    };
    const laterOwners: CallEntry = { ...segment(), atIso: "2026-10-13T23:38:00.000Z", id: other, kind: "segment" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment(), voiceFirst, laterOwners] }),
      ledgerRows: [{ ...LANDED, anchor: `call:${CALL}#${other}`, source: "transcript" }],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [LANDED] });
  });

  it("names only the calls an acted-on mark points at", () => {
    expect(markedCallIds({ marks: [mark(), mark({ kind: "no-ask" }), { ...mark(), pointer: "talk:abc" }] })).toEqual([
      CALL,
    ]);
  });

  it("lands nothing for a turn the chair answered without a relay — the owner asking, not steering", () => {
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment()] }),
      ledgerRows: [],
      marks: [mark({ witness: "owner-steer-console-call-5a50c50e-01-56z-01" }), mark({ kind: "no-ask" })],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [] });
  });

  it("reads a relay slug only bare, before a colon or before a space, never as the head of a longer token", () => {
    const landsFor = ({ witness }: { witness: string }): number =>
      deriveIntakeCardLandings({
        calls: calls({ entries: [segment()] }),
        ledgerRows: [],
        marks: [mark({ witness })],
        relaySlugs: RELAYS,
      }).landings.length;

    expect([RELAY, `${RELAY}: relayed`, `${RELAY} relayed`].map((witness) => landsFor({ witness }))).toEqual([1, 1, 1]);
    expect([`${RELAY}_extra`, `${RELAY}.x`, `${RELAY}B`, `${RELAY}-x`].map((witness) => landsFor({ witness }))).toEqual(
      [0, 0, 0, 0],
    );
  });

  it("lands nothing over a card the owner opened themselves, which the transcript already lands", () => {
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment({ byVoice: false })] }),
      ledgerRows: [],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived.landings).toEqual([]);
  });

  it("lands nothing over an open that is no card key at all", () => {
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment({ open: "not-a-card" })] }),
      ledgerRows: [],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [] });
  });

  it("lands nothing the ledger already holds for that utterance and card, restored since or not", () => {
    const restored: CardLandingRow = {
      anchor: "talk:restore",
      atIso: "2026-10-14T01:00:00.000Z",
      cardKey: CARD,
      kind: "restored",
      why: "a general remark",
    };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment()] }),
      ledgerRows: [{ ...LANDED, source: "transcript" }, restored],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived.landings).toEqual([]);
  });

  it("lands nothing when the ledger holds the card under a sibling segment of the owner's in the same call", () => {
    const sibling = "turn_Sibling";
    const later: CallEntry = { ...segment(), id: sibling, kind: "segment", who: "owner" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment(), later] }),
      ledgerRows: [{ ...LANDED, anchor: `call:${CALL}#${sibling}`, source: "transcript" }],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [] });
  });

  it("lands one row when two marks name sibling segments of the owner's over the same card, dated by the earlier", () => {
    const sibling = "turn_Sibling";
    const later: CallEntry = { ...segment(), id: sibling, kind: "segment", who: "owner" };
    const second = { ...mark(), markedAtIso: "2026-10-14T00:38:40.000Z", pointer: `talk-call:${CALL}#${sibling}` };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment(), later] }),
      ledgerRows: [],
      marks: [second, mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [LANDED] });
  });

  it("still lands the earliest dated mark when an undated one sits between two siblings", () => {
    const sibling = "turn_Sibling";
    const later: CallEntry = { ...segment(), id: sibling, kind: "segment", who: "owner" };
    const second = { ...mark(), markedAtIso: "2026-10-14T00:38:40.000Z", pointer: `talk-call:${CALL}#${sibling}` };
    const undated = { ...mark(), markedAtIso: "bad" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment(), later] }),
      ledgerRows: [],
      marks: [second, undated, mark()],
      relaySlugs: RELAYS,
    });
    expect(derived.landings).toEqual([LANDED]);
  });

  it("lands from a later relayed mark when an earlier one over the same turn had no relay, which reserves nothing", () => {
    const relayed = { ...mark(), markedAtIso: "2026-10-14T00:38:40.000Z" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment()] }),
      ledgerRows: [],
      marks: [mark({ witness: "owner-question" }), relayed],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({ gaps: [], landings: [{ ...LANDED, atIso: "2026-10-14T00:38:40.000Z" }] });
  });

  it("lands one row for an utterance two marks name, dated by the earlier mark", () => {
    const later = { ...mark({ kind: "card" }), markedAtIso: "2026-10-14T00:38:40.000Z" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment()] }),
      ledgerRows: [],
      marks: [later, mark()],
      relaySlugs: RELAYS,
    });
    expect(derived.landings).toEqual([LANDED]);
  });

  it("lands nothing from a mark whose instant does not parse, which no restore could ever lift", () => {
    const undated = { ...mark(), markedAtIso: "not-an-ISO-instant" };
    const derived = deriveIntakeCardLandings({
      calls: calls({ entries: [segment()] }),
      ledgerRows: [],
      marks: [undated],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({
      gaps: [{ pointer: `talk-call:${CALL}#${SEGMENT}`, why: "the mark's instant not-an-ISO-instant does not parse" }],
      landings: [],
    });
  });

  it("says which mark it could not judge when the call did not read, rather than landing nothing silently", () => {
    const derived = deriveIntakeCardLandings({
      calls: new Map<string, CallRead>([[CALL, { kind: "unread", why: "EACCES" }]]),
      ledgerRows: [],
      marks: [mark()],
      relaySlugs: RELAYS,
    });
    expect(derived).toEqual({
      gaps: [{ pointer: `talk-call:${CALL}#${SEGMENT}`, why: `call ${CALL} did not read: EACCES` }],
      landings: [],
    });
  });
});

describe("activeCardLandingsWithIntake — a restore lifts a derived landing exactly as a ledger one", () => {
  const restoreAt = ({ atIso }: { atIso: string }): CardRestoredRow => ({
    anchor: "talk:restore",
    atIso,
    cardKey: CARD,
    kind: "restored",
    why: "put it back",
  });

  it("keeps a derived landing marked after the card's last restore — the 17564 case, restored at 14:33Z", () => {
    const ledgerRows = [restoreAt({ atIso: "2026-10-13T14:33:35.000Z" })];
    expect(activeCardLandingsWithIntake({ derived: [LANDED], ledgerRows })).toEqual([LANDED]);
  });

  it("lifts a derived landing a card-wide restore follows, and one a kept settle of its relay resolves", () => {
    const restored = [restoreAt({ atIso: "2026-10-14T03:00:00.000Z" })];
    const kept: CardLandingRow = {
      ...restoreAt({ atIso: "2026-10-13T20:00:00.000Z" }),
      disposition: "kept",
      workSlug: RELAY,
    };
    expect(activeCardLandingsWithIntake({ derived: [LANDED], ledgerRows: restored })).toEqual([]);
    expect(activeCardLandingsWithIntake({ derived: [LANDED], ledgerRows: [kept] })).toEqual([]);
  });
});
