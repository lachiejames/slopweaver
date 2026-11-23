/*
 * A release drops only the reservation this process took: a late or reordered proven failure never empties a slot
 * another send — or this process's own newer send — took, a late confirmation never back-dates a newer
 * reservation, and an override's proven failure puts back the reservation it replaced. It moved here when
 * `sendReservation.test.ts` was split by behaviour.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  claimSend,
  confirmSend,
  reserveSend,
  settleFailedSend,
} from "../../../../../outbound/slack/sendReservation.js";
import {
  AGED,
  CONFIRMED,
  home,
  KEY,
  NOW,
  platformError,
  seedSlot,
  slotNames,
  slotPath,
  slotRecord,
  UNCONFIRMED,
  useSendReservationHome,
  WINDOW,
} from "./harness.js";

useSendReservationHome();

describe("a release drops only the reservation this process took", () => {
  /** Another sender's reservation, as a process that took the slot after ours aged out would leave it. */
  const THEIRS = JSON.stringify({ claim: "00000000-0000-4000-8000-000000000000", reservedIso: NOW });

  it("a provider-proven failure settled AFTER another send took the slot keeps that send's reservation", () => {
    // The ABA order: we reserve, the slot ages out, another process takes it fresh, and only then does our
    // send's `channel_not_found` settle. Releasing blindly would empty the slot and let a third send post too.
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    seedSlot({ raw: THEIRS });
    const settled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(settled).toEqual({ kind: "kept" });
    expect(readFileSync(slotPath(), "utf8")).toBe(THEIRS);
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("a late failure of THIS process's older send keeps its own newer reservation of the same message", () => {
    // One process reserves, the slot ages out, the same process reserves again, and
    // only then does the FIRST send's channel_not_found settle. The newer claim is this process's too, so a
    // claim check alone would release it and let a third send claim the slot fresh.
    const earlier = "2026-07-24T00:00:00.000Z";
    const later = "2026-07-26T00:00:00.000Z";
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: earlier, windowHours: WINDOW })).toEqual({ kind: "fresh" });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: later, windowHours: WINDOW })).toEqual({ kind: "fresh" });
    const firstSettled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: later,
    });
    expect(firstSettled).toEqual({ kind: "kept" });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: later, windowHours: WINDOW })).toEqual({
      firstSentIso: later,
      kind: "duplicate",
    });
    // Two takes were in flight at once, so even the newer send's own proven failure cannot be told apart from
    // a late one of the older send. It keeps: one over-warning, never a slot emptied under a live send.
    const secondSettled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: later,
    });
    expect(secondSettled).toEqual({ kind: "kept" });
    expect(Object.keys(slotRecord())).toEqual(["claim", "reservedIso"]);
    expect(slotRecord()["reservedIso"]).toBe(later);
  });

  it("settled in the REVERSE order, an older send's proven failure still keeps the newer reservation", () => {
    // The newer send settles first, ambiguously, and only then does the older send's
    // channel_not_found arrive. A count of takes in flight is back to one by then, so only remembering that
    // the two overlapped keeps the newer send's reservation in place.
    const earlier = "2026-07-24T00:00:00.000Z";
    const later = "2026-07-26T00:00:00.000Z";
    reserveSend({ duplicateKey: KEY, home, nowIso: earlier, windowHours: WINDOW });
    reserveSend({ duplicateKey: KEY, home, nowIso: later, windowHours: WINDOW });
    expect(settleFailedSend({ duplicateKey: KEY, error: new Error("ETIMEDOUT"), home, nowIso: later })).toEqual({
      kind: "kept",
    });
    const olderSettled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: later,
    });
    expect(olderSettled).toEqual({ kind: "kept" });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T01:00:00.000Z", windowHours: WINDOW })).toEqual({
      firstSentIso: later,
      kind: "duplicate",
    });
  });

  it("once every overlapping take has settled, the next send's own proven failure releases normally", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-22T00:00:00.000Z", windowHours: WINDOW });
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-24T00:00:00.000Z", windowHours: WINDOW });
    settleFailedSend({ duplicateKey: KEY, error: new Error("ETIMEDOUT"), home, nowIso: NOW });
    settleFailedSend({ duplicateKey: KEY, error: new Error("ETIMEDOUT"), home, nowIso: NOW });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
    const settled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(settled).toEqual({ kind: "released", verdict: { kind: "rejected", providerCode: "channel_not_found" } });
    expect(slotNames()).toEqual([]);
  });

  it("a late confirmation of an older send never back-dates a newer reservation out of its window", () => {
    // The older send's confirm lands after a newer send took the aged slot. Written with the
    // older instant, the slot would read as aged an hour later and a third send would claim it fresh.
    const later = "2026-07-26T12:00:00.000Z";
    seedSlot({ raw: JSON.stringify({ claim: "00000000-0000-4000-8000-000000000000", reservedIso: later }) });
    confirmSend({ duplicateKey: KEY, home, nowIso: "2026-07-24T10:01:00.000Z", sentTs: "1785000000.000400" });
    expect(readFileSync(slotPath(), "utf8")).toBe(JSON.stringify({ reservedIso: later, sentTs: "1785000000.000400" }));
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T13:00:00.000Z", windowHours: WINDOW })).toEqual({
      firstSentIso: later,
      kind: "duplicate",
      sentTs: "1785000000.000400",
    });
  });

  it("a late confirmation whose instant cannot be dated never replaces a reservation's datable one", () => {
    // An unparseable confirm instant written over a live reservation reads as aged.
    const later = "2026-07-26T12:00:00.000Z";
    seedSlot({ raw: JSON.stringify({ claim: "00000000-0000-4000-8000-000000000000", reservedIso: later }) });
    confirmSend({ duplicateKey: KEY, home, nowIso: "not-an-iso", sentTs: "1785000000.000500" });
    expect(readFileSync(slotPath(), "utf8")).toBe(JSON.stringify({ reservedIso: later, sentTs: "1785000000.000500" }));
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T13:00:00.000Z", windowHours: WINDOW })).toEqual({
      firstSentIso: later,
      kind: "duplicate",
      sentTs: "1785000000.000500",
    });
  });

  it("a reserve whose instant cannot be dated is never fresh and leaves the slot untouched", () => {
    seedSlot({ raw: AGED });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: "not-an-iso", windowHours: WINDOW })).toEqual({
      firstSentIso: "not-an-iso",
      kind: "duplicate",
    });
    expect(readFileSync(slotPath(), "utf8")).toBe(AGED);
  });

  it("a reservation this process never took is kept even when it carries no claim at all", () => {
    seedSlot({ raw: UNCONFIRMED });
    const settled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(settled).toEqual({ kind: "kept" });
    expect(readFileSync(slotPath(), "utf8")).toBe(UNCONFIRMED);
  });

  it("an override's re-take keeps the reservation it replaced as its prior", () => {
    seedSlot({ raw: CONFIRMED });
    claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: false },
      windowHours: WINDOW,
    });
    expect(slotRecord()["prior"]).toEqual({ reservedIso: "2026-07-26T11:00:00.000Z", sentTs: "1785000000.000100" });
    expect(slotRecord()["reservedIso"]).toBe(NOW);
  });

  it("an override's proven failure puts back the landed send it was repeating, never an empty slot", () => {
    seedSlot({ raw: CONFIRMED });
    claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: false },
      windowHours: WINDOW,
    });
    const settled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(settled).toEqual({ kind: "released", verdict: { kind: "rejected", providerCode: "channel_not_found" } });
    expect(readFileSync(slotPath(), "utf8")).toBe(CONFIRMED);
    expect(slotNames()).toEqual([KEY]);
    expect(
      claimSend({
        duplicateKey: KEY,
        home,
        nowIso: "2026-07-26T12:00:05.000Z",
        resend: { landed: false, unconfirmed: false },
        windowHours: WINDOW,
      }),
    ).toEqual({ kind: "already-sent", ts: "1785000000.000100" });
  });

  it("a resend-unconfirmed's proven failure puts back the unconfirmed reservation it replaced", () => {
    seedSlot({ raw: UNCONFIRMED });
    claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: false, unconfirmed: true },
      windowHours: WINDOW,
    });
    settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(readFileSync(slotPath(), "utf8")).toBe(UNCONFIRMED);
  });

  it("a fresh send's proven failure still empties the slot, because it replaced nothing", () => {
    claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: false, unconfirmed: false },
      windowHours: WINDOW,
    });
    settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(slotNames()).toEqual([]);
  });
});
