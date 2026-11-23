/*
 * What the voiceActivity tests share: the timed script, the fold that plays it, the status read at one instant,
 * the two event builders, and a measured call.
 */
import {
  type ActivityInput,
  foldActivity,
  NO_ACTIVITY,
  type VoiceActivity,
  type VoiceStatus,
  voiceStatusOf,
} from "../../../lib/voiceActivity";

/** A timed script of inputs. */
export type Script = readonly (readonly [number, ActivityInput])[];

/**
 * Fold a timed script from nothing.
 * @returns the activity after every input of the script has been folded in order
 */
export function play({ script }: { script: Script }): VoiceActivity {
  return script.reduce<VoiceActivity>(
    (activity, [nowMs, input]) => foldActivity({ activity, input, nowMs }),
    NO_ACTIVITY,
  );
}

/**
 * The status of a live call with both levels silent, at one instant.
 * @returns the voice status at `nowMs`
 */
export function quietAt({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): VoiceStatus {
  return voiceStatusOf({ activity, link: "live", micLevel: 0, micRms: 0, muted: false, nowMs, outputLevel: 0 });
}

/**
 * A nested Responses event, as the session wraps it.
 * @returns a backend input carrying the event
 */
export function backend({
  type,
  extra = {},
  delegationId,
}: {
  type: string;
  extra?: Record<string, unknown>;
  delegationId?: string;
}): ActivityInput {
  return { delegationId, event: { type, ...extra }, kind: "backend" };
}

/**
 * A Responses delegation opening.
 * @returns a delegated input for the Responses target
 */
export function delegated({ id, responseId }: { id: string; responseId?: string }): ActivityInput {
  return { id, kind: "delegated", responseId, target: "responses" };
}

/**
 * A measured call on a clock from 0: a spoken "I'll take a look", action_items at +7s, the answer
 * spoken at +31s. The old mark read "listening" for the last twenty-four seconds of that.
 */
export const MEASURED: Script = [
  [0, { kind: "heard" }],
  [500, delegated({ id: "d1" })],
  [600, backend({ delegationId: "d1", extra: { response: { id: "r1" } }, type: "response.created" })],
  [700, { kind: "spoke" }],
  [2_000, backend({ delegationId: "d1", type: "response.reasoning_summary_text.delta" })],
  [
    6_900,
    backend({
      delegationId: "d1",
      extra: { item: { call_id: "c1", name: "action_items", type: "function_call" } },
      type: "response.output_item.done",
    }),
  ],
  [7_000, { callId: "c1", kind: "tool-started", name: "action_items" }],
  [
    7_100,
    backend({
      delegationId: "d1",
      // GPT-Live's lifecycle snapshots clear `output` (live.d.ts), so the completion does not say it asked for a tool.
      extra: { response: { id: "r1", status: "completed" } },
      type: "response.completed",
    }),
  ],
  [7_400, { callId: "c1", kind: "tool-answered" }],
  [7_400, { kind: "continued" }],
  [7_600, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
];
