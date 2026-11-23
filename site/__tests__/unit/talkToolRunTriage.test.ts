/*
 * What `open_card` and `triage_clock` do to a triage pass the page holds: which card opening stops its clock, and
 * which clock states the tool accepts.
 */
import { describe, expect, it } from "vitest";

import { runTalkTool } from "../../components/voice/talkToolRun";
import { CLOCK_MINUTES_MALFORMED, CLOCK_MINUTES_NOT_SAID } from "../../lib/clockMinutesGuard";
import { TOKEN } from "../talkToolSeams";
import { triageSeams, walkOnTriageCard } from "../triageToolSeams";

describe("runTalkTool — open_card over a triage pass", () => {
  it("stops the clock once when the card opened is not the triage card, since its line would land on what the owner reads", async () => {
    const { seams: held, kept } = triageSeams({ walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "open_card",
      rawArguments: JSON.stringify({ key: "hand:other" }),
      seams: held,
    });
    expect([ran.detail, kept.stops, kept.walk]).toEqual(["hand:other not found", 1, walkOnTriageCard()]);
  });

  it("leaves the clock running when the card opened is the triage card itself, or no pass is running", async () => {
    const onCard = triageSeams({ walk: walkOnTriageCard() });
    const none = triageSeams({ walk: undefined });
    const same = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "open_card",
      rawArguments: JSON.stringify({ key: "act:ev-9" }),
      seams: onCard.seams,
    });
    const idle = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "open_card",
      rawArguments: JSON.stringify({ key: "hand:other" }),
      seams: none.seams,
    });
    expect([same.detail, onCard.kept.stops, idle.detail, none.kept.stops]).toEqual([
      "act:ev-9 not found",
      0,
      "hand:other not found",
      0,
    ]);
  });
});

describe("runTalkTool — triage_clock", () => {
  it("refuses a state that is not paused or running before it touches the pass or the clock", async () => {
    const { seams: held, kept } = triageSeams({ walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "triage_clock",
      rawArguments: JSON.stringify({ state: "later" }),
      seams: held,
    });
    expect([ran.refused, ran.answer, ran.detail, kept.stops, kept.walk]).toEqual([
      true,
      { refused: "state must be paused or running" },
      "not a clock state",
      0,
      walkOnTriageCard(),
    ]);
  });

  it("refuses a call naming no state at all", async () => {
    const { seams: held } = triageSeams({ walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      name: "triage_clock",
      rawArguments: "{}",
      requestId: TOKEN,
      seams: held,
    });
    expect([ran.refused, ran.answer]).toEqual([true, { refused: "state must be paused or running" }]);
  });

  it("pauses the pass the page holds when the state is paused, as no read", async () => {
    const { seams: held, kept } = triageSeams({ walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "triage_clock",
      rawArguments: JSON.stringify({ state: "paused" }),
      seams: held,
    });
    expect([ran.refused, ran.readText, ran.detail, kept.walk!.paused, kept.stops, kept.started]).toEqual([
      false,
      false,
      "triage clock paused",
      true,
      1,
      0,
    ]);
  });

  it("starts the card's clock afresh when the state is running", async () => {
    const paused = { ...walkOnTriageCard(), paused: true };
    const { seams: held, kept } = triageSeams({ walk: paused });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "triage_clock",
      rawArguments: JSON.stringify({ state: "running" }),
      seams: held,
    });
    expect([ran.detail, kept.walk!.paused, kept.walk!.current!.presentedMs, kept.stops, kept.started]).toEqual([
      "triage clock running",
      false,
      7000,
      1,
      1,
    ]);
  });
});

// The owner names a card's length; the voice never picks one.
describe("runTalkTool — triage_clock minutes", () => {
  it("runs the card to the length the owner just said", async () => {
    const { seams: held, kept } = triageSeams({ heard: ["ten on this one"], walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      name: "triage_clock",
      rawArguments: JSON.stringify({ minutes: 10, state: "running" }),
      requestId: TOKEN,
      seams: held,
    });
    expect([ran.refused, ran.detail, kept.lengths]).toEqual([false, "triage clock running", [600_000]]);
  });

  it("refuses a length the owner never said, touching no clock", async () => {
    const { seams: held, kept } = triageSeams({ heard: ["give me a minute on this"], walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      name: "triage_clock",
      rawArguments: JSON.stringify({ minutes: 5, state: "running" }),
      requestId: TOKEN,
      seams: held,
    });
    expect([ran.refused, ran.answer, ran.detail, kept.stops, kept.started]).toEqual([
      true,
      { refused: CLOCK_MINUTES_NOT_SAID },
      "a clock length the owner did not name",
      0,
      0,
    ]);
  });

  it("refuses a length that is not a whole number of minutes in range", async () => {
    const { seams: held, kept } = triageSeams({ heard: ["give me 500"], walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      name: "triage_clock",
      rawArguments: JSON.stringify({ minutes: 500, state: "running" }),
      requestId: TOKEN,
      seams: held,
    });
    expect([ran.refused, ran.answer, kept.started]).toEqual([true, { refused: CLOCK_MINUTES_MALFORMED }, 0]);
  });

  it("refuses a length on a pause, which has no card to time", async () => {
    const { seams: held, kept } = triageSeams({ heard: ["pause it for ten"], walk: walkOnTriageCard() });
    const ran = await runTalkTool({
      answerId: undefined,
      name: "triage_clock",
      rawArguments: JSON.stringify({ minutes: 10, state: "paused" }),
      requestId: TOKEN,
      seams: held,
    });
    expect([ran.refused, ran.answer, ran.detail, kept.walk!.paused]).toEqual([
      true,
      { refused: "minutes goes only with state running" },
      "a length on a pause",
      false,
    ]);
  });
});
