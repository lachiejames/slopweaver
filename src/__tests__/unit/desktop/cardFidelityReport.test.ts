import { describe, expect, it } from "vitest";

import type { CardFidelityObservation } from "../../../desktop/cardFidelity.js";
import { cardFidelityHtml, cardFidelityTable } from "../../../desktop/cardFidelityReport.js";
import { NO_CALL_EVIDENCE } from "../../../desktop/e2eCallOutcome.js";
import { e2eCallSteps } from "../../../desktop/e2eCallPlan.js";
import { cardReadSteps } from "../../../desktop/e2eCardReadPlan.js";
import type { E2eStepResult } from "../../../desktop/e2eReport.js";

/** Two synthetic cards, never this install's own. */
const A = "ask:acme-a";
const B = "act:acme-b";

/** One judged call. */
const judged = ({
  callId,
  digest,
  failed,
}: {
  callId: string;
  digest: string;
  failed: boolean;
}): CardFidelityObservation => ({
  briefing: { expected: [], read: [], state: "not-applicable" },
  callId,
  cardKey: A,
  cardRead: true,
  challenge: "reread-before-answer",
  challenged: undefined,
  concessions: [],
  failures: failed ? [{ anchor: `talk-call:${callId}#v1`, code: "FIGURE_UNSOURCED", detail: "5 <times>" }] : [],
  first: undefined,
  sourceDigest: digest,
  surface: "spoken",
});

const [spokenA, typedA, spokenB, typedB] = cardReadSteps({
  cardKeys: [A, B],
  surfaces: ["card-read", "card-read-typed"],
});

/** One step's result. */
const result = ({
  step,
  calls,
  detail,
}: {
  step: E2eStepResult["step"];
  calls: readonly CardFidelityObservation[];
  detail?: string;
}): E2eStepResult => ({
  call: { ...NO_CALL_EVIDENCE, cardFidelity: calls },
  elapsedMs: 1,
  screenshot: undefined,
  step,
  url: undefined,
  verdict: detail === undefined ? { passed: true } : { detail, kind: "blocked", passed: false },
});

const RESULTS: readonly E2eStepResult[] = [
  result({ calls: [], step: e2eCallSteps({ holdMinutes: 5 })[0]! }),
  result({ calls: [judged({ callId: "c1", digest: "d1", failed: false })], step: spokenA! }),
  result({ calls: [judged({ callId: "c2", digest: "d1", failed: true })], step: typedA! }),
  result({ calls: [judged({ callId: "c3", digest: "d2", failed: false })], step: spokenB! }),
  result({ calls: [], detail: "the typed conversation never opened", step: typedB! }),
];

describe("cardFidelityTable", () => {
  it("rows each card scenario in run order, carrying its failures and its scenario's own reason", () => {
    const { rows } = cardFidelityTable({ results: RESULTS });
    expect(
      rows.map((row) => [row.cardKey, row.surface, row.witnessed, row.failures.length, row.scenarioDetail]),
    ).toEqual([
      [A, "spoken", true, 0, undefined],
      [A, "typed", true, 1, undefined],
      [B, "spoken", true, 0, undefined],
      [B, "typed", false, 0, "the typed conversation never opened"],
    ]);
  });

  it("pairs a card's surfaces only over the same card text", () => {
    const moved = [
      ...RESULTS.slice(0, 2),
      result({ calls: [judged({ callId: "c9", digest: "d9", failed: false })], step: typedA! }),
    ];
    expect([cardFidelityTable({ results: RESULTS }).pairings, cardFidelityTable({ results: moved }).pairings]).toEqual([
      { [A]: "same-card", [B]: "one-surface" },
      { [A]: "card-moved" },
    ]);
  });

  it("is empty for a run with no card scenario", () => {
    expect(cardFidelityTable({ results: RESULTS.slice(0, 1) })).toEqual({ pairings: {}, rows: [] });
  });
});

describe("cardFidelityHtml", () => {
  it("leads with the failing rows, anchors each failure and escapes what it quotes", () => {
    const html = cardFidelityHtml({ table: cardFidelityTable({ results: RESULTS }) });
    const order = [A, B].map((key) => html.indexOf(`<code>${key}</code></td><td>typed`));
    expect(order[0]! < html.indexOf(`<code>${A}</code></td><td>spoken`)).toBe(true);
    expect(order[1]! < html.indexOf(`<code>${A}</code></td><td>spoken`)).toBe(true);
    expect(html).toContain("<b>FIGURE_UNSOURCED</b> — 5 &lt;times&gt; <code>talk-call:c2#v1</code>");
    expect(html).toContain("<b>SCENARIO</b> — the typed conversation never opened");
  });
});
