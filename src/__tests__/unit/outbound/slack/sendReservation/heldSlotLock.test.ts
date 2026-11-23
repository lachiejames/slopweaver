/*
 * A slot whose lock another caller holds: every change fails closed — no takeover, no confirmation, no release and
 * no override send while the lock is busy or the lock directory is broken — and normal service resumes once the
 * holder releases. It moved here when `sendReservation.test.ts` was split by behaviour.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireOperationLock, type OperationLockHandle } from "../../../../../admit/operationLock.js";
import { unwrap } from "../../../../../lib/result.js";
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
  slotPath,
  UNCONFIRMED,
  useSendReservationHome,
  WINDOW,
} from "./harness.js";

/** Hold KEY's slot lock the way another process mid-decision would. This process is alive, so it is never stale. */
function holdSlotLock(): OperationLockHandle {
  return unwrap(
    acquireOperationLock({ home, key: `slack-send:${KEY}`, nowIso: NOW, staleAfterMs: Number.POSITIVE_INFINITY }),
  );
}

useSendReservationHome();

describe("a slot whose lock another caller holds — every change fails closed", () => {
  it("does NOT take over an aged slot: it reads as a duplicate and the record is left exactly as it was", () => {
    seedSlot({ raw: AGED });
    const held = holdSlotLock();
    const verdict = reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    held.release();
    expect(verdict).toEqual({ firstSentIso: NOW, kind: "duplicate" });
    expect(readFileSync(slotPath(), "utf8")).toBe(AGED);
  });

  it("reports a live record as itself while the lock is busy, confirmed ts included", () => {
    seedSlot({ raw: CONFIRMED });
    const held = holdSlotLock();
    const verdict = reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    held.release();
    expect(verdict).toEqual({
      firstSentIso: "2026-07-26T11:00:00.000Z",
      kind: "duplicate",
      sentTs: "1785000000.000100",
    });
  });

  it("does not confirm: the reservation stays claimed-but-unconfirmed rather than being rewritten", () => {
    seedSlot({ raw: UNCONFIRMED });
    const held = holdSlotLock();
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000200" });
    held.release();
    expect(readFileSync(slotPath(), "utf8")).toBe(UNCONFIRMED);
  });

  it("reports a provider-proven failure it could not release as KEPT, never as released", () => {
    seedSlot({ raw: UNCONFIRMED });
    const held = holdSlotLock();
    const settled = settleFailedSend({
      duplicateKey: KEY,
      error: platformError({ error: "channel_not_found" }),
      home,
      nowIso: NOW,
    });
    held.release();
    expect(settled).toEqual({ kind: "kept" });
    expect(readFileSync(slotPath(), "utf8")).toBe(UNCONFIRMED);
  });

  it("never turns an override into a send it could not reserve — unconfirmed stays unconfirmed", () => {
    seedSlot({ raw: UNCONFIRMED });
    const held = holdSlotLock();
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: true },
      windowHours: WINDOW,
    });
    held.release();
    expect(claim).toEqual({ kind: "unconfirmed", reservedIso: "2026-07-26T11:00:00.000Z" });
  });

  it("never turns the door override into a send it could not reserve — landed stays already-sent", () => {
    seedSlot({ raw: CONFIRMED });
    const held = holdSlotLock();
    const claim = claimSend({
      duplicateKey: KEY,
      home,
      nowIso: NOW,
      resend: { landed: true, unconfirmed: false },
      windowHours: WINDOW,
    });
    held.release();
    expect(claim).toEqual({ kind: "already-sent", ts: "1785000000.000100" });
  });

  it("fails closed, never throws, when the shared lock directory itself is broken", () => {
    seedSlot({ raw: UNCONFIRMED });
    // The lock directory is a FILE, so taking any operation lock throws from its `mkdir`.
    writeFileSync(join(home, "ledgers", "operation-locks"), "not a directory");
    const verdict = reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW });
    confirmSend({ duplicateKey: KEY, home, nowIso: NOW, sentTs: "1785000000.000200" });
    expect(verdict).toEqual({ firstSentIso: "2026-07-26T11:00:00.000Z", kind: "duplicate" });
    expect(readFileSync(slotPath(), "utf8")).toBe(UNCONFIRMED);
  });

  it("goes back to normal once the holder releases", () => {
    seedSlot({ raw: AGED });
    holdSlotLock().release();
    expect(reserveSend({ duplicateKey: KEY, home, nowIso: NOW, windowHours: WINDOW })).toEqual({ kind: "fresh" });
  });
});
