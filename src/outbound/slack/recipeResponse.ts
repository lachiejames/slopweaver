/**
 * A scheduled-recipe response message's own `metadata` — the Slack-side half of the crash-recovery anchor
 * `../../live/automation/recover.ts` depends on. Mirrors `./types.ts`'s proven `SlackAssistantAnswerMetadataV2`/
 * `SlackAssistantAnswerPayloadV2` pattern exactly (an ask's own identity embedded in `event_payload`, read
 * back by recovery to prove which ask a message answers) — here carrying a recipe generation's identity
 * instead of an ask's, plus the stable per-slot `idempotencyKey` recovery matches on.
 *
 * A NEW type, never a widening of {@link SlackCardMetadata}: that contract is deliberately exact for the
 * `slack post` operator card, and a recipe response is a different message kind with different identity
 * fields to carry.
 */
import { isRecord } from "../../lib/parsers.js";
import { redactWrapper } from "./piiRedaction.js";
import type { SlackCardWrapper } from "./types.js";

/** A scheduled-recipe response message's `metadata`. */
interface RecipeResponseMetadata {
  readonly event_type: "slopweaver_recipe_response_v1";
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly renderer: "slack-recipe-response-v1";
    readonly slotHash: string;
    readonly runId: string;
    readonly idempotencyKey: string;
    readonly targetChannel: string;
    readonly targetThreadTs: string | undefined;
  };
}

/** The exact `chat.postMessage` arguments for a scheduled recipe's response message. */
export interface SlackRecipeResponsePayload {
  readonly text: "";
  readonly attachments: readonly [SlackCardWrapper];
  readonly metadata: RecipeResponseMetadata;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/** What `renderRecipeResponse` needs to build one recipe response message. */
export interface RecipeResponseAnchor {
  readonly slotHash: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly targetChannel: string;
  readonly targetThreadTs: string | undefined;
}

/**
 * Build a recipe response's exact `chat.postMessage` payload, reusing an already-rendered card wrapper and
 * replacing only its metadata contract.
 *
 * **The wrapper crosses the PII pass here, and that is the whole reason the call is not left to the caller.**
 * Every other outbound renderer builds its own blocks and can redact where it builds them; this one is handed
 * a wrapper `recipe slot-post` read off DISK from its `--card` file, written by whichever session
 * investigated the slot. Nothing about that file is under this module's control, so an unredacted one reaching
 * Slack was only ever prevented by the composing session remembering — which is not a mechanism. The rule
 * is that redaction lands at the post, and for this message kind the post is here.
 *
 * @param options the already-rendered card wrapper and the anchor identity to embed
 * @returns the exact `chat.postMessage` arguments, strings redacted
 */
export function renderRecipeResponse(options: {
  readonly wrapper: SlackCardWrapper;
  readonly anchor: RecipeResponseAnchor;
}): SlackRecipeResponsePayload {
  return {
    attachments: [redactWrapper({ wrapper: options.wrapper })],
    metadata: {
      event_payload: {
        idempotencyKey: options.anchor.idempotencyKey,
        renderer: "slack-recipe-response-v1",
        runId: options.anchor.runId,
        schemaVersion: 1,
        slotHash: options.anchor.slotHash,
        targetChannel: options.anchor.targetChannel,
        targetThreadTs: options.anchor.targetThreadTs,
      },
      event_type: "slopweaver_recipe_response_v1",
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/**
 * Recover a recipe response anchor from a Slack message's own `metadata`, when it carries one — the read
 * side of {@link renderRecipeResponse}, used by recovery's exhaustive metadata search.
 *
 * @param options the decoded `metadata` value off a fetched Slack message
 * @returns the anchor, or `undefined` when this message carries no recipe-response metadata
 */
export function parseRecipeResponseMetadata(options: { readonly value: unknown }): RecipeResponseAnchor | undefined {
  if (!isRecord(options.value) || options.value["event_type"] !== "slopweaver_recipe_response_v1") {
    return undefined;
  }
  const payload = options.value["event_payload"];
  if (!isRecord(payload)) {
    return undefined;
  }
  const p = payload;
  if (
    p["schemaVersion"] !== 1 ||
    p["renderer"] !== "slack-recipe-response-v1" ||
    typeof p["slotHash"] !== "string" ||
    typeof p["runId"] !== "string" ||
    typeof p["idempotencyKey"] !== "string" ||
    typeof p["targetChannel"] !== "string"
  ) {
    return undefined;
  }
  const targetThreadTs = p["targetThreadTs"];
  return {
    idempotencyKey: p["idempotencyKey"],
    runId: p["runId"],
    slotHash: p["slotHash"],
    targetChannel: p["targetChannel"],
    targetThreadTs: typeof targetThreadTs === "string" ? targetThreadTs : undefined,
  };
}
