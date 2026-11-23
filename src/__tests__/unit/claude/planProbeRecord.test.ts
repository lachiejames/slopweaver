import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import {
  type ClaudePlanProbeObservation,
  type ClaudePlanProbeRecord,
  decodeClaudePlanProbesDocument,
  nextClaudePlanProbeRecord,
  observationOfReading,
  withClaudePlanProbes,
} from "../../../claude/planProbeRecord.js";
import { err, ok, unwrap } from "../../../lib/result.js";

const STORE = "/Users/owner/.claude-accounts/plan-two";
const T1 = "2026-10-31T06:22:53.000Z";
const T2 = "2026-10-31T07:59:23.000Z";
const T3 = "2026-11-03T06:28:10.000Z";
const SIGNED_OUT: ClaudePlanProbeObservation = { code: "STORE_NOT_READY", kind: "fault", message: "no sign-in" };

/** The record one probe of plan-two at `at` leaves on `previous`. */
function next({
  at,
  observation,
  previous,
  storeDir = STORE,
}: {
  at: string;
  observation: ClaudePlanProbeObservation;
  previous: ClaudePlanProbeRecord | undefined;
  storeDir?: string;
}): ClaudePlanProbeRecord {
  const transition = nextClaudePlanProbeRecord({
    observed: { alias: "plan-two", observation, observedAtIso: at, storeDir },
    previous,
  });
  if (transition.kind === "keep") {
    throw new Error(`expected a write, and the probe was kept out: ${transition.why}`);
  }
  return transition.record;
}

describe("observationOfReading", () => {
  it("reads a store that is not on disk as STORE_MISSING, whatever the probe said", () => {
    expect(observationOfReading({ reading: ok({}), storeExists: false })).toEqual({
      code: "STORE_MISSING",
      kind: "fault",
      message: "its store directory is not on this machine",
    });
  });

  it("reads a usage answer as ok, a plan's own failure as a fault, and a transport failure as unmeasured", () => {
    const notReady = ClaudeRotationErrors.storeNotReady({ alias: "plan-two" });
    const transport = ClaudeRotationErrors.probeTransportFailed({ alias: "plan-two" });
    expect([
      observationOfReading({ reading: ok({}), storeExists: true }).kind,
      observationOfReading({ reading: err(notReady), storeExists: true }),
      observationOfReading({ reading: err(transport), storeExists: true }),
    ]).toEqual([
      "ok",
      { code: "STORE_NOT_READY", kind: "fault", message: notReady.message },
      { kind: "unmeasured", message: transport.message },
    ]);
  });
});

describe("nextClaudePlanProbeRecord", () => {
  it("starts an episode on the first fault, and keeps its start while the same fault repeats", () => {
    const first = next({ at: T1, observation: SIGNED_OUT, previous: undefined });
    const second = next({ at: T2, observation: SIGNED_OUT, previous: first });
    expect([second.fault!.sinceIso, second.fault!.lastSeenIso, second.latest]).toEqual([T1, T2, "fault"]);
  });

  it("carries the episode unchanged through an unmeasured probe, saying why it was unmeasured", () => {
    const first = next({ at: T1, observation: SIGNED_OUT, previous: undefined });
    const blip = next({ at: T2, observation: { kind: "unmeasured", message: "no network" }, previous: first });
    expect([blip.fault, blip.latest, blip.unmeasuredBecause]).toEqual([first.fault, "unmeasured", "no network"]);
  });

  it("ends the episode on ok, so the same fault later is a new episode", () => {
    const first = next({ at: T1, observation: SIGNED_OUT, previous: undefined });
    const well = next({ at: T2, observation: { kind: "ok" }, previous: first });
    const again = next({ at: T3, observation: SIGNED_OUT, previous: well });
    expect([well.fault, again.fault!.sinceIso]).toEqual([undefined, T3]);
  });

  it("starts a new episode on a different fault code", () => {
    const first = next({ at: T1, observation: SIGNED_OUT, previous: undefined });
    const rejected = next({
      at: T2,
      observation: { code: "CREDENTIAL_REJECTED", kind: "fault", message: "401" },
      previous: first,
    });
    expect([rejected.fault!.code, rejected.fault!.sinceIso]).toEqual(["CREDENTIAL_REJECTED", T2]);
  });

  it("inherits nothing when the alias is re-pointed at another store", () => {
    const first = next({ at: T1, observation: SIGNED_OUT, previous: undefined });
    const moved = next({ at: T2, observation: SIGNED_OUT, previous: first, storeDir: "/elsewhere" });
    expect(moved.fault!.sinceIso).toBe(T2);
  });

  it("keeps out a probe no newer than the one recorded for the same store", () => {
    const recorded = next({ at: T2, observation: SIGNED_OUT, previous: undefined });
    expect(
      nextClaudePlanProbeRecord({
        observed: { alias: "plan-two", observation: { kind: "ok" }, observedAtIso: T1, storeDir: STORE },
        previous: recorded,
      }),
    ).toEqual({ kind: "keep", why: `a probe at ${T2} is already recorded for plan-two` });
  });
});

describe("withClaudePlanProbes and the stored document", () => {
  it("records each probe, carries a plan no probe names, sorts by alias, and round-trips through the decoder", () => {
    const { document: seeded } = withClaudePlanProbes({
      document: undefined,
      observed: [{ alias: "plan-one", observation: { kind: "ok" }, observedAtIso: T1, storeDir: "/one" }],
    });
    const { document, kept } = withClaudePlanProbes({
      document: seeded,
      observed: [{ alias: "plan-two", observation: SIGNED_OUT, observedAtIso: T2, storeDir: STORE }],
    });
    expect([document.plans.map((plan) => plan.alias), kept]).toEqual([["plan-one", "plan-two"], []]);
    const stored: unknown = JSON.parse(JSON.stringify(document));
    expect(unwrap(decodeClaudePlanProbesDocument({ value: stored }))).toEqual(document);
  });

  it("refuses a document whose fault code no version knows, and one naming a plan twice", () => {
    const plan = { alias: "plan-two", latest: "ok", observedAtIso: T1, storeDir: STORE };
    const strange = { ...plan, fault: { code: "MOON", lastSeenIso: T1, message: "x", sinceIso: T1 }, latest: "fault" };
    expect([
      decodeClaudePlanProbesDocument({ value: { plans: [strange], schemaVersion: 1 } })._unsafeUnwrapErr().message,
      decodeClaudePlanProbesDocument({ value: { plans: [plan, plan], schemaVersion: 1 } })._unsafeUnwrapErr().message,
      decodeClaudePlanProbesDocument({ value: { plans: [], schemaVersion: 2 } })._unsafeUnwrapErr().message,
    ]).toEqual([
      "plan-two: a fault's code MOON is not one this version knows",
      "plan-two is recorded twice",
      "it is not a schemaVersion 1 object",
    ]);
  });

  it("refuses a record whose latest probe is a fault but which carries none", () => {
    const value = {
      plans: [{ alias: "plan-two", latest: "fault", observedAtIso: T1, storeDir: STORE }],
      schemaVersion: 1,
    };
    expect(decodeClaudePlanProbesDocument({ value })._unsafeUnwrapErr().message).toBe(
      "plan-two's latest probe is a fault, and the record carries none",
    );
  });

  it("reads an offset-spelled instant as UTC, so a later ok probe still ends the episode", () => {
    const tenAm = "2026-11-04T10:00:00+10:00";
    const fault = { code: "STORE_NOT_READY", lastSeenIso: tenAm, message: "no sign-in", sinceIso: tenAm };
    const value = {
      plans: [{ alias: "plan-two", fault, latest: "fault", observedAtIso: tenAm, storeDir: STORE }],
      schemaVersion: 1,
    };
    const [stored] = unwrap(decodeClaudePlanProbesDocument({ value })).plans;
    const later = next({ at: "2026-11-04T01:00:00.000Z", observation: { kind: "ok" }, previous: stored });
    expect([stored!.observedAtIso, stored!.fault!.sinceIso, later.latest, later.fault]).toEqual([
      "2026-11-04T00:00:00.000Z",
      "2026-11-04T00:00:00.000Z",
      "ok",
      undefined,
    ]);
  });

  it("refuses a record whose latest probe read ok but which still carries a fault", () => {
    const fault = { code: "STORE_NOT_READY", lastSeenIso: T1, message: "no sign-in", sinceIso: T1 };
    const value = {
      plans: [{ alias: "plan-two", fault, latest: "ok", observedAtIso: T3, storeDir: STORE }],
      schemaVersion: 1,
    };
    expect(decodeClaudePlanProbesDocument({ value })._unsafeUnwrapErr().message).toBe(
      "plan-two's latest probe read ok, and the record still carries a fault",
    );
  });
});
