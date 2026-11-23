/*
 * The reservation record: a legacy bare-ISO reservation, once confirmed, reads back as a duplicate carrying its ts.
 */
import { describe, expect, it } from "vitest";
import { confirmSend, peekSend, reserveSend } from "../../../../../../outbound/slack/sendReservation.js";
import { freshHome, useFreshHomes, WINDOW } from "./harness.js";

useFreshHomes();

describe("the reservation record", () => {
  it("reads a LEGACY bare-ISO reservation as a duplicate with no confirmed ts", () => {
    const home = freshHome();
    reserveSend({ duplicateKey: "k", home, nowIso: "2026-07-26T09:00:00.000Z", windowHours: WINDOW });
    confirmSend({ duplicateKey: "k", home, nowIso: "2026-07-26T09:00:01.000Z", sentTs: "1700000000.000100" });

    const prior = peekSend({ duplicateKey: "k", home, nowIso: "2026-07-26T09:05:00.000Z", windowHours: WINDOW });

    expect(prior.kind === "duplicate" ? prior.sentTs : undefined).toBe("1700000000.000100");
    expect(prior.kind === "duplicate" ? prior.firstSentIso : "").toBe("2026-07-26T09:00:01.000Z");
  });
});
