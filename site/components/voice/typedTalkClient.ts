/**
 * The page's half of the Talk page's typed conversation: open one (`/api/talk/typed`) and send what the owner typed into it
 * (`/api/talk/call/[id]/say`). Everything else — its event stream, a tool call's claim and answer, its stop — is a plan
 * call's own route, through `planCallClient.ts`.
 */
import type { TalkTypedResult } from "../../app/api/talk/typed/route";
import { isBag } from "../../lib/bag";

/** How long opening may take before the page gives up on the answer: the route's own bound, with room. */
const OPEN_TIMEOUT_MS = 120_000;

/** How long one send may take: the server's `turn/start` step, with room. */
const SAY_TIMEOUT_MS = 30_000;

/**
 * Open a typed conversation on the owner's plan.
 *
 * @returns the held conversation, or why there is none in the route's own words
 */
export async function openTypedTalk(): Promise<TalkTypedResult> {
  let response: Response;
  try {
    response = await fetch("/api/talk/typed", {
      body: "{}",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
    });
  } catch (cause) {
    return { notOpened: `the console server did not answer: ${String(cause)}`, ok: false };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!isBag(body)) {
    return { notOpened: `the typed route answered HTTP ${String(response.status)} with no reading`, ok: false };
  }
  const { backendModel, callId, threadId } = body;
  if (body["ok"] === true && typeof callId === "string" && typeof threadId === "string") {
    if (typeof backendModel === "string") {
      return {
        backendModel,
        callId,
        ok: true,
        // Unsure reads as carried, as `mintCarriesStandingData` does: the cost is a relay of the owner's words only.
        packed: body["packed"] !== false,
        threadId,
        tools: strings({ value: body["tools"] }),
        writers: strings({ value: body["writers"] }),
      };
    }
  }
  if (typeof body["notOpened"] === "string") {
    return { notOpened: body["notOpened"], ok: false };
  }
  return { notOpened: `the typed route answered HTTP ${String(response.status)} with no reading`, ok: false };
}

/** The strings of a list the route sent, or none when it sent something else. */
function strings({ value }: { value: unknown }): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * How one send landed, as the page reads it: `accepted`; `refused` with the server's reason; `gone` when no
 * conversation is live under the id any more, so a fresh one is opened; `unknown` when the page cannot tell whether
 * the thread took it, so it is never sent again on its own.
 */
export type TypedSend =
  | { readonly kind: "accepted"; readonly turnId: string }
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "gone"; readonly why: string }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * Send one message.
 *
 * @param callId the conversation's id
 * @param messageId the page's own id for this message, the same on a retry
 * @param text what the owner typed
 * @returns how it landed
 */
export async function sayTyped({
  callId,
  messageId,
  text,
}: {
  callId: string;
  messageId: string;
  text: string;
}): Promise<TypedSend> {
  let response: Response;
  try {
    response = await fetch(`/api/talk/call/${encodeURIComponent(callId)}/say`, {
      body: JSON.stringify({ messageId, text }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(SAY_TIMEOUT_MS),
    });
  } catch (cause) {
    return { kind: "unknown", why: `the console server did not answer: ${String(cause)}` };
  }
  const body: unknown = await response.json().catch(() => undefined);
  return typedSendOf({ body, status: response.status });
}

/** The turns of one conversation the page has seen start and not end, and seen end. */
export interface TurnsSeen {
  readonly running: ReadonlySet<string>;
  readonly completed: ReadonlySet<string>;
}

/**
 * Where the box stands once a send's answer is back, by what the thread has said of its turns — which can reach the
 * page first: an accepted send is answering unless its turn has already completed, and any other is answering only
 * while a turn the thread announced is still running.
 *
 * @param said how the send landed
 * @param seen the turns the page has seen
 * @returns the phase
 */
export function phaseAfterSend({ said, seen }: { said: TypedSend; seen: TurnsSeen }): "open" | "replying" {
  if (said.kind === "accepted" && !seen.completed.has(said.turnId)) {
    return "replying";
  }
  if (seen.running.size > 0) {
    return "replying";
  }
  return "open";
}

/**
 * Whether the thread took a send: its answer says so, or the answer was lost while the thread announced a turn as the
 * send was out — nothing else starts a turn on a typed thread.
 *
 * @param said how the send landed, as the page read it
 * @param turnHeard whether the thread announced a turn not already ended while the send was out
 * @returns whether the owner's words are shown as theirs and heard by the relay gate
 */
export function sendTaken({ said, turnHeard }: { said: TypedSend; turnHeard: boolean }): boolean {
  return said.kind === "accepted" || (said.kind === "unknown" && turnHeard);
}

/** A send of unknown fate the page owes the owner, and the turns heard while it was out that an earlier send may own. */
export interface OwedSend {
  readonly messageId: string;
  readonly text: string;
  readonly notIts: ReadonlySet<string>;
}

/**
 * Whether a turn the thread announced is the owed send's: any fresh turn is, since only the owner's sends start one, but one
 * heard while it was out may be an earlier unsure send's.
 *
 * @param owed the send owed, if any
 * @param turnId the turn announced, not already ended
 * @returns whether to show the owed send as the owner's and hear it
 */
export function owedTakenBy({ owed, turnId }: { owed: OwedSend | undefined; turnId: string }): boolean {
  return owed !== undefined && !owed.notIts.has(turnId);
}

/**
 * Whether the typed conversation holds a voice call off: an answer is being sent or written, or a send of unknown fate
 * may have started one the thread has not announced yet.
 *
 * @param answering whether the box is sending or its thread is writing
 * @param unsureUntilMs until when an unknown send still counts as answered, if one is pending
 * @param nowMs the page's clock
 * @returns whether a call waits
 */
export function typedHoldsCall({
  answering,
  unsureUntilMs,
  nowMs,
}: {
  answering: boolean;
  unsureUntilMs: number | undefined;
  nowMs: number;
}): boolean {
  return answering || (unsureUntilMs !== undefined && nowMs < unsureUntilMs);
}

/**
 * Read the say route's answer.
 *
 * @param status the HTTP status
 * @param body the parsed body, or `undefined` when it was not JSON
 * @returns how the send landed
 */
export function typedSendOf({ status, body }: { status: number; body: unknown }): TypedSend {
  // Only a 2xx is the route's own answer: a 5xx is whatever stood in front of it, so a success shape there is not one.
  const answered = status >= 200 && status < 300;
  if (answered && isBag(body) && body["ok"] === true && typeof body["turnId"] === "string" && body["turnId"] !== "") {
    return { kind: "accepted", turnId: body["turnId"] };
  }
  let why = `the say route answered HTTP ${String(status)}`;
  if (isBag(body) && typeof body["refused"] === "string") {
    why = body["refused"];
  }
  // The route's own refusal carries all three of its fields; anything less was written by something in front of it.
  const written =
    isBag(body) &&
    body["ok"] === false &&
    typeof body["refused"] === "string" &&
    typeof body["ambiguous"] === "boolean";
  // Only the route's own 404, marked gone, says no conversation holds the id: any other may stand in front of a send
  // the thread took, and a gone conversation is sent to again on a fresh one.
  if (status === 404 && written && body["gone"] === true) {
    return { kind: "gone", why };
  }
  // A body that is not a refusal the route wrote cannot say the thread did not take it — the route's own unknown-fate
  // answer is a 409 — and the route answers 2xx only once the thread took the message.
  if (answered || !written || status >= 500 || body["ambiguous"] === true) {
    return { kind: "unknown", why };
  }
  return { kind: "refused", why };
}
