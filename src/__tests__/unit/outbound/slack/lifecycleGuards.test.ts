/**
 * The edit/delete guards. Both pure, so the whole decision space is enumerated rather than sampled.
 *
 * The exemption table is asserted in BOTH directions on purpose: the failure this guard exists to prevent
 * is silent in either direction — exempting the card post defeats double-post protection, and reserving a
 * progress edit blocks every tick after the first.
 */
import { describe, expect, it } from "vitest";

import {
  isReservationExempt,
  type LifecycleMessageKind,
  type LifecycleOperationKind,
  messageOwnership,
  ownershipRefusal,
  type ReadSlackMessage,
} from "../../../../outbound/slack/lifecycleGuards.js";

/** The bot this token is. */
const SELF = { botId: "B_SELF", userId: "U_SELF" };

/** A card slopweaver genuinely posted. */
const OUR_CARD: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: "slopweaver_card_v1",
  renderer: "slack-card-v1",
  ts: "1700000000.000100",
  userId: "U_SELF",
};

const CARD_TYPES = ["slopweaver_card_v1"];
const BOTH_TYPES = ["slopweaver_card_v1", "slopweaver_progress_v1"];

describe("messageOwnership", () => {
  it("admits a card this bot posted through a known renderer", () => {
    expect(messageOwnership({ expectedEventTypes: CARD_TYPES, message: OUR_CARD, self: SELF })).toEqual({
      kind: "owned",
      renderer: "slack-card-v1",
    });
  });

  it("admits a progress message when the operation accepts that type", () => {
    const progress: ReadSlackMessage = {
      ...OUR_CARD,
      metadataEventType: "slopweaver_progress_v1",
      renderer: "slack-progress-v1",
    };
    expect(messageOwnership({ expectedEventTypes: BOTH_TYPES, message: progress, self: SELF })).toEqual({
      kind: "owned",
      renderer: "slack-progress-v1",
    });
  });

  it("REFUSES a message posted by a human, which carries no bot id at all", () => {
    const human: ReadSlackMessage = { fileIds: [], ts: "1700000000.000100", userId: "U_COLLEAGUE" };
    expect(messageOwnership({ expectedEventTypes: CARD_TYPES, message: human, self: SELF })).toEqual({
      kind: "not-ours-bot",
      messageBotId: undefined,
    });
  });

  it("REFUSES a message posted by a different bot", () => {
    const other: ReadSlackMessage = { ...OUR_CARD, botId: "B_OTHER_APP" };
    expect(messageOwnership({ expectedEventTypes: CARD_TYPES, message: other, self: SELF })).toEqual({
      kind: "not-ours-bot",
      messageBotId: "B_OTHER_APP",
    });
  });

  it("REFUSES when our own identity is unknown, because 'could not tell' must never read as 'ours'", () => {
    expect(
      messageOwnership({ expectedEventTypes: CARD_TYPES, message: OUR_CARD, self: { userId: "U_OTHER" } }),
    ).toEqual({
      kind: "not-ours-bot",
      messageBotId: "B_SELF",
    });
  });

  it("REFUSES a message from the same bot that carries no slopweaver metadata", () => {
    const sameBotNoMetadata: ReadSlackMessage = { botId: "B_SELF", fileIds: [], ts: "1700000000.000100" };
    expect(messageOwnership({ expectedEventTypes: CARD_TYPES, message: sameBotNoMetadata, self: SELF })).toEqual({
      kind: "no-slopweaver-metadata",
    });
  });

  it("REFUSES an empty event type, which is absence wearing a different shape", () => {
    expect(
      messageOwnership({ expectedEventTypes: CARD_TYPES, message: { ...OUR_CARD, metadataEventType: "" }, self: SELF }),
    ).toEqual({ kind: "no-slopweaver-metadata" });
  });

  it("REFUSES a progress message when the operation only accepts cards", () => {
    const progress: ReadSlackMessage = {
      ...OUR_CARD,
      metadataEventType: "slopweaver_progress_v1",
      renderer: "slack-progress-v1",
    };
    expect(messageOwnership({ expectedEventTypes: CARD_TYPES, message: progress, self: SELF })).toEqual({
      found: "slopweaver_progress_v1",
      kind: "unexpected-event-type",
    });
  });

  it("REFUSES a renderer version this build does not know, rather than re-rendering a different shape", () => {
    expect(
      messageOwnership({
        expectedEventTypes: CARD_TYPES,
        message: { ...OUR_CARD, renderer: "slack-card-v9" },
        self: SELF,
      }),
    ).toEqual({ found: "slack-card-v9", kind: "unknown-renderer" });
  });

  it("RECOGNISES the bot's own assistant answer, so the owner can still delete what their bot said", () => {
    expect(
      messageOwnership({
        expectedEventTypes: CARD_TYPES,
        message: { ...OUR_CARD, renderer: "slack-assistant-answer-v1" },
        self: SELF,
      }),
    ).toEqual({ kind: "owned", renderer: "slack-assistant-answer-v1" });
  });

  it("still RECOGNISES a card posted by an earlier build, because Slack holds those and we cannot re-stamp them", () => {
    expect(
      messageOwnership({
        expectedEventTypes: CARD_TYPES,
        message: { ...OUR_CARD, renderer: "slack-card-v1" },
        self: SELF,
      }),
    ).toEqual({ kind: "owned", renderer: "slack-card-v1" });
  });

  /**
   * The two-part check, in the order it actually runs: event type first, renderer second.
   *
   * `KNOWN_RENDERERS` recognising a renderer is USELESS if the calling verb's own `expectedEventTypes` never
   * names that message's real event type — the event-type check refuses before the renderer is ever
   * inspected. A message genuinely carrying the assistant answer's own event type, checked against a verb
   * that only expects the CARD's event type, must refuse for exactly this reason.
   */
  it("REFUSES a real assistant-answer message when the operation only expects the card's event type", () => {
    expect(
      messageOwnership({
        expectedEventTypes: CARD_TYPES,
        message: {
          ...OUR_CARD,
          metadataEventType: "slopweaver_assistant_answer_v1",
          renderer: "slack-assistant-answer-v1",
        },
        self: SELF,
      }),
    ).toEqual({ found: "slopweaver_assistant_answer_v1", kind: "unexpected-event-type" });
  });

  it("RECOGNISES a real V1 assistant answer once its own event type is in the expected list", () => {
    expect(
      messageOwnership({
        expectedEventTypes: ["slopweaver_assistant_answer_v1"],
        message: {
          ...OUR_CARD,
          metadataEventType: "slopweaver_assistant_answer_v1",
          renderer: "slack-assistant-answer-v1",
        },
        self: SELF,
      }),
    ).toEqual({ kind: "owned", renderer: "slack-assistant-answer-v1" });
  });

  it("RECOGNISES a metadata-bearing turn checklist once its turn event type is expected", () => {
    expect(
      messageOwnership({
        expectedEventTypes: ["slopweaver_turn_v1"],
        message: {
          ...OUR_CARD,
          metadataEventType: "slopweaver_turn_v1",
          renderer: "slack-turn-v1",
        },
        self: SELF,
      }),
    ).toEqual({ kind: "owned", renderer: "slack-turn-v1" });
  });

  it("RECOGNISES a real V2 assistant answer once its own event type is in the expected list", () => {
    expect(
      messageOwnership({
        expectedEventTypes: ["slopweaver_assistant_answer_v2"],
        message: {
          ...OUR_CARD,
          metadataEventType: "slopweaver_assistant_answer_v2",
          renderer: "slack-assistant-answer-v2",
        },
        self: SELF,
      }),
    ).toEqual({ kind: "owned", renderer: "slack-assistant-answer-v2" });
  });

  it("REFUSES a real V2 assistant answer when the operation only expects the V1 event type", () => {
    expect(
      messageOwnership({
        expectedEventTypes: ["slopweaver_assistant_answer_v1"],
        message: {
          ...OUR_CARD,
          metadataEventType: "slopweaver_assistant_answer_v2",
          renderer: "slack-assistant-answer-v2",
        },
        self: SELF,
      }),
    ).toEqual({ found: "slopweaver_assistant_answer_v2", kind: "unexpected-event-type" });
  });

  it("REFUSES a message whose metadata names our event type but carries no renderer", () => {
    const noRenderer: ReadSlackMessage = {
      botId: "B_SELF",
      fileIds: [],
      metadataEventType: "slopweaver_card_v1",
      ts: "1700000000.000100",
    };
    expect(messageOwnership({ expectedEventTypes: CARD_TYPES, message: noRenderer, self: SELF })).toEqual({
      found: undefined,
      kind: "unknown-renderer",
    });
  });
});

describe("ownershipRefusal", () => {
  it("names the wrong-ts correction for a foreign message", () => {
    const line = ownershipRefusal({ ts: "1700000000.000100", verdict: { kind: "not-ours-bot", messageBotId: "B0X" } });
    expect(line).toContain("slopweaver did not post it");
    expect(line).toContain("B0X");
    expect(line).toContain("--ts");
  });

  it("says 'absent' rather than printing undefined for a human's message", () => {
    const line = ownershipRefusal({
      ts: "1700000000.000100",
      verdict: { kind: "not-ours-bot", messageBotId: undefined },
    });
    expect(line).toContain("bot_id absent");
  });

  it("tells the operator to upgrade rather than replace when the renderer is unknown", () => {
    const line = ownershipRefusal({ ts: "1.1", verdict: { found: "slack-card-v9", kind: "unknown-renderer" } });
    expect(line).toContain("Upgrade slopweaver");
  });

  it("quotes a named renderer and prints a missing one as a bare null", () => {
    const named = ownershipRefusal({ ts: "1.1", verdict: { found: "slack-card-v9", kind: "unknown-renderer" } });
    const missing = ownershipRefusal({ ts: "1.1", verdict: { found: undefined, kind: "unknown-renderer" } });
    expect(named).toContain('laid out by renderer "slack-card-v9", which');
    expect(missing).toContain("laid out by renderer null, which");
  });

  it("covers the remaining refusal arms with the reason in the text", () => {
    expect(ownershipRefusal({ ts: "1.1", verdict: { kind: "no-slopweaver-metadata" } })).toContain(
      "no slopweaver metadata",
    );
    expect(ownershipRefusal({ ts: "1.1", verdict: { found: "other_type", kind: "unexpected-event-type" } })).toContain(
      "other_type",
    );
    expect(ownershipRefusal({ ts: "1.1", verdict: { kind: "owned", renderer: "slack-card-v1" } })).toContain("is ours");
  });
});

describe("isReservationExempt", () => {
  it("exempts every progress mutation, so a tick loop is never blocked by its own first edit", () => {
    expect(isReservationExempt({ kind: "progress", operation: "post" })).toBe(true);
    expect(isReservationExempt({ kind: "progress", operation: "edit" })).toBe(true);
    expect(isReservationExempt({ kind: "progress", operation: "delete" })).toBe(true);
  });

  it("still GUARDS the card post — the one irreversible cell the reservation exists for", () => {
    expect(isReservationExempt({ kind: "card", operation: "post" })).toBe(false);
  });

  it("exempts card edits and deletes, which are idempotent", () => {
    expect(isReservationExempt({ kind: "card", operation: "edit" })).toBe(true);
    expect(isReservationExempt({ kind: "card", operation: "delete" })).toBe(true);
  });

  it("has exactly ONE non-exempt cell across the whole space", () => {
    const kinds: readonly LifecycleMessageKind[] = ["progress", "card"];
    const operations: readonly LifecycleOperationKind[] = ["post", "edit", "delete"];
    const guarded = kinds.flatMap((kind) =>
      operations
        .filter((operation) => !isReservationExempt({ kind, operation }))
        .map((operation) => `${kind}/${operation}`),
    );
    expect(guarded).toEqual(["card/post"]);
  });
});
