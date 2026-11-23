import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import {
  type CourierOutcome,
  type HeldRelays,
  heldRelays,
  pruneDropped,
  recoverCourier,
  settleHeldRelay,
} from "../../../talk/relayCourier.js";
import { courierTurns, enqueueCourier, takeCourier } from "../../../talk/relayCourierStore.js";
import { claimDelivery } from "../../../talk/relayDeliveryClaim.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { claimTurn, markDelivered, markRegistered, readTurn, type TurnRecord } from "../../../talk/relayStore.js";

const TURN = "951b9e45-6fc9-45fd-8e25-d04ded7164c9";
const OTHER = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const UNREGISTERED = "0f6c3a2e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const NOW = "2026-10-17T07:00:00.000Z";
const LATER = "2026-10-17T07:01:00.000Z";
const BATCH = "2026-10-17T07:03:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "courier-pass-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Stage one turn, registered on the board unless told otherwise, saying whether its words end before the owner did. */
function writeTurn({
  turnId,
  registered,
  heardTailCut,
}: {
  turnId: string;
  registered: boolean;
  heardTailCut?: boolean;
}): TurnRecord {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "ship the courier",
      heardTailCut,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "Ship the courier",
      turnId,
      typed: false,
      wordsAlone: false,
    }),
  );
  const claimed = unwrap(claimTurn({ draft, home, nowIso: NOW })).record;
  if (!registered) {
    return claimed;
  }
  return unwrap(markRegistered({ home, nowIso: NOW, record: claimed }));
}

/** Write a delivery onto a stored turn. */
function deliver({ record, delivery }: { record: TurnRecord; delivery: Delivery }): TurnRecord {
  return unwrap(markDelivered({ delivery, home, record }));
}

const HELD: Delivery = { atIso: LATER, detail: "held for the chair's next quiet batch", kind: "held", via: "courier" };

const TYPED: Delivery = {
  atIso: "2026-10-17T07:05:00.000Z",
  detail: "typed into the supervisor's chat (workspace:663) as a turn from the owner",
  kind: "typed",
  via: "courier",
};

describe("heldRelays", () => {
  it("admits a held turn at its held instant and one queued before the batch at its registration, oldest first", () => {
    deliver({ delivery: HELD, record: writeTurn({ registered: true, turnId: TURN }) });
    writeTurn({ heardTailCut: true, registered: true, turnId: OTHER });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: OTHER }));

    // A record written now keeps every word, so its start is kept; a voice relay made mid-call lost its end, and one
    // that never said whether it was leaves its end unknown.
    expect(unwrap(heldRelays({ home }))).toEqual<HeldRelays>({
      dropped: [],
      held: [
        {
          heard: "ship the courier",
          heardEdges: { end: "lost", start: "kept" },
          heldAtIso: NOW,
          slug: unwrap(readTurn({ home, turnId: OTHER })).slug,
          turnId: OTHER,
        },
        {
          heard: "ship the courier",
          heardEdges: { end: "unknown", start: "kept" },
          heldAtIso: LATER,
          slug: unwrap(readTurn({ home, turnId: TURN })).slug,
          turnId: TURN,
        },
      ],
    });
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([OTHER, TURN]);
  });

  it("drops a turn not registered on the board, and pruning removes its request", () => {
    writeTurn({ registered: false, turnId: UNREGISTERED });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: UNREGISTERED }));
    const read = unwrap(heldRelays({ home }));
    unwrap(pruneDropped({ dropped: read.dropped, home }));

    expect(read).toEqual<HeldRelays>({
      dropped: [{ detail: "the turn is intended, not registered on the board", kind: "skipped", turnId: UNREGISTERED }],
      held: [],
    });
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it("drops a turn that already carries a delivery other than held", () => {
    deliver({ delivery: TYPED, record: writeTurn({ registered: true, turnId: TURN }) });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));

    expect(unwrap(heldRelays({ home })).dropped).toEqual<CourierOutcome[]>([
      { detail: "the turn already carries a delivery (typed)", kind: "skipped", turnId: TURN },
    ]);
  });

  it("drops a held turn whose held instant is not an instant, so no batch dates by it", () => {
    deliver({ delivery: { ...HELD, atIso: "not-a-date" }, record: writeTurn({ registered: true, turnId: TURN }) });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));

    expect(unwrap(heldRelays({ home }))).toEqual<HeldRelays>({
      dropped: [{ detail: 'the turn\'s held instant "not-a-date" is not an instant', kind: "skipped", turnId: TURN }],
      held: [],
    });
  });

  it("drops a request naming a turn that was never staged", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));

    const dropped = unwrap(heldRelays({ home })).dropped;
    unwrap(pruneDropped({ dropped, home }));
    expect(dropped.map((outcome) => [outcome.kind, outcome.turnId])).toEqual([["skipped", TURN]]);
    expect(dropped[0]!.detail).toContain("the turn could not be read");
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it.each([
    ["a forged request", '{"kind":"relay","line":"rm -rf"}\n'],
    ["a request that is not JSON", "{\n"],
  ])("drops %s and says so, even for a held turn — never carried and deleted unread", (_, contents) => {
    deliver({ delivery: HELD, record: writeTurn({ registered: true, turnId: TURN }) });
    const pending = join(home, "talk", "courier", "pending");
    mkdirSync(pending, { recursive: true });
    writeFileSync(join(pending, `${TURN}.json`), contents);

    const read = unwrap(heldRelays({ home }));
    expect(read.held).toEqual([]);
    expect(read.dropped.map((outcome) => [outcome.kind, outcome.turnId])).toEqual([["skipped", TURN]]);
    expect(read.dropped[0]!.detail).toContain("the courier request could not be read");
  });

  it("says what it would drop without removing it: the read alone writes nothing", () => {
    writeTurn({ registered: false, turnId: UNREGISTERED });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: UNREGISTERED }));

    expect(unwrap(heldRelays({ home })).dropped.map((outcome) => outcome.turnId)).toEqual([UNREGISTERED]);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([UNREGISTERED]);
  });
});

describe("settleHeldRelay", () => {
  it("records a line that reached the chat on the relay, naming the batch, and removes its request", () => {
    deliver({ delivery: HELD, record: writeTurn({ registered: true, turnId: TURN }) });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));

    const detail = `on the quiet batch of ${BATCH}: ${TYPED.detail}`;
    expect(unwrap(settleHeldRelay({ batchAtIso: BATCH, delivery: TYPED, home, turnId: TURN }))).toEqual<CourierOutcome>(
      {
        detail: `typed — ${detail}`,
        kind: "typed",
        turnId: TURN,
      },
    );
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual<Delivery>({ ...TYPED, detail });
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it.each([
    ["queued", { ...TYPED, kind: "queued" }],
    ["unconfirmed", { ...TYPED, kind: "unconfirmed" }],
    ["stranded", { ...TYPED, kind: "stranded" }],
  ] as const)("settles a line %s, which may be in the chat", (kind, delivery) => {
    deliver({ delivery: HELD, record: writeTurn({ registered: true, turnId: TURN }) });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));

    expect(unwrap(settleHeldRelay({ batchAtIso: BATCH, delivery, home, turnId: TURN }))!.kind).toBe("typed");
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery!.kind).toBe(kind);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it.each([
    ["skipped", { ...TYPED, kind: "skipped", refusal: "composer-busy" }],
    ["failed", { ...TYPED, kind: "failed", refusal: "cmux-access-denied" }],
  ] as const)("leaves a relay held, its request queued, when the line was %s", (_kind, delivery) => {
    deliver({ delivery: HELD, record: writeTurn({ registered: true, turnId: TURN }) });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));

    expect(unwrap(settleHeldRelay({ batchAtIso: BATCH, delivery, home, turnId: TURN }))).toBe(undefined);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(HELD);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
  });
});

describe("recoverCourier", () => {
  it("requeues a request a stopped courier took before claiming its delivery", () => {
    writeTurn({ registered: true, turnId: TURN });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(takeCourier({ home, turnId: TURN }));
    expect(unwrap(recoverCourier({ home }))).toEqual([{ kind: "requeued", turnId: TURN }]);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
  });

  it("never re-offers a request whose delivery a stopped courier had claimed", () => {
    writeTurn({ registered: true, turnId: TURN });
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(takeCourier({ home, turnId: TURN }));
    expect(unwrap(claimDelivery({ home, turnId: TURN }))).toBe(true);
    expect(unwrap(recoverCourier({ home }))).toEqual([{ kind: "left", turnId: TURN }]);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
    expect(unwrap(courierTurns({ home, stage: "claimed" }))).toEqual([]);
  });

  it("finds nothing to recover in a home that never handed anything over", () => {
    expect(unwrap(recoverCourier({ home }))).toEqual([]);
  });
});
