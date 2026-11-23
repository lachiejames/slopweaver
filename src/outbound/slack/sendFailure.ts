/**
 * What a FAILED Slack send tells us about whether anything landed.
 *
 * A send that throws is not one state but three, and the duplicate-key reservation taken before it has to be
 * settled differently for each:
 *
 * - **Slack answered `ok: false`** (`channel_not_found`, `not_in_channel`, `invalid_blocks`, …). Slack itself
 *   said the message was not posted — that is not an unknown outcome, it is a definite no-send, and a
 *   reservation left behind for it blocks every later attempt at the same words for the whole window while
 *   protecting nothing. Measured: a card's first attempt died on `channel_not_found`, the
 *   reservation dangled, and neither the door override nor `--resend-unconfirmed` could clear it.
 * - **The composite send posted and then RETRACTED** (media would not attach, the message was deleted). Nothing
 *   is visible, so nothing landed. When the retraction ALSO failed the message IS visible, at a `ts` the error
 *   carries — a landed send by any honest reading, and the reservation should say so.
 * - **A guard at the transport refused before the wire** (`refusedBeforeWire: true` on the thrown value — the
 *   repeat guard's `RepeatSendRefusedError`, the high-stakes reply guard's `HighStakesReplyRefusedError`). No
 *   request left, so nothing landed, and a reservation kept for it would block the corrected send the refusal
 *   asks for.
 * - **Anything else** — a network error, a timeout, a 5xx, a lost response. The request may have reached Slack
 *   and the answer may have been lost, so the only honest state is "unconfirmed", exactly as before.
 *
 * Pure: it reads the thrown value and never touches the reservation. {@link ./sendReservation.settleFailedSend}
 * is the one caller that acts on the verdict. Conservative by construction — absent an EXPLICIT negative
 * signal from Slack itself, a failure is `ambiguous`, because "released" is the verdict a retry uses to post
 * again, and a wrong one there is a double-post.
 */
import { isRecord } from "../../lib/parsers.js";

/** What one failed send is known to have done on the wire. */
export type SendFailureVerdict =
  | { readonly kind: "rejected"; readonly providerCode: string }
  | { readonly kind: "retracted" }
  | { readonly kind: "refused-before-wire" }
  | { readonly kind: "visible"; readonly channel: string; readonly ts: string }
  | { readonly kind: "ambiguous" };

/**
 * Slack's own `data.error` string off a platform-rejected SDK error, when the value is one.
 *
 * The SDK's `WebAPIPlatformError` carries the `ok: false` response body as `data`, and `data.error` is the
 * string Slack itself answered with. Read structurally rather than by `instanceof`: the value may be the raw
 * SDK error, or an `IngestError.cause` carrying it, and neither should require this module to import the SDK.
 *
 * @param value the thrown value, or a boundary error's `cause`
 * @returns Slack's error string, or undefined when the value is not a platform rejection
 */
export function slackPlatformErrorCode({ value }: { value: unknown }): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const data = value["data"];
  if (!isRecord(data)) {
    return undefined;
  }
  const code = data["error"];
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

/** The composite send's own failure, read structurally: whether a posted message was retracted, and where it was. */
function compositeOutcome({
  value,
}: {
  value: unknown;
}): { readonly deletedMessage: boolean; readonly posted: { channel: string; ts: string } | undefined } | undefined {
  if (!isRecord(value) || typeof value["deletedMessage"] !== "boolean") {
    return undefined;
  }
  const posted = value["posted"];
  if (isRecord(posted) && typeof posted["channel"] === "string" && typeof posted["ts"] === "string") {
    return { deletedMessage: value["deletedMessage"], posted: { channel: posted["channel"], ts: posted["ts"] } };
  }
  return { deletedMessage: value["deletedMessage"], posted: undefined };
}

/**
 * Classify a thrown send failure by what it proves about the wire.
 *
 * @param error the value the send threw
 * @returns the verdict the reservation is settled on
 */
export function classifySendFailure({ error }: { error: unknown }): SendFailureVerdict {
  if (isRecord(error) && error["refusedBeforeWire"] === true) {
    return { kind: "refused-before-wire" };
  }
  const providerCode = slackPlatformErrorCode({ value: error });
  if (providerCode !== undefined) {
    return { kind: "rejected", providerCode };
  }
  const composite = compositeOutcome({ value: error });
  if (composite === undefined) {
    return { kind: "ambiguous" };
  }
  if (composite.posted === undefined) {
    // Failed before anything was posted (an upload phase), or posted and retracted: nothing is on the wire.
    return { kind: "retracted" };
  }
  if (composite.deletedMessage) {
    return { kind: "retracted" };
  }
  return { channel: composite.posted.channel, kind: "visible", ts: composite.posted.ts };
}
