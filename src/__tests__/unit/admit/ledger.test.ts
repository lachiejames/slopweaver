// The file reader went with door.jsonl; the store port reads now.
import { describe, expect, it } from "vitest";

import {
  doorActionLabel,
  doorDecisionRecord,
  type PreDoorRefusal,
  recordPreDoorRefusal,
} from "../../../admit/ledger.js";
import type { DoorDecision, DoorRequest } from "../../../admit/types.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../doorLedgerFixture.js";

const request: DoorRequest = {
  action: { kind: "verb", noun: "demo", verb: "run" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("doorDecisionRecord", () => {
  it("records a warn decision as one exact object", () => {
    const decision: DoorDecision = {
      findings: [{ code: "demo.warn", correction: "c", override: "demo.run:v1", severity: "warn", summary: "s" }],
      overridden: [],
      status: "warn",
    };
    expect(doorDecisionRecord({ decision, request, runId: "r1", tsIso: "2026-07-14T00:00:00.000Z" })).toStrictEqual({
      action: "verb:demo.run",
      effect: "external-write",
      // The summary rides along with the code: a record saying only that something was stopped, without
      // saying why, is the half-record a withheld reply cannot be audited from.
      findings: [{ code: "demo.warn", severity: "warn", summary: "s" }],
      overridden: [],
      runId: "r1",
      schemaVersion: 1,
      status: "warn",
      tsIso: "2026-07-14T00:00:00.000Z",
    });
  });

  it("records an overridden pass with the waived finding codes", () => {
    const decision: DoorDecision = {
      findings: [],
      overridden: [{ code: "demo.warn", correction: "c", override: "demo.run:v1", severity: "warn", summary: "s" }],
      status: "pass",
    };
    expect(doorDecisionRecord({ decision, request, runId: "r2", tsIso: "t" })["overridden"]).toStrictEqual([
      "demo.warn",
    ]);
  });

  it("records a raw-tool action label", () => {
    const rawRequest: DoorRequest = {
      action: { command: "gh pr merge 1", kind: "raw-tool", tool: "gh" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
    };
    const decision: DoorDecision = { findings: [], overridden: [], status: "hold" };
    expect(doorDecisionRecord({ decision, request: rawRequest, runId: "r3", tsIso: "t" })["action"]).toBe(
      "raw-tool:gh",
    );
  });

  it("records the artifact's opaque duplicateKey so a re-send is recognisable", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "pass" };
    const withKey: DoorRequest = { ...request, artifact: { duplicateKey: "abc123" } };
    expect(doorDecisionRecord({ decision, request: withKey, runId: "r4", tsIso: "t" })["duplicateKey"]).toBe("abc123");
  });

  it("omits duplicateKey entirely for an action that has none", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "pass" };
    const record = doorDecisionRecord({ decision, request, runId: "r5", tsIso: "t" });
    expect(Object.keys(record).includes("duplicateKey")).toBe(false);
  });

  it("records where and when the owner approved, when the artifact carries both", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "pass" };
    const approved: DoorRequest = {
      ...request,
      artifact: { approvedAtIso: "2026-10-12T00:19:00.000Z", approvedBy: "talk-call:c1#s1" },
    };
    const record = doorDecisionRecord({ decision, request: approved, runId: "r7", tsIso: "t" });
    expect(record["approvedBy"]).toBe("talk-call:c1#s1");
    expect(record["approvedAtIso"]).toBe("2026-10-12T00:19:00.000Z");
  });

  it("records neither half of an approval the artifact states only partly, or not as strings", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "pass" };
    const halves: readonly DoorRequest[] = [
      { ...request, artifact: { approvedBy: "talk-call:c1#s1" } },
      { ...request, artifact: { approvedAtIso: "2026-10-12T00:19:00.000Z" } },
      { ...request, artifact: { approvedAtIso: 7, approvedBy: "talk-call:c1#s1" } },
    ];
    const keys = halves.map((half) =>
      Object.keys(doorDecisionRecord({ decision, request: half, runId: "r8", tsIso: "t" })).filter((key) =>
        key.startsWith("approved"),
      ),
    );
    expect(keys).toStrictEqual([[], [], []]);
  });

  it("records no approval on a decision that did not pass, because only a pass performs", () => {
    const approved: DoorRequest = {
      ...request,
      artifact: { approvedAtIso: "2026-10-12T00:19:00.000Z", approvedBy: "talk-call:c1#s1" },
    };
    const keys = (["hold", "warn"] as const).map((status) =>
      Object.keys(
        doorDecisionRecord({
          decision: { findings: [], overridden: [], status },
          request: approved,
          runId: "r9",
          tsIso: "t",
        }),
      ).filter((key) => key.startsWith("approved")),
    );
    expect(keys).toStrictEqual([[], []]);
  });

  it("ignores a non-string duplicateKey rather than recording a wrong shape", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "pass" };
    const bad: DoorRequest = { ...request, artifact: { duplicateKey: 42 } };
    const record = doorDecisionRecord({ decision, request: bad, runId: "r6", tsIso: "t" });
    expect(Object.keys(record).includes("duplicateKey")).toBe(false);
  });
});

describe("doorActionLabel", () => {
  it("labels a verb action", () => {
    expect(doorActionLabel({ request })).toBe("verb:demo.run");
  });

  it("labels a raw-tool action", () => {
    expect(
      doorActionLabel({
        request: {
          action: { command: "gh pr merge 1", kind: "raw-tool", tool: "gh" },
          artifact: {},
          meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
        },
      }),
    ).toBe("raw-tool:gh");
  });
});

describe("recordPreDoorRefusal", () => {
  const refusal: PreDoorRefusal = {
    findings: [{ code: "voice.length", message: "too long", path: "summary" }],
    gate: "above-the-fold-voice",
    hatch: "voice-rules",
    runId: "r-refused",
    surface: "slack",
    tsIso: "2026-09-19T01:00:00.000Z",
  };

  it("writes one refused row through the port", async () => {
    const door = memoryDoorLedger();
    expect(await recordPreDoorRefusal({ home: "/fixture/home", ledger: door.port, refusal })).toStrictEqual({
      written: true,
    });
    expect(door.records().map((record) => [record["runId"], record["status"]])).toStrictEqual([
      ["r-refused", "refused"],
    ]);
  });

  it("reports a store outage instead of throwing over the refusal it is recording", async () => {
    const written = await recordPreDoorRefusal({ home: "/fixture/home", ledger: unreachableDoorLedger(), refusal });
    expect(written.written).toBe(false);
  });
});
