/*
 * `confirmSend`: a confirmation re-dates the reservation to the last real send, creates one when none exists,
 * records the message ts that tells a confirmed send from an abandoned reservation, and a legacy bare-ISO record
 * still reads as evidence. It moved here when `sendReservation.test.ts` was split by behaviour.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { confirmSend, peekSend, reserveSend } from "../../../../../outbound/slack/sendReservation.js";
import { home, KEY, NOW, useSendReservationHome, WINDOW } from "./harness.js";

useSendReservationHome();

describe("confirmSend", () => {
  it("re-dates the reservation so the window measures from the LAST real send", () => {
    // The gap it closes: an OVERRIDDEN duplicate really went out, so the window must restart from it. Without
    // re-dating, a third identical send just past the ORIGINAL window reads as fresh minutes after a send.
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-25T13:00:00.000Z", windowHours: WINDOW });
    confirmSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T11:30:00.000Z", sentTs: "1785000000.000100" }); // the overridden send
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: "2026-07-26T11:30:00.000Z",
      kind: "duplicate",
      sentTs: "1785000000.000100",
    });
  });

  it("creates the reservation when none exists yet", () => {
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000200" });
    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
      sentTs: "1785000000.000200",
    });
  });

  it("records the message ts, which is what tells a CONFIRMED send from an abandoned reservation", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    const beforeConfirming = peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });

    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000300" });
    const afterConfirming = peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });

    // Reserved-but-unconfirmed is the state a drip refuses to guess about; confirmed is the one it skips.
    expect(beforeConfirming).toEqual({ firstSentIso: NOW, kind: "duplicate" });
    expect(afterConfirming).toEqual({ firstSentIso: NOW, kind: "duplicate", sentTs: "1785000000.000300" });
  });

  it("reads a LEGACY bare-ISO reservation rather than treating it as no evidence", () => {
    // A record written before the JSON format existed must NOT re-parse as garbage: garbage reads as
    // `fresh`, and the very next run would cheerfully double-post it.
    mkdirSync(join(home, "ledgers", "slack-sends"), { recursive: true });
    writeFileSync(join(home, "ledgers", "slack-sends", KEY), NOW);

    expect(peekSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });
});
