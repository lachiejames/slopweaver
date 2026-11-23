/**
 * Vanta Manage API OAuth client-credentials, resolved from the environment.
 *
 * A pure `resolveVantaCredentials({ env })`, read by the command file at the point of use.
 *
 * Vanta's setup docs (https://developer.vanta.com/docs/api-access-setup) describe how a `client_id` and
 * `client_secret` are minted — Settings → Developer Console → create a "Manage Vanta" application — but
 * state no fixed prefix, length or character set for either value. Only the minted ACCESS TOKEN is
 * documented as prefixed. So these two are graded on presence and a plausible shape rather than an
 * invented prefix.
 *
 * Nothing here ever reaches a credential value into an error message, only its length.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { SecretName } from "../../secrets/names.js";
import { type VantaCredentialError, VantaCredentialErrors, vantaCredentialErrorsLines } from "./credentialErrors.js";

/** The client id, from a Vanta Manage Vanta application in Settings → Developer Console. */
export const VANTA_CLIENT_ID_ENV = "VANTA_CLIENT_ID";

/** The client secret paired with {@link VANTA_CLIENT_ID_ENV}. */
export const VANTA_CLIENT_SECRET_ENV = "VANTA_CLIENT_SECRET";

/** The secrets-store file `slopweaver secrets set` writes the client id to — the no-environment route. */
export const VANTA_CLIENT_ID_SECRET: SecretName = "vanta-client-id";

/** The secrets-store file paired with {@link VANTA_CLIENT_ID_SECRET}. */
export const VANTA_CLIENT_SECRET_SECRET: SecretName = "vanta-client-secret";

/** Which store file stands in for each environment variable, so a "not set" message can name both routes. */
const SECRET_FOR_ENV: Readonly<Record<string, SecretName>> = {
  [VANTA_CLIENT_ID_ENV]: VANTA_CLIENT_ID_SECRET,
  [VANTA_CLIENT_SECRET_ENV]: VANTA_CLIENT_SECRET_SECRET,
};

/** Below this, a value is a placeholder or a truncation rather than a real credential. */
const MIN_CREDENTIAL_LENGTH = 8;

/** Above this, a value is more likely a pasted token dump than a single credential. */
const MAX_CREDENTIAL_LENGTH = 512;

/** A verified-shape pair of Vanta Manage API credentials. */
export interface VantaCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Grade one required credential variable, accumulating a reason rather than throwing on the first miss.
 *
 * @param name the environment variable's name
 * @param raw the environment's value, or `undefined` when unset
 * @returns the trimmed value, or the typed reason it is unusable
 */
function requireVantaCredential({
  name,
  raw,
}: {
  name: string;
  raw: string | undefined;
}): Result<string, VantaCredentialError> {
  if (raw === undefined || raw.trim() === "") {
    return err(VantaCredentialErrors.credentialUnset({ name, secretName: SECRET_FOR_ENV[name] }));
  }
  const value = raw.trim();
  if (value.length < MIN_CREDENTIAL_LENGTH || value.length > MAX_CREDENTIAL_LENGTH) {
    return err(VantaCredentialErrors.credentialImplausibleLength({ length: value.length, name }));
  }
  if (/\s/.test(value)) {
    return err(VantaCredentialErrors.credentialHasWhitespace({ name }));
  }
  return ok(value);
}

/**
 * Resolve Vanta Manage API credentials from an environment, or say precisely what is wrong with it. EVERY
 * problem is reported, not just the first.
 *
 * @param env the environment to read — passed in, never reached for, so this stays pure
 * @returns the verified credentials, or every reason they could not be resolved
 */
export function resolveVantaCredentials({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<VantaCredentials> {
  return resolveVantaCredentialsTyped({ env }).mapErr((errors) => vantaCredentialErrorsLines({ errors }));
}

/**
 * {@link resolveVantaCredentials}, before its typed failures become the lines a caller prints — for a caller
 * that decides on WHICH failure it was.
 *
 * @param env the environment to read — passed in, never reached for, so this stays pure
 * @returns the verified credentials, or every typed reason they could not be resolved
 */
export function resolveVantaCredentialsTyped({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<VantaCredentials, readonly VantaCredentialError[]> {
  const clientId = requireVantaCredential({ name: VANTA_CLIENT_ID_ENV, raw: env[VANTA_CLIENT_ID_ENV] });
  const clientSecret = requireVantaCredential({ name: VANTA_CLIENT_SECRET_ENV, raw: env[VANTA_CLIENT_SECRET_ENV] });
  if (clientId.isErr() || clientSecret.isErr()) {
    return err([...(clientId.isErr() ? [clientId.error] : []), ...(clientSecret.isErr() ? [clientSecret.error] : [])]);
  }
  return ok({ clientId: clientId.value, clientSecret: clientSecret.value });
}
