/**
 * The decoder and the write schema on a ruling's gate.
 *
 * The property both halves exist for: an optional field that is PRESENT and unusable makes the line
 * unreadable rather than decoding to one with the field absent — because absence is a CLAIM here (this
 * ruling gates nothing), and a half-decoded gate would be a refusal with a verb list nobody wrote.
 */
import { describe, expect, it } from "vitest";

import { parseLedger } from "../../../handover/ledger.js";
import { ROW_EVENT_SCHEMAS } from "../../../handover/rowEventSchema.js";
import { rulingEvent } from "../../../handover/rulingLineDecode.js";

const PLACED = "2026-09-21T03:01:34.000Z";

const base = {
  anchor: "transcript:a0000036#a0000064",
  atIso: PLACED,
  decidedIso: PLACED,
  kind: "ruling",
  ruling: "stop posting shit that no one is asking for",
};

/** One journal holding exactly the line under test. */
function parsed({ event }: { event: Readonly<Record<string, unknown>> }): ReturnType<typeof parseLedger> {
  return parseLedger({ text: `${JSON.stringify(event)}\n` });
}

describe("decoding a ruling's gate", () => {
  it("reads a well-formed gate", () => {
    const gate = { subjects: ["a-recipe"], verbs: [{ noun: "recipe", verb: "run-due" }] };

    const { events, unreadable } = parsed({ event: { ...base, gate } });

    expect(unreadable).toEqual([]);
    expect(events.length).toBe(1);
    expect(events[0]!.kind).toBe("ruling");
  });

  it("reads the whole-verb gate, whose subjects list is legitimately empty", () => {
    const gate = { subjects: [], verbs: [{ noun: "slack", verb: "post" }] };

    const { events, unreadable } = parsed({ event: { ...base, gate } });

    expect(unreadable).toEqual([]);
    expect(events.length).toBe(1);
  });

  it("refuses a subjects field that is not a list — reading it as empty would WIDEN the gate", () => {
    const gate = { subjects: "a-recipe", verbs: [{ noun: "slack", verb: "post" }] };

    expect(parsed({ event: { ...base, gate } }).events).toEqual([]);
  });

  it("decodes a ruling with no gate at all, unchanged", () => {
    const { events, unreadable } = parsed({ event: base });

    expect(unreadable).toEqual([]);
    expect(events.length).toBe(1);
  });

  it("refuses a gate naming no verbs — a constraint that refuses nothing", () => {
    const { events } = parsed({ event: { ...base, gate: { subjects: [], verbs: [] } } });

    expect(events).toEqual([]);
  });

  it("refuses a gate that is not an object", () => {
    expect(parsed({ event: { ...base, gate: "slack post" } }).events).toEqual([]);
  });

  it("refuses a gate whose untilIso is present and not an instant", () => {
    const gate = { subjects: [], untilIso: "soon", verbs: [{ noun: "slack", verb: "post" }] };

    expect(parsed({ event: { ...base, gate } }).events).toEqual([]);
  });

  it("refuses an empty gateReleases list, which lifts nothing while reading as a release", () => {
    expect(parsed({ event: { ...base, gateReleases: [] } }).events).toEqual([]);
  });

  it("refuses a gateReleases list holding a non-string, rather than filtering it to a release nobody wrote", () => {
    expect(parsed({ event: { ...base, gateReleases: ["gate#x", 7] } }).events).toEqual([]);
  });

  it("refuses a gateReleases list holding a blank id, which names no gate", () => {
    expect(parsed({ event: { ...base, gateReleases: ["gate#x", "  "] } }).events).toEqual([]);
  });

  it("refuses a gateReleases value that is not a list at all", () => {
    expect(parsed({ event: { ...base, gateReleases: "gate#x" } }).events).toEqual([]);
  });

  it("refuses a gate on a RECONSTRUCTION", () => {
    const gate = { subjects: [], verbs: [{ noun: "slack", verb: "post" }] };

    expect(parsed({ event: { ...base, backfilledFrom: PLACED, gate } }).events).toEqual([]);
  });
});

describe("the write schema on a ruling's gate", () => {
  const schema = ROW_EVENT_SCHEMAS.ruling;

  it("accepts a gate naming one verb", () => {
    const gate = { subjects: [], verbs: [{ noun: "slack", verb: "post" }] };

    expect(schema.safeParse({ ...base, gate }).success).toBe(true);
  });

  it("refuses a gate naming no verb", () => {
    expect(schema.safeParse({ ...base, gate: { subjects: [], verbs: [] } }).success).toBe(false);
  });

  it("refuses a blank subject, which would narrow the gate to nothing", () => {
    const gate = { subjects: [""], verbs: [{ noun: "slack", verb: "post" }] };

    expect(schema.safeParse({ ...base, gate }).success).toBe(false);
  });

  it("refuses a reconstruction that tries to place a gate", () => {
    const gate = { subjects: [], verbs: [{ noun: "slack", verb: "post" }] };

    expect(schema.safeParse({ ...base, backfilledFrom: PLACED, gate }).success).toBe(false);
  });

  it("refuses a reconstruction that tries to LIFT one", () => {
    expect(schema.safeParse({ ...base, backfilledFrom: PLACED, gateReleases: ["row#x"] }).success).toBe(false);
  });
});

describe("rulingEvent, called directly", () => {
  it("decodes the gate onto the event rather than dropping it on the way through", () => {
    const gate = { subjects: ["a-recipe"], verbs: [{ noun: "recipe", verb: "run-due" }] };

    const event = rulingEvent({ atIso: PLACED, payload: { ...base, gate } })!;

    expect(event.kind).toBe("ruling");
    expect(JSON.stringify(event)).toContain('"run-due"');
  });

  it("answers undefined for a line missing the anchor, since the owner's word needs a where", () => {
    expect(rulingEvent({ atIso: PLACED, payload: { atIso: PLACED, kind: "ruling", ruling: "no" } })).toBe(undefined);
  });
});
