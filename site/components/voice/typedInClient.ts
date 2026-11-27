/**
 * The page's half of typing into a live call: what the owner typed or pasted into the Messenger box while a voice call
 * is up, posted to `/api/talk/typed-in`, which hands it to that call's voice as the owner's turn. No call id: the window
 * the owner types in may not hold the call, so the server finds it. What the voice makes of it arrives on the call's own event stream.
 * The desktop test instance marks its body `instance: "e2e"`, as its offer does, so the server hands it only to a test call
 * and the owner's words only to the owner's.
 */
import { isBag } from "../../lib/bag";
import { windowInstance } from "./useDesktopShell";

/** How long one send may take: the server's append step, with room. */
const TYPED_IN_TIMEOUT_MS = 30_000;

/**
 * How one send into the call landed, as the page reads it: `taken` once the voice has it; `refused` with the server's
 * reason when it certainly does not; `unknown` when the page cannot tell, so it is never sent again on its own.
 */
export type TypedInSend =
  | { readonly kind: "taken" }
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * Hand one message to the live call's voice.
 *
 * @param messageId the page's own id for this message, the same on a retry
 * @param pressedMs when the owner pressed send, so a call made after it is never handed their words
 * @param text what the owner typed or pasted
 * @returns how it landed
 */
export async function typeIntoLiveCall({
  messageId,
  pressedMs,
  text,
}: {
  messageId: string;
  pressedMs: number;
  text: string;
}): Promise<TypedInSend> {
  const instance = windowInstance();
  let response: Response;
  try {
    response = await fetch("/api/talk/typed-in", {
      body: typedInBody({ instance, messageId, pressedMs, text }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(TYPED_IN_TIMEOUT_MS),
    });
  } catch (cause) {
    return { kind: "unknown", why: `the console server did not answer: ${String(cause)}` };
  }
  const body: unknown = await response.json().catch(() => undefined);
  return typedInSendOf({ body, status: response.status });
}

/**
 * The send's JSON body: `instance` rides only on the desktop test instance's, so the owner's own carries none.
 *
 * @param instance `e2e` on the desktop test instance, `undefined` on the owner's own app or a browser
 * @param messageId the page's own id for this message
 * @param pressedMs when send was pressed
 * @param text what was typed or pasted
 * @returns the body text
 */
export function typedInBody({
  instance,
  messageId,
  pressedMs,
  text,
}: {
  instance: "e2e" | undefined;
  messageId: string;
  pressedMs: number;
  text: string;
}): string {
  if (instance === undefined) {
    return JSON.stringify({ messageId, pressedMs, text });
  }
  return JSON.stringify({ instance, messageId, pressedMs, text });
}

/**
 * Read the typed-in route's answer.
 *
 * @param status the HTTP status
 * @param body the parsed body, or `undefined` when it was not JSON
 * @returns how the send landed
 */
export function typedInSendOf({ status, body }: { status: number; body: unknown }): TypedInSend {
  // Only a 2xx is the route's own answer: a 5xx is whatever stood in front of it, so a success shape there is not one.
  const answered = status >= 200 && status < 300;
  if (answered && isBag(body) && body["ok"] === true) {
    return { kind: "taken" };
  }
  let why = `the typed-in route answered HTTP ${String(status)}`;
  if (isBag(body) && typeof body["refused"] === "string") {
    why = body["refused"];
  }
  // The route's own refusal carries all three of its fields; anything less was written by something in front of it.
  const written =
    isBag(body) &&
    body["ok"] === false &&
    typeof body["refused"] === "string" &&
    typeof body["ambiguous"] === "boolean";
  // A body that is not a refusal the route wrote cannot say the voice did not take it, and neither can the route's
  // own unsure answer, a 504 marked ambiguous.
  if (answered || !written || status >= 500 || body["ambiguous"] === true) {
    return { kind: "unknown", why };
  }
  return { kind: "refused", why };
}
