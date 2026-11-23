/*
 * `handover currency`'s human read: a count and only the cards with something to act on by default, every card
 * behind `--full`. Built from constructed documents — the renderer is pure.
 */
import { describe, expect, it } from "vitest";

import {
  HANDOVER_CURRENCY_FLAG_NAMES,
  parseHandoverCurrencyArgs,
} from "../../../../../cli/commands/handover/currencyArgs.js";
import { currencyHumanLines, currencyRowNeedsAction } from "../../../../../cli/commands/handover/currencyPrint.js";
import { CURRENCY_SCHEMA_VERSION, type CurrencyDocument, type CurrencyRow } from "../../../../../handover/currency.js";

const CONFIRMED = { atIso: "2026-11-05T10:00:00.000Z", by: "register", kind: "confirmed" } as const;

const quiet = ({ key }: { key: string }): CurrencyRow => ({
  fact: CONFIRMED,
  floorIso: "2026-11-05T09:00:00.000Z",
  key,
  since: { gaps: [], standing: [], words: [] },
});

const document = ({ rows }: { rows: readonly CurrencyRow[] }): CurrencyDocument => ({
  checkedIso: "2026-11-05T12:00:00.000Z",
  pullRequests: [],
  readFromIso: "2026-11-04T12:00:00.000Z",
  rows,
  said: {},
  schemaVersion: CURRENCY_SCHEMA_VERSION,
  sources: {
    chair: "3 turns read",
    github: "0 pull-request bodies read",
    memory: "12 leaves read",
    profile: "revision 1",
    relays: "0 undelivered",
    rulings: "4 rulings read",
    voice: "0 unread call words",
  },
});

const HEAD = [
  "checked 2026-11-05T12:00:00.000Z, the owner's words read from 2026-11-04T12:00:00.000Z",
  "chair: 3 turns read; relays: 0 undelivered; calls: 0 unread call words",
  "memories: 12 leaves read; profile: revision 1; rulings: 4 rulings read",
];
const TAIL = ["github: 0 pull-request bodies read"];

const UNFILED: CurrencyRow = {
  ...quiet({ key: "ask:unfiled" }),
  since: {
    gaps: [],
    standing: [],
    words: [{ atIso: "2026-11-05T11:00:00.000Z", filed: "unfiled", pointer: "talk:a", source: "chair" }],
  },
};
const GAP: CurrencyRow = {
  ...quiet({ key: "pr:12" }),
  since: { gaps: ["voice: unreadable"], standing: [], words: [] },
};
const STANDING: CurrencyRow = {
  ...quiet({ key: "ask:standing" }),
  since: {
    gaps: [],
    standing: [{ atIso: "2026-11-05T11:15:00.000Z", filed: "unfiled", pointer: "memory:a-leaf", source: "memory" }],
    words: [],
  },
};
const REPLIED: CurrencyRow = {
  ...quiet({ key: "ask:replied" }),
  done: { atIso: "2026-11-05T11:30:00.000Z", kind: "replied", permalink: "https://acme.slack.com/archives/C1/p1" },
};
const UNCHECKED: CurrencyRow = {
  ...quiet({ key: "ask:unchecked" }),
  done: { kind: "could-not-check", why: "no token" },
};

describe("currencyRowNeedsAction", () => {
  it("names a card for each of the five causes", () => {
    expect([UNFILED, STANDING, GAP, REPLIED, UNCHECKED].map((row) => currencyRowNeedsAction({ row }))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("names a card whose fact would not read, with the read's own reason", () => {
    const broken: CurrencyRow = {
      ...quiet({ key: "review:broken-monitor" }),
      fact: {
        kind: "not-confirmed",
        unread: "EACCES reading monitor evidence",
        why: "its monitor's last pass would not read",
      },
    };
    expect(currencyHumanLines({ document: document({ rows: [broken] }), full: false })).toEqual([
      ...HEAD,
      "cards: 1 — 1 with something to act on, 0 unchanged (--full lists every card)",
      "review:broken-monitor: facts not-confirmed (EACCES reading monitor evidence); since 0 filed here, 0 unfiled; 0 standing change(s)",
      ...TAIL,
    ]);
  });

  it("counts a not-confirmed, still-waiting or ruling-done card as unchanged", () => {
    const rows: readonly CurrencyRow[] = [
      {
        ...quiet({ key: "ask:a" }),
        fact: { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" },
      },
      { ...quiet({ key: "ask:b" }), done: { kind: "not-yet", readAtIso: "2026-11-05T11:00:00.000Z" } },
      { ...quiet({ key: "ask:c" }), done: { kind: "on-owner-ruling" } },
      { ...quiet({ key: "ask:d" }), done: { checks: ["path: x"], kind: "declared-not-run" } },
      {
        ...quiet({ key: "pr:9" }),
        since: {
          gaps: [],
          standing: [],
          words: [{ atIso: "2026-11-05T11:00:00.000Z", filed: "here", pointer: "talk:b", source: "voice" }],
        },
      },
    ];
    expect(rows.map((row) => currencyRowNeedsAction({ row }))).toEqual([false, false, false, false, false]);
  });
});

describe("currencyHumanLines", () => {
  it("says zero cards rather than printing nothing", () => {
    expect(currencyHumanLines({ document: document({ rows: [] }), full: false })).toEqual([
      ...HEAD,
      "cards: 0 — 0 with something to act on, 0 unchanged (--full lists every card)",
      ...TAIL,
    ]);
  });

  it("counts unchanged cards and names only the actionable ones, in document order", () => {
    const rows = [quiet({ key: "pr:1" }), UNFILED, quiet({ key: "pr:2" }), REPLIED];
    expect(currencyHumanLines({ document: document({ rows }), full: false })).toEqual([
      ...HEAD,
      "cards: 4 — 2 with something to act on, 2 unchanged (--full lists every card)",
      "ask:unfiled: facts confirmed; since 0 filed here, 1 unfiled; 0 standing change(s)",
      "ask:replied: facts confirmed; done replied; since 0 filed here, 0 unfiled; 0 standing change(s)",
      "… and 2 card(s) not named here: 2 unchanged (--full names them)",
      ...TAIL,
    ]);
  });

  it("counts every card it leaves unnamed, unchanged and shared-only together", () => {
    const rows = [quiet({ key: "pr:quiet" }), STANDING, UNFILED];
    expect(currencyHumanLines({ document: document({ rows }), full: false })).toEqual([
      ...HEAD,
      "cards: 3 — 2 with something to act on, 1 unchanged (--full lists every card)",
      "standing: memory memory:a-leaf at 2026-11-05T11:15:00.000Z — bears on 1 card(s)",
      "ask:unfiled: facts confirmed; since 0 filed here, 1 unfiled; 0 standing change(s)",
      "… and 2 card(s) not named here: 1 unchanged, 1 whose only change is a standing one above (--full names them)",
      ...TAIL,
    ]);
  });

  it("names every card with a cause of its own, never folding one into a bare count", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ ...GAP, key: `pr:${String(index + 1)}` }));
    expect(currencyHumanLines({ document: document({ rows }), full: false })).toEqual([
      ...HEAD,
      "cards: 10 — 10 with something to act on, 0 unchanged (--full lists every card)",
      ...rows.map(
        (row) => `${row.key}: facts confirmed; since 0 filed here, 0 unfiled; 0 standing change(s); 1 gap(s)`,
      ),
      ...TAIL,
    ]);
  });

  it("counts a card listing the same standing change twice as one card", () => {
    const change = STANDING.since.standing[0]!;
    const twice: CurrencyRow = { ...STANDING, since: { ...STANDING.since, standing: [change, change] } };
    expect(currencyHumanLines({ document: document({ rows: [twice] }), full: false })).toContain(
      "standing: memory memory:a-leaf at 2026-11-05T11:15:00.000Z — bears on 1 card(s)",
    );
  });

  it("names a shared standing change once with its reach, and still names a card with its own cause", () => {
    const shared = Array.from({ length: 3 }, (_, index) => ({ ...STANDING, key: `ask:s${String(index + 1)}` }));
    const ownToo: CurrencyRow = { ...STANDING, key: "ask:own", since: { ...STANDING.since, gaps: ["chair: unread"] } };
    expect(currencyHumanLines({ document: document({ rows: [...shared, ownToo] }), full: false })).toEqual([
      ...HEAD,
      "cards: 4 — 4 with something to act on, 0 unchanged (--full lists every card)",
      "standing: memory memory:a-leaf at 2026-11-05T11:15:00.000Z — bears on 4 card(s)",
      "ask:own: facts confirmed; since 0 filed here, 0 unfiled; 1 standing change(s); 1 gap(s)",
      "… and 3 card(s) not named here: 3 whose only change is a standing one above (--full names them)",
      ...TAIL,
    ]);
  });

  it("names a card whose ruling is filed on its own row", () => {
    const here: CurrencyRow = {
      ...quiet({ key: "ask:ruled" }),
      since: {
        gaps: [],
        standing: [{ atIso: "2026-11-05T11:20:00.000Z", filed: "here", pointer: "ruling:r1", source: "ruling" }],
        words: [],
      },
    };
    expect(currencyHumanLines({ document: document({ rows: [here] }), full: false })).toEqual([
      ...HEAD,
      "cards: 1 — 1 with something to act on, 0 unchanged (--full lists every card)",
      "ask:ruled: facts confirmed; since 0 filed here, 0 unfiled; 1 standing change(s)",
      ...TAIL,
    ]);
  });

  it("prints every card's line under --full, with no count line", () => {
    const rows = [quiet({ key: "pr:1" }), UNCHECKED];
    expect(currencyHumanLines({ document: document({ rows }), full: true })).toEqual([
      ...HEAD,
      "pr:1: facts confirmed; since 0 filed here, 0 unfiled; 0 standing change(s)",
      "ask:unchecked: facts confirmed; done could-not-check; since 0 filed here, 0 unfiled; 0 standing change(s)",
      ...TAIL,
    ]);
  });

  it("keeps every pull-request proof line in both reads", () => {
    const withPr: CurrencyDocument = {
      ...document({ rows: [] }),
      pullRequests: [
        {
          identity: "acme/widgets#7",
          proof: {
            ask: {
              anchor: "talk:c",
              atIso: "2026-11-05T09:00:00.000Z",
              kinds: [],
              rowSlug: "land-acme-widgets-7",
              words: "prove it",
            },
            kind: "body-unread",
            why: "no token",
          },
          rowSlugs: ["land-acme-widgets-7"],
        },
      ],
    };
    expect(currencyHumanLines({ document: withPr, full: false }).at(-1)).toBe("acme/widgets#7: proof body-unread");
    expect(currencyHumanLines({ document: withPr, full: true }).at(-1)).toBe("acme/widgets#7: proof body-unread");
  });
});

describe("handover currency --full", () => {
  it("is a declared flag the parser accepts", () => {
    expect(HANDOVER_CURRENCY_FLAG_NAMES).toContain("--full");
    expect(parseHandoverCurrencyArgs({ rest: ["--full"] }).isOk()).toBe(true);
  });
});
