/*
 * `askLifecycleEventLine` / `parseAskLifecycleLog`: every event kind round-trips through one log line, the real
 * schema version is always written, and a malformed, future-version or incomplete line is reported unreadable by
 * its 1-indexed number without dropping the rest of the log. It was split out when the ask-lifecycle suite
 * became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  type AskLifecycleEvent,
  askLifecycleEventLine,
  parseAskLifecycleLog,
} from "../../../../../live/ask/lifecycle.js";
import { A_CHECKLIST, BASE, CAPTURED, SATISFIED } from "./harness.js";

describe("askLifecycleEventLine / parseAskLifecycleLog", () => {
  it("round-trips a captured event", () => {
    const line = askLifecycleEventLine({ event: CAPTURED });
    const { events, unreadable } = parseAskLifecycleLog({ text: line });

    expect(events).toEqual([CAPTURED]);
    expect(unreadable).toEqual([]);
  });

  /**
   * `AskIdentity`'s structural type does not stop a WIDER value (assignable but carrying extra fields) from
   * being passed where an identity is expected — nothing here enforces "exactly these three fields" at the
   * type level. If the event object itself happened to carry an excess `schemaVersion`, spreading it AFTER
   * the canonical one would let it win; this line always writes the real version regardless.
   */
  it("always writes the real schema version, even when the event object itself carries a stray schemaVersion field", () => {
    const contaminated = { ...CAPTURED, schemaVersion: 2 };
    const line = askLifecycleEventLine({ event: contaminated });

    expect(JSON.parse(line).schemaVersion).toBe(1);
    expect(parseAskLifecycleLog({ text: line })).toEqual({ events: [CAPTURED], unreadable: [] });
  });

  it("reports an unparsable line's 1-indexed number without dropping the rest of the log", () => {
    const good = askLifecycleEventLine({ event: CAPTURED });
    const { events, unreadable } = parseAskLifecycleLog({ text: `not json\n${good}` });

    expect(unreadable).toEqual([1]);
    expect(events).toEqual([CAPTURED]);
  });

  it("rejects a line from a future schema version", () => {
    const { events, unreadable } = parseAskLifecycleLog({ text: JSON.stringify({ ...CAPTURED, schemaVersion: 2 }) });

    expect(events).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("skips a blank line without counting it as unreadable", () => {
    const good = askLifecycleEventLine({ event: CAPTURED });
    const { events, unreadable } = parseAskLifecycleLog({ text: `${good}\n\n` });

    expect(events).toEqual([CAPTURED]);
    expect(unreadable).toEqual([]);
  });

  it("rejects a dispatched event naming a tier outside the known three", () => {
    const line = JSON.stringify({
      ...CAPTURED,
      kind: "dispatched",
      leaseExpiresAt: "2026-08-05T13:31:00.000Z",
      schemaVersion: 1,
      tier: "invented-tier",
    });
    const { events, unreadable } = parseAskLifecycleLog({ text: line });

    expect(events).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("round-trips a withheld event, the queue id and code included", () => {
    const withheld: AskLifecycleEvent = {
      ...BASE,
      code: "unclear-intent",
      kind: "withheld",
      queueId: "q-1",
      reason: "ambiguous request",
    };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: withheld }) });

    expect(events).toEqual([withheld]);
    expect(unreadable).toEqual([]);
  });

  it("round-trips a failed event", () => {
    const failed: AskLifecycleEvent = { ...BASE, kind: "failed", reason: "turn threw before answering" };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: failed }) });

    expect(events).toEqual([failed]);
    expect(unreadable).toEqual([]);
  });

  /**
   * A kind the parser does not know is dropped as unreadable, and an ask whose terminal row is dropped goes
   * on reading as unfinished forever. So the round trip is what makes `answer-lost` a real row rather than a
   * type that only exists in memory.
   */
  it("round-trips an answer-lost event, distinct from a failed one", () => {
    const lost: AskLifecycleEvent = { ...BASE, kind: "answer-lost", reason: "the send threw after review" };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: lost }) });

    expect(events).toEqual([lost]);
    expect(unreadable).toEqual([]);
  });

  it("round-trips a checklist-posted event", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      turnId: "turn-1",
      workingTs: "1785000000.000900",
    };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: posted }) });

    expect(events).toEqual([posted]);
    expect(unreadable).toEqual([]);
  });

  it("rejects a checklist-posted event missing workingTs", () => {
    const line = JSON.stringify({ ...BASE, kind: "checklist-posted", schemaVersion: 1, turnId: "turn-1" });
    const { events, unreadable } = parseAskLifecycleLog({ text: line });

    expect(events).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("round-trips a triaged-no-response event", () => {
    const triaged: AskLifecycleEvent = { ...BASE, kind: "triaged-no-response", reason: "already resolved elsewhere" };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: triaged }) });

    expect(events).toEqual([triaged]);
    expect(unreadable).toEqual([]);
  });

  it("round-trips a satisfied-elsewhere event, pointer and all", () => {
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: SATISFIED }) });

    expect(events).toEqual([SATISFIED]);
    expect(unreadable).toEqual([]);
  });

  /**
   * The pointer is the whole content of this event, so a row without one is unreadable rather than a
   * satisfied ask with nothing to point at — the posture every other arm holds, and what keeps a malformed
   * row from folding an ask to a terminal it cannot justify.
   */
  it("rejects a satisfied-elsewhere event missing its answeredByTs pointer", () => {
    const line = JSON.stringify({ ...BASE, kind: "satisfied-elsewhere", reason: "answered above", schemaVersion: 1 });
    const { events, unreadable } = parseAskLifecycleLog({ text: line });

    expect(events).toEqual([]);
    expect(unreadable).toEqual([1]);
  });

  it("round-trips a triage-cleanup-intended event carrying an exact checklist delete target", () => {
    const intended: AskLifecycleEvent = {
      ...BASE,
      checklistDelete: A_CHECKLIST,
      kind: "triage-cleanup-intended",
      reason: "casual greeting, no reply owed",
    };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: intended }) });

    expect(events).toEqual([intended]);
    expect(unreadable).toEqual([]);
  });

  it("round-trips a handover-cleanup-intended event, keeping it apart from triage's intent", () => {
    const intended: AskLifecycleEvent = {
      ...BASE,
      checklistDelete: A_CHECKLIST,
      kind: "handover-cleanup-intended",
      reason: "a lockout is IT's to answer",
    };
    const { events, unreadable } = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: intended }) });

    expect(events).toEqual([intended]);
    expect(unreadable).toEqual([]);
  });

  it("parses an old triage-cleanup-intended row with no checklistDelete field at all", () => {
    const line = JSON.stringify({
      ...BASE,
      kind: "triage-cleanup-intended",
      reason: "no checklist existed",
      schemaVersion: 1,
    });
    const { events, unreadable } = parseAskLifecycleLog({ text: line });

    expect(events).toEqual([{ ...BASE, kind: "triage-cleanup-intended", reason: "no checklist existed" }]);
    expect(unreadable).toEqual([]);
  });
});
