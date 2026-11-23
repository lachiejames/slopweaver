/**
 * A plan call's data-channel events, as the page acts on them. Pure, so the one question that matters — does the
 * transcript neither lose nor duplicate a word — is answered by a test over a synthetic session in 0.157.1's vocabulary
 * (a fake microphone reading a scripted question, every id synthetic) rather than by watching a call.
 *
 * A plan call rides the SDK's `OpenAILiveWebRTC` channel, and its realtime v3 session speaks its own vocabulary on
 * it (recorded through `codex app-server` 0.157.1):
 *
 * - `turn.created` / `turn.delta` / `turn.done`, keyed by turn id and carrying the ROLE, are the transcript: the
 *   created turn's text plus every delta is exactly the done turn's text. They are the ONE source for display,
 *   per role, so nothing is shown twice.
 * - `input_transcript.added` is each raw fragment the owner was heard saying. It is what the relay gate reads as "the
 *   owner spoke".
 * - `output_transcript.added` is each fragment the voice said. It overlaps the assistant turn and a backchannel
 *   ("Go on.") appears here before any turn does, so it is ACTIVITY only, never text — and one carrying no words is
 *   none.
 * - `delegation.created` hands a turn to Codex (`target: "client"`); tool calls, and the Codex turn's own start,
 *   progress and end, then arrive over the app-server, not this channel. The hand-off opens a "handing to Codex"
 *   row on the orb until that turn starts (`site/lib/voicePlanWork.ts`).
 * - `session.usage.updated` carries the audio seconds so far and whether the plan's usage limit has been hit.
 *
 * Anything else is ignored, so an event 0.157.1 did not send cannot break a call.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import { type Bag, isBag, num, str, sub } from "./bag";
import type { PlanContentItem } from "./talkPlanProtocolItems";

/** Who a transcript segment belongs to, as the page names the two sides. */
export type PlanSpeaker = "owner" | "voice";

/** One open turn: whose it is, and its text so far. */
export interface PlanTurn {
  readonly who: PlanSpeaker;
  readonly text: string;
}

/** When a piece of the owner's speech was said, in the session's own audio milliseconds. */
export interface AudioSpan {
  readonly startMs: number;
  readonly endMs: number;
}

/** What one event asks the page to do. */
export type PlanEffect =
  | { readonly kind: "started"; readonly sessionId: string }
  /** A raw fragment heard, with the audio it covers when the event says. */
  | { readonly kind: "heard"; readonly text: string; readonly span?: AudioSpan }
  | { readonly kind: "spoke" }
  | {
      readonly kind: "segment";
      readonly id: string;
      readonly who: PlanSpeaker;
      readonly text: string;
      readonly final: boolean;
      /** The audio an open step of the owner's added, when the event says: what pairs it with its fragment. */
      readonly span?: AudioSpan;
    }
  | {
      readonly kind: "delegated";
      readonly id: string;
      readonly target: string;
      /** The owner's turn it hands off (`user_bidi_turn_id`), the id their segments carry, when the event names one. */
      readonly turnId?: string;
    }
  | {
      readonly kind: "usage";
      readonly audioSeconds: number;
      readonly limitStatus: string | undefined;
      readonly resetSeconds: number | undefined;
    };

/**
 * Fold one data-channel event into the open turns, and say what the page should do about it.
 *
 * @param turns the turns opened and not yet done
 * @param event one parsed data-channel event
 * @returns the next open turns and the effects, in order
 */
export function foldPlanEvent({ turns, event }: { turns: ReadonlyMap<string, PlanTurn>; event: unknown }): {
  readonly turns: ReadonlyMap<string, PlanTurn>;
  readonly effects: readonly PlanEffect[];
} {
  const none = { effects: [], turns };
  const type = isBag(event) ? str({ bag: event, key: "type" }) : undefined;
  if (!isBag(event) || type === undefined) {
    return none;
  }
  switch (type) {
    case "session.started": {
      const session = sub({ bag: event, key: "session" });
      const id = session === undefined ? undefined : str({ bag: session, key: "id" });
      return id === undefined ? none : { effects: [{ kind: "started", sessionId: id }], turns };
    }
    case "input_transcript.added": {
      const text = itemText({ event });
      if (text === undefined) {
        return none;
      }
      return { effects: [withSpan({ effect: { kind: "heard", text }, span: spanOf({ bag: event }) })], turns };
    }
    case "output_transcript.added": {
      // A fragment carrying no words — none, blank, or a lone "." — is no answer to the owner: a held rollover reads `spoke`
      // as one.
      const text = itemText({ event });
      return text === undefined || !/[\p{L}\p{N}]/u.test(text) ? none : { effects: [{ kind: "spoke" }], turns };
    }
    case "turn.created":
    case "turn.done":
      return foldTurn({ done: type === "turn.done", event, turns });
    case "turn.delta":
      return foldDelta({ event, turns });
    case "delegation.created": {
      const item = sub({ bag: event, key: "item" });
      const id = item === undefined ? undefined : str({ bag: item, key: "id" });
      const target = item === undefined ? undefined : str({ bag: item, key: "target" });
      if (id === undefined || target === undefined) {
        return none;
      }
      const turnId = str({ bag: item!, key: "user_bidi_turn_id" });
      if (turnId === undefined) {
        return { effects: [{ id, kind: "delegated", target }], turns };
      }
      return { effects: [{ id, kind: "delegated", target, turnId }], turns };
    }
    case "session.usage.updated":
      return { effects: usageEffects({ event }), turns };
    default:
      return none;
  }
}

/** A turn opening or finishing: its text is the turn's own, whole, and it replaces what the deltas built. */
function foldTurn({ done, event, turns }: { done: boolean; event: Bag; turns: ReadonlyMap<string, PlanTurn> }): {
  readonly turns: ReadonlyMap<string, PlanTurn>;
  readonly effects: readonly PlanEffect[];
} {
  const turn = sub({ bag: event, key: "turn" });
  const id = turn === undefined ? undefined : str({ bag: turn, key: "id" });
  const role = turn === undefined ? undefined : str({ bag: turn, key: "role" });
  const text = turn === undefined ? undefined : str({ bag: turn, key: "transcript" });
  if (turn === undefined || id === undefined || text === undefined || (role !== "user" && role !== "assistant")) {
    return { effects: [], turns };
  }
  const who: PlanSpeaker = role === "user" ? "owner" : "voice";
  const next = new Map(turns);
  if (done) {
    next.delete(id);
  } else {
    next.set(id, { text, who });
  }
  const segment = { final: done, id, kind: "segment", text, who } as const satisfies PlanEffect;
  if (done || role !== "user") {
    return { effects: [segment], turns: next };
  }
  return { effects: [withSpan({ effect: segment, span: spanOf({ bag: turn }) })], turns: next };
}

/** A delta extends the open turn it names; one naming no open turn is dropped, since its `done` carries it whole. */
function foldDelta({ event, turns }: { event: Bag; turns: ReadonlyMap<string, PlanTurn> }): {
  readonly turns: ReadonlyMap<string, PlanTurn>;
  readonly effects: readonly PlanEffect[];
} {
  const id = str({ bag: event, key: "turn_id" });
  const delta = str({ bag: event, key: "delta" });
  const open = id === undefined ? undefined : turns.get(id);
  if (id === undefined || delta === undefined || open === undefined) {
    return { effects: [], turns };
  }
  const text = open.text + delta;
  const next = new Map(turns);
  next.set(id, { text, who: open.who });
  const segment = { final: false, id, kind: "segment", text, who: open.who } as const satisfies PlanEffect;
  if (open.who === "voice") {
    return { effects: [segment], turns: next };
  }
  return { effects: [withSpan({ effect: segment, span: spanOf({ bag: event }) })], turns: next };
}

/** The `start_ms`/`end_ms` an event or turn carries, when it carries both. */
function spanOf({ bag }: { bag: Bag }): AudioSpan | undefined {
  const startMs = num({ bag, key: "start_ms" });
  const endMs = num({ bag, key: "end_ms" });
  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }
  return { endMs, startMs };
}

/** An effect with its span attached, or as it is when the event carried none. */
function withSpan({
  effect,
  span,
}: {
  effect: Extract<PlanEffect, { kind: "heard" | "segment" }>;
  span: AudioSpan | undefined;
}): PlanEffect {
  if (span === undefined) {
    return effect;
  }
  return { ...effect, span };
}

/** The `item.text` of a transcript fragment. */
function itemText({ event }: { event: Bag }): string | undefined {
  const item = sub({ bag: event, key: "item" });
  return item === undefined ? undefined : str({ bag: item, key: "text" });
}

/** Usage so far, and the plan limit's state when the session reports one. */
function usageEffects({ event }: { event: Bag }): readonly PlanEffect[] {
  const usage = sub({ bag: event, key: "usage" });
  const audioMs = usage === undefined ? undefined : num({ bag: usage, key: "audio_duration_ms" });
  if (audioMs === undefined) {
    return [];
  }
  const limit = sub({ bag: event, key: "usage_limit" });
  return [
    {
      audioSeconds: audioMs / 1000,
      kind: "usage",
      limitStatus: limit === undefined ? undefined : str({ bag: limit, key: "status" }),
      resetSeconds: limit === undefined ? undefined : num({ bag: limit, key: "reset_seconds" }),
    },
  ];
}

/**
 * A tool's answer, as the page builds it (`functionCallOutputOf`), in the app-server's shape.
 *
 * @param output the page's own answer — its text, or its text-and-image list
 * @returns the content items `item/tool/call`'s response carries
 */
export function planContentOf({
  output,
}: {
  output: string | ResponseFunctionCallOutputItemList;
}): readonly PlanContentItem[] {
  if (typeof output === "string") {
    return [{ text: output, type: "inputText" }];
  }
  const items: PlanContentItem[] = [];
  for (const item of output) {
    if (item.type === "input_text") {
      items.push({ text: item.text, type: "inputText" });
    } else if (item.type === "input_image" && typeof item.image_url === "string") {
      items.push({ imageUrl: item.image_url, type: "inputImage" });
    }
  }
  if (items.length === 0) {
    return [{ text: '{"refused":"the answer carried nothing the plan call can take"}', type: "inputText" }];
  }
  return items;
}
