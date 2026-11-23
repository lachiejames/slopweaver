import { describe, expect, it } from "vitest";

import type { DocStatus } from "../../../../handover/doc.js";
import type { AskSettlement } from "../../../../handover/rowKind.js";
import { DerivedRowReadErrors } from "../../../../handover/rowState.js";
import { err, ok } from "../../../../lib/result.js";
import {
  standingsByKey,
  type TriageCardStanding,
  type TriageRowRead,
  triageCardStanding,
} from "../../../../live/gmail/triageCarded.js";
import type { GmailTriageCard } from "../../../../live/gmail/triageCards.js";

const SLUG = "inbox-triage-20261028-from-alerts-example-test";
const KEY = "from:alerts@example.test";
const OPEN_ASK = "inbox-triage-20261027-from-alerts-example-test";

const CARD: GmailTriageCard = {
  ids: ["m-1", "m-2"],
  key: KEY,
  pinnedAtIso: "2026-10-28T08:00:00.000Z",
  schemaVersion: 1,
  slug: SLUG,
};

/** One row read off the board. */
function row({
  slug = SLUG,
  status,
  authoredStatus = status,
  archived = false,
  settlement,
  settlementWitness,
}: {
  slug?: string;
  status: DocStatus;
  authoredStatus?: DocStatus;
  archived?: boolean;
  settlement?: AskSettlement;
  settlementWitness?: string;
}): TriageRowRead {
  return ok({ archived, authoredStatus, settlement, settlementWitness, slug, status });
}

/** The card row as `derivedRowState` reads one settled `filed` — `done`, which is what misled the seat. */
const FILED = row({ settlement: "filed", settlementWitness: OPEN_ASK, status: "done" });

describe("triageCardStanding — whether one pin's card still stands open", () => {
  it("is carded when the card was filed into an ask that is still open (the regression)", () => {
    expect(triageCardStanding({ card: CARD, row: FILED, witness: row({ slug: OPEN_ASK, status: "ready" }) })).toEqual({
      carded: true,
      filedInto: OPEN_ASK,
      key: KEY,
      line: `card ${SLUG} was filed into ${OPEN_ASK}, still ready`,
      reason: "filed-open",
      slug: SLUG,
    });
  });

  it.each(["draft", "ready", "in-progress", "paused"] as const)("is carded when filed into a %s row", (status) => {
    expect(triageCardStanding({ card: CARD, row: FILED, witness: row({ slug: OPEN_ASK, status }) }).carded).toBe(true);
  });

  it.each(["done", "cancelled", "rejected"] as const)("is not carded when filed into a %s row", (status) => {
    expect(triageCardStanding({ card: CARD, row: FILED, witness: row({ slug: OPEN_ASK, status }) })).toEqual({
      carded: false,
      filedInto: OPEN_ASK,
      key: KEY,
      line: `card ${SLUG} was filed into ${OPEN_ASK}, which is ${status}`,
      reason: "terminal",
      slug: SLUG,
    });
  });

  it("is not carded, and says so as unreadable, when the filed witness row did not read", () => {
    const witness = err(
      DerivedRowReadErrors.unreadable({ slug: OPEN_ASK, why: "1 run-journal line(s) did not decode" }),
    );
    const standing = triageCardStanding({ card: CARD, row: FILED, witness });
    expect(standing.carded).toBe(false);
    expect(standing.reason).toBe("unreadable");
    expect(standing.line).toBe(
      `card ${SLUG} was filed into ${OPEN_ASK}, and the board row ${OPEN_ASK} did not read whole — ` +
        "1 run-journal line(s) did not decode",
    );
  });

  it("is not carded when the filed witness row is missing", () => {
    const witness = err(DerivedRowReadErrors.missing({ slug: OPEN_ASK }));
    expect(triageCardStanding({ card: CARD, row: FILED, witness }).reason).toBe("missing");
  });

  it("is not carded, as unreadable, when the card was filed into no row", () => {
    const filedNowhere = row({ settlement: "filed", status: "done" });
    expect(triageCardStanding({ card: CARD, row: filedNowhere, witness: null })).toEqual({
      carded: false,
      filedInto: null,
      key: KEY,
      line: `card ${SLUG} was settled filed into no board row, so nothing says it is still open`,
      reason: "unreadable",
      slug: SLUG,
    });
  });

  it.each(["draft", "ready", "in-progress", "paused"] as const)(
    "is carded when the card row itself is %s and unsettled",
    (status) => {
      expect(triageCardStanding({ card: CARD, row: row({ status }), witness: null })).toEqual({
        carded: true,
        filedInto: null,
        key: KEY,
        line: `card ${SLUG} is ${status}, unanswered`,
        reason: "open-row",
        slug: SLUG,
      });
    },
  );

  it.each(["done", "cancelled", "rejected"] as const)("is not carded when the card row is %s", (status) => {
    expect(triageCardStanding({ card: CARD, row: row({ status }), witness: null }).reason).toBe("terminal");
  });

  it.each(["answered", "declined"] as const)("is not carded when the card was settled %s", (settlement) => {
    const settled = row({ settlement, settlementWitness: "anchor", status: "done" });
    expect(triageCardStanding({ card: CARD, row: settled, witness: null })).toEqual({
      carded: false,
      filedInto: null,
      key: KEY,
      line: `card ${SLUG} was settled ${settlement}`,
      reason: "settled",
      slug: SLUG,
    });
  });

  it("is not carded, as unreadable, when the card row's status could not be read", () => {
    expect(triageCardStanding({ card: CARD, row: row({ status: "unknown" }), witness: null })).toEqual({
      carded: false,
      filedInto: null,
      key: KEY,
      line: `card ${SLUG} declares a status the board could not read (unknown), so nothing proves it open`,
      reason: "unreadable",
      slug: SLUG,
    });
  });

  it("is not carded, as unreadable, when a filed card's own authored status could not be read", () => {
    const damaged = row({
      authoredStatus: "unknown",
      settlement: "filed",
      settlementWitness: OPEN_ASK,
      status: "done",
    });
    const witness = row({ slug: OPEN_ASK, status: "ready" });
    expect(triageCardStanding({ card: CARD, row: damaged, witness })).toEqual({
      carded: false,
      filedInto: null,
      key: KEY,
      line: `card ${SLUG} declares a status the board could not read (unknown), so nothing proves it open`,
      reason: "unreadable",
      slug: SLUG,
    });
  });

  it("is not carded when the card row is archived, whatever it declares", () => {
    const archived = row({ archived: true, status: "ready" });
    expect(triageCardStanding({ card: CARD, row: archived, witness: null })).toEqual({
      carded: false,
      filedInto: null,
      key: KEY,
      line: `card ${SLUG} is archived`,
      reason: "terminal",
      slug: SLUG,
    });
  });

  it("is not carded when the row a card was filed into is archived", () => {
    const witness = row({ archived: true, slug: OPEN_ASK, status: "ready" });
    expect(triageCardStanding({ card: CARD, row: FILED, witness }).line).toBe(
      `card ${SLUG} was filed into ${OPEN_ASK}, which is archived`,
    );
    expect(triageCardStanding({ card: CARD, row: FILED, witness }).carded).toBe(false);
  });

  it("is not carded, as unreadable, when the filed witness's authored status could not be read", () => {
    const witness = row({ authoredStatus: "unknown", slug: OPEN_ASK, status: "ready" });
    const standing = triageCardStanding({ card: CARD, row: FILED, witness });
    expect([standing.carded, standing.reason, standing.filedInto]).toEqual([false, "unreadable", OPEN_ASK]);
  });

  it("is not carded, as unreadable, when the filed witness's status could not be read", () => {
    const standing = triageCardStanding({
      card: CARD,
      row: FILED,
      witness: row({ slug: OPEN_ASK, status: "unknown" }),
    });
    expect([standing.carded, standing.reason, standing.filedInto]).toEqual([false, "unreadable", OPEN_ASK]);
  });

  it("is not carded when the pin's card was never registered", () => {
    const missing = err(DerivedRowReadErrors.missing({ slug: SLUG }));
    expect(triageCardStanding({ card: CARD, row: missing, witness: null }).reason).toBe("missing");
  });

  it("is not carded, as unreadable, when the card row did not read", () => {
    const unread = err(DerivedRowReadErrors.unreadable({ slug: SLUG, why: "bad front matter" }));
    expect(triageCardStanding({ card: CARD, row: unread, witness: null })).toEqual({
      carded: false,
      filedInto: null,
      key: KEY,
      line: `the board row ${SLUG} did not read whole — bad front matter`,
      reason: "unreadable",
      slug: SLUG,
    });
  });
});

/** A standing for `key` with that reason. */
function standingOf({ key, slug, reason }: { key: string; slug: string; reason: TriageCardStanding["reason"] }) {
  const carded = reason === "open-row" || reason === "filed-open";
  return { carded, filedInto: null, key, line: slug, reason, slug } satisfies TriageCardStanding;
}

describe("standingsByKey — one standing per key", () => {
  it("keeps a carded pin over a closed and an unreadable one, whatever the order", () => {
    const folded = standingsByKey({
      standings: [
        standingOf({ key: KEY, reason: "terminal", slug: "a" }),
        standingOf({ key: KEY, reason: "unreadable", slug: "b" }),
        standingOf({ key: KEY, reason: "open-row", slug: "c" }),
        standingOf({ key: KEY, reason: "settled", slug: "d" }),
      ],
    });
    expect([...folded.values()].map((kept) => kept.slug)).toEqual(["c"]);
  });

  it("keeps an unreadable pin over a closed one, so it is reported", () => {
    const folded = standingsByKey({
      standings: [
        standingOf({ key: KEY, reason: "terminal", slug: "a" }),
        standingOf({ key: KEY, reason: "unreadable", slug: "b" }),
      ],
    });
    expect(folded.get(KEY)!.slug).toBe("b");
  });

  it("keeps the first of two carded pins, and keys apart", () => {
    const folded = standingsByKey({
      standings: [
        standingOf({ key: KEY, reason: "open-row", slug: "a" }),
        standingOf({ key: KEY, reason: "filed-open", slug: "b" }),
        standingOf({ key: "from:other@example.test", reason: "missing", slug: "c" }),
      ],
    });
    expect([...folded.entries()].map(([key, kept]) => `${key}=${kept.slug}`)).toEqual([
      `${KEY}=a`,
      "from:other@example.test=c",
    ]);
  });
});
