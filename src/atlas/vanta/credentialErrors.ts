/**
 * The typed failures of resolving the Vanta credential pair and workspace slug, and of taking the token mint
 * lock — `credentials.ts`, `credentialFiles.ts`, `tenantSlug.ts` and `oauth.ts`'s lock.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside the HTTP, sync and evidence unions rather
 * than inside one of them: nothing that resolves a credential also reads a response. Each resolver offers a
 * typed export (`…Typed`) for a caller that DECIDES on the failure — {@link isVantaCredentialUnset} is what
 * picks a verb's "not configured" exit, by code — and a `readonly string[]` export for a caller that only
 * prints it. {@link vantaCredentialErrorLines} is the one place a failure becomes the lines it always printed.
 *
 * No variant carries a credential's value: an environment variable's NAME, a secret file's NAME, a flag or
 * route label, a filesystem path and a length, never what the file or variable holds.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** One credential file, by the label a refusal calls it and the path it was read from. */
interface CredentialFileError<C extends string> extends Plain<C> {
  readonly label: string;
  readonly path: string;
}

/** A slug refusal, naming the route (`--tenant`, the variable, the store file) it came from. */
interface TenantSlugError<C extends string> extends Plain<C> {
  readonly route: string;
}

/** Every way resolving a Vanta credential, a workspace slug or the mint lock can fail. */
export type VantaCredentialError =
  | (Plain<"CREDENTIAL_UNSET"> & { readonly name: string; readonly secretName: string | undefined })
  | (Plain<"CREDENTIAL_IMPLAUSIBLE_LENGTH"> & { readonly name: string; readonly length: number })
  | (Plain<"CREDENTIAL_HAS_WHITESPACE"> & { readonly name: string })
  | Plain<"CREDENTIAL_FILES_UNPAIRED">
  | (Plain<"CREDENTIAL_STORE_HALF_POPULATED"> & { readonly present: string; readonly missing: string })
  | CredentialFileError<"CREDENTIAL_FILE_NOT_REGULAR">
  | CredentialFileError<"CREDENTIAL_FILE_NOT_OWNER_ONLY">
  | (CredentialFileError<"CREDENTIAL_FILE_UNREADABLE"> & { readonly cause: unknown })
  | TenantSlugError<"TENANT_SLUG_EMPTY">
  | TenantSlugError<"TENANT_SLUG_MALFORMED">
  | (Listed<"TENANT_SLUG_UNSET"> & { readonly envName: string; readonly secretName: string })
  | (Plain<"TENANT_SLUG_UNREADABLE"> & { readonly secretName: string; readonly path: string; readonly cause: unknown })
  | (Plain<"MINT_LOCK_HELD"> & { readonly holder: string });

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VantaCredentialErrors = {
  credentialFilesUnpaired: (): VantaCredentialError => ({
    code: "CREDENTIAL_FILES_UNPAIRED",
    message: "--client-id-file and --client-secret-file must be supplied together",
  }),
  credentialHasWhitespace: ({ name }: { name: string }): VantaCredentialError => ({
    code: "CREDENTIAL_HAS_WHITESPACE",
    message: `${name} is set but contains whitespace, which is not part of any credential Vanta issues — re-copy it`,
    name,
  }),
  credentialImplausibleLength: ({ name, length }: { name: string; length: number }): VantaCredentialError => ({
    code: "CREDENTIAL_IMPLAUSIBLE_LENGTH",
    length,
    message: `${name} is set (${String(length)} chars) but is not a plausible credential length — re-issue it rather than editing it`,
    name,
  }),
  credentialUnset: ({ name, secretName }: { name: string; secretName: string | undefined }): VantaCredentialError => {
    let storeRoute = "";
    if (secretName !== undefined) {
      storeRoute = `, or run: slopweaver secrets set ${secretName}`;
    }
    return {
      code: "CREDENTIAL_UNSET",
      message: `${name} is not set — export it${storeRoute} (Settings → Developer Console → your Manage Vanta application)`,
      name,
      secretName,
    };
  },
  fileNotOwnerOnly: ({ label, path }: { label: string; path: string }): VantaCredentialError => ({
    code: "CREDENTIAL_FILE_NOT_OWNER_ONLY",
    label,
    message: `${label} must be owner-only (mode 0600 or stricter): ${path}`,
    path,
  }),
  fileNotRegular: ({ label, path }: { label: string; path: string }): VantaCredentialError => ({
    code: "CREDENTIAL_FILE_NOT_REGULAR",
    label,
    message: `${label} does not name a regular file: ${path}`,
    path,
  }),
  fileUnreadable: ({ label, path, cause }: { label: string; path: string; cause: unknown }): VantaCredentialError => ({
    cause,
    code: "CREDENTIAL_FILE_UNREADABLE",
    label,
    message: `could not read ${label} at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  mintLockHeld: ({ holder }: { holder: string }): VantaCredentialError => ({
    code: "MINT_LOCK_HELD",
    holder,
    message: `could not acquire the Vanta token mint lock: ${holder}`,
  }),
  storeHalfPopulated: ({ present, missing }: { present: string; missing: string }): VantaCredentialError => ({
    code: "CREDENTIAL_STORE_HALF_POPULATED",
    message: `the secrets store holds ${present} but not ${missing} — the pair mints together, so run: slopweaver secrets set ${missing}`,
    missing,
    present,
  }),
  tenantSlugEmpty: ({ route }: { route: string }): VantaCredentialError => ({
    code: "TENANT_SLUG_EMPTY",
    message: `${route} is set but empty — it must be the workspace segment of your app.vanta.com URL`,
    route,
  }),
  tenantSlugMalformed: ({ route }: { route: string }): VantaCredentialError => ({
    code: "TENANT_SLUG_MALFORMED",
    message: `${route} is not a Vanta workspace slug — it is the single path segment after /c/ in your app.vanta.com URL`,
    route,
  }),
  tenantSlugUnreadable: ({
    secretName,
    path,
    cause,
  }: {
    secretName: string;
    path: string;
    cause: unknown;
  }): VantaCredentialError => ({
    cause,
    code: "TENANT_SLUG_UNREADABLE",
    message: `could not read secrets/${secretName} at ${path}: ${errorMessage({ error: cause })}`,
    path,
    secretName,
  }),
  tenantSlugUnset: ({ envName, secretName }: { envName: string; secretName: string }): VantaCredentialError => {
    const reasons = [
      `${envName} is not set — export it, pass --tenant, or run: slopweaver secrets set ${secretName}`,
      "the slug is the single path segment after /c/ in your app.vanta.com URL",
    ];
    return { code: "TENANT_SLUG_UNSET", envName, message: reasons.join("; "), reasons, secretName };
  },
} as const;

/**
 * The lines one failure prints, exactly as the resolver printed them before it had a type: a list-carrying
 * failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function vantaCredentialErrorLines({ error }: { error: VantaCredentialError }): readonly string[] {
  if (error.code === "TENANT_SLUG_UNSET") {
    return error.reasons;
  }
  return [error.message];
}

/**
 * Every failure's lines, in order — what a resolver that reports EVERY problem prints.
 *
 * @param errors the failures, in the order they were found
 * @returns the lines, in order
 */
export function vantaCredentialErrorsLines({ errors }: { errors: readonly VantaCredentialError[] }): readonly string[] {
  return errors.flatMap((error) => vantaCredentialErrorLines({ error }));
}

/**
 * Whether a failure is a value that is simply ABSENT — the credential pair or the workspace slug never
 * configured on this machine — rather than one that is present and wrong, unreadable or locked.
 *
 * A scheduled Vanta verb exits "expected empty" on exactly this, so it is decided by code: the sentence a
 * factory writes can be reworded without a verb flipping between "not configured" and "broken".
 *
 * @returns whether configuring the value is the whole repair
 */
export function isVantaCredentialUnset({ error }: { error: VantaCredentialError }): boolean {
  return error.code === "CREDENTIAL_UNSET" || error.code === "TENANT_SLUG_UNSET";
}
