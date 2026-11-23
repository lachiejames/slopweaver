/*
 * `claimSend`, the shared verdict every lane sends on: a fresh key sends, a confirmed prior is already sent, an
 * unconfirmed one halts unless `--resend-unconfirmed` or the door override permits a repeat, and neither flag
 * repeats more than it names. It moved here when `sendReservation.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { claimSend, confirmSend, peekSend, reserveSend } from "../../../../../outbound/slack/sendReservation.js";
import { home, KEY, NOW, useSendReservationHome, WINDOW } from "./harness.js";

const NO_RESEND = { landed: false, unconfirmed: false } as const;

useSendReservationHome();

describe("claimSend — the shared verdict every lane sends on", () => {
  it("SENDS a fresh key, and holds the reservation afterwards", () => {
    expect(claimSend({ duplicateKey: KEY, home, nowIso: NOW, resend: NO_RESEND, windowHours: WINDOW })).toEqual({
      kind: "send",
    });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("reports a CONFIRMED prior as already sent, with its ts, when nothing permits a repeat", () => {
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000100" });
    expect(claimSend({ duplicateKey: KEY, home, nowIso: NOW, resend: NO_RESEND, windowHours: WINDOW })).toEqual({
      kind: "already-sent",
      ts: "1785000000.000100",
    });
  });

  it("halts on an UNCONFIRMED prior when nothing permits a resend — the honest state for an unread outcome", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T11:00:00.000Z", windowHours: WINDOW });
    expect(claimSend({ duplicateKey: KEY, home, nowIso: NOW, resend: NO_RESEND, windowHours: WINDOW })).toEqual({
      kind: "unconfirmed",
      reservedIso: "2026-07-26T11:00:00.000Z",
    });
  });

  it("SENDS an unconfirmed prior under --resend-unconfirmed, and re-dates the reservation to now", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T11:00:00.000Z", windowHours: WINDOW });
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: false, unconfirmed: true },
      windowHours: WINDOW,
    });
    expect(claim).toEqual({ kind: "send" });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("does NOT let --resend-unconfirmed repeat a prior that LANDED — the flag never meant 'repeat it'", () => {
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000100" });
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: false, unconfirmed: true },
      windowHours: WINDOW,
    });
    expect(claim).toEqual({ kind: "already-sent", ts: "1785000000.000100" });
  });

  it("SENDS a landed prior under the door override — 'post it again, I mean it' must post again", () => {
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000100" });
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: false },
      windowHours: WINDOW,
    });
    expect(claim).toEqual({ kind: "send" });
  });

  it("SENDS an unconfirmed prior under the door override too — repeating regardless covers the unknown case", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T11:00:00.000Z", windowHours: WINDOW });
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: false },
      windowHours: WINDOW,
    });
    expect(claim).toEqual({ kind: "send" });
  });
});
