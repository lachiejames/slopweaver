/**
 * One read of a plan call's event stream, from the last event it delivered to the stream's end. Split from
 * `planCallClient.ts` to keep it under the line cap.
 */
import { type PlanStreamEntry, planStreamEntryOf } from "../../lib/talkPlanEventsStream";
import { callPath, refusalOf } from "./planCallClientPost";

/**
 * One stream's life: it closed with the call, the page stopped, the call is gone, or it dropped and may be reopened.
 *
 * @returns whether the call closed, the page stopped, the call is gone, or the stream dropped
 */
export async function readStream({
  after,
  callId,
  onEntry,
  signal,
}: {
  after: number;
  callId: string;
  onEntry: (entry: PlanStreamEntry) => void;
  signal: AbortSignal;
}): Promise<
  | { readonly kind: "closed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "gone" | "dropped"; readonly why: string }
> {
  let response: Response;
  try {
    response = await fetch(callPath({ callId, leaf: "events" }), {
      body: JSON.stringify({ after }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });
  } catch (cause) {
    if (signal.aborted) {
      return { kind: "stopped" };
    }
    return { kind: "dropped", why: `the console server did not answer the call's stream: ${String(cause)}` };
  }
  if (response.status === 404) {
    return { kind: "gone", why: await refusalOf({ response }) };
  }
  if (!response.ok || response.body === null) {
    return { kind: "dropped", why: await refusalOf({ response }) };
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let held = "";
  let closed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      held += value;
      const lines = held.split("\n");
      held = lines.pop()!;
      for (const line of lines) {
        if (line === "") {
          continue;
        }
        const entry = planStreamEntryOf({ line });
        onEntry(entry);
        if (entry.kind === "event" && entry.event.kind === "closed") {
          closed = true;
        }
      }
    }
  } catch (cause) {
    if (signal.aborted) {
      return { kind: "stopped" };
    }
    return { kind: "dropped", why: `the call's stream broke: ${String(cause)}` };
  }
  if (closed) {
    return { kind: "closed" };
  }
  if (signal.aborted) {
    return { kind: "stopped" };
  }
  return { kind: "dropped", why: "the call's stream ended before the call did" };
}
