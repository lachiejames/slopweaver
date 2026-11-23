/*
 * The card clock's length and `triage_clock` over plain fake seams: a card gets the minutes the owner named, else ten on
 * a briefing and two on any other; a pause writes the pass paused and arms nothing, a resume counts the card's length
 * afresh (split out of `triageRun.test.ts` to keep that file under the size ratchet).
 */
import { describe, expect, it } from "vitest";

import { runTriageClock } from "../../components/voice/triageClockRun";
import { runTriageNext } from "../../components/voice/triageRun";
import type { QueueRow } from "../../lib/queueRows";
import {
  CLOCK_NOTE,
  clockNoteOf,
  fakes,
  heldVisit,
  heldWalk,
  NO_CARD_NOTE,
  PAUSED_NOTE,
  ROWS,
  WALK_ID,
} from "./triageRunFixture";

/** The fixture's one card, carrying a page for the owner to react to: a briefing. */
const BRIEFING_ROWS: readonly QueueRow[] = ROWS.map((row) => ({
  ...row,
  card: {
    ...row.card,
    pages: [{ slug: "clock-briefing", url: "file:///h/.slopweaver/pages/clock-briefing/index.html" }],
  },
}));

/**
 * The clock note a `triage_next` answer carries.
 *
 * @param ran the answer
 * @returns its `triage.clock` words
 */
function clockOf({ ran }: { ran: { readonly answer: unknown } }): string {
  return (ran.answer as { triage: { clock: string } }).triage.clock;
}

describe("the card clock's length", () => {
  it("gives a card two minutes when the owner named none", async () => {
    const { seams, lengthsAtStart } = fakes({ walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([lengthsAtStart, clockOf({ ran })]).toEqual([[120_000], CLOCK_NOTE]);
  });

  it("gives a briefing ten minutes when the owner named none", async () => {
    const { seams, lengthsAtStart } = fakes({ rows: BRIEFING_ROWS, walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([lengthsAtStart, clockOf({ ran })]).toEqual([[600_000], clockNoteOf({ length: "10 minutes" })]);
  });

  it("gives the card the minutes the owner named, over a briefing's ten", async () => {
    const { seams, lengthsAtStart } = fakes({ rows: BRIEFING_ROWS, walk: undefined });
    const ran = await runTriageNext({ minutes: 1, seams });
    expect([lengthsAtStart, clockOf({ ran })]).toEqual([[60_000], clockNoteOf({ length: "1 minute" })]);
  });

  it("keeps the card's length while the clock is paused, so a start with no length runs it again", async () => {
    const { seams, lengths } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    runTriageClock({ minutes: undefined, seams, state: "paused" });
    expect([...lengths.entries()]).toEqual([[`${WALK_ID}-1`, 120_000]]);
  });
});

describe("runTriageClock", () => {
  it("pauses: writes the pass paused and stops the clock without starting one", async () => {
    const { seams, clocks, kept, started } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    const ran = runTriageClock({ minutes: undefined, seams, state: "paused" });
    expect([ran.refused, ran.answer, ran.detail, kept.walk!.paused, clocks, started.length]).toEqual([
      false,
      { clock: "paused", note: PAUSED_NOTE },
      "triage clock paused",
      true,
      ["stop", `start ${WALK_ID}-1`, "stop"],
      1,
    ]);
    expect(Object.keys(ran)).not.toContain("triageVisit");
  });

  it("resumes on the card in front of the owner with its length counted afresh from now", async () => {
    const { seams, clocks, kept, now, started } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    runTriageClock({ minutes: undefined, seams, state: "paused" });
    now.ms = 90_000;
    const ran = runTriageClock({ minutes: undefined, seams, state: "running" });
    expect([ran.refused, ran.answer, ran.detail, kept.walk!.paused, kept.walk!.current!.presentedMs]).toEqual([
      false,
      { clock: "running", note: CLOCK_NOTE },
      "triage clock running",
      false,
      90_000,
    ]);
    expect([clocks, started.map((visit) => visit.presentedMs)]).toEqual([
      ["stop", `start ${WALK_ID}-1`, "stop", "stop", `start ${WALK_ID}-1`],
      [5000, 90_000],
    ]);
    // The answer names the card whose clock restarted, so the server takes its due line again.
    expect(ran.triageVisit).toBe(`${WALK_ID}-1`);
  });

  it("runs a restarted clock to the length the owner just named", async () => {
    const { seams, lengthsAtStart } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    const ran = runTriageClock({ minutes: 10, seams, state: "running" });
    expect([lengthsAtStart, ran.answer]).toEqual([
      [120_000, 600_000],
      { clock: "running", note: clockNoteOf({ length: "10 minutes" }) },
    ]);
  });

  it("runs a restarted clock with no length named to the length the card ran before", async () => {
    const { seams, lengthsAtStart } = fakes({ walk: undefined });
    await runTriageNext({ minutes: 5, seams });
    runTriageClock({ minutes: undefined, seams, state: "paused" });
    const ran = runTriageClock({ minutes: undefined, seams, state: "running" });
    expect([lengthsAtStart, ran.answer]).toEqual([
      [300_000, 300_000],
      { clock: "running", note: clockNoteOf({ length: "5 minutes" }) },
    ]);
  });

  it("resumes with no clock to arm when the card in front of the owner is ruled or none is", () => {
    const ruled = heldWalk({ over: { current: heldVisit({ over: { ruled: true } }), paused: true } });
    const none = heldWalk({ over: { paused: true } });
    const onRuled = fakes({ walk: ruled });
    const onNone = fakes({ walk: none });
    const ranRuled = runTriageClock({ minutes: undefined, seams: onRuled.seams, state: "running" });
    runTriageClock({ minutes: undefined, seams: onNone.seams, state: "running" });
    expect([
      onRuled.kept.walk!.paused,
      onRuled.clocks,
      onRuled.started.length,
      onNone.kept.walk!.paused,
      onNone.clocks,
      onNone.started.length,
      ranRuled.answer,
    ]).toEqual([false, ["stop"], 0, false, ["stop"], 0, { clock: "running", note: NO_CARD_NOTE }]);
  });

  it("refuses with no pass running, touching no clock", () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const ran = runTriageClock({ minutes: undefined, seams, state: "paused" });
    expect([ran.refused, ran.answer, ran.detail, clocks, kept.walk]).toEqual([
      true,
      { refused: "no triage pass is running: there is no clock to pause or start" },
      "no triage pass",
      [],
      undefined,
    ]);
  });

  it("refuses a stopped pass, leaving it as it was", () => {
    const stopped = heldWalk({ over: { stoppedMs: 4000 } });
    const { seams, clocks, kept } = fakes({ walk: stopped });
    const ran = runTriageClock({ minutes: undefined, seams, state: "paused" });
    expect([ran.refused, ran.answer, clocks, kept.walk]).toEqual([
      true,
      { refused: "no triage pass is running: there is no clock to pause or start" },
      [],
      stopped,
    ]);
  });
});
