import { describe, expect, it } from "vitest";

import type { LiveMachineReading } from "../../lib/liveMachine";
import {
  LIVE_MACHINE_OPENING,
  liveFreshnessOf,
  liveMachineHeldAfter,
  readLiveMachineWire,
} from "../../lib/liveMachineClient";

const AT = "2026-11-09T10:00:00.000Z";
const AT_MS = Date.parse(AT);

/** A reading as the route serves it, CPU measured. */
const READING: LiveMachineReading = {
  cores: 10,
  cpu: { busyCores: 6, fleetCores: 1.6, idlePct: 40, otherCores: 4.4 },
  diagnostics: [],
  load1: 12.35,
  memory: { compressorSegmentsPct: 12, fleetBytes: 1850, swapfileCount: 2, totalBytes: 20_000, usedBytes: 10_000 },
  observedAtIso: AT,
  sessions: [{ cpuCores: 1.5, memoryBytes: 1500, processCount: 2, sessionId: "s1" }],
  topOtherCpu: { cpuCores: 2, label: "Google Chrome", memoryBytes: 3000 },
  topOtherMemory: { cpuCores: 2, label: "Google Chrome", memoryBytes: 3000 },
};

/** The reading through JSON, which drops every `undefined`. */
const wireOf = ({ reading }: { reading: LiveMachineReading }): unknown =>
  JSON.parse(JSON.stringify({ kind: "read", reading }));

describe("readLiveMachineWire", () => {
  it("accepts a reading round-tripped through JSON", () => {
    expect(readLiveMachineWire({ payload: wireOf({ reading: READING }) })).toEqual({ kind: "read", reading: READING });
  });

  it("accepts a first read, whose CPU figures JSON dropped", () => {
    const first: LiveMachineReading = {
      ...READING,
      cpu: { busyCores: undefined, fleetCores: undefined, idlePct: undefined, otherCores: undefined },
      sessions: [{ cpuCores: undefined, memoryBytes: 1500, processCount: 2, sessionId: "s1" }],
      topOtherCpu: undefined,
    };
    expect(readLiveMachineWire({ payload: wireOf({ reading: first }) })).toEqual({ kind: "read", reading: first });
  });

  it("accepts a reading the route could not take", () => {
    const payload = { attemptedAtIso: AT, kind: "not-measured", why: "/bin/ps did not answer" };
    expect(readLiveMachineWire({ payload })).toEqual(payload);
  });

  it("refuses a shape it does not recognise rather than drawing a plausible one", () => {
    expect(readLiveMachineWire({ payload: { kind: "read" } })).toBe(undefined);
    expect(readLiveMachineWire({ payload: "read" })).toBe(undefined);
    const overfull = { ...READING, memory: { ...READING.memory, usedBytes: 30_000 } };
    expect(readLiveMachineWire({ payload: wireOf({ reading: overfull }) })).toBe(undefined);
    const negative = { ...READING, cpu: { ...READING.cpu, busyCores: -1 } };
    expect(readLiveMachineWire({ payload: wireOf({ reading: negative }) })).toBe(undefined);
  });
});

describe("liveMachineHeldAfter", () => {
  it("replaces the held reading and clears the failure on an answer", () => {
    const failed = liveMachineHeldAfter({
      answer: { failed: "the console did not answer" },
      held: LIVE_MACHINE_OPENING,
    });
    expect(failed).toEqual({ opening: false, reading: undefined, why: "the console did not answer" });
    expect(liveMachineHeldAfter({ answer: { wire: { kind: "read", reading: READING } }, held: failed })).toEqual({
      opening: false,
      reading: READING,
      why: undefined,
    });
  });

  it("keeps the held reading ageing when a read fails", () => {
    const held = { opening: false, reading: READING, why: undefined };
    expect(
      liveMachineHeldAfter({
        answer: { wire: { attemptedAtIso: AT, kind: "not-measured", why: "vm_stat did not answer" } },
        held,
      }),
    ).toEqual({ opening: false, reading: READING, why: "vm_stat did not answer" });
  });
});

describe("liveFreshnessOf", () => {
  it("is live up to ten seconds, inclusive", () => {
    expect(liveFreshnessOf({ nowMs: AT_MS + 2_000, observedAtIso: AT, why: undefined })).toEqual({
      tone: "live",
      words: "read 2s ago · every 2s",
    });
    expect(liveFreshnessOf({ nowMs: AT_MS + 10_000, observedAtIso: AT, why: undefined }).tone).toBe("live");
  });

  it("is amber past ten seconds, up to a minute inclusive", () => {
    expect(liveFreshnessOf({ nowMs: AT_MS + 10_001, observedAtIso: AT, why: undefined })).toEqual({
      tone: "amber",
      words: "read 10s ago · a newer reading is late",
    });
    expect(liveFreshnessOf({ nowMs: AT_MS + 60_000, observedAtIso: AT, why: undefined }).tone).toBe("amber");
  });

  it("says it stopped updating past a minute, and why when a read said", () => {
    expect(liveFreshnessOf({ nowMs: AT_MS + 60_001, observedAtIso: AT, why: undefined })).toEqual({
      tone: "stopped",
      words: "stopped updating · last read 1m ago · no newer reading has answered",
    });
    expect(liveFreshnessOf({ nowMs: AT_MS + 3 * 3_600_000, observedAtIso: AT, why: "/bin/ps did not answer" })).toEqual(
      { tone: "stopped", words: "stopped updating · last read 3h ago · /bin/ps did not answer" },
    );
  });
});
