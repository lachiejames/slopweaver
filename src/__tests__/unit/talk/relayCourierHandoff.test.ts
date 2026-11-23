/**
 * Holding a spoken console relay for the chair's quiet batch: `held` is written on the turn BEFORE its request is
 * queued, a retry only re-queues, and a turn already on its way is never held again.
 *
 * deleted-with-code: handToCourier
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, unwrap } from "../../../lib/result.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import { HELD_DETAIL, holdForChair } from "../../../talk/relayCourierHandoff.js";
import { courierTurns, type enqueueCourier, RelayCourierErrors } from "../../../talk/relayCourierStore.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { claimTurn, markDelivered, markRegistered, readTurn, type TurnRecord } from "../../../talk/relayStore.js";

const TURN = "951b9e45-6fc9-45fd-8e25-d04ded7164c9";
const NOW = "2026-10-17T07:00:00.000Z";
const RETRY = "2026-10-17T07:00:20.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "courier-hold-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One registered turn carrying no delivery. */
function registeredTurn(): TurnRecord {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "ship the courier",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "Ship the courier",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  const claimed = unwrap(claimTurn({ draft, home, nowIso: NOW })).record;
  return unwrap(markRegistered({ home, nowIso: NOW, record: claimed }));
}

const HELD: Delivery = { atIso: NOW, detail: HELD_DETAIL, kind: "held", via: "courier" };

describe("holdForChair", () => {
  it("marks a registered turn held at the instant given and queues its request", () => {
    const held = holdForChair({ home, nowIso: NOW, record: registeredTurn() });

    expect(held.unqueued).toBe(undefined);
    expect(held.record.delivery).toEqual(HELD);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(HELD);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
  });

  it("leaves the turn held, saying why, when its request cannot be queued — the held write came first", () => {
    const failing: typeof enqueueCourier = () => err(RelayCourierErrors.turnIdInvalid({ turnId: "nope" }));
    const held = holdForChair({ enqueue: failing, home, nowIso: NOW, record: registeredTurn() });

    expect(held.unqueued).toBe('"nope" is not a relay turn id');
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(HELD);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it("on a retry of a held turn keeps its first instant and queues the request a crash left unwritten", () => {
    const first = unwrap(markDelivered({ delivery: HELD, home, record: registeredTurn() }));
    const retried = holdForChair({ home, nowIso: RETRY, record: first });

    expect(retried.unqueued).toBe(undefined);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(HELD);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
  });

  it("queues one request however many times a held turn is retried", () => {
    const first = holdForChair({ home, nowIso: NOW, record: registeredTurn() }).record;
    holdForChair({ home, nowIso: RETRY, record: first });

    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
  });

  it("never holds a turn whose delivery is already on its way", () => {
    const typed: Delivery = { atIso: NOW, detail: "typed into the supervisor's chat", kind: "typed", via: "direct" };
    const record = unwrap(markDelivered({ delivery: typed, home, record: registeredTurn() }));
    const held = holdForChair({ home, nowIso: RETRY, record });

    expect(held).toEqual({ record, unqueued: undefined });
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });
});
