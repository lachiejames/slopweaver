/**
 * The "having a look" post and the frame for the owner's look ask, each on the held plan call, with the call-log lines they
 * leave. Split from `planWiring.ts` to keep it under the line cap.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";

import type { LookAsk } from "../../lib/lookAck";
import { framePlanCall, lookPlanCall, type PlanPost } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import type { ToolLine } from "./voiceContext";

/**
 * The call-log line a "having a look" or "finding it" post leaves, so the call file shows the voice was asked to say
 * it — and why not, when it was not.
 *
 * @param posted what the look route answered
 * @param ask which line was asked for
 * @returns the line
 */
export function lookLine({ posted, ask }: { posted: PlanPost; ask: LookAsk }): ToolLine {
  let detail = ask === "find" ? "said it is finding it" : "said it is having a look";
  if (posted.kind === "refused") {
    detail = `not said: ${posted.why}`;
  } else if (posted.kind === "lost") {
    detail = `lost: ${posted.why}`;
  }
  return { detail, ms: undefined, name: "look", refused: posted.kind !== "taken", usage: undefined };
}

/**
 * What `planEffectHandler`'s `looking` does on a live page: post the look on the plan call held now, and log what it
 * came to — dropped rather than written into a call that replaced it meanwhile.
 *
 * @param held the plan call this page holds now
 * @param current whether the call is still this page's current one
 * @param note writes a line in the call's log
 * @returns the poster
 */
export function lookPoster({
  held,
  current,
  note,
}: {
  held: () => HeldPlanCall | undefined;
  current: () => boolean;
  note: (input: { line: ToolLine }) => void;
}): (input: { ask: LookAsk }) => void {
  return ({ ask }) => {
    const on = held();
    if (on === undefined) {
      if (current()) {
        const posted: PlanPost = { kind: "refused", status: 0, why: "this page holds no plan call" };
        note({ line: lookLine({ ask, posted }) });
      }
      return;
    }
    void lookPlanCall({ ask, callId: on.callId }).then((posted) => {
      if (current() && held() === on) {
        note({ line: lookLine({ ask, posted }) });
      }
      return undefined;
    });
  };
}

/**
 * The picture in a look's output, as a `data:image/` URL — `undefined` when the look took none.
 *
 * @param output the function-call output a look built (`screenOutputOf`), `undefined` when it took no frame
 * @returns the frame's URL
 */
export function frameUrlOf({ output }: { output: ResponseFunctionCallOutputItemList | undefined }): string | undefined {
  if (output === undefined) {
    return undefined;
  }
  for (const item of output) {
    if (item.type === "input_image" && typeof item.image_url === "string" && item.image_url.startsWith("data:image/")) {
      return item.image_url;
    }
  }
  return undefined;
}

/**
 * The call-log line the frame for the owner's look ask leaves, so the call file shows the thinking model was handed the owner's
 * screen — and why not, when it was not.
 *
 * @param posted what the frame route answered, or why no frame was taken to post
 * @param took how the look itself went: its size and cost, or why it took no frame
 * @returns the line
 */
export function frameLine({ posted, took }: { posted: PlanPost; took: string }): ToolLine {
  let detail = `handed the answering turn ${took}`;
  if (posted.kind === "refused") {
    detail = `not handed over: ${posted.why}`;
  } else if (posted.kind === "lost") {
    detail = `lost: ${posted.why}`;
  }
  return { detail, ms: undefined, name: "frame", refused: posted.kind !== "taken", usage: undefined };
}

/**
 * What `planEffectHandler`'s `framing` does on a live page: take one look the way `read_screen` does — so a relay this
 * turn carries it, `focus_screen` may point into it and the edge pulses — then post its picture on the plan call held
 * now, and log what it came to, dropped rather than written into a call that replaced it meanwhile.
 *
 * @param held the plan call this page holds now
 * @param current whether the call is still this page's current one
 * @param note writes a line in the call's log
 * @param shoot takes one look, `screenLookSeam`'s seam on a live page
 * @param post posts the frame, the real route unless a test passes a seam
 * @returns the poster
 */
export function framePoster({
  held,
  current,
  note,
  shoot,
  post = framePlanCall,
}: {
  held: () => HeldPlanCall | undefined;
  current: () => boolean;
  note: (input: { line: ToolLine }) => void;
  shoot: () => Promise<{ readonly output: ResponseFunctionCallOutputItemList | undefined; readonly detail: string }>;
  post?: typeof framePlanCall;
}): () => Promise<void> {
  return async () => {
    const on = held();
    if (on === undefined) {
      return;
    }
    // A look that throws — the shell's capture, the encoder — is logged like one that took nothing, never left to
    // reject unheard behind the caller's `void`.
    let shot: Awaited<ReturnType<typeof shoot>>;
    try {
      shot = await shoot();
    } catch (cause) {
      shot = { detail: `the look threw: ${cause instanceof Error ? cause.message : String(cause)}`, output: undefined };
    }
    const imageUrl = frameUrlOf({ output: shot.output });
    let posted: PlanPost = { kind: "refused", status: 0, why: `no frame was taken: ${shot.detail}` };
    if (imageUrl !== undefined) {
      posted = await post({ callId: on.callId, imageUrl });
    }
    if (current() && held() === on) {
      note({ line: frameLine({ posted, took: shot.detail }) });
    }
  };
}
