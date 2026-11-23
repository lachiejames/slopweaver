/**
 * The pure half of the six `knock` verbs: each tail parsed into checked options, every refusal collected before
 * any credential or network is touched.
 *
 * Exit contract, shared by every verb (`shell.ts` maps it): 2 for a caller mistake refused here, 3 when this
 * install holds no Knock key (`TOKEN_MISSING`, with the hand step), 1 for anything Knock or the boundary refused,
 * 0 for a read that answered — an empty list included, because "no notification matched" is the answer.
 *
 * An id is checked against the same one-path-segment rule the transport applies, so a malformed one is a usage
 * error here rather than a refused URL later. A status must be one Knock's list documents; an instant is a
 * whole-second UTC ISO instant.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { KNOCK_MAX_LIMIT } from "../../../live/knock/paging.js";
import type { KnockMessageFilter } from "../../../live/knock/reads.js";
import { isSafeKnockId } from "../../../live/knock/transport.js";
import {
  collectRepeated,
  flagValue,
  type ParsedFlagTail,
  parseFlagTail,
  parsePositiveInteger,
  requiredFlagValue,
} from "../../optionParsers.js";

/** How many items a list read returns when `--limit` is not passed. */
export const KNOCK_DEFAULT_LIMIT = 50;

/** The delivery statuses Knock's message list filters on. */
const KNOCK_STATUSES = ["queued", "sent", "delivered", "delivery_attempted", "undelivered", "not_sent", "bounced"];

/** A whole-second (or finer) UTC instant. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Options every verb takes. */
interface KnockCommonOptions {
  /** `--home`, or `null` for this install's own state home. */
  readonly home: string | null;
  readonly json: boolean;
}

/** `knock verify`'s options. */
export type KnockVerifyOptions = KnockCommonOptions;

/** `knock messages`'s options, and `knock user-messages`'s with `userId` set. */
export interface KnockMessagesOptions extends KnockCommonOptions {
  readonly filter: KnockMessageFilter;
  readonly limit: number;
  /** `null` for the environment-wide list. */
  readonly userId: string | null;
}

/** `knock message`'s options, and the two per-message lists' with `limit`. */
export interface KnockMessageOptions extends KnockCommonOptions {
  readonly messageId: string;
  readonly limit: number;
}

/** The value flags the two message lists share. */
const FILTER_FLAGS = [
  "channel-id",
  "status",
  "source",
  "tenant",
  "workflow-run-id",
  "workflow-recipient-run-id",
  "inserted-after",
  "inserted-before",
  "limit",
  "home",
];

/**
 * Parse `knock verify`'s tail.
 *
 * @param rest the verb's argv tail
 * @returns the options, or every refusal
 */
export function parseKnockVerifyOptions({ rest }: { rest: readonly string[] }): Result<KnockVerifyOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: flagValue({ name: "home", parsed: parsed.value }), json: parsed.value.flags.has("json") });
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
    return KNOCK_DEFAULT_LIMIT;
  }
  const limit = parsePositiveInteger({ errors, label: "--limit", value: raw });
  if (limit !== undefined && limit > KNOCK_MAX_LIMIT) {
    errors.push(`--limit must be at most ${String(KNOCK_MAX_LIMIT)} — narrow the window or the filters instead`);
    return undefined;
  }
  return limit;
}

/**
 * One optional id flag, refused when it could change which route a URL names.
 *
 * @param parsed the parsed tail
 * @param name the flag name
 * @param errors the accumulator a refusal is pushed into
 * @returns the id, or `null` when not passed or refused
 */
function optionalId({
  parsed,
  name,
  errors,
}: {
  parsed: ParsedFlagTail;
  name: string;
  errors: string[];
}): string | null {
  const value = flagValue({ name, parsed });
  if (value !== null && !isSafeKnockId({ value })) {
    errors.push(`--${name} must be one id with no slash, ?, #, %, space or control character`);
    return null;
  }
  return value;
}

/**
 * One optional instant flag.
 *
 * @param parsed the parsed tail
 * @param name the flag name
 * @param errors the accumulator a refusal is pushed into
 * @returns the instant, or `null` when not passed or refused
 */
function optionalInstant({
  parsed,
  name,
  errors,
}: {
  parsed: ParsedFlagTail;
  name: string;
  errors: string[];
}): string | null {
  const value = flagValue({ name, parsed });
  if (value !== null && (!INSTANT.test(value) || Number.isNaN(Date.parse(value)))) {
    errors.push(`--${name} must be a UTC instant such as 2026-10-11T00:00:00Z`);
    return null;
  }
  return value;
}

/**
 * Parse `knock messages`'s tail, or `knock user-messages`'s when `withUser` is set.
 *
 * @param rest the verb's argv tail
 * @param withUser whether `--user-id` is required (`user-messages`) or refused (`messages`)
 * @returns the options, or every refusal at once
 */
export function parseKnockMessagesOptions({
  rest,
  withUser,
}: {
  rest: readonly string[];
  withUser: boolean;
}): Result<KnockMessagesOptions> {
  const value = withUser ? [...FILTER_FLAGS, "user-id"] : FILTER_FLAGS;
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], repeatable: ["status"], value } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const tail = parsed.value;
  const errors: string[] = [];
  let userId: string | null = null;
  if (withUser) {
    const given = requiredFlagValue({
      missing: "--user-id is required: the application's own user id, as Knock was told it",
      name: "user-id",
      parsed: tail,
    });
    if (given.isErr()) {
      errors.push(...given.error);
    } else if (isSafeKnockId({ value: given.value })) {
      userId = given.value;
    } else {
      errors.push("--user-id must be one id with no slash, ?, #, %, space or control character");
    }
  }
  const statuses = collectRepeated({ name: "--status", rest });
  const unknown = statuses.filter((status) => !KNOCK_STATUSES.includes(status));
  if (unknown.length > 0) {
    errors.push(`--status must be one of ${KNOCK_STATUSES.join(", ")} (got ${unknown.join(", ")})`);
  }
  const filter: KnockMessageFilter = {
    channelId: optionalId({ errors, name: "channel-id", parsed: tail }),
    insertedAfter: optionalInstant({ errors, name: "inserted-after", parsed: tail }),
    insertedBefore: optionalInstant({ errors, name: "inserted-before", parsed: tail }),
    source: optionalId({ errors, name: "source", parsed: tail }),
    statuses,
    tenant: optionalId({ errors, name: "tenant", parsed: tail }),
    workflowRecipientRunId: optionalId({ errors, name: "workflow-recipient-run-id", parsed: tail }),
    workflowRunId: optionalId({ errors, name: "workflow-run-id", parsed: tail }),
  };
  const limit = parseLimit({ errors, raw: flagValue({ name: "limit", parsed: tail }) });
  if (errors.length > 0 || limit === undefined) {
    return err(errors);
  }
  return ok({ filter, home: flagValue({ name: "home", parsed: tail }), json: tail.flags.has("json"), limit, userId });
}

/**
 * Parse a single-message verb's tail: `knock message`, or a per-message list when `withLimit` is set.
 *
 * @param rest the verb's argv tail
 * @param withLimit whether `--limit` is accepted (`message-events`, `delivery-logs`)
 * @returns the options, or every refusal at once
 */
export function parseKnockMessageOptions({
  rest,
  withLimit,
}: {
  rest: readonly string[];
  withLimit: boolean;
}): Result<KnockMessageOptions> {
  const value = withLimit ? ["id", "limit", "home"] : ["id", "home"];
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const id = requiredFlagValue({
    missing: "--id is required: the Knock message id from a `knock messages` row",
    name: "id",
    parsed: parsed.value,
  });
  if (id.isErr()) {
    errors.push(...id.error);
  } else if (!isSafeKnockId({ value: id.value })) {
    errors.push("--id must be one message id with no slash, ?, #, %, space or control character");
  }
  const limit = parseLimit({ errors, raw: flagValue({ name: "limit", parsed: parsed.value }) });
  if (errors.length > 0 || id.isErr() || limit === undefined) {
    return err(errors);
  }
  return ok({
    home: flagValue({ name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    limit,
    messageId: id.value,
  });
}
