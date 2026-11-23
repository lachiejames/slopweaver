/**
 * The subscription dates a Codex store's own sign-in STATES, read from `$CODEX_HOME/auth.json` on this machine, with
 * no network call.
 *
 * ## Where the date lives, measured
 *
 * The Codex app-server protocol carries no subscription date: `account/read` answers an email and a plan type, and
 * `account/rateLimits/read` the windows, credits and reset credits (`codex app-server generate-json-schema --out <dir>`
 * on codex-cli 0.165.0, then read `v2/GetAccountResponse.json` and `v2/GetAccountRateLimitsResponse.json`). The date
 * is in the sign-in itself: the `id_token` OpenAI issues at login and on every refresh is a JWT whose
 * `https://api.openai.com/auth` claims carry `chatgpt_subscription_active_start`, `chatgpt_subscription_active_until`
 * and `chatgpt_subscription_last_checked`, ISO-8601 instants with an offset and up to six fractional digits. Measured
 * present on every registered Codex store; reproduce by decoding the middle segment of `tokens.id_token` and listing
 * that namespace's keys.
 *
 * `active_until` is the end of the period the provider holds paid as of `last_checked`, which is why the reading
 * carries both: a renewal moves it on the next token refresh, and a stale check is shown as stale rather than read
 * as today's answer. It is PROVIDER-STATED, a different fact from the lapse the owner records with `plans lapse`
 * (`../plans/lapse.ts` prints both, and says when they differ). Nothing here writes the register or moves a route.
 *
 * ## What this reader holds, stated rather than discovered
 *
 * `./auth.ts` deliberately extracts NO token value, and stays that way: this is a separate module because it does
 * the one thing that module refuses to. The residue:
 *
 * - reading `auth.json` puts every byte of it in memory, and `JSON.parse` materialises its other fields — the access
 *   and refresh tokens included — for the duration of one call, exactly as any reader of the file, Codex included;
 * - the `id_token` is extracted, and only its payload segment is decoded and parsed, transiently;
 * - the signature is NOT verified: that would need OpenAI's signing keys, a network destination this reader does not
 *   add. The trust boundary is the local file Codex itself wrote, the same one every other Codex reader here trusts.
 *
 * Only the paid-through and last-checked date strings leave this module; the start date is passed over unread. No token, payload, namespace object, other claim or parser message
 * escapes, and nothing here logs: every failure names the path and the stage alone (`./subscriptionDatesErrors.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type CodexSubscriptionDatesError, CodexSubscriptionDatesErrors } from "./subscriptionDatesErrors.js";

/** The subscription dates one Codex sign-in states. */
export interface CodexSubscriptionDates {
  /** The end of the period the provider holds paid, as of {@link lastCheckedIso}. */
  readonly paidThroughIso: string;
  /** When the provider last checked the subscription, which is when the date above was true. */
  readonly lastCheckedIso: string;
}

/** The claim namespace OpenAI puts its ChatGPT account facts under. */
const AUTH_NAMESPACE = "https://api.openai.com/auth";

/** The claim whose presence says the sign-in carries subscription dates at all. */
const PAID_THROUGH_CLAIM = "chatgpt_subscription_active_until";

/** The document: only `tokens.id_token` is required, every other field is left as Codex wrote it. */
const authDocument = z.looseObject({ tokens: z.looseObject({ id_token: z.string() }) });

/** An instant with an explicit offset, any fractional precision — the measured claims carry six digits. */
const instant = z.iso.datetime({ offset: true });

/**
 * The two picked claims. `chatgpt_subscription_active_start` is deliberately NOT one: no surface prints it, so
 * requiring it would let its absence discard a valid paid-through date, and leaving it unread lets one fewer value
 * out of the sign-in. The namespace carries many unrelated claims, all passed over unread.
 */
const subscriptionClaims = z.looseObject({
  chatgpt_subscription_active_until: instant,
  chatgpt_subscription_last_checked: instant,
});

/** The JWT payload: an object whose namespace, when present, is an object. A payload without one states no date. */
const tokenPayload = z.looseObject({ [AUTH_NAMESPACE]: z.looseObject({}).optional() });

/**
 * Decode a JWT's payload segment as canonical base64url JSON. Node's decoder skips characters outside the alphabet
 * rather than refusing them, so the bytes must re-encode to the segment exactly (`../cmux/events.ts` does the same).
 *
 * @param idToken the token text
 * @returns the parsed payload as `unknown`, or undefined when the token is not three segments of canonical base64url
 */
function decodedPayload({ idToken }: { idToken: string }): unknown {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    return undefined;
  }
  const segment = segments[1]!;
  const bytes = Buffer.from(segment, "base64url");
  if (segment === "" || bytes.toString("base64url") !== segment) {
    return undefined;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Read the subscription dates out of an `auth.json` document's text. Pure.
 *
 * @param authText the whole `auth.json` text
 * @param path the file it came from, the one thing a failure names
 * @returns the two dates, or which structural stage refused
 */
export function decodeCodexSubscriptionDates({
  authText,
  path,
}: {
  authText: string;
  path: string;
}): Result<CodexSubscriptionDates, CodexSubscriptionDatesError> {
  let document: unknown;
  try {
    document = JSON.parse(authText);
  } catch {
    return err(CodexSubscriptionDatesErrors.authInvalid({ path }));
  }
  const auth = authDocument.safeParse(document);
  if (!auth.success) {
    return err(CodexSubscriptionDatesErrors.authInvalid({ path }));
  }
  const payload = tokenPayload.safeParse(decodedPayload({ idToken: auth.data.tokens.id_token }));
  if (!payload.success) {
    return err(CodexSubscriptionDatesErrors.idTokenInvalid({ path }));
  }
  const namespace = payload.data[AUTH_NAMESPACE];
  if (namespace === undefined) {
    return err(CodexSubscriptionDatesErrors.claimsAbsent({ path }));
  }
  const paidThrough = namespace[PAID_THROUGH_CLAIM];
  if (paidThrough === undefined || paidThrough === null) {
    return err(CodexSubscriptionDatesErrors.claimsAbsent({ path }));
  }
  const claims = subscriptionClaims.safeParse(namespace);
  if (!claims.success) {
    return err(CodexSubscriptionDatesErrors.claimsInvalid({ path }));
  }
  return ok({
    lastCheckedIso: claims.data.chatgpt_subscription_last_checked,
    paidThroughIso: claims.data.chatgpt_subscription_active_until,
  });
}

/**
 * Read one Codex store's subscription dates off its `auth.json`.
 *
 * @param codexHome the store directory
 * @returns the two dates, or why this store states none
 */
export function readCodexSubscriptionDates({
  codexHome,
}: {
  codexHome: string;
}): Result<CodexSubscriptionDates, CodexSubscriptionDatesError> {
  const path = join(codexHome, "auth.json");
  let authText: string;
  try {
    authText = readFileSync(path, "utf8");
  } catch {
    return err(CodexSubscriptionDatesErrors.authUnreadable({ path }));
  }
  return decodeCodexSubscriptionDates({ authText, path });
}
