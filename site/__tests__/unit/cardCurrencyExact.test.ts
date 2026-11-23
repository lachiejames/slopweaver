/**
 * The Queue card currency mark over an exact reading (schema 3), which carries a row for every card kind: a hand step,
 * a pull request and an ask each read against their own row, and the ordering that puts a fresh card first.
 */
import { describe, expect, it } from "vitest";

import { readCurrency } from "../../components/live/readCurrency";
import type { CurrencyCard, CurrencyCardRow, CurrencyReading } from "../../lib/cardCurrency";
import { currencyOrdered } from "../../lib/cardCurrencyMark";
import { ASKED, ask, base, CHECKED, CONFIRMED, floored, markOf, READ, v3Of } from "./cardCurrencyFixture";

describe("an exact reading (schema 3), a row for every card kind", () => {
  const POSTED = "2026-10-02T09:00:00.000Z";
  const PASS = "2026-10-02T11:30:00.000Z";
  /** A monitor-raised hand step the hands register last read at {@link READ}. */
  const hand: CurrencyCard & { tier: string } = {
    aliases: ["ask:mirror"],
    currencyFloorIso: POSTED,
    key: "hand:mon-rs-r1",
    kind: "hand",
    tier: "team-blocked",
    verifiedIso: READ,
    whenIso: POSTED,
  };
  const row: CurrencyCardRow = {
    fact: { atIso: PASS, by: "the recipe-stopped monitor's last pass", kind: "confirmed" },
    floorIso: POSTED,
    key: "hand:mon-rs-r1",
    since: { gaps: [], standing: [], words: [] },
  };
  const v2 = (rows: readonly CurrencyCardRow[]): CurrencyReading => ({ ...v3Of(), rows });
  const word = ({ atIso, filed }: { atIso: string; filed: "here" | "unfiled" }) => ({
    atIso,
    filed,
    pointer: `transcript:c#${atIso}`,
    source: "chair" as const,
  });

  it("joins a card by its own key at its own floor, its facts dated by the row's fact, never its register read", () => {
    const mark = markOf({ card: hand, reading: v2([row]) });

    expect(mark.kind).toBe("fresh");
    expect(mark.words).toBe(`fresh · checked age(${PASS})`);
    expect(mark.lines).toEqual([
      `Facts: last confirmed age(${PASS}), by the recipe-stopped monitor's last pass.`,
      `Your steers: checked age(${CHECKED}) against everything you said and every change to your standing rulings, memories and owner profile since it reached you; nothing new bears on it.`,
    ]);
  });

  it("says why the facts were not confirmed, and never joins through an alias", () => {
    const unconfirmed = markOf({
      card: hand,
      reading: v2([{ ...row, fact: { kind: "not-confirmed", why: "no pass of its monitor is recorded" } }]),
    });
    const aliasOnly = markOf({ card: hand, reading: v2([{ ...base, fact: row.fact }]) });

    expect([unconfirmed.kind, unconfirmed.lines[0]]).toEqual([
      "steers-only",
      "Facts: not confirmed, because no pass of its monitor is recorded.",
    ]);
    expect([aliasOnly.kind, aliasOnly.lines[0], aliasOnly.lines[1]]).toEqual([
      "unchecked",
      "Facts: not confirmed, because the last check did not read this card as it stands.",
      `Your steers: not checked. The last check (age(${CHECKED})) did not include this card: it is newer than the check, or its register no longer holds it.`,
    ]);
  });

  it("reads a row at another floor as a different card, older or newer", () => {
    const older = markOf({ card: hand, reading: v2([{ ...row, floorIso: ASKED }]) });
    const undated = markOf({ card: { ...hand, currencyFloorIso: undefined }, reading: v2([row]) });

    expect([older.kind, older.lines[1]]).toEqual([
      "unchecked",
      `Your steers: not checked. Changed age(${POSTED}), after the last check (age(${CHECKED})) read it.`,
    ]);
    expect(undated.lines[1]).toBe(
      `Your steers: not checked. The last check (age(${CHECKED})) read a version of this card that is dated; this one is not.`,
    );
  });

  it("says the owner reacted when a word filed to this card came after its floor, and moves it to the check-ins", () => {
    const after = "2026-10-02T09:00:00.001Z";
    const reading = v2([{ ...row, since: { gaps: [], standing: [], words: [word({ atIso: after, filed: "here" })] } }]);
    const mark = markOf({ card: hand, reading });
    const draftRow = { ...hand, currencyFloorIso: undefined, key: "draft:a", kind: "draft" };

    expect(mark.kind).toBe("reacted");
    expect(mark.words).toBe(`you reacted · age(${after})`);
    expect(mark.lines).toEqual([
      `You said something about this card age(${after}), after it reached you. A seat folds it in; nothing here waits on you until it comes back.`,
    ]);
    expect(currencyOrdered({ reading, rows: [hand, draftRow] }).map((each) => [each.key, each.tier])).toEqual([
      ["draft:a", "team-blocked"],
      ["hand:mon-rs-r1", "check-in"],
    ]);
  });

  // A card restored in the same words after the owner ruled must not rank first as unanswered.
  it("reads a ruling on the same question before it was asked again as the owner's reaction, and moves it to the check-ins", () => {
    const ruledBefore = "2026-10-01T15:00:00.000Z";
    const recorded = v3Of({
      fact: { atIso: CONFIRMED, by: "re-read", kind: "confirmed" },
      sameQuestionRuling: { atIso: ruledBefore, pointer: "talk:ruled" },
    });
    // On the wire a schema-3 reading carries its standing source lines flat on `sources`.
    const { standing, ...lines } = recorded.sources;
    const wired = { ...recorded, sources: { ...lines, ...standing } };
    const reading = readCurrency(wired)!;
    const card = floored(ask);
    const mark = markOf({ card, reading });

    expect(reading.rows[0].sameQuestionRuling).toEqual({ atIso: ruledBefore, pointer: "talk:ruled" });
    expect([mark.kind, mark.words, mark.lines]).toEqual([
      "reacted",
      `you ruled · age(${ruledBefore})`,
      [
        `You already ruled on this same question age(${ruledBefore}), and it was asked again in the same words. Nothing here waits on you: a re-ask that needs you says what changed since your ruling.`,
      ],
    ]);
    expect(currencyOrdered({ reading, rows: [{ ...card, tier: "ask" }] }).map((each) => [each.key, each.tier])).toEqual(
      [["ask:mirror", "check-in"]],
    );
    expect(
      readCurrency({ ...wired, rows: [{ ...recorded.rows[0], sameQuestionRuling: { atIso: ruledBefore } }] }),
    ).toBeUndefined();
  });

  it("never counts a word at the floor, or one no session filed, as the owner's reaction", () => {
    const atFloor = v2([
      { ...row, since: { gaps: [], standing: [], words: [word({ atIso: POSTED, filed: "here" })] } },
    ]);
    const unfiled = v2([
      { ...row, since: { gaps: [], standing: [], words: [word({ atIso: CHECKED, filed: "unfiled" })] } },
    ]);

    expect([markOf({ card: hand, reading: atFloor }).kind, markOf({ card: hand, reading: unfiled }).kind]).toEqual([
      "facts-only",
      "facts-only",
    ]);
  });
});
