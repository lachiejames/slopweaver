/**
 * The guard every `/api/talk/call/[id]/*` route puts in front of itself: a console press, a bounded JSON body,
 * and a call that is live under that id. One copy, for the reason `consolePress.ts` gives for being one — and its
 * first half on its own for a route that finds its call without an id (`/api/talk/typed-in`).
 */
import { type Bag, isBag } from "./bag";
import { refuseUnlessConsolePress } from "./consolePress";
import { planCallById } from "./talkCallRegistry";
import type { PlanCall } from "./talkPlanCall";

/** A refusal, with the status to answer it. */
interface RequestRefusal {
  readonly refused: string;
  readonly status: number;
}

/**
 * Read a console press's bounded JSON object body, or say why not with the status to answer.
 *
 * @param request the press
 * @param maxBytes the largest body this route takes
 * @returns the body, or the refusal
 */
export async function readConsoleBody({
  request,
  maxBytes,
}: {
  request: Request;
  maxBytes: number;
}): Promise<{ readonly body: Bag } | RequestRefusal> {
  const press = refuseUnlessConsolePress({ request });
  if (press !== undefined) {
    return { refused: press, status: 403 };
  }
  const raw = await request.text();
  if (raw.length > maxBytes) {
    return {
      refused: `the body is ${String(raw.length)} bytes; this route takes up to ${String(maxBytes)}`,
      status: 413,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { refused: "the body is not JSON", status: 400 };
  }
  if (!isBag(body)) {
    return { refused: "the body is not a JSON object", status: 400 };
  }
  return { body };
}

/**
 * Read a call route's request, or say why not with the status to answer.
 *
 * @param request the press
 * @param id the call id from the path
 * @param maxBytes the largest body this route takes
 * @returns the live call and the body, or the refusal
 */
export async function readCallRequest({
  request,
  id,
  maxBytes,
}: {
  request: Request;
  id: string;
  maxBytes: number;
}): Promise<{ readonly call: PlanCall; readonly body: Bag } | RequestRefusal> {
  const read = await readConsoleBody({ maxBytes, request });
  if ("refused" in read) {
    return read;
  }
  const call = planCallById({ id });
  if (call === undefined) {
    return { refused: `no plan call is live under ${id}; it ended, or this server restarted`, status: 404 };
  }
  return { body: read.body, call };
}
