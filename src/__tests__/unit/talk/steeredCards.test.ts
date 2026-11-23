/*
 * What became of a steer the owner spoke over a Queue card. Each case pins one rung of the verdict's order: a registration
 * that does not parse outranks everything, a restore outranks action, action outranks every deadline, and the deadline is the first pass that STARTED after the relay
 * registered — or a pass that never came.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { type RelayRowEvidence, relayRowAction } from "../../../talk/relayIntake.js";
import {
  CHAIR_DOWN_MS,
  firstPassAfter,
  LANDING_GRACE_MS,
  type SteerEvidence,
  steerVerdict,
} from "../../../talk/steeredCards.js";

const REGISTERED = "2026-10-04T00:36:59.000Z";
const REGISTERED_MS = Date.parse(REGISTERED);

/** An instant `ms` after registration. */
const after = ({ ms }: { ms: number }): string => new Date(REGISTERED_MS + ms).toISOString();

/** A landed, unacted steer with no pass yet, overridable field by field. */
const evidence = (over: Partial<SteerEvidence> = {}): SteerEvidence => ({
  action: undefined,
  chairPass: undefined,
  landing: { kind: "active", workSlug: "talk-ed674c0ed0f9" },
  registeredAtIso: REGISTERED,
  ticksRead: true,
  ...over,
});

const PASS = { finalisedIso: after({ ms: 20 * 60_000 }), startedIso: after({ ms: 60_000 }) };

describe("steerVerdict", () => {
  it("awaits while landed, unacted, and no pass has come", () => {
    expect(steerVerdict({ evidence: evidence(), nowIso: after({ ms: 60_000 }) })).toEqual({ kind: "awaiting" });
  });

  it("settles on an intake mark", () => {
    const action = { atIso: after({ ms: 90_000 }), kind: "intake-mark", markKind: "card", witness: "ask:x" } as const;
    expect(steerVerdict({ evidence: evidence({ action }), nowIso: after({ ms: 120_000 }) })).toEqual({
      action,
      kind: "settled",
    });
  });

  it("settles on action that arrives after the pass came and went", () => {
    const action = { kind: "settlement" } as const;
    const verdict = steerVerdict({ evidence: evidence({ action, chairPass: PASS }), nowIso: after({ ms: 3_600_000 }) });
    expect(verdict).toEqual({ action, kind: "settled" });
  });

  it("brings the card back once the first pass after it finished with nothing done", () => {
    const verdict = steerVerdict({ evidence: evidence({ chairPass: PASS }), nowIso: after({ ms: 21 * 60_000 }) });
    expect(verdict).toEqual({ kind: "reverted", passFinalisedIso: PASS.finalisedIso, reason: "missed-pass" });
  });

  it("brings the card back when no pass at all ran for the chair-down window", () => {
    expect(steerVerdict({ evidence: evidence(), nowIso: after({ ms: CHAIR_DOWN_MS - 1 }) })).toEqual({
      kind: "awaiting",
    });
    expect(steerVerdict({ evidence: evidence(), nowIso: after({ ms: CHAIR_DOWN_MS }) })).toEqual({
      kind: "reverted",
      reason: "chair-down",
    });
  });

  it("a kept restore outranks the settlement that wrote it", () => {
    const verdict = steerVerdict({
      evidence: evidence({
        action: { kind: "settlement" },
        landing: { kept: true, kind: "lifted", why: "answering is not finishing" },
      }),
      nowIso: after({ ms: 60_000 }),
    });
    expect(verdict).toEqual({ kind: "reverted", reason: "kept", why: "answering is not finishing" });
  });

  it("a card-wide restore reads as restored with its reason", () => {
    const verdict = steerVerdict({
      evidence: evidence({ landing: { kept: false, kind: "lifted", why: "a general remark" } }),
      nowIso: after({ ms: 60_000 }),
    });
    expect(verdict).toEqual({ kind: "reverted", reason: "restored", why: "a general remark" });
  });

  it("a landing never written is a failure only after the grace", () => {
    const never = evidence({ landing: { kind: "never" } });
    expect(steerVerdict({ evidence: never, nowIso: after({ ms: LANDING_GRACE_MS - 1 }) })).toEqual({
      kind: "awaiting",
    });
    expect(steerVerdict({ evidence: never, nowIso: after({ ms: LANDING_GRACE_MS }) })).toEqual({
      kind: "reverted",
      reason: "landing-missing",
    });
  });

  it("claims nothing when the row's evidence did not read", () => {
    const verdict = steerVerdict({
      evidence: evidence({ action: { kind: "unread", why: "doc unreadable" }, chairPass: PASS }),
      nowIso: after({ ms: 3_600_000 }),
    });
    expect(verdict).toEqual({ kind: "unread", why: "doc unreadable" });
  });

  it("claims no pass when the tick ledger did not read", () => {
    const verdict = steerVerdict({ evidence: evidence({ ticksRead: false }), nowIso: after({ ms: 3_600_000 }) });
    expect(verdict.kind).toBe("unread");
  });

  it("never awaits on a registration time that does not parse, which no deadline could ever pass", () => {
    const verdict = steerVerdict({
      evidence: evidence({ registeredAtIso: "not-a-date" }),
      nowIso: after({ ms: 3_600_000 }),
    });
    expect(verdict).toEqual({ kind: "unread", why: "its registration time not-a-date does not parse" });
  });

  it("reads a registration that does not parse as unread before a restore or an action, as the site does", () => {
    const unread = { kind: "unread", why: "its registration time not-a-date does not parse" };
    const lifted = evidence({ landing: { kept: true, kind: "lifted", why: "kept" }, registeredAtIso: "not-a-date" });
    const acted = evidence({ action: { kind: "settlement" }, registeredAtIso: "not-a-date" });
    expect(steerVerdict({ evidence: lifted, nowIso: after({ ms: 60_000 }) })).toEqual(unread);
    expect(steerVerdict({ evidence: acted, nowIso: after({ ms: 60_000 }) })).toEqual(unread);
  });
});

describe("firstPassAfter", () => {
  it("skips a tick that started before registration, even one that finished after it", () => {
    const straddling = { finalisedIso: after({ ms: 60_000 }), startedIso: after({ ms: -60_000 }) };
    const later = { finalisedIso: after({ ms: 30 * 60_000 }), startedIso: after({ ms: 20 * 60_000 }) };
    const first = { finalisedIso: after({ ms: 10 * 60_000 }), startedIso: after({ ms: 5 * 60_000 }) };
    expect(firstPassAfter({ registeredAtIso: REGISTERED, ticks: [straddling, later, first] })).toEqual(first);
  });

  it("is none when no tick started after registration", () => {
    const before = { finalisedIso: after({ ms: 60_000 }), startedIso: after({ ms: -60_000 }) };
    expect(firstPassAfter({ registeredAtIso: REGISTERED, ticks: [before] })).toBe(undefined);
  });
});

describe("relayRowAction", () => {
  const row = (over: Partial<RelayRowEvidence> = {}): RelayRowEvidence => ({
    anchor: "talk:x",
    events: [],
    settled: false,
    slug: "talk-x",
    ...over,
  });
  const dispatched = ({ atIso }: { atIso: string }): RunEvent => ({
    atIso,
    by: "supervisor",
    kind: "dispatched",
    target: undefined,
  });

  it("names the first action event at or after registration", () => {
    const events = [dispatched({ atIso: after({ ms: -1 }) }), dispatched({ atIso: after({ ms: 5_000 }) })];
    expect(relayRowAction({ registeredAtIso: REGISTERED, row: row({ events }) })).toEqual({
      atIso: after({ ms: 5_000 }),
      eventKind: "dispatched",
      kind: "run-event",
    });
  });

  it("names the settlement first", () => {
    expect(relayRowAction({ registeredAtIso: REGISTERED, row: row({ settled: true }) })).toEqual({
      kind: "settlement",
    });
  });

  it("is none for an event from before registration", () => {
    const events = [dispatched({ atIso: after({ ms: -1 }) })];
    expect(relayRowAction({ registeredAtIso: REGISTERED, row: row({ events }) })).toBe(undefined);
  });
});
