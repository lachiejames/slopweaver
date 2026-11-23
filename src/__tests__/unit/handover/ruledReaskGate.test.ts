/*
 * `ruledReaskVerdict`: `handover ask` refuses a question the owner already ruled on, word for word, and tells the
 * asking session to say what changed since their ruling.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { RULED_REASK_HATCH, type RuledReaskVerdict, ruledReaskVerdict } from "../../../handover/ruledReaskGate.js";

const QUESTION = "Ship it?";
const COMMAND = "slopweaver handover ask";
const ASKED_ISO = "2026-11-08T00:00:00.000Z";

/** A journal: asked, ruled while held, answered — then asked again by hand. */
const RULED_AND_ANSWERED: readonly RunEvent[] = [
  { atIso: "2026-11-05T00:00:00.000Z", kind: "question", question: QUESTION },
  {
    anchor: "talk:a",
    atIso: "2026-11-06T00:00:00.000Z",
    decidedIso: "2026-11-06T00:00:00.000Z",
    kind: "ruling",
    ruling: "ship it",
  },
  { answer: "ship it", atIso: "2026-11-07T00:00:00.000Z", kind: "answered" },
];

/** The lines of a refusal, throwing on any other verdict so the assertion stays unconditional. */
function refusedLines({ verdict }: { verdict: RuledReaskVerdict }): readonly string[] {
  if (verdict.kind !== "refused") {
    throw new Error("expected a refusal");
  }
  return verdict.lines;
}

describe("ruledReaskVerdict", () => {
  it("refuses a hand re-ask in the same words the owner already ruled on, naming that ruling and what to say", () => {
    const verdict = ruledReaskVerdict({
      askedIso: ASKED_ISO,
      command: COMMAND,
      env: {},
      events: RULED_AND_ANSWERED,
      question: QUESTION,
    });
    expect(refusedLines({ verdict }).slice(1)).toEqual([
      '  - the owner ruled on this question in these words at 2026-11-06T00:00:00.000Z (talk:a): "ship it"',
      "  - say what changed since their ruling, in the question itself — a re-ask in the same words is drawn as a " +
        "check-in carrying their ruling, never a fresh question",
      "NOTHING was recorded and the run is not paused, so reword the question with what changed and ask again.",
    ]);
  });

  // The verb judges this ahead of its reshape path, so a question still held after
  // the owner's ruling, asked again to give it a shape, is refused the same way.
  it("refuses the same words while the question the owner ruled on is still held", () => {
    const verdict = ruledReaskVerdict({
      askedIso: ASKED_ISO,
      command: COMMAND,
      env: {},
      events: RULED_AND_ANSWERED.slice(0, 2),
      question: QUESTION,
    });
    expect(refusedLines({ verdict })[1]).toBe(
      '  - the owner ruled on this question in these words at 2026-11-06T00:00:00.000Z (talk:a): "ship it"',
    );
  });

  // Work the owner already ruled on is never carded again, so another question asked
  // and answered between their ruling and the same words does not make them fresh.
  it("refuses the same words after a different question was asked and answered since the owner's ruling", () => {
    const verdict = ruledReaskVerdict({
      askedIso: ASKED_ISO,
      command: COMMAND,
      env: {},
      events: [
        ...RULED_AND_ANSWERED,
        { atIso: "2026-11-07T06:00:00.000Z", kind: "question", question: "Deploy today?" },
        { answer: "not today", atIso: "2026-11-07T07:00:00.000Z", kind: "answered" },
      ],
      question: QUESTION,
    });
    expect(refusedLines({ verdict })[1]).toBe(
      '  - the owner ruled on this question in these words at 2026-11-06T00:00:00.000Z (talk:a): "ship it"',
    );
  });

  it("opens on its hatch", () => {
    const verdict = ruledReaskVerdict({
      askedIso: ASKED_ISO,
      command: COMMAND,
      env: {},
      events: RULED_AND_ANSWERED,
      question: QUESTION,
    });
    expect(refusedLines({ verdict })[0]).toContain(`${RULED_REASK_HATCH}=1 ${COMMAND}`);
  });

  it("passes a re-ask that says what changed, a first asking, and one the hatch opens", () => {
    const verdicts = [
      ruledReaskVerdict({
        askedIso: ASKED_ISO,
        command: COMMAND,
        env: {},
        events: RULED_AND_ANSWERED,
        question: "Ship it, now that the migration is reverted?",
      }),
      ruledReaskVerdict({ askedIso: ASKED_ISO, command: COMMAND, env: {}, events: [], question: QUESTION }),
      ruledReaskVerdict({
        askedIso: ASKED_ISO,
        command: COMMAND,
        env: { [RULED_REASK_HATCH]: "1" },
        events: RULED_AND_ANSWERED,
        question: QUESTION,
      }),
    ];
    expect(verdicts).toEqual([{ kind: "ok" }, { kind: "ok" }, { kind: "ok" }]);
  });
});
