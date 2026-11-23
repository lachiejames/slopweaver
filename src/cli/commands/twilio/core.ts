/**
 * The pure half of the three `twilio` verbs: each tail parsed into checked options, every refusal collected
 * before any credential or network is touched.
 *
 * Exit contract, shared by every verb (`shell.ts` maps it): 2 for a caller mistake refused here, 3 when this
 * install holds no Twilio key (`TOKEN_MISSING`, with the mint step), 1 for anything Twilio or the boundary
 * refused, 0 for a read that answered — an empty list included, because "no message matched" is the answer.
 *
 * A filter is validated here rather than left to Twilio because the values are phone numbers: a malformed one
 * would otherwise go to Twilio and come back as an error this door then has to withhold. A date is a calendar
 * day or a whole-second UTC instant, the two shapes Twilio's `DateSent` documents.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { TWILIO_MAX_LIMIT, type TwilioMessageFilter } from "../../../live/twilio/reads.js";
import { isTwilioMessageSid } from "../../../live/twilio/transport.js";
import {
  flagValue,
  type ParsedFlagTail,
  parseFlagTail,
  parsePositiveInteger,
  requiredFlagValue,
} from "../../optionParsers.js";

/** How many messages a list read returns when `--limit` is not passed. */
export const TWILIO_DEFAULT_LIMIT = 50;

/** Options every verb takes. */
interface TwilioCommonOptions {
  /** `--home`, or `null` for this install's own state home. */
  readonly home: string | null;
  readonly json: boolean;
}

/** `twilio verify`'s options. */
export type TwilioVerifyOptions = TwilioCommonOptions;

/** `twilio messages`'s options. */
export interface TwilioMessagesOptions extends TwilioCommonOptions {
  readonly filter: TwilioMessageFilter;
  readonly limit: number;
}

/** `twilio message`'s options. */
export interface TwilioMessageOptions extends TwilioCommonOptions {
  readonly sid: string;
}

/** A recipient: E.164, optionally on a channel Twilio prefixes (`whatsapp:`). */
const RECIPIENT = /^(whatsapp:)?\+[1-9][0-9]{6,14}$/;

/** A sender: a recipient's shape, or an alphanumeric sender id or short code of up to eleven characters. */
const SENDER_ID = /^[A-Za-z0-9]{1,11}$/;

/** A calendar day, or a whole-second UTC instant. */
const DATE_SENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

/**
 * One optional `--sent-after`/`--sent-before`, checked to be a real day or instant.
 *
 * @param parsed the parsed tail
 * @param flag the flag name
 * @param errors the accumulator a refusal is pushed into
 * @returns the value, or `null` when not passed or refused
 */
function optionalDateSent({
  parsed,
  flag,
  errors,
}: {
  parsed: ParsedFlagTail;
  flag: "sent-after" | "sent-before";
  errors: string[];
}): string | null {
  const value = flagValue({ name: flag, parsed });
  if (value !== null && (!DATE_SENT.test(value) || Number.isNaN(Date.parse(value)))) {
    errors.push(`--${flag} must be a day (2026-10-11) or a UTC instant (2026-10-11T03:00:00Z)`);
    return null;
  }
  return value;
}

/**
 * Parse `twilio verify`'s tail.
 *
 * @param rest the verb's argv tail
 * @returns the options, or every refusal
 */
export function parseTwilioVerifyOptions({ rest }: { rest: readonly string[] }): Result<TwilioVerifyOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: flagValue({ name: "home", parsed: parsed.value }), json: parsed.value.flags.has("json") });
}

/**
 * Parse `twilio messages`'s tail.
 *
 * @param rest the verb's argv tail
 * @returns the options, or every refusal at once
 */
export function parseTwilioMessagesOptions({ rest }: { rest: readonly string[] }): Result<TwilioMessagesOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["to", "from", "sent-after", "sent-before", "limit", "home"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const to = flagValue({ name: "to", parsed: parsed.value });
  if (to !== null && !RECIPIENT.test(to)) {
    errors.push("--to must be an E.164 number such as +61400000000 (optionally whatsapp:+61…)");
  }
  const from = flagValue({ name: "from", parsed: parsed.value });
  if (from !== null && !RECIPIENT.test(from) && !SENDER_ID.test(from)) {
    errors.push("--from must be an E.164 number, a short code or an alphanumeric sender id of up to 11 characters");
  }
  const sentAfter = optionalDateSent({ errors, flag: "sent-after", parsed: parsed.value });
  const sentBefore = optionalDateSent({ errors, flag: "sent-before", parsed: parsed.value });
  const limit = parseLimit({ errors, raw: flagValue({ name: "limit", parsed: parsed.value }) });
  if (errors.length > 0 || limit === undefined) {
    return err(errors);
  }
  return ok({
    filter: { from, sentAfter, sentBefore, to },
    home: flagValue({ name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    limit,
  });
}

/**
 * `--limit`, bounded to what one list read will follow.
 *
 * @param raw the flag's value, or `null` for the stated default
 * @param errors the accumulator a refusal is pushed into
 * @returns the limit, or `undefined` once a refusal was pushed
 */
function parseLimit({ raw, errors }: { raw: string | null; errors: string[] }): number | undefined {
  if (raw === null) {
    return TWILIO_DEFAULT_LIMIT;
  }
  const limit = parsePositiveInteger({ errors, label: "--limit", value: raw });
  if (limit !== undefined && limit > TWILIO_MAX_LIMIT) {
    errors.push(`--limit must be at most ${String(TWILIO_MAX_LIMIT)} — narrow the window or the number instead`);
    return undefined;
  }
  return limit;
}

/**
 * Parse `twilio message`'s tail.
 *
 * @param rest the verb's argv tail
 * @returns the options, or the refusal
 */
export function parseTwilioMessageOptions({ rest }: { rest: readonly string[] }): Result<TwilioMessageOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["sid", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const sid = requiredFlagValue({
    missing: "--sid is required: the message SID (SM… or MM…) from a `twilio messages` row",
    name: "sid",
    parsed: parsed.value,
  });
  if (sid.isErr()) {
    return err(sid.error);
  }
  if (!isTwilioMessageSid({ value: sid.value })) {
    return err(["--sid must be a message SID: SM or MM followed by 32 lower-case hex characters"]);
  }
  return ok({
    home: flagValue({ name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    sid: sid.value,
  });
}
