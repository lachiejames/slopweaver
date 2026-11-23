/**
 * The one post every plan call route shares: a route's path, its refusal read back, and what the post came to. Split
 * from `planCallClient.ts` to keep it under the line cap.
 */

/**
 * The route base for one call.
 *
 * @returns the route's path
 */
export function callPath({ callId, leaf }: { callId: string; leaf: PlanLeaf | "events" }): string {
  return `/api/talk/call/${encodeURIComponent(callId)}/${leaf}`;
}

/**
 * A refused route's own sentence, or its status when it has none.
 *
 * @returns the refusal sentence
 */
export async function refusalOf({ response }: { response: Response }): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "refused" in body && typeof body.refused === "string") {
      return body.refused;
    }
  } catch {
    // Not JSON: the status is all there is to say.
  }
  return `the call route answered HTTP ${String(response.status)}`;
}

/**
 * What one post to a plan call's claim or answer route came to: the server took it, the server answered and refused
 * it (it will refuse it again), or it got no answer or a 5xx — lost, so the page cannot tell whether it landed.
 */
export type PlanPost =
  | { readonly kind: "taken" }
  | { readonly kind: "refused"; readonly why: string; readonly status: number }
  | { readonly kind: "lost"; readonly why: string };

/**
 * Read a claim or answer route's status.
 *
 * @param status the HTTP status
 * @param why the route's own refusal, or its status when it gave none
 * @returns what the post came to
 */
export function planPostOf({ status, why }: { status: number; why: string }): PlanPost {
  if (status >= 200 && status < 300) {
    return { kind: "taken" };
  }
  if (status >= 500) {
    return { kind: "lost", why };
  }
  return { kind: "refused", status, why };
}

/**
 * How long one claim or answer post may take before it is abandoned as lost: both routes answer from memory, so a
 * response this late is a stalled connection, and a claim or answer left awaiting one would hold the call as surely
 * as one never sent.
 */
export const PLAN_POST_MS = 10_000;

/** Every route of a plan call the page posts a body to. */
type PlanLeaf =
  | "claim"
  | "answer"
  | "nudge"
  | "look"
  | "frame"
  | "resume"
  | "stop"
  | "send-outcome"
  | "count-grounding"
  | "claim-grounding"
  | "spoken-record"
  | "triage-due"
  | "drift"
  | "iso-nudge"
  | "reopen-reminder";

/**
 * Post one body to one of a plan call's {@link PlanLeaf} routes, abandoning it as lost past `timeoutMs`.
 *
 * @returns what the post came to
 */
export async function postPlan({
  callId,
  leaf,
  body,
  timeoutMs = PLAN_POST_MS,
}: {
  callId: string;
  leaf: PlanLeaf;
  body: unknown;
  timeoutMs?: number;
}): Promise<PlanPost> {
  let response: Response;
  try {
    response = await fetch(callPath({ callId, leaf }), {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    return { kind: "lost", why: `the console server did not take the ${leaf}: ${String(cause)}` };
  }
  if (response.ok) {
    return { kind: "taken" };
  }
  return planPostOf({ status: response.status, why: await refusalOf({ response }) });
}
