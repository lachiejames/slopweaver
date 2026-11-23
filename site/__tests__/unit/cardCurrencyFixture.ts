/*
 * The readings, cards and mark the Queue card currency tests share (`./cardCurrency.test.ts`,
 * `./cardCurrencyExact.test.ts`): one ask row read at a fixed instant, its schema-3 form, and the owner's words since.
 */
import type { CurrencyCard, CurrencyCardRow, CurrencyReading } from "../../lib/cardCurrency";
import { cardCurrencyOf } from "../../lib/cardCurrencyMark";

export const ASKED = "2026-10-02T10:00:00.000Z";
export const CONFIRMED = "2026-10-02T11:00:00.000Z";
export const CHECKED = "2026-10-02T12:00:00.000Z";
export const READ = "2026-10-02T12:30:00.000Z";

export const base: CurrencyCardRow = {
  askedIso: ASKED,
  done: { kind: "on-owner-ruling" },
  floorIso: ASKED,
  key: "ask:mirror",
  since: { gaps: [], standing: [], words: [] },
};

/**
 * One row over {@link base} in an older, ask-only reading checked at {@link CHECKED}.
 *
 * @param row the fields this row overrides on the base ask row
 * @returns the reading
 */
export const readingOf = (row: Partial<CurrencyCardRow> = {}): CurrencyReading => ({
  checkedIso: CHECKED,
  readFromIso: "2026-10-01T12:00:00.000Z",
  rows: [{ ...base, ...row }],
  sources: { chair: "132 turns read", relays: "0 undelivered", voice: "0 unread call words" },
});

/**
 * The same row in a schema-3 reading, every standing source read, and the card floored where the row is: an ask-only
 * reading never read the owner's standing set, so only this shape can pass the steers half.
 *
 * @param row the fields this row overrides on the base ask row
 * @returns the schema-3 reading
 */
export const v3Of = (row: Partial<CurrencyCardRow> = {}): CurrencyReading => ({
  ...readingOf(row),
  schemaVersion: 3,
  sources: {
    ...readingOf(row).sources,
    standing: {
      memory: "0 memories read across 0 projects",
      profile: "no owner profile recorded",
      rulings: "0 rulings read",
    },
  },
});

/**
 * A card floored at its own asking, as the live read floors one.
 *
 * @param card the card to floor
 * @returns the card with its currency floor set
 */
export const floored = (card: CurrencyCard): CurrencyCard => ({ currencyFloorIso: card.whenIso, ...card });

/** An ask whose still-real check confirmed its facts at {@link CONFIRMED}. */
export const ask: CurrencyCard = { key: "ask:mirror", kind: "ask", verifiedIso: CONFIRMED, whenIso: ASKED };

/**
 * A stand-in age that names the instant it was given, so an assertion reads which instant a line aged.
 *
 * @returns `age(<iso>)`
 */
const ageOf = ({ iso }: { iso: string }): string => `age(${iso})`;

/**
 * The currency mark one card wears under one reading.
 *
 * @param card the card, the confirmed {@link ask} when omitted
 * @param reading the reading, or `undefined` for none yet
 * @returns the mark
 */
export const markOf = ({
  card = ask,
  reading,
}: {
  card?: CurrencyCard;
  reading: CurrencyReading | undefined;
}): ReturnType<typeof cardCurrencyOf> => cardCurrencyOf({ ageOf, card, reading });

export const said = {
  gaps: [],
  standing: [],
  words: [
    {
      atIso: "2026-10-02T10:05:00.000Z",
      filed: "unfiled" as const,
      pointer: "transcript:c#1",
      source: "chair" as const,
    },
    { atIso: "2026-10-02T10:06:00.000Z", filed: "here" as const, pointer: "talk:a", source: "relay" as const },
  ],
};
