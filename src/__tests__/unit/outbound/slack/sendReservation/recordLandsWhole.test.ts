/*
 * A record lands whole and leaves nothing beside it: a reservation, a confirmation and an override's re-take are
 * each the one file in the slot directory, and an empty or malformed slot a crash left is recovered once. It moved
 * here when `sendReservation.test.ts` was split by behaviour.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { claimSend, confirmSend, reserveSend } from "../../../../../outbound/slack/sendReservation.js";
import {
  CONFIRMED,
  home,
  KEY,
  NOW,
  seedSlot,
  slotNames,
  slotPath,
  slotRecord,
  useSendReservationHome,
  WINDOW,
} from "./harness.js";

/** A random claim id as the module mints one. */
const CLAIM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

useSendReservationHome();

describe("a record lands whole, and leaves nothing beside it", () => {
  it("a fresh reservation is the only file in the slot directory", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    expect(slotNames()).toEqual([KEY]);
    expect(Object.keys(slotRecord())).toEqual(["claim", "reservedIso"]);
    expect(slotRecord()["reservedIso"]).toBe(NOW);
    expect(slotRecord()["claim"]).toMatch(CLAIM_ID);
  });

  it("a confirmation is the only file in the slot directory", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000300" });
    expect(slotNames()).toEqual([KEY]);
    expect(readFileSync(slotPath(), "utf8")).toBe(JSON.stringify({ reservedIso: NOW, sentTs: "1785000000.000300" }));
  });

  it("an EMPTY slot, the state a crash between create and write left behind, is recovered once", () => {
    seedSlot({ raw: "" });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
    expect(slotNames()).toEqual([KEY]);
  });

  it("a MALFORMED record is recovered once", () => {
    seedSlot({ raw: "{not a record" });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
    expect(Object.keys(slotRecord())).toEqual(["claim", "reservedIso"]);
    expect(slotRecord()["reservedIso"]).toBe(NOW);
  });

  it("an override re-takes the slot as one fresh record", () => {
    seedSlot({ raw: CONFIRMED });
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: false },
      windowHours: WINDOW,
    });
    expect(claim).toEqual({ kind: "send" });
    expect(slotNames()).toEqual([KEY]);
    expect(Object.keys(slotRecord())).toEqual(["claim", "reservedIso", "prior"]);
    expect(slotRecord()["reservedIso"]).toBe(NOW);
  });
});
