import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  confirmSlot,
  ensureSlotDir,
  readReservation,
  releaseOwnTake,
  reservationPath,
  retakeSlot,
  settledHere,
  takeSlot,
} from "../../../../outbound/slack/sendReservationSlot.js";

const KEY = "c".repeat(64);
const NOW = "2026-07-26T12:00:00.000Z";
const EARLIER = "2026-07-26T11:00:00.000Z";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-send-slot-"));
  ensureSlotDir({ home });
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** KEY's slot path under this test's home. */
function slot(): string {
  return reservationPath({ duplicateKey: KEY, home });
}

describe("readReservation", () => {
  it("reads the legacy bare-instant record as a reservation, never as no evidence", () => {
    writeFileSync(slot(), `${EARLIER}\n`);
    expect(readReservation({ path: slot() })).toEqual({ reservedIso: EARLIER });
  });

  it("reads a record's claim, confirmed ts and prior", () => {
    writeFileSync(
      slot(),
      JSON.stringify({ claim: "k1", prior: { reservedIso: EARLIER, sentTs: "1.2" }, reservedIso: NOW, sentTs: "3.4" }),
    );
    expect(readReservation({ path: slot() })).toEqual({
      claim: "k1",
      prior: { reservedIso: EARLIER, sentTs: "1.2" },
      reservedIso: NOW,
      sentTs: "3.4",
    });
  });

  it("reads an empty, malformed or absent slot as undefined", () => {
    expect(readReservation({ path: slot() })).toBe(undefined);
    writeFileSync(slot(), "");
    expect(readReservation({ path: slot() })).toBe(undefined);
    writeFileSync(slot(), "{not json");
    expect(readReservation({ path: slot() })).toBe(undefined);
  });
});

describe("takeSlot", () => {
  it("lands one whole record in an empty slot and leaves no staging file beside it", () => {
    expect(takeSlot({ nowIso: NOW, path: slot() })).toBe(true);
    expect(readReservation({ path: slot() })!.reservedIso).toBe(NOW);
    expect(readdirSync(join(slot(), "..")).toSorted()).toEqual([KEY]);
    settledHere({ path: slot() });
  });

  it("refuses an occupied slot and leaves what stands there untouched", () => {
    writeFileSync(slot(), JSON.stringify({ reservedIso: EARLIER }));
    expect(takeSlot({ nowIso: NOW, path: slot() })).toBe(false);
    expect(readFileSync(slot(), "utf8")).toBe(JSON.stringify({ reservedIso: EARLIER }));
  });
});

describe("retakeSlot and releaseOwnTake", () => {
  it("a re-take keeps what it replaced, and its release puts exactly that back", () => {
    const landed = JSON.stringify({ reservedIso: EARLIER, sentTs: "1785000000.000100" });
    writeFileSync(slot(), landed);
    expect(retakeSlot({ duplicateKey: KEY, home, nowIso: NOW })).toBe(true);
    expect(readReservation({ path: slot() })!.prior).toEqual({ reservedIso: EARLIER, sentTs: "1785000000.000100" });
    expect(releaseOwnTake({ duplicateKey: KEY, home })).toBe(true);
    settledHere({ path: slot() });
    expect(readFileSync(slot(), "utf8")).toBe(landed);
  });

  it("a re-take with an undatable instant writes nothing", () => {
    writeFileSync(slot(), JSON.stringify({ reservedIso: EARLIER }));
    expect(retakeSlot({ duplicateKey: KEY, home, nowIso: "whenever" })).toBe(false);
    expect(readFileSync(slot(), "utf8")).toBe(JSON.stringify({ reservedIso: EARLIER }));
  });

  it("never releases a reservation this process did not take", () => {
    writeFileSync(slot(), JSON.stringify({ claim: "someone-else", reservedIso: NOW }));
    expect(releaseOwnTake({ duplicateKey: KEY, home })).toBe(false);
    expect(readReservation({ path: slot() })!.claim).toBe("someone-else");
  });
});

describe("confirmSlot", () => {
  it("never dates the slot earlier than the reservation standing there", () => {
    writeFileSync(slot(), JSON.stringify({ reservedIso: NOW }));
    expect(confirmSlot({ duplicateKey: KEY, home, nowIso: EARLIER, sentTs: "9.9" })).toBe(true);
    expect(readFileSync(slot(), "utf8")).toBe(JSON.stringify({ reservedIso: NOW, sentTs: "9.9" }));
  });
});
