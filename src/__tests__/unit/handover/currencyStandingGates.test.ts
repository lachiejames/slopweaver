/**
 * The every-journal half of a card's standing read: a
 * ruling gate in force in ANY run journal is an unfiled entry, and a journal that may hide one is a gap on every card.
 */
import { describe, expect, it } from "vitest";

import { standingSince } from "../../../handover/currencyStanding.js";
import { gatePart } from "../../../handover/currencyStandingGates.js";
import { ledgerLine, type RunEvent } from "../../../handover/ledger.js";

const PLACED = "2026-10-02T09:30:00.000Z";
const NOW = "2026-10-02T12:00:00.000Z";

const gated = ({ appendedIso = PLACED, untilIso }: { appendedIso?: string; untilIso?: string }): RunEvent => ({
  anchor: "transcript:a0000036#a0000064",
  atIso: appendedIso,
  decidedIso: appendedIso,
  gate: { subjects: [], ...(untilIso === undefined ? {} : { untilIso }), verbs: [{ noun: "slack", verb: "post" }] },
  kind: "ruling",
  ruling: "posts go to the owner's DM only",
});

const release = ({ atIso, slug }: { atIso: string; slug: string }): RunEvent => ({
  anchor: "transcript:a0000036#a0000064",
  atIso,
  decidedIso: atIso,
  gateReleases: [`${slug}#${PLACED}`],
  kind: "ruling",
  ruling: "lift the DM-only gate",
});

const textOf = (...events: RunEvent[]): string => events.map((event) => ledgerLine({ event })).join("");

describe("gatePart", () => {
  it("reads a gate in force from a journal no board row claims, filed to no card, one expiring a fraction past the clock included", () => {
    const part = gatePart({
      journals: [
        { kind: "read", slug: "orphan", text: textOf(gated({})) },
        { kind: "read", slug: "lapsed", text: textOf(gated({ untilIso: "2026-10-02T11:00:00.000Z" })) },
        { kind: "read", slug: "just-after", text: textOf(gated({ untilIso: "2026-10-02T12:00:00.0005Z" })) },
      ],
      nowIso: NOW,
    });

    expect(part.entries).toEqual([
      {
        atIso: PLACED,
        pointer: `ruling:orphan#${PLACED}`,
        row: undefined,
        source: "ruling",
        text: "posts go to the owner's DM only",
      },
      {
        atIso: "2026-10-02T11:00:00.000Z",
        pointer: `ruling:lapsed#${PLACED}`,
        row: undefined,
        source: "ruling",
        text: "lapsed: posts go to the owner's DM only",
      },
      {
        atIso: PLACED,
        pointer: `ruling:just-after#${PLACED}`,
        row: undefined,
        source: "ruling",
        text: "posts go to the owner's DM only",
      },
    ]);
    expect(part.gaps).toEqual([]);
    expect(part.source).toBe("2 gates in force across 3 run journals");
  });

  it("lists a release through the reading's clock at its own instant, and keeps the gate in force for one in its millisecond or after it", () => {
    const part = gatePart({
      journals: [
        {
          kind: "read",
          slug: "lifted",
          text: textOf(gated({}), release({ atIso: "2026-10-02T11:59:59.999Z", slug: "lifted" })),
        },
        {
          kind: "read",
          slug: "lifted-on-the-clock",
          text: textOf(gated({}), release({ atIso: NOW, slug: "lifted-on-the-clock" })),
        },
        {
          kind: "read",
          slug: "lifted-late",
          text: textOf(gated({}), release({ atIso: "2026-10-02T12:00:00.001Z", slug: "lifted-late" })),
        },
      ],
      nowIso: NOW,
    });

    expect(part.entries.map((entry) => entry.pointer)).toEqual([
      "ruling:lifted#2026-10-02T11:59:59.999Z",
      `ruling:lifted-on-the-clock#${PLACED}`,
      `ruling:lifted-on-the-clock#${NOW}`,
      `ruling:lifted-late#${PLACED}`,
    ]);
    expect(part.source).toBe("2 gates in force across 3 run journals");
  });

  it("fails a card whose floor sits between a gate's placing and its release, the release listed as the change", () => {
    const part = gatePart({
      journals: [
        {
          kind: "read",
          slug: "orphan",
          text: textOf(gated({}), release({ atIso: "2026-10-02T11:00:00.000Z", slug: "orphan" })),
        },
      ],
      nowIso: NOW,
    });
    const hand = standingSince({
      floorMs: Date.parse("2026-10-02T10:00:00.000Z"),
      row: "anything",
      standing: { entries: part.entries, gaps: part.gaps, sources: { memory: "m", profile: "p", rulings: "r" } },
    });

    expect(hand.changes).toEqual([
      {
        atIso: "2026-10-02T11:00:00.000Z",
        filed: "unfiled",
        pointer: "ruling:orphan#2026-10-02T11:00:00.000Z",
        source: "ruling",
      },
    ]);
    expect(part.source).toBe("0 gates in force across 1 run journals");
  });

  it("fails a card whose floor sits before a gate appended with an expiry already past, dated at its placing", () => {
    const appended = "2026-10-02T11:00:00.000Z";
    const placedExpired = gated({ appendedIso: appended, untilIso: "2026-10-02T09:00:00.000Z" });
    const part = gatePart({ journals: [{ kind: "read", slug: "expired", text: textOf(placedExpired) }], nowIso: NOW });
    const hand = standingSince({
      floorMs: Date.parse("2026-10-02T10:00:00.000Z"),
      row: "anything",
      standing: { entries: part.entries, gaps: part.gaps, sources: { memory: "m", profile: "p", rulings: "r" } },
    });

    expect(hand.changes).toEqual([
      { atIso: appended, filed: "unfiled", pointer: `ruling:expired#${appended}`, source: "ruling" },
    ]);
    expect(part.source).toBe("0 gates in force across 1 run journals");
  });

  it("fails a card across a gate lapsing exactly at the reading's clock, the lapse listed at that instant", () => {
    const part = gatePart({
      journals: [{ kind: "read", slug: "on-the-clock", text: textOf(gated({ untilIso: NOW })) }],
      nowIso: NOW,
    });
    const hand = standingSince({
      floorMs: Date.parse("2026-10-02T10:00:00.000Z"),
      row: "anything",
      standing: { entries: part.entries, gaps: part.gaps, sources: { memory: "m", profile: "p", rulings: "r" } },
    });

    expect(hand.changes).toEqual([
      { atIso: NOW, filed: "unfiled", pointer: `ruling:on-the-clock#${PLACED}`, source: "ruling" },
    ]);
  });

  it("fails a card across a lapse a fraction of a millisecond past its floor, never one written with zeros there", () => {
    const part = gatePart({
      journals: [
        { kind: "read", slug: "sub-ms", text: textOf(gated({ untilIso: "2026-10-02T10:00:00.0005Z" })) },
        { kind: "read", slug: "zeros", text: textOf(gated({ untilIso: "2026-10-02T10:00:00.0000Z" })) },
      ],
      nowIso: NOW,
    });
    const hand = standingSince({
      floorMs: Date.parse("2026-10-02T10:00:00.000Z"),
      row: "anything",
      standing: { entries: part.entries, gaps: part.gaps, sources: { memory: "m", profile: "p", rulings: "r" } },
    });

    expect(hand.changes).toEqual([
      { atIso: "2026-10-02T10:00:00.0005Z", filed: "unfiled", pointer: `ruling:sub-ms#${PLACED}`, source: "ruling" },
    ]);
  });

  it("fails every card on a journal that would not read or an undecodable or kindless ruling line, never on another kind", () => {
    const part = gatePart({
      journals: [
        { kind: "unreadable", slug: "locked", why: "EACCES" },
        { kind: "read", slug: "newer", text: `${textOf(gated({}))}{"kind":"ruling","future":true}\n` },
        { kind: "read", slug: "torn", text: '{"kind":"rul\n' },
        { kind: "read", slug: "stray", text: '{"kind":"parked-v9"}\n' },
        {
          kind: "read",
          slug: "kindless",
          text: '{"ruling":"posts go to the owner\'s DM only","gate":{"subjects":[],"verbs":[]}}\n',
        },
      ],
      nowIso: NOW,
    });
    const hand = standingSince({
      floorMs: Date.parse(NOW),
      row: "anything",
      standing: { entries: [], gaps: part.gaps, sources: { memory: "m", profile: "p", rulings: "r" } },
    });

    expect(part.entries.map((entry) => entry.pointer)).toEqual([`ruling:newer#${PLACED}`]);
    expect(hand.gaps).toEqual([
      "4 run journals hold a ruling this build could not read, so a ruling gate may be missed",
    ]);
    expect(part.source).toBe(
      "1 gates in force across 5 run journals; 4 run journals hold a ruling this build could not read",
    );
  });

  it("decodes a journal rather than matching its text, so an escaped kind key still places its gate", () => {
    const escaped = ledgerLine({ event: gated({}) }).replace('"kind"', String.raw`"kind"`);

    const part = gatePart({ journals: [{ kind: "read", slug: "escaped", text: escaped }], nowIso: NOW });

    expect(escaped).toContain(String.raw`"kind":"ruling"`);
    expect(part.entries.map((entry) => entry.pointer)).toEqual([`ruling:escaped#${PLACED}`]);
    expect(part.gaps).toEqual([]);
  });

  it("fails every card when the journals could not be listed at all", () => {
    const part = gatePart({ journals: { why: "EACCES: permission denied" }, nowIso: NOW });

    expect(part.gaps).toEqual([
      { why: "your run journals could not be listed, so a ruling gate may be missed: EACCES: permission denied" },
    ]);
    expect(part.source).toBe("gates not read: EACCES: permission denied");
  });
});
