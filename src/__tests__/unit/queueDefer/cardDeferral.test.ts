/**
 * The "Come back to it" fold: newest press per card wins, a restore puts the card back, a re-defer sorts by its new
 * press, and a row naming no Queue register never reads.
 */
import { describe, expect, it } from "vitest";

import { QUEUE_KINDS } from "../../../hand/consoleLinkNames.js";
import {
  type CardDeferralRow,
  cardDeferralRowOf,
  DEFERRABLE_KINDS,
  deferrableCardKey,
  standingDeferrals,
} from "../../../queueDefer/cardDeferral.js";

/** One press. */
function press({
  cardKey,
  action,
  pressedIso,
}: {
  cardKey: string;
  action: CardDeferralRow["action"];
  pressedIso: string;
}): CardDeferralRow {
  return { action, bySession: "work-console", cardKey, pressedIso };
}

describe("standingDeferrals", () => {
  it("is empty over an empty ledger", () => {
    expect(standingDeferrals({ rows: [] })).toEqual([]);
  });

  it("keeps the cards still put off, oldest deferral first, and drops one the owner brought back up", () => {
    const rows = [
      press({ action: "defer", cardKey: "ask:policy-approvals", pressedIso: "2026-10-05T11:58:00.000Z" }),
      press({ action: "defer", cardKey: "hand:datadog-key", pressedIso: "2026-10-05T11:50:00.000Z" }),
      press({ action: "defer", cardKey: "pr:1881", pressedIso: "2026-10-05T12:10:00.000Z" }),
      press({ action: "restore", cardKey: "pr:1881", pressedIso: "2026-10-05T12:20:00.000Z" }),
    ];
    expect(standingDeferrals({ rows })).toEqual([
      { cardKey: "hand:datadog-key", deferredIso: "2026-10-05T11:50:00.000Z" },
      { cardKey: "ask:policy-approvals", deferredIso: "2026-10-05T11:58:00.000Z" },
    ]);
  });

  it("dates a card put off again after a restore by its newest press", () => {
    const rows = [
      press({ action: "defer", cardKey: "ask:policy-approvals", pressedIso: "2026-10-05T11:58:00.000Z" }),
      press({ action: "defer", cardKey: "hand:datadog-key", pressedIso: "2026-10-05T12:00:00.000Z" }),
      press({ action: "restore", cardKey: "ask:policy-approvals", pressedIso: "2026-10-05T12:05:00.000Z" }),
      press({ action: "defer", cardKey: "ask:policy-approvals", pressedIso: "2026-10-05T12:30:00.000Z" }),
    ];
    expect(standingDeferrals({ rows })).toEqual([
      { cardKey: "hand:datadog-key", deferredIso: "2026-10-05T12:00:00.000Z" },
      { cardKey: "ask:policy-approvals", deferredIso: "2026-10-05T12:30:00.000Z" },
    ]);
  });

  // A come-back's retry read the ledger, the owner pressed "Bring it back up", then the retry appended.
  it("lets a later press beat an older-dated row appended after it, and a restore win a tie either way", () => {
    const rows = [
      press({ action: "restore", cardKey: "ask:policy-approvals", pressedIso: "2026-10-05T12:42:01.000Z" }),
      press({ action: "defer", cardKey: "ask:policy-approvals", pressedIso: "2026-10-05T12:37:16.000Z" }),
      press({ action: "restore", cardKey: "pr:1881", pressedIso: "2026-10-05T12:20:00.000Z" }),
      press({ action: "defer", cardKey: "pr:1881", pressedIso: "2026-10-05T12:20:00.000Z" }),
      press({ action: "defer", cardKey: "pr:1885", pressedIso: "2026-10-05T12:25:00.000Z" }),
      press({ action: "restore", cardKey: "pr:1885", pressedIso: "2026-10-05T12:25:00.000Z" }),
      press({ action: "defer", cardKey: "hand:datadog-key", pressedIso: "2026-10-05T12:30:00.000Z" }),
      press({ action: "defer", cardKey: "hand:datadog-key", pressedIso: "2026-10-05T12:30:00.000Z" }),
    ];
    expect(standingDeferrals({ rows })).toEqual([
      { cardKey: "hand:datadog-key", deferredIso: "2026-10-05T12:30:00.000Z" },
    ]);
  });
});

describe("cardDeferralRowOf", () => {
  const good = { action: "defer", bySession: "work-console", cardKey: "ask:x", pressedIso: "2026-10-05T11:58:00.000Z" };

  it("reads a good row and refuses an act card, a stray field, a bad action and a bad instant", () => {
    expect([
      cardDeferralRowOf({ value: good }),
      cardDeferralRowOf({ value: { ...good, cardKey: "act:x" } }),
      cardDeferralRowOf({ value: { ...good, rank: 1 } }),
      cardDeferralRowOf({ value: { ...good, action: "snooze" } }),
      cardDeferralRowOf({ value: { ...good, pressedIso: "yesterday" } }),
      cardDeferralRowOf({ value: "ask:x" }),
    ]).toEqual([good, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("deferrableCardKey", () => {
  it("joins a Queue register's kind to an id, and refuses an act, an unknown kind, an id with a colon and a bare pull request number", () => {
    expect([
      deferrableCardKey({ id: "policy-approvals", kind: "ask" }),
      deferrableCardKey({ id: "acme.widgets.42", kind: "pr" }),
      deferrableCardKey({ id: "x", kind: "act" }),
      deferrableCardKey({ id: "x", kind: "recipe" }),
      deferrableCardKey({ id: "a:b", kind: "pr" }),
      deferrableCardKey({ id: "42", kind: "pr" }),
    ]).toEqual(["ask:policy-approvals", "pr:acme.widgets.42", undefined, undefined, undefined, undefined]);
  });

  it("names every register the Queue draws bar the Alignment page's acts", () => {
    expect(DEFERRABLE_KINDS).toEqual(QUEUE_KINDS.filter((kind) => kind !== "act"));
  });
});
