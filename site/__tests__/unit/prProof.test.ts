import { describe, expect, it } from "vitest";

import { readCurrency } from "../../components/live/readCurrency";
import type { CurrencyPullRequest, CurrencyReading } from "../../lib/cardCurrency";
import { proofGapsOf } from "../../lib/prProof";

const GAP =
  'You asked for proof on acme/acme-admin#17564 on 2026-10-12 ("show me a screenshot") and its body still carries no screenshot.';

const unmet: CurrencyPullRequest = {
  identity: "acme/acme-admin#17564",
  proof: { gap: GAP, kind: "requested-and-unmet", missing: ["image", "run-link"] },
  rowSlugs: ["proof-row", "card-row"],
};

const readingOf = (pullRequests: readonly CurrencyPullRequest[] | undefined): CurrencyReading => ({
  checkedIso: "2026-10-14T08:00:00.000Z",
  ...(pullRequests === undefined ? {} : { pullRequests }),
  readFromIso: "2026-10-13T08:00:00.000Z",
  rows: [],
  sources: { chair: "3 turns", relays: "0 relays", voice: "1 call" },
});

const NAMED = ["acme/acme-admin#17564"];

describe("proofGapsOf", () => {
  it("leads an ask card whose board row names the pull request", () => {
    expect(
      proofGapsOf({
        card: { keys: ["ask:card-row"], named: NAMED, pullRequest: undefined },
        reading: readingOf([unmet]),
      }),
    ).toEqual([
      {
        identity: "acme/acme-admin#17564",
        sentence: GAP,
        short: "Still missing the proof you asked for on acme/acme-admin#17564: screenshot, Actions run link",
      },
    ]);
  });

  it("leads a hand step through the ask it opens, and a pull request's own card by its address, any case", () => {
    const hand = proofGapsOf({
      card: { keys: ["hand:h1", "ask:proof-row"], named: NAMED, pullRequest: undefined },
      reading: readingOf([unmet]),
    });
    const own = proofGapsOf({
      card: { keys: ["pr:17564"], named: undefined, pullRequest: "Acme/acme-admin#17564" },
      reading: readingOf([unmet]),
    });
    expect(hand.map((gap) => gap.identity)).toEqual(["acme/acme-admin#17564"]);
    expect(own.map((gap) => gap.identity)).toEqual(["acme/acme-admin#17564"]);
  });

  it("draws nothing on a card about another pull request, or a same-numbered one in another repo", () => {
    expect(
      proofGapsOf({
        card: { keys: ["ask:elsewhere"], named: NAMED, pullRequest: undefined },
        reading: readingOf([unmet]),
      }),
    ).toEqual([]);
    expect(
      proofGapsOf({
        card: { keys: ["pr:17564"], named: undefined, pullRequest: "acme/other#17564" },
        reading: readingOf([unmet]),
      }),
    ).toEqual([]);
  });

  it("draws nothing by slug when the row no longer names the pull request, or published nothing it names", () => {
    expect(
      proofGapsOf({
        card: { keys: ["ask:card-row"], named: ["acme/app#2"], pullRequest: undefined },
        reading: readingOf([unmet]),
      }),
    ).toEqual([]);
    expect(
      proofGapsOf({
        card: { keys: ["ask:card-row"], named: undefined, pullRequest: undefined },
        reading: readingOf([unmet]),
      }),
    ).toEqual([]);
  });

  it("draws nothing for a met ask, a body the tick could not read, or a reading with no verdicts", () => {
    const card = { keys: ["ask:card-row"], named: NAMED, pullRequest: undefined };
    const met: CurrencyPullRequest = { ...unmet, proof: { kind: "requested-and-met" } };
    const unread: CurrencyPullRequest = { ...unmet, proof: { kind: "body-unread", why: "GitHub said 502" } };
    expect(proofGapsOf({ card, reading: readingOf([met, unread]) })).toEqual([]);
    expect(proofGapsOf({ card, reading: readingOf(undefined) })).toEqual([]);
    expect(proofGapsOf({ card, reading: undefined })).toEqual([]);
  });
});

describe("readCurrency's pull requests", () => {
  it("round-trips every verdict kind, and leaves the field off a reading recorded before it existed", () => {
    const every = readingOf([
      unmet,
      { ...unmet, identity: "a/b#1", proof: { kind: "requested-and-met" } },
      { ...unmet, identity: "a/b#2", proof: { kind: "body-unread", why: "GitHub said 502" } },
    ]);
    expect(readCurrency(JSON.parse(JSON.stringify(every)))).toEqual(every);
    expect(readCurrency(JSON.parse(JSON.stringify(readingOf(undefined))))).toEqual(readingOf(undefined));
  });

  it("drops the whole document over a verdict that will not read, rather than lose a gap", () => {
    const withProof = (proof: unknown): unknown => ({ ...readingOf(undefined), pullRequests: [{ ...unmet, proof }] });
    expect(readCurrency(withProof({ gap: GAP, kind: "requested-and-unmet", missing: ["video"] }))).toBeUndefined();
    expect(readCurrency(withProof({ gap: GAP, kind: "requested-and-unmet", missing: [] }))).toBeUndefined();
    expect(readCurrency(withProof({ gap: "", kind: "requested-and-unmet", missing: ["image"] }))).toBeUndefined();
    expect(readCurrency(withProof({ kind: "body-unread" }))).toBeUndefined();
    expect(readCurrency(withProof({ kind: "proved" }))).toBeUndefined();
    expect(readCurrency({ ...readingOf(undefined), pullRequests: "acme/acme-admin#17564" })).toBeUndefined();
  });
});
