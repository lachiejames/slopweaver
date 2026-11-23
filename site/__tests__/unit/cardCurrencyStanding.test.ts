/**
 * A Queue card's steers half over the owner's STANDING guidance: a schema-3
 * reading names every change to their memories, owner profile and rulings since the card's floor, a card passes only
 * when none could bear on it, and a reading older than schema 3 — which never read them — never passes. And the strict
 * reader: every shape round-trips, and a schema-3 document missing any standing field is dropped whole.
 */
import { describe, expect, it } from "vitest";

import { readCurrency } from "../../components/live/readCurrency";
import { type CurrencyCard, type CurrencyCardRow, type CurrencyReading } from "../../lib/cardCurrency";
import { cardCurrencyOf } from "../../lib/cardCurrencyMark";

const POSTED = "2026-10-02T09:00:00.000Z";
const PASS = "2026-10-02T11:30:00.000Z";
const CHECKED = "2026-10-02T12:00:00.000Z";
const CHANGED = "2026-10-02T10:00:00.000Z";
const STANDING_SOURCES = {
  memory: "31 memories read across 2 projects",
  profile: "revision 4",
  rulings: "12 rulings read",
};

const ageOf = ({ iso }: { iso: string }): string => `age(${iso})`;

/** A hand step its monitor's last pass confirmed at {@link PASS}. */
const hand: CurrencyCard = {
  currencyFloorIso: POSTED,
  key: "hand:step",
  kind: "hand",
  verifiedIso: PASS,
  whenIso: POSTED,
};

const row: CurrencyCardRow = {
  fact: { atIso: PASS, by: "the recipe-stopped monitor's last pass", kind: "confirmed" },
  floorIso: POSTED,
  key: "hand:step",
  since: { gaps: [], standing: [], words: [] },
};

/** A schema-3 reading of one row, exactly as the producer writes it. */
const v3 = (rows: readonly CurrencyCardRow[]): CurrencyReading => ({
  checkedIso: CHECKED,
  readFromIso: "2026-10-01T12:00:00.000Z",
  rows,
  schemaVersion: 3,
  sources: {
    chair: "132 turns read",
    relays: "0 undelivered",
    standing: STANDING_SOURCES,
    voice: "0 unread call words",
  },
});

/** The same reading as the wire carries it: the standing source lines flat beside the others. */
const wire = (reading: CurrencyReading): Record<string, unknown> => {
  const { standing, ...words } = reading.sources;
  return { ...JSON.parse(JSON.stringify(reading)), sources: { ...words, ...standing } };
};

const memoryChange = { atIso: CHANGED, filed: "unfiled" as const, pointer: "memory:p/a.md", source: "memory" as const };

describe("the steers half over the owner's standing guidance", () => {
  it("passes a schema-3 row only when nothing the owner said and nothing standing changed since", () => {
    const mark = cardCurrencyOf({ ageOf, card: hand, reading: v3([row]) });

    expect(mark.kind).toBe("fresh");
    expect(mark.lines[1]).toBe(
      `Your steers: checked age(${CHECKED}) against everything you said and every change to your standing rulings, memories and owner profile since it reached you; nothing new bears on it.`,
    );
    // What each source read is docs/console's, never a fold on the card.
    expect(mark.title).not.toContain("31 memories read across 2 projects");
  });

  it("lists a memory that changed since, behind the fold, and never passes over it", () => {
    const reading = {
      ...v3([{ ...row, since: { gaps: [], standing: [memoryChange], words: [] } }]),
      said: { "memory:p/a.md": { cut: "none" as const, text: "jq is banned" } },
    };
    const mark = cardCurrencyOf({ ageOf, card: hand, reading });

    expect(mark.kind).toBe("facts-only");
    expect(mark.lines[1]).toBe(
      `Your steers: checked age(${CHECKED}); things you said or standing guidance that changed since it reached you could bear on it, not yet folded in; they are listed below.`,
    );
    expect(mark.said!.summary).toBe("1 possible steer since it reached you: none yet tied to a card");
    expect(mark.said!.groups[0].rows.map(({ lead, where }) => ({ lead, where }))).toEqual([
      { lead: "jq is banned", where: `One of your memories changed, age(${CHANGED})` },
    ]);
  });

  it("reads a ruling recorded on the card's own row as the owner's reaction to it", () => {
    const ruling = { atIso: CHANGED, filed: "here" as const, pointer: "ruling:mirror#x", source: "ruling" as const };
    const mark = cardCurrencyOf({
      ageOf,
      card: hand,
      reading: v3([{ ...row, since: { gaps: [], standing: [ruling], words: [] } }]),
    });

    expect(mark.kind).toBe("reacted");
    expect(mark.said!.groups.map((group) => group.heading)).toEqual(["Tied to this card"]);
  });

  it("never passes a row that did not read the standing set, naming what it did read", () => {
    const schema2 = { ...v3([{ ...row, since: { gaps: [], words: [] } }]), schemaVersion: 2 as const };
    const smuggled = { ...v3([{ ...row, since: { gaps: [], standing: [], words: [] } }]), schemaVersion: 2 as const };
    const mark = cardCurrencyOf({ ageOf, card: hand, reading: schema2 });

    expect(mark.kind).toBe("facts-only");
    expect(cardCurrencyOf({ ageOf, card: hand, reading: smuggled }).lines).toEqual(mark.lines);
    expect(mark.lines[1]).toBe(
      `Your steers: checked age(${CHECKED}) against what you said since it reached you, but not against your standing rulings, memories and owner profile, which that check predates reading.`,
    );
  });
});

describe("readCurrency over every reading shape", () => {
  const schema2 = { ...v3([{ ...row, since: { gaps: [], words: [] } }]), schemaVersion: 2 as const };
  const legacyRow = {
    askedIso: POSTED,
    done: { kind: "on-owner-ruling" as const },
    floorIso: POSTED,
    key: "ask:mirror",
    since: { gaps: [], words: [] },
  };
  const legacy: CurrencyReading = {
    checkedIso: CHECKED,
    readFromIso: CHECKED,
    rows: [legacyRow],
    sources: schema2.sources,
  };

  it("round-trips a schema-3 reading, a schema-2 one and an ask-only one", () => {
    const three = v3([{ ...row, since: { gaps: [], standing: [memoryChange], words: [] } }]);
    const { standing: _unread, ...wordSources } = schema2.sources;
    const two = { ...schema2, sources: wordSources };
    const askOnly = {
      ...legacy,
      sources: wordSources,
      said: { "transcript:c#1": { cut: "start" as const, text: "ship it" } },
    };

    expect(readCurrency(wire(three))).toEqual(three);
    expect(readCurrency(JSON.parse(JSON.stringify(two)))).toEqual(two);
    expect(readCurrency(JSON.parse(JSON.stringify(askOnly)))).toEqual(askOnly);
  });

  it("drops a schema-3 document missing a row's standing, a standing source line, or carrying an unknown source", () => {
    const good = wire(v3([row]));
    const noStanding = wire(v3([{ ...row, since: { gaps: [], words: [] } }]));
    const badSource = wire(
      v3([{ ...row, since: { gaps: [], standing: [{ ...memoryChange, source: "chair" as never }], words: [] } }]),
    );
    const { memory: _memory, ...noMemoryLine } = good["sources"] as Record<string, string>;

    expect(readCurrency(good)!.schemaVersion).toBe(3);
    expect([
      readCurrency(noStanding),
      readCurrency(badSource),
      readCurrency({ ...good, sources: noMemoryLine }),
      readCurrency({ ...good, schemaVersion: 4 }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("never reads a standing list off a schema-2 row, which did not read the standing set", () => {
    const smuggled = { ...wire(schema2), rows: [{ ...row, since: { gaps: [], standing: [], words: [] } }] };

    expect(readCurrency(smuggled)!.rows[0].since.standing).toBeUndefined();
  });
});
