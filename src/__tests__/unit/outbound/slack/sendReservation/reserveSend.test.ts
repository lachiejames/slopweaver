/*
 * `reserveSend`: a key's first reservation is fresh, a repeat inside the window is a duplicate naming the first
 * send, an aged-out one is taken over and re-dated, and exactly one of many callers wins. It moved here when
 * `sendReservation.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { reserveSend } from "../../../../../outbound/slack/sendReservation.js";
import { home, KEY, NOW, useSendReservationHome, WINDOW } from "./harness.js";

const OTHER_KEY = "b".repeat(64);

useSendReservationHome();

describe("reserveSend", () => {
  it("is fresh the first time", () => {
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("is a duplicate the second time, reporting when the first send was", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-26T12:00:05.000Z", windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("is fresh for a different key", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    expect(reserveSend({ duplicateKey: OTHER_KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      kind: "fresh",
    });
  });

  it("is fresh again once the prior reservation has aged out", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-24T12:00:00.000Z", windowHours: WINDOW });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });

  it("re-dates the reservation when it takes over an aged-out one", () => {
    reserveSend({ duplicateKey: KEY, home, nowIso: "2026-07-24T12:00:00.000Z", windowHours: WINDOW });
    reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({
      firstSentIso: NOW,
      kind: "duplicate",
    });
  });

  it("lets exactly ONE of many callers win the same key", () => {
    const outcomes = Array.from({ length: 20 }, () =>
      reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW }),
    );
    expect(outcomes.filter((outcome) => outcome.kind === "fresh").length).toBe(1);
    expect(outcomes.filter((outcome) => outcome.kind === "duplicate").length).toBe(19);
  });

  it("creates the reservation directory under the home rather than failing", () => {
    const fresh = mkdtempSync(join(tmpdir(), "slop-send-reservation-empty-"));
    expect(reserveSend({ duplicateKey: KEY, home: fresh, nowIso: NOW, windowHours: WINDOW })).toEqual({
      kind: "fresh",
    });
    rmSync(fresh, { force: true, recursive: true });
  });
});
