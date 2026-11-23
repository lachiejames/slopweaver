import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  courierPending,
  courierTurns,
  enqueueCourier,
  finishCourier,
  requeueCourier,
  takeCourier,
  withdrawCourier,
} from "../../../talk/relayCourierStore.js";

const TURN = "0f6c3a2e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const OTHER = "1a6c3a2e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const NOW = "2026-10-17T07:00:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "courier-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One stage's directory under the courier root. */
function stage({ name }: { name: "pending" | "claimed" }): string {
  return join(home, "talk", "courier", name);
}

describe("enqueueCourier", () => {
  it("writes a request naming only the turn", () => {
    expect(unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }))).toBe("queued");
    const text = readFileSync(join(stage({ name: "pending" }), `${TURN}.json`), "utf8");
    expect(JSON.parse(text)).toEqual({ kind: "relay", requestedAtIso: NOW, turnId: TURN, version: 1 });
  });

  it("is the same hand-off when the turn's request is already pending", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    expect(unwrap(enqueueCourier({ home, nowIso: "2026-10-17T07:00:05.000Z", turnId: TURN }))).toBe("already");
    expect(readdirSync(stage({ name: "pending" }))).toEqual([`${TURN}.json`]);
  });

  it("never re-offers a turn a courier already took, so no second request can be withdrawn under it", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(takeCourier({ home, turnId: TURN }));
    expect(unwrap(enqueueCourier({ home, nowIso: "2026-10-17T07:00:05.000Z", turnId: TURN }))).toBe("claimed");
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it("refuses an id that is not a relay's uuid before building a path from it", () => {
    const refused = enqueueCourier({ home, nowIso: NOW, turnId: "../../escape" });
    expect(unwrapErr(refused).code).toBe("COURIER_TURN_ID_INVALID");
  });

  it("refuses a pending file that is not a request rather than calling it the same hand-off", () => {
    mkdirSync(stage({ name: "pending" }), { recursive: true });
    writeFileSync(join(stage({ name: "pending" }), `${TURN}.json`), '{"kind":"relay","words":"type this"}\n');
    const refused = enqueueCourier({ home, nowIso: NOW, turnId: TURN });
    expect(unwrapErr(refused).code).toBe("COURIER_REQUEST_MALFORMED");
  });
});

describe("the race between a withdrawing relay and a taking courier", () => {
  it("withdraws a request no courier took", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    expect(unwrap(withdrawCourier({ home, turnId: TURN }))).toBe("withdrawn");
    expect(unwrap(courierPending({ home, turnId: TURN }))).toBe(false);
  });

  it("reports taken when the courier renamed it first, and the courier holds it", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    const taken = unwrap(takeCourier({ home, turnId: TURN }));
    expect(taken).toEqual({
      kind: "taken",
      request: { kind: "relay", requestedAtIso: NOW, turnId: TURN, version: 1 },
    });
    expect(unwrap(withdrawCourier({ home, turnId: TURN }))).toBe("taken");
    expect(unwrap(courierTurns({ home, stage: "claimed" }))).toEqual([TURN]);
  });

  it("tells a courier the request is gone once the relay withdrew it", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(withdrawCourier({ home, turnId: TURN }));
    expect(unwrap(takeCourier({ home, turnId: TURN }))).toEqual({ kind: "gone" });
  });

  it("gives a request to exactly one of two couriers", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    const first = unwrap(takeCourier({ home, turnId: TURN }));
    const second = unwrap(takeCourier({ home, turnId: TURN }));
    expect([first.kind, second.kind]).toEqual(["taken", "gone"]);
  });

  it("refuses a request whose body names another turn than its file", () => {
    mkdirSync(stage({ name: "pending" }), { recursive: true });
    const forged = { kind: "relay", requestedAtIso: NOW, turnId: OTHER, version: 1 };
    writeFileSync(join(stage({ name: "pending" }), `${TURN}.json`), `${JSON.stringify(forged)}\n`);
    const refused = takeCourier({ home, turnId: TURN });
    expect(unwrapErr(refused).message).toContain(`it names turn ${OTHER}`);
  });
});

describe("courierTurns", () => {
  it("is empty before anything was handed over", () => {
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });

  it("lists request files sorted and ignores anything that is not one", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: OTHER }));
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    writeFileSync(join(stage({ name: "pending" }), "notes.json"), "{}\n");
    writeFileSync(join(stage({ name: "pending" }), `${TURN}.json.tmp`), "{}\n");
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN, OTHER]);
  });
});

describe("after the courier has a request", () => {
  it("puts a claimed request back in the queue", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(takeCourier({ home, turnId: TURN }));
    unwrap(requeueCourier({ home, turnId: TURN }));
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
    expect(unwrap(courierTurns({ home, stage: "claimed" }))).toEqual([]);
  });

  it("removes a finished request, and finishing twice is still finished", () => {
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    unwrap(takeCourier({ home, turnId: TURN }));
    unwrap(finishCourier({ home, turnId: TURN }));
    expect(unwrap(courierTurns({ home, stage: "claimed" }))).toEqual([]);
    expect(finishCourier({ home, turnId: TURN }).isOk()).toBe(true);
  });
});
