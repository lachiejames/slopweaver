/**
 * The two credentials this atlas can hold, resolved from an environment.
 *
 * They are separate on purpose, and the separation is the security design rather than a packaging choice:
 *
 * - The **Events API token** is a read-only bearer token minted per integration, scoped to a chosen subset
 *   of event families and given an expiry at mint time. There is no endpoint behind it that returns an
 *   item's contents, so this credential is structurally incapable of the thing this atlas guards against.
 * - The **administrative `op` session** is the only route to the roster — no 1Password API exposes users,
 *   groups, or vault permissions read-only. It is therefore the credential worth being careful with, and
 *   `opCli.ts` is careful with it by never running an argv the closed allowlist did not produce.
 *
 * Either may be absent. An atlas with only the Events API token still publishes an events generation and
 * declares every roster surface `not-configured`, which is the honest state rather than a failure.
 *
 * Nothing here ever reaches a credential value into an error message, only its length.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type OnepasswordEventsError, OnepasswordEventsErrors, onepasswordEventsErrorLines } from "./eventsErrors.js";
import { OnepasswordOpErrors, onepasswordOpErrorLines } from "./opErrors.js";

/**
 * The Events API bearer token. Minted at 1Password.com → Integrations → Events Reporting → Add a token.
 *
 * @internal
 */
export const ONEPASSWORD_EVENTS_TOKEN_ENV = "ONEPASSWORD_EVENTS_TOKEN";

/**
 * The Events API host for this account's region, without a scheme.
 *
 * A variable rather than a constant because 1Password serves the Events API from a per-region host and an
 * account on the wrong one gets a 401 that reads exactly like a bad token. Defaulted rather than required,
 * since the commercial host is the common case.
 *
 * @internal
 */
export const ONEPASSWORD_EVENTS_HOST_ENV = "ONEPASSWORD_EVENTS_HOST";

/**
 * The default Events API host — 1Password's commercial region.
 *
 * @internal
 */
export const ONEPASSWORD_DEFAULT_EVENTS_HOST = "events.1password.com";

/**
 * The variable naming an account shorthand other than the atlas default, for an install whose atlas account carries another one.
 *
 * @internal
 */
export const ONEPASSWORD_ACCOUNT_ENV = "ONEPASSWORD_ACCOUNT";

/**
 * The shorthand the dedicated atlas account carries in `~/.config/op/config`, the one every documented sign-in
 * names. Every `op` call is pinned to it, so a session for any other account is never taken for the atlas's.
 */
const ONEPASSWORD_DEFAULT_ACCOUNT = "atlas";

/** Below this, a value is a placeholder or a truncation rather than a real credential. */
const MIN_TOKEN_LENGTH = 20;

/** Above this, a value is more likely a pasted token dump than a single credential. */
const MAX_TOKEN_LENGTH = 4096;

/** A verified-shape Events API credential. */
export interface OnepasswordEventsCredentials {
  readonly host: string;
  readonly token: string;
}

/**
 * Resolve the Events API credential, or say precisely what is wrong with it.
 *
 * @param env the environment to read — passed in, never reached for, so this stays pure
 * @returns the verified credential, or every reason it could not be resolved
 */
export function resolveOnepasswordEventsCredentials({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<OnepasswordEventsCredentials> {
  const raw = env[ONEPASSWORD_EVENTS_TOKEN_ENV];
  if (raw === undefined || raw.trim() === "") {
    return err(
      onepasswordEventsErrorLines({
        error: OnepasswordEventsErrors.tokenUnset({ name: ONEPASSWORD_EVENTS_TOKEN_ENV }),
      }),
    );
  }
  const token = raw.trim();
  const problems: OnepasswordEventsError[] = [];
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    problems.push(
      OnepasswordEventsErrors.tokenLengthImplausible({ length: token.length, name: ONEPASSWORD_EVENTS_TOKEN_ENV }),
    );
  }
  if (/\s/.test(token)) {
    problems.push(OnepasswordEventsErrors.tokenHasWhitespace({ name: ONEPASSWORD_EVENTS_TOKEN_ENV }));
  }
  const host = eventsHostFrom({ env });
  if (host === "" || /[^A-Za-z0-9.-]/.test(host)) {
    problems.push(
      OnepasswordEventsErrors.hostNotBare({
        example: ONEPASSWORD_DEFAULT_EVENTS_HOST,
        name: ONEPASSWORD_EVENTS_HOST_ENV,
      }),
    );
  }
  if (problems.length > 0) {
    return err(problems.flatMap((error) => onepasswordEventsErrorLines({ error })));
  }
  return ok({ host, token });
}

/**
 * The Events API host an environment names, trimmed. Unset means 1Password's commercial region, the common
 * case {@link ONEPASSWORD_EVENTS_HOST_ENV} is defaulted for; a SET value, blank included, is the caller's to
 * validate.
 */
function eventsHostFrom({ env }: { env: Readonly<Record<string, string | undefined>> }): string {
  const configured = env[ONEPASSWORD_EVENTS_HOST_ENV];
  if (configured === undefined) {
    return ONEPASSWORD_DEFAULT_EVENTS_HOST;
  }
  return configured.trim();
}

/**
 * Resolve which locally-configured 1Password account `op` should act as.
 *
 * Unset means the dedicated atlas account, {@link ONEPASSWORD_DEFAULT_ACCOUNT}, never whichever account `op`
 * would pick: a session for another account would otherwise pass `op whoami` and sync the wrong roster. What
 * is NOT legitimate is a value carrying shell metacharacters — this ends up in an argv, so it is validated as an
 * opaque token here rather than trusted downstream.
 *
 * @param env the environment to read — passed in, never reached for, so this stays pure
 * @returns the account shorthand, the atlas default when unset, or why the value was refused
 */
export function resolveOnepasswordAccount({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<string> {
  const raw = env[ONEPASSWORD_ACCOUNT_ENV];
  if (raw === undefined || raw.trim() === "") {
    return ok(ONEPASSWORD_DEFAULT_ACCOUNT);
  }
  const account = raw.trim();
  if (!/^[A-Za-z0-9._@-]{1,128}$/.test(account)) {
    return err(
      onepasswordOpErrorLines({ error: OnepasswordOpErrors.accountMalformed({ name: ONEPASSWORD_ACCOUNT_ENV }) }),
    );
  }
  return ok(account);
}

/**
 * The one step that gives the roster half a session with nobody at a terminal, as every sign-in hint words it.
 *
 * The atlas account is CLI-only — the desktop app refuses a second account on the same team — so the step is
 * never "add it to the app".
 */
export const ONEPASSWORD_SIGNIN_STEP =
  "the atlas account is CLI-only: store its password once with `slopweaver secrets set onepassword-atlas-password` (the dedicated Slopweaver account's item in 1Password), then sync again";
