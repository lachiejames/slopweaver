/**
 * What one nested Responses event says on its own — the step it names, the response it belongs to, and how it closed —
 * read off the event alone, with no fold state. `./voiceActivity.ts` folds these into a turn's progress.
 */

import { type Bag, isBag } from "./bag";

/**
 * Why a Codex turn is awaiting: its request is out to the model and no item has started (`model`), or Codex said the
 * model's reply dropped and it is sending the request again (`retry`, app-server's `error` with `willRetry: true`).
 */
export type AwaitingReason = "model" | "retry";

/**
 * The steps a turn names. `awaiting` is a Codex turn with a request out to the model and nothing running: after the
 * turn starts and after each of its items completes, until the next item starts. MEASURED on one call: three such
 * waits ran 346s, 326s and 233s with no tool running, while the row said "working" or a tool that had already finished.
 */
export type WorkStep =
  | { readonly kind: "working" }
  | { readonly kind: "awaiting"; readonly reason: AwaitingReason }
  | { readonly kind: "reasoning" }
  | { readonly kind: "writing" }
  | { readonly kind: "compacting" }
  | { readonly kind: "tool"; readonly name: string };

/** A Codex turn's step while its request is out to the model: from its start, and from each item's completion. */
export const AWAITING_MODEL: WorkStep = { kind: "awaiting", reason: "model" };

/** What the orb says while the voice's Codex thread compacts its own context: silent work, not a stall. */
export const COMPACTING_WORDS = "compacting the conversation";

/** What the orb says while a Codex turn's request is out to the model. */
export const AWAITING_MODEL_WORDS = "waiting for the model";

/** What the orb says once Codex has said the model's reply dropped and it is sending the request again. */
export const AWAITING_RETRY_WORDS = "the model's reply dropped; Codex is re-sending";

/**
 * A step, in the words the orb says.
 *
 * @returns the step as a short phrase — "reasoning", "running action_items", "waiting for the model"
 */
export function stepWords({ step }: { step: WorkStep }): string {
  if (step.kind === "tool") {
    return `running ${step.name}`;
  }
  if (step.kind === "compacting") {
    return COMPACTING_WORDS;
  }
  if (step.kind === "awaiting") {
    return step.reason === "retry" ? AWAITING_RETRY_WORDS : AWAITING_MODEL_WORDS;
  }
  return step.kind;
}

/**
 * The step a nested event names.
 *
 * @param type the nested event's `type`, read once by the caller
 * @returns the step, or `undefined` when it names none this fold knows
 */
export function stepOf({ event, type }: { event: Bag; type: string }): WorkStep | undefined {
  if (type === "response.created" || type === "response.in_progress" || type.startsWith("response.reasoning")) {
    return { kind: "reasoning" };
  }
  if (type === "response.queued") {
    return { kind: "working" };
  }
  if (
    type.startsWith("response.output_text") ||
    type.startsWith("response.content_part") ||
    type.startsWith("response.refusal")
  ) {
    return { kind: "writing" };
  }
  if (type === "response.output_item.added" || type === "response.output_item.done") {
    return itemStep({ item: event["item"] });
  }
  if (type.startsWith("response.function_call_arguments")) {
    const name = event["name"];
    if (typeof name === "string") {
      return { kind: "tool", name };
    }
    return { kind: "tool", name: "a tool" };
  }
  return undefined;
}

/** The step an output item names. */
function itemStep({ item }: { item: unknown }): WorkStep | undefined {
  if (!isBag(item)) {
    return undefined;
  }
  if (item["type"] === "function_call" && typeof item["name"] === "string") {
    return { kind: "tool", name: item["name"] };
  }
  if (item["type"] === "reasoning") {
    return { kind: "reasoning" };
  }
  if (item["type"] === "message") {
    return { kind: "writing" };
  }
  return undefined;
}

/**
 * The response id a nested event carries: on its `response` snapshot, or as its own `response_id`.
 *
 * @returns the id, or `undefined` when the event carries neither
 */
export function responseIdOf({ event }: { event: Bag }): string | undefined {
  const response = event["response"];
  if (isBag(response) && typeof response["id"] === "string") {
    return response["id"];
  }
  const direct = event["response_id"];
  if (typeof direct === "string") {
    return direct;
  }
  return undefined;
}

/**
 * A lifecycle snapshot's status.
 *
 * @returns the status, or `undefined` when the event carries no snapshot with one
 */
export function statusOf({ event }: { event: Bag }): string | undefined {
  const response = event["response"];
  if (isBag(response) && typeof response["status"] === "string") {
    return response["status"];
  }
  return undefined;
}

/**
 * A closed response's failure in the provider's words.
 *
 * @param type the closing event's `type`
 * @returns the reason, or `undefined` when it completed
 */
export function failureOf({ event, type }: { event: Bag; type: string }): string | undefined {
  if (type === "response.completed" && statusOf({ event }) !== "cancelled") {
    return undefined;
  }
  if (type === "error") {
    const message = event["message"];
    if (typeof message === "string") {
      return message;
    }
    return "the answer failed";
  }
  const response = event["response"];
  if (isBag(response)) {
    const error = response["error"];
    if (isBag(error) && typeof error["message"] === "string") {
      return error["message"];
    }
    const details = response["incomplete_details"];
    if (isBag(details) && typeof details["reason"] === "string") {
      return `the answer was cut short: ${details["reason"]}`;
    }
  }
  if (type === "response.incomplete") {
    return "the answer was cut short";
  }
  if (type === "response.failed") {
    return "the answer failed";
  }
  return "the answer was cancelled";
}
