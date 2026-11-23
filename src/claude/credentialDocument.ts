/**
 * Read ONE account's Claude credential out of a keychain document, and read the five bounded facts about its
 * lifetime that this repository is allowed to know. Pure: no keychain, no filesystem, no clock. The credential
 * itself is opaque to it.
 *
 * ## Why the MERGE reasoning is kept although nothing merges any more
 *
 * Measured: the keychain item Claude Code keeps is a single JSON document holding `claudeAiOauth` —
 * the Claude subscription credential — AND an `mcpOAuth` map with a separate entry per connected MCP server.
 * On this machine that map held live Slack and Hex tokens. Replacing the document wholesale to change plans
 * would silently sign the owner out of every MCP server they have connected, which is a data-loss bug wearing the
 * costume of a feature. The swap that needed that merge is retired — nothing in this repository copies a
 * credential between slots any more (`keychain.ts` § Why there is no writer here) — so the merge itself is
 * gone and this paragraph is what a future writer has to read first: replace one top-level key and carry every
 * sibling through untouched, known or not, because a future Claude Code version may add a key this build has
 * never heard of and dropping it would be the same bug again.
 *
 * ## Nothing here returns a credential's contents
 *
 * `claudeAiOauth` is handled as an opaque `unknown` for every purpose that moves it: never parsed,
 * narrowed, logged or interpolated. FIVE functions look inside it — {@link credentialExpiryIso},
 * {@link credentialHasAccessToken}, {@link credentialRefreshExpiryIso}, {@link credentialHasRefreshToken} and
 * {@link credentialHasScope} — and each is bounded by its RETURN type rather than by discipline: two instants and
 * three booleans, none of which a token fits into. That is why the guarantee is stated over what leaves this
 * module rather than over what it reads, and why a sixth such function would have to earn the same bound before
 * it is added.
 *
 * The two refresh-grant readers are the newest, and they exist because the number that actually decides when
 * the owner must sign in again must not be left unread. MEASURED on one machine: every store's
 * credential carries `refreshTokenExpiresAt` 27 to 29 days out beside the eight-hour `expiresAt`. Reproduce
 * with `git grep refreshTokenExpiresAt`. A decision taken against the eight-hour number while the four-week
 * number sits unread in the same JSON object treats an expired access token as a plan that needs a browser
 * sign-in, when it is a cache miss repairable from a grant with weeks left.
 *
 * **`claude signin --status` prints the grant expiry**, as the forced-sign-in date each store's continuation
 * line carries; `signinPlan.ts` § A row also carries RECENCY and a DEADLINE is why it is that number and not
 * the eight-hour one. Read the raw field with
 * `security find-generic-password -s "$(the store's service name)" -a "$USER" -w | jq .claudeAiOauth`.
 *
 * ## Both expiry readers are RANGE-safe, not merely finiteness-checked
 *
 * `new Date(8.64e15 + 1).toISOString()` throws `RangeError` — verified by running it — and
 * `8.64e15 + 1` is a perfectly finite number. A provider field, or a corrupted item, carrying one would
 * therefore have thrown out of a reader whose whole contract is to answer "or undefined". Both readers share
 * {@link millisecondsToIso}, which checks the constructed instant rather than the number it came from.
 */
import { isRecord } from "../lib/parsers.js";

/** The one key in a keychain document that holds the Claude subscription credential. */
const CLAUDE_OAUTH_KEY = "claudeAiOauth";

/**
 * The credential a store holds, as an opaque value plus the siblings sitting beside it.
 *
 * @internal — the shape {@link readClaudeCredential} returns and the five bounded readers consume; callers
 *   thread it between those rather than constructing one.
 */
export interface ClaudeCredentialSlice {
  /** The account credential, opaque — never inspected, never rendered. */
  readonly credential: unknown;
}

/**
 * Take the Claude credential out of one store's decoded document.
 *
 * @param document the decoded keychain document for a store, or undefined when the item is absent
 * @returns the credential slice, or undefined when the document holds no Claude credential at all
 */
export function readClaudeCredential({ document }: { document: unknown }): ClaudeCredentialSlice | undefined {
  if (!isRecord(document)) {
    return undefined;
  }
  const credential = document[CLAUDE_OAUTH_KEY];
  if (credential === undefined || credential === null) {
    return undefined;
  }
  return { credential };
}

/**
 * When one store's credential expires, read out of the credential itself.
 *
 * The credential is otherwise opaque here on purpose, and this is one of the five narrow exceptions the file
 * overview names rather than a loosening of it: `expiresAt` is a timestamp, not a secret, and the function
 * can return nothing else — it reads a single named field, checks it is a number, and hands back an
 * instant. Nothing here can reach the access or refresh token.
 *
 * It earns that exception by being the only falsifiable witness a refresh attempt has. MEASURED: a
 * keep-alive tick reported three stores "refreshed" while the keychain modification date on every one of them
 * had not moved, because the refresh command is a REPAIR and correctly does nothing to a credential that is
 * still healthy. Without this field a caller can only report that it ran a command; with it, it reports how
 * much life each store actually has, which is what `credentialRepair.ts`'s witness is built on.
 *
 * @param slice the credential slice read out of a store's document, when it holds one
 * @returns the expiry instant, ISO-8601, or undefined when the credential carries no usable one
 */
export function credentialExpiryIso({ slice }: { slice: ClaudeCredentialSlice | undefined }): string | undefined {
  return epochFieldIso({ field: "expiresAt", slice });
}

/**
 * An epoch-millisecond instant as ISO-8601, or undefined when it is not a representable one.
 *
 * The range check is the point and it is not paranoia: `Number.isFinite(8.64e15 + 1)` is true and
 * `new Date(8.64e15 + 1).toISOString()` throws `RangeError` — verified by running it — so a
 * finiteness test alone lets a reader whose contract is "an instant or undefined" throw instead. Checking the
 * constructed `Date` rather than the number covers every way out of range, including a value that overflows
 * only after the conversion.
 *
 * @param milliseconds the epoch-millisecond value read out of a credential field
 * @returns the instant, ISO-8601, or undefined when it is not representable
 */
function millisecondsToIso({ milliseconds }: { milliseconds: number }): string | undefined {
  const instant = new Date(milliseconds);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

/**
 * One epoch-millisecond field of a credential, as an instant.
 *
 * The value is epoch MILLISECONDS as the provider writes it, so it is not scaled — `epochSecondsToIso` is
 * for a seconds-valued field and using it here would put every expiry tens of thousands of years out. A
 * non-numeric value is refused rather than coerced, so a future build writing a STRING reads as unknown.
 *
 * **A seconds-valued NUMBER is not detected, and the two callers it reaches go opposite ways.** Codex review
 * pass supplied the value: the repair does not simply decline. `1791720012` passes every check here and comes back as `1970-01-21T17:42:00.012Z`. On
 * the REFRESH expiry that reads as a dead grant and the repair declines. On the ACCESS expiry it reads as
 * long-expired, so a refused store with a live grant is ATTEMPTED — one extra `claude --safe-mode mcp list`,
 * which the CLI either no-ops or uses to refresh the store properly. Neither path writes anything false and
 * neither is silent, so the honest statement is worth more than a plausibility floor this module would have to
 * invent: no provider field in this document has ever been seconds-valued, and inventing a lower bound would be
 * a policy this code has no measurement behind.
 *
 * @param field the credential field to read
 * @param slice the credential slice read out of a store's document, when it holds one
 * @returns the instant, ISO-8601, or undefined when the field is absent, mistyped or out of range
 */
function epochFieldIso({
  field,
  slice,
}: {
  field: "expiresAt" | "refreshTokenExpiresAt";
  slice: ClaudeCredentialSlice | undefined;
}): string | undefined {
  const credential = slice?.credential;
  if (!isRecord(credential)) {
    return undefined;
  }
  const value = credential[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return millisecondsToIso({ milliseconds: value });
}

/**
 * When one store's REFRESH GRANT expires — the instant after which no refresh can repair it and only the
 * owner's own browser can.
 *
 * This is the number that actually decides when the owner must sign in again, and it is easy to leave unread. The file overview carries the measurement and why its absence mattered. It is the third
 * of the five bounded exceptions to the opacity rule, and it earns it the same way the others do: it returns
 * an instant, which no token fits into.
 *
 * An absent, mistyped or out-of-range value answers undefined, which callers must read as UNKNOWN rather than
 * as permission — an unreadable deadline is not evidence that a grant is alive.
 *
 * @param slice the credential slice read out of a store's document, when it holds one
 * @returns the refresh grant's expiry instant, ISO-8601, or undefined when the credential carries no usable one
 */
export function credentialRefreshExpiryIso({
  slice,
}: {
  slice: ClaudeCredentialSlice | undefined;
}): string | undefined {
  return epochFieldIso({ field: "refreshTokenExpiresAt", slice });
}

/**
 * Whether a store's credential carries a refresh token at all.
 *
 * The fourth bounded exception, and the companion {@link credentialRefreshExpiryIso} needs: a deadline in the
 * future says nothing if there is no grant to present against it. The empty-string case is exactly the one
 * {@link credentialHasAccessToken} was written for — `claude doctor` wrote back a credential whose tokens were
 * the empty string — and an empty refresh token is the same shape one step further on: a store
 * no refresh can repair, needing one browser sign-in.
 *
 * @param slice the credential slice read out of a store's document, when it holds one
 * @returns true when there is a non-empty refresh token to present
 */
export function credentialHasRefreshToken({ slice }: { slice: ClaudeCredentialSlice | undefined }): boolean {
  const credential = slice?.credential;
  return isRecord(credential) && typeof credential["refreshToken"] === "string" && credential["refreshToken"] !== "";
}

/**
 * Whether a store's credential carries an access token at all.
 *
 * One of the five narrow exceptions the file overview names, and it earns it the same way
 * {@link credentialExpiryIso} does: it can return nothing but a boolean, so it cannot leak what it looked at. Choosing the weaker
 * capability that still answers the question is the point.
 *
 * The question is worth one function because an EMPTIED credential is a state of its own, and neither of the
 * two obvious readings is right. MEASURED on one machine: `claude doctor` under `plan-two`
 * and `plan-three` exited 0, moved the keychain item's modification date, and wrote back a credential whose
 * access token is the empty string — the shape a store is left in when its refresh token has been
 * superseded. An empty string is still a `string`, so a guard that only checks the type presents `Bearer `
 * to the provider and spends a request to be told 401; and a store in that state does not repair on the
 * next touch, it needs one browser sign-in. Both surfaces must agree on that, which is why they now read it
 * from here rather than each keeping a copy.
 *
 * @param slice the credential slice read out of a store's document, when it holds one
 * @returns true when there is a non-empty access token to present in the first place
 */
export function credentialHasAccessToken({ slice }: { slice: ClaudeCredentialSlice | undefined }): boolean {
  const credential = slice?.credential;
  return isRecord(credential) && typeof credential["accessToken"] === "string" && credential["accessToken"] !== "";
}

/**
 * Whether a store's credential was granted one OAuth scope.
 *
 * The fifth bounded exception, and it earns it the same way: it returns a boolean. `claude reset` needs it because
 * the free-reset endpoints refuse a login without `user:profile` — an inference-only setup token was answered
 * `403 oauth_scope_insufficient` — so a candidate is ruled out before a request
 * is spent on it. `scopes` is a list of scope names, never a secret.
 *
 * @param slice the credential slice read out of a store's document, when it holds one
 * @param scope the scope name to look for
 * @returns true when the credential's `scopes` list names it
 */
export function credentialHasScope({
  scope,
  slice,
}: {
  scope: string;
  slice: ClaudeCredentialSlice | undefined;
}): boolean {
  const credential = slice?.credential;
  if (!isRecord(credential)) {
    return false;
  }
  const scopes = credential["scopes"];
  return Array.isArray(scopes) && scopes.includes(scope);
}

/**
 * Whether the target already holds this exact credential, so a swap can be skipped.
 *
 * Compared by serialised value rather than by reference, because the two documents are decoded separately
 * from two keychain items and are never the same object.
 *
 * @param document the decoded target document
 * @param slice the credential a swap would install
 * @returns true when writing would change nothing
 */
export function alreadyHolds({ document, slice }: { document: unknown; slice: ClaudeCredentialSlice }): boolean {
  const current = readClaudeCredential({ document });
  if (current === undefined) {
    return false;
  }
  return JSON.stringify(current.credential) === JSON.stringify(slice.credential);
}
