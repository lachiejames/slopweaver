/**
 * A Queue card's open lines and hover never carry a producer's raw failure reason — a session id, a path — only one of
 * the closed phrases the producers write (`NOT_CONFIRMED_WHYS`). The raw reason still reaches the card's staleness mark,
 * and an older reading's free-text `why` decodes but goes there too.
 */
import { describe, expect, it } from "vitest";

import { readCurrency } from "../../components/live/readCurrency";
import type { CurrencyCard, CurrencyCardRow, CurrencyFact, CurrencyReading } from "../../lib/cardCurrency";
import { cardCurrencyOf } from "../../lib/cardCurrencyMark";

const ASKED = "2026-10-02T10:00:00.000Z";
const PASS = "2026-10-02T11:30:00.000Z";
const CHECKED = "2026-10-02T12:00:00.000Z";
const RAW = "session sess-123 at /tmp/reply.json";

const reading = ({ rows }: { rows: readonly CurrencyCardRow[] }): CurrencyReading => ({
  checkedIso: CHECKED,
  readFromIso: "2026-10-01T12:00:00.000Z",
  rows,
  schemaVersion: 2,
  sources: { chair: "132 turns read", relays: "0 undelivered", voice: "0 unread call words" },
});

const ask: CurrencyCard = {
  currencyFloorIso: ASKED,
  key: "ask:mirror",
  kind: "ask",
  verifiedIso: undefined,
  whenIso: ASKED,
};
const askRow: CurrencyCardRow = {
  askedIso: ASKED,
  done: { kind: "could-not-check", why: RAW },
  fact: { kind: "not-confirmed", why: "its Slack thread could not be read" },
  floorIso: ASKED,
  key: "ask:mirror",
  since: { gaps: [], standing: [], words: [] },
};
const hand: CurrencyCard = {
  currencyFloorIso: ASKED,
  key: "hand:mon-rs-r1",
  kind: "hand",
  verifiedIso: undefined,
  whenIso: ASKED,
};
const handRow = ({ fact }: { fact: CurrencyFact }): CurrencyCardRow => ({
  fact,
  floorIso: ASKED,
  key: "hand:mon-rs-r1",
  since: { gaps: [], standing: [], words: [] },
});

const markOf = ({ card, rows }: { card: CurrencyCard; rows: readonly CurrencyCardRow[] }) =>
  cardCurrencyOf({ ageOf: ({ iso }) => `age(${iso})`, card, reading: reading({ rows }) });

/** Whether the raw reason reached the open lines, and the hover. */
const leaked = ({ mark }: { mark: ReturnType<typeof markOf> }): readonly boolean[] => [
  mark.lines.join("\n").includes("sess-123") || mark.lines.join("\n").includes("/tmp/reply.json"),
  mark.title.includes("sess-123") || mark.title.includes("/tmp/reply.json"),
];

describe("a not-confirmed card's reason", () => {
  it("names an ask's unread Slack thread in a closed phrase, its raw reason only in the staleness mark", () => {
    const mark = markOf({ card: ask, rows: [askRow] });

    expect(mark.lines[0]).toBe("Facts: not confirmed, because its Slack thread could not be read.");
    expect(leaked({ mark })).toEqual([false, false]);
    expect(mark.unread).toEqual([{ subject: "whether you have replied in its Slack thread", why: RAW }]);
  });

  it("names a monitor pass that would not read in a closed phrase, its raw reason only in the staleness mark", () => {
    const fact: CurrencyFact = { kind: "not-confirmed", unread: RAW, why: "its monitor's last pass would not read" };
    const mark = markOf({ card: hand, rows: [handRow({ fact })] });

    expect(mark.lines[0]).toBe("Facts: not confirmed, because its monitor's last pass would not read.");
    expect(leaked({ mark })).toEqual([false, false]);
    expect(mark.unread).toEqual([{ subject: "how its facts were checked", why: RAW }]);
  });

  it("keeps an older producer's free-text reason off the card, and puts it in the staleness mark", () => {
    const mark = markOf({ card: hand, rows: [handRow({ fact: { kind: "not-confirmed", why: RAW } })] });

    expect(mark.lines[0]).toBe("Facts: not confirmed.");
    expect(leaked({ mark })).toEqual([false, false]);
    expect(mark.unread).toEqual([{ subject: "how its facts were checked", why: RAW }]);
  });

  it("adds nothing to the staleness mark for a closed phrase carrying no failed read", () => {
    const fact: CurrencyFact = { kind: "not-confirmed", why: "its monitor's last pass found the condition clear" };
    const mark = markOf({ card: hand, rows: [handRow({ fact })] });

    expect([mark.lines[0], mark.unread]).toEqual([
      "Facts: not confirmed, because its monitor's last pass found the condition clear.",
      [],
    ]);
  });
});

describe("readCurrency on a fact's unread reason", () => {
  const withUnread = ({ unread }: { unread: unknown }): unknown => ({
    ...reading({ rows: [] }),
    rows: [
      {
        floorIso: ASKED,
        key: "hand:mon-rs-r1",
        since: { gaps: [], standing: [], words: [] },
        fact: { kind: "not-confirmed", unread, why: "its monitor's last pass would not read" },
      },
    ],
  });

  it("decodes it when it is a string", () => {
    expect(readCurrency(withUnread({ unread: "the ledger would not parse" }))!.rows[0].fact).toEqual({
      kind: "not-confirmed",
      unread: "the ledger would not parse",
      why: "its monitor's last pass would not read",
    });
  });

  it("refuses the whole document when it is anything else", () => {
    expect([
      readCurrency(withUnread({ unread: 7 })),
      readCurrency(withUnread({ unread: {} })),
      readCurrency(withUnread({ unread: [] })),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
