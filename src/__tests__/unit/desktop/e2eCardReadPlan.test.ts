import { describe, expect, it } from "vitest";

import { CALL_STEP_IDS, e2eCallSteps } from "../../../desktop/e2eCallPlan.js";
import {
  CARD_READ_CAP_MS,
  CARD_STEP_IDS,
  cardNextRequest,
  cardPageWord,
  cardReadingHoldRequest,
  cardReadRequest,
  cardReadSteps,
  cardTargetsOf,
  isCardStepId,
  placeCardSteps,
  typedCardReadRequest,
} from "../../../desktop/e2eCardReadPlan.js";

/** Two synthetic card keys, never this install's own: one Queue card and one Alignment card. */
const QUEUE_CARD = "ask:acme-fixture-card";
const ALIGN_CARD = "act:acme-fixture-row";

describe("cardReadRequest", () => {
  it("names the card by its id's words on the page it is drawn on, with no challenge and no coaching", () => {
    expect([cardReadRequest({ cardKey: QUEUE_CARD }), cardReadRequest({ cardKey: ALIGN_CARD })]).toEqual([
      "This is an automated end to end test. Please open my Queue card acme fixture card and tell me, in the card's " +
        "own terms, what problem it describes and what it asks me to decide.",
      "This is an automated end to end test. Please open my Alignment card acme fixture row and tell me, in the " +
        "card's own terms, what problem it describes and what it asks me to decide.",
    ]);
    const words = ["real", "quote", "briefing", "checked"];
    expect(words.filter((word) => cardReadRequest({ cardKey: QUEUE_CARD }).includes(word))).toEqual([]);
  });

  it("types the same words behind the run's marker, so the two surfaces are asked one question", () => {
    expect(typedCardReadRequest({ cardKey: QUEUE_CARD, nonce: "abc123" })).toBe(
      `E2E typed abc123: ${cardReadRequest({ cardKey: QUEUE_CARD })}`,
    );
  });
});

describe("cardPageWord", () => {
  it("puts an act row and an align question on Alignment, every other kind on the Queue", () => {
    const keys = ["act:x", "align:x", "ask:x", "hand:x", "draft:x", "pr:x"];
    expect(keys.map((cardKey) => cardPageWord({ cardKey }))).toEqual([
      "Alignment",
      "Alignment",
      "Queue",
      "Queue",
      "Queue",
      "Queue",
    ]);
  });
});

describe("cardReadSteps", () => {
  it("places each card spoken, typed, held, then walked on from, in the list's order, each carrying its key", () => {
    const steps = cardReadSteps({ cardKeys: [QUEUE_CARD, ALIGN_CARD], surfaces: [...CARD_STEP_IDS] });
    expect(steps.map((step) => [step.id, step.cardKey])).toEqual([
      ["card-read", QUEUE_CARD],
      ["card-read-typed", QUEUE_CARD],
      ["card-reading-hold", QUEUE_CARD],
      ["card-next", QUEUE_CARD],
      ["card-read", ALIGN_CARD],
      ["card-read-typed", ALIGN_CARD],
      ["card-reading-hold", ALIGN_CARD],
      ["card-next", ALIGN_CARD],
    ]);
  });

  it("has the reading hold open the card and say the owner is still reading it, in the stalled call's own words", () => {
    const [hold] = cardReadSteps({ cardKeys: [QUEUE_CARD], surfaces: ["card-reading-hold"] });
    expect([hold!.prompt, hold!.capMs, hold!.silenceMs]).toEqual([
      "This is an automated end to end test. Please open my Queue card acme fixture card. I only just started " +
        "reading it, let me just keep reading.",
      CARD_READ_CAP_MS,
      360_000,
    ]);
    expect(cardReadingHoldRequest({ cardKey: ALIGN_CARD })).toContain("open my Alignment card acme fixture row.");
  });

  it("has card-next open the card, pause in say's own silence, then ask for the next card in the stalled call's words", () => {
    const [next] = cardReadSteps({ cardKeys: [QUEUE_CARD], surfaces: ["card-next"] });
    expect([next!.prompt, next!.capMs, next!.silenceMs]).toEqual([
      "This is an automated end to end test. Please open my Queue card acme fixture card. [[slnc 30000]] All right, " +
        "next card please.",
      CARD_READ_CAP_MS,
      360_000,
    ]);
    expect(cardNextRequest({ cardKey: ALIGN_CARD })).toContain("open my Alignment card acme fixture row.");
  });

  it("keeps only the surfaces asked for, whatever order they were asked in", () => {
    const steps = cardReadSteps({ cardKeys: [QUEUE_CARD], surfaces: ["card-read-typed"] });
    expect(steps.map((step) => step.id)).toEqual(["card-read-typed"]);
  });

  it("gives the microphone silence past the step's cap, so the request is never heard twice", () => {
    const [read] = cardReadSteps({ cardKeys: [QUEUE_CARD], surfaces: ["card-read"] });
    expect([read!.capMs, read!.silenceMs, read!.holdMs, read!.prompt]).toEqual([
      CARD_READ_CAP_MS,
      360_000,
      0,
      cardReadRequest({ cardKey: QUEUE_CARD }),
    ]);
    expect(read!.silenceMs).toBeGreaterThan(read!.capMs);
  });

  it("places nothing for no cards", () => {
    expect(cardReadSteps({ cardKeys: [], surfaces: [...CARD_STEP_IDS] })).toEqual([]);
  });
});

describe("placeCardSteps", () => {
  const cards = cardReadSteps({ cardKeys: [QUEUE_CARD], surfaces: [...CARD_STEP_IDS] });

  it("places the card steps after long-task-mid-call and before fleet-ask", () => {
    const leg = placeCardSteps({ calls: e2eCallSteps({ holdMinutes: 5 }), cards, order: CALL_STEP_IDS });
    const ids = leg.map((step) => step.id);
    expect(ids.slice(ids.indexOf("long-task-mid-call"), ids.indexOf("fleet-ask") + 1)).toEqual([
      "long-task-mid-call",
      "card-read",
      "card-read-typed",
      "card-reading-hold",
      "card-next",
      "fleet-ask",
    ]);
  });

  it("appends them when nothing in the leg comes after them, and is them alone with no other call", () => {
    const early = e2eCallSteps({ holdMinutes: 5 }).filter((step) => step.id === "call-live");
    expect(placeCardSteps({ calls: early, cards, order: CALL_STEP_IDS }).map((step) => step.id)).toEqual([
      "call-live",
      "card-read",
      "card-read-typed",
      "card-reading-hold",
      "card-next",
    ]);
    expect(placeCardSteps({ calls: [], cards, order: CALL_STEP_IDS })).toEqual(cards);
  });
});

describe("isCardStepId", () => {
  it("is true of the four card scenarios alone", () => {
    expect(CALL_STEP_IDS.filter((id) => isCardStepId({ id }))).toEqual([
      "card-read",
      "card-read-typed",
      "card-reading-hold",
      "card-next",
    ]);
  });
});

describe("cardTargetsOf", () => {
  it("reads all as the console's inventory", () => {
    expect(cardTargetsOf({ text: "all" })).toEqual({ kind: "inventory" });
  });

  it("reads a comma list of keys, trimmed and deduplicated, an Alignment question included", () => {
    expect(cardTargetsOf({ text: `${QUEUE_CARD}, align:acme-q,${QUEUE_CARD}` })).toEqual({
      keys: [QUEUE_CARD, "align:acme-q"],
      kind: "named",
    });
  });

  it("refuses an Automations recipe, a proposed workstream and a malformed key, naming each", () => {
    expect(cardTargetsOf({ text: "recipe:a,candidate:b,ask:ok,nonsense" })).toEqual({
      invalid: ["recipe:a", "candidate:b", "nonsense"],
    });
  });

  it("refuses an empty list by the text it was given", () => {
    expect(cardTargetsOf({ text: " , " })).toEqual({ invalid: [" , "] });
  });
});
