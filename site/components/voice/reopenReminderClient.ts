/**
 * The page's two posts to a reopened call's opening window (`/api/talk/call/<id>/reopen-reminder`): `ready` once its
 * connection is up, and `speech` once its microphone meter hears the owner. Its own file because the page needs the
 * window's answer — only a call that answered `armed` is watched for the owner's speech — which `postPlan` does not carry.
 */
import { PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import type { ReopenReminderPostOutcome } from "../../lib/talkPlanReopenReminder";
import { callPath, PLAN_POST_MS, refusalOf } from "./planCallClientPost";

/** What one post came to: the window's answer, or why there is none. */
export type ReopenReminderPost =
  | { readonly kind: "answered"; readonly outcome: ReopenReminderPostOutcome }
  | { readonly kind: "refused"; readonly why: string };

/** Every answer the window gives, which a body must name exactly. */
const OUTCOMES: readonly ReopenReminderPostOutcome[] = ["armed", "gave-way", "already", "unavailable"];

/**
 * Read the window's answer out of a body, refusing anything else.
 *
 * @param body the route's parsed answer
 * @returns the window's answer, or `undefined` for a body that names none
 */
export function reopenReminderOutcomeOf({ body }: { body: unknown }): ReopenReminderPostOutcome | undefined {
  if (typeof body !== "object" || body === null || !("outcome" in body)) {
    return undefined;
  }
  return OUTCOMES.find((outcome) => outcome === body.outcome);
}

/**
 * Post one action to the call's opening window.
 *
 * @param action `ready` to start the window, `speech` to give it away
 * @returns the window's answer, or why there is none
 */
export async function postReopenReminder({
  callId,
  action,
}: {
  callId: string;
  action: "ready" | "speech";
}): Promise<ReopenReminderPost> {
  let response: Response;
  try {
    response = await fetch(callPath({ callId, leaf: "reopen-reminder" }), {
      body: JSON.stringify({ action }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(PLAN_POST_MS),
    });
  } catch (cause) {
    return { kind: "refused", why: `the console server did not take the reopen ${action}: ${String(cause)}` };
  }
  if (!response.ok) {
    return { kind: "refused", why: await refusalOf({ response }) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "refused", why: "the reopen reminder route answered something that is not JSON" };
  }
  const outcome = reopenReminderOutcomeOf({ body });
  if (outcome === undefined) {
    return { kind: "refused", why: "the reopen reminder route answered no outcome" };
  }
  return { kind: "answered", outcome };
}

/** How often an armed window's watch reads the owner's microphone: the meter's own sampling, `useVoiceActivity`. */
const WATCH_EVERY_MS = 80;

/** Where the window's answer to `ready` is: still in flight, `armed`, or anything else (nothing to watch). */
export type ReopenWatchAnswer = "pending" | "armed" | "not-armed";

/**
 * What one read of the window's watch does. The watch runs from the moment `ready` is posted, so the owner's speech while that
 * post is in flight is heard rather than missed and posted AT ONCE, never held for the answer: the server
 * armed its deadline when it took `ready`, so a held `speech` could land after that deadline handed the reminder.
 * The window takes a `speech` ahead of `ready` as given way, so the order the two land in is moot. Stop
 * because the call is no longer this page's, the window answered anything but `armed`, or a whole window has passed
 * since it did (the server hands the reminder itself then, and the owner's speech after it is the voice's own turn-taking).
 *
 * @param heard whether the owner's microphone has carried them at any read since `ready` was posted
 * @param answer the window's answer to `ready`
 * @param sinceArmedMs how long since the `armed` answer arrived, 0 before it
 * @param windowMs the window's length, past which there is nothing left to give way
 * @returns the read's outcome
 */
export function reopenWatchStep({
  current,
  heard,
  answer,
  sinceArmedMs,
  windowMs,
}: {
  current: boolean;
  heard: boolean;
  answer: ReopenWatchAnswer;
  sinceArmedMs: number;
  windowMs: number;
}): "speech" | "stop" | "watch" {
  if (!current || answer === "not-armed") {
    return "stop";
  }
  if (heard) {
    return "speech";
  }
  if (answer === "pending") {
    return "watch";
  }
  if (sinceArmedMs >= windowMs) {
    return "stop";
  }
  return "watch";
}

/**
 * Start a fresh call's opening window and, when the server armed it, give it away the moment the owner's microphone hears them:
 * their own opening speech goes first. The transcript gives way on the server too, but a
 * transcript lands a second or more after they start, and the meter hears them within one sample. Fire and forget: a
 * refused post leaves the window to the server's own transcript and timer.
 *
 * The one interval starts here, while the call is this page's, and every read ends it once the call is not — so an
 * answer landing after the owner hung up never starts a watch; the `ready` post's own timeout bounds a pending one.
 *
 * @param callId the call that just went live
 * @param current whether the call is still this page's
 * @param sounding whether the owner's microphone carries them talking, read off the live meter
 */
export function watchReopenReminder({
  callId,
  current,
  sounding,
}: {
  callId: string;
  current: () => boolean;
  sounding: () => boolean;
}): void {
  if (!current()) {
    return;
  }
  let answer: ReopenWatchAnswer = "pending";
  let armedAt = 0;
  let heard = false;
  let over = false;
  const read = (): void => {
    if (over) {
      return;
    }
    if (sounding()) {
      heard = true;
    }
    let sinceArmedMs = 0;
    if (answer === "armed") {
      sinceArmedMs = performance.now() - armedAt;
    }
    const step = reopenWatchStep({
      answer,
      current: current(),
      heard,
      sinceArmedMs,
      windowMs: PLAN_CALL_LIMITS.reopenReminderSilenceMs,
    });
    if (step === "watch") {
      return;
    }
    over = true;
    window.clearInterval(timer);
    if (step === "speech") {
      void postReopenReminder({ action: "speech", callId });
    }
  };
  const timer = window.setInterval(read, WATCH_EVERY_MS);
  void postReopenReminder({ action: "ready", callId }).then((posted) => {
    answer = posted.kind === "answered" && posted.outcome === "armed" ? "armed" : "not-armed";
    armedAt = performance.now();
    read();
    return undefined;
  });
}
