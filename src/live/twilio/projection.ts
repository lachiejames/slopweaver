/**
 * What a Twilio message becomes before anything prints it: its delivery facts, its numbers masked, and no body.
 *
 * The view is the ONLY thing the CLI receives. It has no field a message body could reach, so "the door never
 * prints what a person was told" is a property of this type rather than of each caller's care. A phone number is
 * a direct identifier joined to a notification, so it is masked to its last three digits: the
 * investigator already holds the full number they filtered by, and the message SID is the stable handle for a
 * follow-up read. An alphanumeric sender id (the organisation's own name) carries no digits and passes unchanged.
 *
 * Twilio's dates are RFC 2822 (`<weekday>, <day> <month> <year> <time> +0000`). They are projected to ISO 8601 so they line up
 * with Datadog and Slack timestamps in the same investigation; one that will not parse is refused, never passed
 * through as if it were a date.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import { err, ok, type Result } from "../../lib/result.js";
import { GET_TWILIO_MESSAGE, type TwilioMessageWire } from "./boundaries.js";
import { type TwilioReadError, TwilioReadErrors } from "./errors.js";

/** One message's delivery facts, safe to print. */
export interface TwilioMessageView {
  readonly sid: string;
  /** `queued`, `sent`, `delivered`, `undelivered`, `failed`, … — Twilio's word, unchanged. */
  readonly status: string;
  /** Twilio's error code (e.g. 30003 unreachable handset), or `null` when Twilio reports none. */
  readonly errorCode: number | null;
  /**
   * Twilio's page for that code, or `null` with no code. Twilio's own `error_message` text is never projected: it is
   * free text that can quote the number it failed on, and the code says the same thing without it.
   */
  readonly errorDocs: string | null;
  /** `outbound-api`, `inbound`, … — or `null` when Twilio reports none. */
  readonly direction: string | null;
  /** The recipient, masked to its last three digits. */
  readonly to: string | null;
  /** The sender, masked the same way; an alphanumeric sender id passes unchanged, anything else is withheld. */
  readonly from: string | null;
  readonly createdAt: string | null;
  readonly sentAt: string | null;
  readonly updatedAt: string | null;
  readonly segments: string | null;
  readonly messagingServiceSid: string | null;
}

/** How many trailing digits of a phone number survive the mask. */
const VISIBLE_DIGITS = 3;

/** What an address prints as when it is not phone-shaped: an email, a name, anything a mask cannot make safe. */
export const WITHHELD_ADDRESS = "withheld (not a phone number)";

/** A Twilio channel prefix and the rest; only the channels Twilio documents survive as a prefix. */
const CHANNEL_SPLIT = /^((?:whatsapp|messenger|rcs):)?([\s\S]*)$/;

/** A phone number, a short code or a channel's numeric id: digits with the punctuation a number is written with. */
const PHONE_SHAPE = /^\+?[0-9][0-9 ().-]*$/;

/** An alphanumeric sender id as Twilio defines one: up to eleven letters, digits and spaces, at least one letter. */
const SENDER_ID_SHAPE = /^(?=[^A-Za-z]*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

/**
 * Mask every digit but the last three (all of them on a number of three digits or fewer), keeping any `+` or
 * documented channel prefix (`whatsapp:`) so the shape stays legible. Anything not phone-shaped is withheld whole, because masking digits in an email or a name still
 * prints the name. A sending side may be an alphanumeric sender id (the brand a recipient sees), which is kept.
 *
 * @param value a Twilio `to`/`from` value
 * @param side which field it came from: only `from` may carry a sender id
 * @returns the masked number, the sender id, or {@link WITHHELD_ADDRESS}
 */
export function maskPhone({ value, side }: { value: string; side: "to" | "from" }): string {
  const [, prefix, rest] = CHANNEL_SPLIT.exec(value)!;
  const number = rest!;
  if (side === "from" && prefix === undefined && SENDER_ID_SHAPE.test(number)) {
    return number;
  }
  if (!PHONE_SHAPE.test(number)) {
    return WITHHELD_ADDRESS;
  }
  // A number no longer than the visible tail is masked whole, so no value ever prints every one of its digits.
  const digits = number.replace(/[^0-9]/g, "").length;
  const shown = digits > VISIBLE_DIGITS ? VISIBLE_DIGITS : 0;
  let seen = 0;
  const masked = number.replace(/[0-9]/g, (digit) => {
    seen += 1;
    return seen > digits - shown ? digit : "•";
  });
  return prefix === undefined ? masked : `${prefix}${masked}`;
}

/**
 * An RFC 2822 date as ISO 8601, refusing one that does not parse.
 *
 * @param raw Twilio's date text, or null/absent
 * @param field which field, so a refusal names it
 * @returns the ISO instant, `null` when Twilio sent none, or the refusal
 */
function isoOf({
  raw,
  field,
}: {
  raw: string | null | undefined;
  field: string;
}): Result<string | null, TwilioReadError> {
  if (raw === null || raw === undefined) {
    return ok(null);
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return err(
      TwilioReadErrors.responseRefused({
        endpoint: GET_TWILIO_MESSAGE.endpoint,
        why: `${field} is not a date Twilio documents`,
      }),
    );
  }
  return ok(new Date(ms).toISOString());
}

/**
 * Project one parsed message.
 *
 * @param message the message as the strict boundary parsed it
 * @returns the printable view, or the refusal when a date will not parse
 */
export function projectTwilioMessage({
  message,
}: {
  message: TwilioMessageWire;
}): Result<TwilioMessageView, TwilioReadError> {
  const created = isoOf({ field: "date_created", raw: message.date_created });
  const sent = isoOf({ field: "date_sent", raw: message.date_sent });
  const updated = isoOf({ field: "date_updated", raw: message.date_updated });
  if (created.isErr()) {
    return err(created.error);
  }
  if (sent.isErr()) {
    return err(sent.error);
  }
  if (updated.isErr()) {
    return err(updated.error);
  }
  const to = unsetFieldAsNull({ key: "to", record: message });
  const from = unsetFieldAsNull({ key: "from", record: message });
  const errorCode = unsetFieldAsNull({ key: "error_code", record: message });
  return ok({
    createdAt: created.value,
    direction: unsetFieldAsNull({ key: "direction", record: message }),
    errorCode,
    errorDocs: errorCode === null ? null : `https://www.twilio.com/docs/api/errors/${String(errorCode)}`,
    from: from === null ? null : maskPhone({ side: "from", value: from }),
    messagingServiceSid: unsetFieldAsNull({ key: "messaging_service_sid", record: message }),
    segments: unsetFieldAsNull({ key: "num_segments", record: message }),
    sentAt: sent.value,
    sid: message.sid,
    status: message.status,
    to: to === null ? null : maskPhone({ side: "to", value: to }),
    updatedAt: updated.value,
  });
}

/**
 * The human lines for one message — a headline with the outcome, then the timing.
 *
 * @param view the projected message
 * @returns the lines, in print order
 */
export function renderTwilioMessage({ view }: { view: TwilioMessageView }): readonly string[] {
  // Each absence is worded for its own field: a message Twilio never sent says "not sent", not "unknown".
  const outcome =
    view.errorCode === null || view.errorDocs === null
      ? view.status
      : `${view.status} (error ${String(view.errorCode)}, ${view.errorDocs})`;
  let direction = "direction unknown";
  if (view.direction !== null) {
    direction = view.direction;
  }
  const from = view.from === null ? "from unknown" : `from ${view.from}`;
  const to = view.to === null ? "to unknown" : `to ${view.to}`;
  const segments = view.segments === null ? "segments unknown" : `segments ${view.segments}`;
  const created = view.createdAt === null ? "created unknown" : `created ${view.createdAt}`;
  const sent = view.sentAt === null ? "not sent" : `sent ${view.sentAt}`;
  const updated = view.updatedAt === null ? "updated unknown" : `updated ${view.updatedAt}`;
  return [
    `${view.sid}  ${outcome}`,
    `    ${direction}  ${from}  ${to}  ${segments}`,
    `    ${created}  ${sent}  ${updated}`,
  ];
}
