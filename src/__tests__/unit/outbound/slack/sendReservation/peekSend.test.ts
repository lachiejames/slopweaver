/*
 * `peekSend`: a read-only look at a key's reservation — fresh when nothing was reserved, a duplicate an earlier
 * real send left, fresh again once it ages out, and never itself a reservation. It moved here when
 * `sendReservation.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { peekSend, reserveSend } from "../../../../../outbound/slack/sendReservation.js";
import { home, KEY, NOW, useSendReservationHome, WINDOW } from "./harness.js";

useSendReservationHome();

describe("peekSend", () => {
  it("is fresh when nothing has been reserved", () => {
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("RESERVES NOTHING — a peek leaves the next real send fresh", () => {
    peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("reports a duplicate an earlier real send left", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("reports fresh once the reservation has aged out", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-24T12:00:00.000Z", windowHours: WINDOW });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });
});
