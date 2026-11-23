/**
 * What the previous tick held, read off its `tick.json` by exact handover id — and an unreadable file or a judgement
 * `tick close` would refuse reads as UNKNOWN, never as a tick that held nothing.
 */
import { describe, expect, it } from "vitest";

import { priorHoldsOf } from "../../../supervisor/digestPriorHolds.js";

/**
 * One judgement as the chair authors it and `tick close` accepts — no `recordedIso`, which the close stamps — so a
 * case varies only the fields it is about.
 */
const judgementOf = ({
  claim,
  kind = "hold-rationale",
  relatedSubjects,
  subject,
}: {
  claim: string;
  kind?: string;
  relatedSubjects?: unknown;
  subject: { id: string; kind: string };
}): Record<string, unknown> => ({
  claim,
  judgementId: `j-${subject.id}`,
  kind,
  ...(relatedSubjects === undefined ? {} : { relatedSubjects }),
  subject: { ...subject, label: subject.id },
  whyNotDerived: "risk-call",
  witness: { kind: "command", ref: "slopweaver handover list" },
});

describe("priorHoldsOf", () => {
  it("holds a hold-rationale's subject and each related subject of kind handover, by exact id", () => {
    const value = {
      judgements: [
        judgementOf({
          claim: "EEEE-861 waits on Smith",
          relatedSubjects: [
            { id: "land-1523", kind: "handover", label: "land" },
            { id: "#1523", kind: "pull-request", label: "pr" },
          ],
          subject: { id: "land-18099", kind: "handover" },
        }),
        judgementOf({ claim: "not a hold", kind: "priority-call", subject: { id: "seated-row", kind: "handover" } }),
        judgementOf({
          claim: "the EEEE-861 stack: land-18100, land-18101",
          subject: { id: "devx-stack", kind: "ceiling" },
        }),
      ],
    };

    expect(priorHoldsOf({ tick: 11, value })).toEqual({
      held: new Map([
        ["land-18099", "EEEE-861 waits on Smith"],
        ["land-1523", "EEEE-861 waits on Smith"],
      ]),
      kind: "read",
      tick: 11,
    });
  });

  it("holds a draft hold-rationale's handover id, read in the authored shape tick close accepts (handoff-9323 tick 4)", () => {
    const value = {
      judgements: [judgementOf({ claim: "waits on Smith's review", subject: { id: "land-2173", kind: "handover" } })],
    };

    expect(priorHoldsOf({ tick: 3, value })).toEqual({
      held: new Map([["land-2173", "waits on Smith's review"]]),
      kind: "read",
      tick: 3,
    });
  });

  it("calls a tick.json with no judgements list unreadable, never a tick that held nothing", () => {
    expect([priorHoldsOf({ tick: 11, value: {} }), priorHoldsOf({ tick: 11, value: { judgements: [] } })]).toEqual([
      { kind: "unreadable", tick: 11, why: "its tick.json carries no judgements list" },
      { held: new Map(), kind: "read", tick: 11 },
    ]);
  });

  it("calls a tick.json carrying a judgement tick close would refuse unreadable, never a partial read", () => {
    const good = judgementOf({ claim: "waits", subject: { id: "x", kind: "handover" } });
    const malformed = [
      judgementOf({
        claim: "wait",
        relatedSubjects: { id: "x", kind: "handover", label: "x" },
        subject: { id: "stack", kind: "ceiling" },
      }),
      { claim: "wait", kind: "hold-rationale", subject: { id: "x", kind: "handover" } },
      { ...good, recordedIso: "2026-10-13T00:00:00.000Z" },
      "not a judgement",
    ];

    expect(malformed.map((bad) => priorHoldsOf({ tick: 11, value: { judgements: [good, bad] } }))).toEqual(
      malformed.map(() => ({
        kind: "unreadable",
        tick: 11,
        why: "1 of its judgement(s) do not match the tick schema",
      })),
    );
  });
});
