/**
 * PURE argument handling for `gmail triage`, apart from `./core.ts` so that file stays under the size ratchet. A
 * malformed invocation is refused before a credential is read, which is what lets the verb declare
 * `parseRejectIsIoFree`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_TRIAGE_LIMIT, MAX_TRIAGE_LIMIT } from "../../../live/gmail/triageRead.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";
import { GMAIL_TRIAGE_USAGE } from "./triageUsage.js";

/** A parsed `gmail triage` invocation. */
export interface GmailTriageArgs {
  readonly home: string | undefined;
  /** The one group to print with its ids, when the caller named one. */
  readonly key: string | undefined;
  /** With {@link key}: the card slug to pin that group's ids under, exactly as they stand now. */
  readonly pin: string | undefined;
  /** A card slug whose pinned ids to print, those still in the inbox only. Excludes {@link key} and {@link pin}. */
  readonly card: string | undefined;
  /** Print the ids every declared archive rule covers — the set the seat archives unasked. Excludes the three above. */
  readonly ruled: boolean;
  readonly limit: number;
  readonly write: boolean;
  readonly json: boolean;
}

/** Longest card slug accepted — a board slug is far shorter; this only bounds a file name. */
const MAX_CARD_SLUG = 120;

/**
 * Whether a card slug is safe as a file name: lower-case letters, digits and hyphens, not starting with a hyphen.
 * Checked character by character rather than by pattern, so a hostile value costs nothing to refuse.
 *
 * @returns true when the slug may name a pin's file
 */
export function isCardSlug({ slug }: { slug: string }): boolean {
  if (slug.length === 0 || slug.length > MAX_CARD_SLUG || slug.startsWith("-")) {
    return false;
  }
  for (const char of slug) {
    if (!((char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "-")) {
      return false;
    }
  }
  return true;
}

/**
 * Why two selectors cannot be combined: `--card` reads a set already pinned, and `--ruled` reads every ruled group.
 *
 * @returns the refusal reason, or undefined when the selectors combine
 */
function selectorConflict({
  key,
  pin,
  card,
  ruled,
}: {
  key: string | undefined;
  pin: string | undefined;
  card: string | undefined;
  ruled: boolean;
}): string | undefined {
  const keyed = key !== undefined || pin !== undefined;
  if (card !== undefined && keyed) {
    return "--card prints a set already pinned, so it takes neither --key nor --pin";
  }
  if (ruled && (keyed || card !== undefined)) {
    return "--ruled prints every ruled group's ids, so it takes none of --key, --pin or --card";
  }
  return undefined;
}

/**
 * Parse the `gmail triage` tail.
 *
 * @param rest the argv tail after `gmail triage`
 * @returns the validated request, or the one reason it was refused
 */
export function parseGmailTriageArgs({ rest }: { rest: readonly string[] }): Result<GmailTriageArgs, GmailArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "ruled", "write"], value: ["card", "home", "key", "limit", "pin"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: GMAIL_TRIAGE_USAGE }));
  }
  const { values, flags } = parsed.value;
  const rawLimit = values["limit"];
  let limit = DEFAULT_TRIAGE_LIMIT;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRIAGE_LIMIT) {
    return err(
      GmailArgsErrors.limitOutOfRange({ got: String(rawLimit), max: MAX_TRIAGE_LIMIT, usage: GMAIL_TRIAGE_USAGE }),
    );
  }
  const { key, pin, card } = { card: values["card"], key: values["key"], pin: values["pin"] };
  if (pin !== undefined && key === undefined) {
    return err(GmailArgsErrors.keyRequired({ usage: GMAIL_TRIAGE_USAGE }));
  }
  const ruled = flags.has("ruled");
  const conflict = selectorConflict({ card, key, pin, ruled });
  if (conflict !== undefined) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: [conflict], usage: GMAIL_TRIAGE_USAGE }));
  }
  for (const [flag, slug] of [
    ["--pin", pin],
    ["--card", card],
  ] as const) {
    if (slug !== undefined && !isCardSlug({ slug })) {
      return err(GmailArgsErrors.cardSlugInvalid({ flag, got: slug, usage: GMAIL_TRIAGE_USAGE }));
    }
  }
  return ok({
    card,
    home: values["home"],
    json: flags.has("json"),
    key,
    limit,
    pin,
    ruled,
    write: flags.has("write"),
  });
}
