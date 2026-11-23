/**
 * The relay's once-per-turn delivery: the shapes that type nothing into the chair, and the claim-type-record sequence
 * over a seam, so no cmux socket is reached.
 * Every write goes to a `mkdtempSync` home this file mints.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deliverOnce, typeTurnOnce } from "../../../../../cli/commands/talk/relayDeliverOnce.js";
import { unwrap } from "../../../../../lib/result.js";
import type { Delivery } from "../../../../../talk/deliveryOutcome.js";
import { courierTurns } from "../../../../../talk/relayCourierStore.js";
import { claimDelivery, deliveryClaimed } from "../../../../../talk/relayDeliveryClaim.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn, markDelivered, readTurn, type TurnRecord } from "../../../../../talk/relayStore.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const STAGED = "2026-10-12T00:30:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-deliver-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const claimed = (): TurnRecord => {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "move it to dev-alerts",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  return unwrap(claimTurn({ draft, home, nowIso: STAGED })).record;
};

describe("deliverOnce", () => {
  it("types nothing and claims no delivery when the relay is not for the chair", async () => {
    const record = claimed();
    const after = await deliverOnce({
      args: { consoleOrigin: undefined, deliverToSupervisor: false },
      home,
      lead: "CHANNEL: x",
      record,
    });
    expect(after).toBe(record);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toBe(null);
  });

  it("types nothing again once a delivery is on the record, an interrupted attempt included", async () => {
    const attempting = {
      atIso: STAGED,
      detail: "typing into the supervisor's chat",
      kind: "attempting",
      via: "direct",
    } as const;
    const record = unwrap(markDelivered({ delivery: attempting, home, record: claimed() }));
    const after = await deliverOnce({
      args: { consoleOrigin: undefined, deliverToSupervisor: true },
      home,
      lead: undefined,
      record,
    });
    expect(after).toBe(record);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(attempting);
  });

  const CONSOLE = { checkoutRoot: "/checkout", defaultPort: 3000, port: 3000 };

  it("holds a spoken console relay for the chair's quiet batch instead of typing it", async () => {
    const after = await deliverOnce({
      args: { consoleOrigin: CONSOLE, deliverToSupervisor: true },
      home,
      lead: "CHANNEL: x",
      record: claimed(),
    });

    expect(after.delivery!.kind).toBe("held");
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery!.kind).toBe("held");
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
    expect(unwrap(deliveryClaimed({ home, turnId: TURN }))).toBe(false);
  });

  it("on a retry of a held relay only makes sure its request is queued", async () => {
    const held = {
      atIso: STAGED,
      detail: "held for the chair's next quiet batch",
      kind: "held",
      via: "courier",
    } as const;
    const record = unwrap(markDelivered({ delivery: held, home, record: claimed() }));
    const after = await deliverOnce({
      args: { consoleOrigin: CONSOLE, deliverToSupervisor: true },
      home,
      lead: undefined,
      record,
    });

    expect(after.delivery).toEqual(held);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
  });

  it("never holds a console relay that already carries another delivery", async () => {
    const attempting = { atIso: STAGED, detail: "typing", kind: "attempting", via: "direct" } as const;
    const record = unwrap(markDelivered({ delivery: attempting, home, record: claimed() }));
    const after = await deliverOnce({
      args: { consoleOrigin: CONSOLE, deliverToSupervisor: true },
      home,
      lead: undefined,
      record,
    });

    expect(after).toBe(record);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });
});

describe("typeTurnOnce", () => {
  const QUEUED: Delivery = {
    atIso: STAGED,
    detail: "typed into the supervisor's chat (workspace:663), queued behind its running turn",
    kind: "queued",
    via: "courier",
  };

  /** A seam that never reaches cmux: it records each call and answers with one delivery. */
  const answering = ({ delivery }: { delivery: Delivery }) => {
    const calls: number[] = [];
    const deliver = (): Promise<Delivery> => {
      calls.push(calls.length);
      return Promise.resolve(delivery);
    };
    return { calls, deliver };
  };

  it("claims the turn, types once and records the outcome under the process that typed it", async () => {
    const seam = answering({ delivery: QUEUED });
    const after = await typeTurnOnce({ deliver: seam.deliver, home, record: claimed(), via: "courier" });
    expect(seam.calls).toEqual([0]);
    expect(after.delivery).toEqual(QUEUED);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual(QUEUED);
  });

  it("types nothing when another run already holds the turn's delivery claim", async () => {
    const record = claimed();
    unwrap(claimDelivery({ home, turnId: TURN }));
    const seam = answering({ delivery: QUEUED });
    const after = await typeTurnOnce({ deliver: seam.deliver, home, record, via: "courier" });
    expect(seam.calls).toEqual([]);
    expect(after).toBe(record);
  });
});
