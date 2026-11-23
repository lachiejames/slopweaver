/*
 * `settleFailedSend`: a boundary failure resolves its reservation by what it proves — released when Slack answered
 * `ok: false`, a composite send retracted or a guard refused before the wire; kept when the outcome is unread; and
 * confirmed when a posted message could not be retracted. It moved here when `sendReservation.test.ts` was split
 * by behaviour.
 */
import { describe, expect, it } from "vitest";

import { peekSend, reserveSend, settleFailedSend } from "../../../../../outbound/slack/sendReservation.js";
import { home, KEY, NOW, platformError, useSendReservationHome, WINDOW } from "./harness.js";

useSendReservationHome();

describe("settleFailedSend — a boundary failure resolves its reservation by what it proves", () => {
  it("RELEASES the reservation when Slack itself answered ok:false, so the retry is fresh", () => {
    // The measured case: a card died on channel_not_found and its reservation dangled for 24h.
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    const settled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    expect(settled).toEqual({ kind: "released", verdict: { kind: "rejected", providerCode: "channel_not_found" } });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("KEEPS the reservation, unconfirmed, when the failure was unread — a lost response may have landed", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    const settled = settleFailedSend({ duplicateKey: KEY, error: new Error("ETIMEDOUT"), home, nowIso: NOW });
    expect(settled).toEqual({ kind: "kept" });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("RELEASES when the composite send posted and then retracted — nothing is on the wire", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    const error = Object.assign(new Error("read-back found 0 files"), {
      deletedMessage: true,
      posted: { channel: "C1", ts: "1785000000.000100" },
    });
    expect(settleFailedSend({ duplicateKey: KEY, error, home, nowIso: NOW })).toEqual({
      kind: "released",
      verdict: { kind: "retracted" },
    });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("RELEASES when a transport guard refused before the wire — no request left", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    const error = Object.assign(new Error("slack post blocked because it repeats"), { refusedBeforeWire: true });
    expect(settleFailedSend({ duplicateKey: KEY, error, home, nowIso: NOW })).toEqual({
      kind: "released",
      verdict: { kind: "refused-before-wire" },
    });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("CONFIRMS with the ts when the composite send posted and could NOT retract — the message is visible", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    const error = Object.assign(new Error("read-back found 0 files; the message could ALSO not be deleted"), {
      deletedMessage: false,
      posted: { channel: "C1", ts: "1785000000.000100" },
    });
    expect(settleFailedSend({ duplicateKey: KEY, error, home, nowIso: NOW })).toEqual({
      kind: "confirmed",
      ts: "1785000000.000100",
    });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
      sentTs: "1785000000.000100",
    });
  });
});
