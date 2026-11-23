import { describe, expect, it } from "vitest";

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import { type ThroughDoorResult, throughDoor } from "../../../admit/effects.js";
import type { DoorGate, DoorRequest } from "../../../admit/types.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../doorLedgerFixture.js";

/** The fixture home a decision names; the in-memory store is what records it. */
const home = "/fixture/home";

const request: DoorRequest = {
  action: { kind: "verb", noun: "demo", verb: "run" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};
const warnGate: DoorGate = () => [
  { code: "demo.warn", correction: "c", override: "demo.run:v1", severity: "warn", summary: "s" },
];

/** Assert an effect ran and return its result (throws otherwise — keeps assertions unconditional). */
function performedResult<T>({ result }: { result: ThroughDoorResult<T> }): T {
  if (!result.performed) {
    throw new Error("expected the effect to have been performed");
  }
  return result.result;
}

/** Assert an effect did NOT run and return the outcome, narrowed (throws otherwise). */
function notPerformed<T>({ result }: { result: ThroughDoorResult<T> }): NotPerformed {
  if (result.performed) {
    throw new Error("expected the effect not to have been performed");
  }
  return result;
}

describe("throughDoor", () => {
  it("does NOT perform the effect on warn, and records the decision", async () => {
    const door = memoryDoorLedger();
    let ran = false;
    const result = await throughDoor({
      env: {},
      gates: [warnGate],
      home,
      ledger: door.port,
      nowIso: "2026-10-01T00:00:00.000Z",
      perform: () => {
        ran = true;
        return "done";
      },
      request,
      runId: "r1",
    });
    expect(ran).toBe(false);
    expect(result.kind).toBe("door-refused");
    expect(result.decision.status).toBe("warn");
    expect(door.records().map((record) => record["status"])).toStrictEqual(["warn"]);
  });

  it("performs the effect on pass, returns its result, and records the decision", async () => {
    const door = memoryDoorLedger();
    const result = await throughDoor({
      env: {},
      gates: DEFAULT_GATES,
      home,
      ledger: door.port,
      nowIso: "2026-10-01T00:00:00.000Z",
      perform: () => "done",
      request,
      runId: "r2",
    });
    expect(result.kind).toBe("performed");
    expect(performedResult({ result })).toBe("done");
    expect(result.decision.status).toBe("pass");
    expect(door.records().map((record) => record["status"])).toStrictEqual(["pass"]);
  });

  it("performs on pass when a warning is overridden", async () => {
    const result = await throughDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "demo.run:v1" },
      gates: [warnGate],
      home,
      ledger: memoryDoorLedger().port,
      nowIso: "2026-10-01T00:00:00.000Z",
      perform: () => "done",
      request,
      runId: "r3",
    });
    expect(result.performed).toBe(true);
    expect(result.decision.overridden.map((f) => f.code)).toStrictEqual(["demo.warn"]);
  });

  it("performs NOTHING when the store cannot record a decision the door passed", async () => {
    let ran = false;
    const result = await throughDoor({
      env: {},
      gates: DEFAULT_GATES,
      home,
      ledger: unreachableDoorLedger(),
      nowIso: "2026-10-01T00:00:00.000Z",
      perform: () => {
        ran = true;
        return "done";
      },
      request,
      runId: "r4",
    });
    expect(ran).toBe(false);
    expect(result.kind).toBe("recording-refused");
    expect(result.decision.status).toBe("pass");
  });
});

describe("notPerformedLines", () => {
  it("renders a recording refusal as the store's own reason, never as the door refusing", async () => {
    const result = await throughDoor({
      env: {},
      gates: DEFAULT_GATES,
      home,
      ledger: unreachableDoorLedger(),
      nowIso: "2026-10-01T00:00:00.000Z",
      perform: () => "done",
      request,
      runId: "r5",
    });
    const lines = notPerformedLines({ command: "slopweaver demo run", through: notPerformed({ result }) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("slopweaver demo run not performed: the door ledger lives in the store");
  });

  it("renders a policy refusal in the door's own shape", async () => {
    const result = await throughDoor({
      env: {},
      gates: [warnGate],
      home,
      ledger: memoryDoorLedger().port,
      nowIso: "2026-10-01T00:00:00.000Z",
      perform: () => "done",
      request,
      runId: "r6",
    });
    const lines = notPerformedLines({ command: "slopweaver demo run", through: notPerformed({ result }) });
    expect(lines[0]).toBe("the door did not admit this (warn). Nothing was changed.");
  });
});
