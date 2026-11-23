/**
 * The typed failures of resolving a Datadog configuration from the environment and proving its two keys
 * answer — `config.ts` and `verifyCredentials.ts`.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside the query, domain and citation unions
 * rather than inside one of them: nothing that resolves a key also reads a response. A variant carrying
 * `reasons` keeps one line per problem, and {@link datadogConfigErrorLines} is how a caller prints them
 * without re-composing the joined `message`.
 *
 * No variant carries a credential's value, and no message quotes one — a length and a shape label only.
 *
 * Pure: values in, values out.
 */

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** One credential variable, named, with the issuer's shape it is held to. */
interface CredentialError<C extends string> extends Plain<C> {
  readonly name: string;
  readonly shapeLabel: string;
}

/** A key Datadog itself refused, with the status and site it answered from. */
interface KeyRejectedError<C extends string> extends Listed<C> {
  readonly status: number;
  readonly site: string;
}

/** Every way resolving or verifying a Datadog configuration can fail. */
export type DatadogConfigError =
  | CredentialError<"CREDENTIAL_MISSING">
  | (CredentialError<"CREDENTIAL_MALFORMED"> & { readonly length: number })
  | Listed<"CONFIG_INVALID">
  | (Plain<"SITE_MISSING"> & { readonly acceptedSites: readonly string[] })
  | (Plain<"SITE_INVALID"> & { readonly value: string; readonly acceptedSites: readonly string[] })
  | (Plain<"API_KEY_REPORTED_INVALID"> & { readonly site: string })
  | KeyRejectedError<"API_KEY_REJECTED">
  | KeyRejectedError<"APP_KEY_REJECTED">
  | (Listed<"CREDENTIALS_UNREACHABLE"> & { readonly apiHost: string; readonly detail: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DatadogConfigErrors = {
  apiKeyRejected: ({
    status,
    site,
    reasons,
  }: {
    status: number;
    site: string;
    reasons: readonly string[];
  }): DatadogConfigError => ({ ...listed({ code: "API_KEY_REJECTED", reasons }), site, status }),
  apiKeyReportedInvalid: ({ site }: { site: string }): DatadogConfigError => ({
    code: "API_KEY_REPORTED_INVALID",
    message: `Datadog reported DD_API_KEY as invalid at ${site}, without refusing the request`,
    site,
  }),
  appKeyRejected: ({
    status,
    site,
    reasons,
  }: {
    status: number;
    site: string;
    reasons: readonly string[];
  }): DatadogConfigError => ({ ...listed({ code: "APP_KEY_REJECTED", reasons }), site, status }),
  configInvalid: ({ reasons }: { reasons: readonly string[] }): DatadogConfigError =>
    listed({ code: "CONFIG_INVALID", reasons }),
  credentialMalformed: ({
    name,
    length,
    shapeLabel,
  }: {
    name: string;
    length: number;
    shapeLabel: string;
  }): DatadogConfigError => ({
    code: "CREDENTIAL_MALFORMED",
    length,
    message: `${name} is set (${String(length)} chars) but is not ${shapeLabel} — re-issue it rather than editing it`,
    name,
    shapeLabel,
  }),
  credentialMissing: ({
    name,
    secretName,
    shapeLabel,
  }: {
    name: string;
    secretName: string;
    shapeLabel: string;
  }): DatadogConfigError => ({
    code: "CREDENTIAL_MISSING",
    message: `${name} is not set — store it with \`slopweaver secrets set ${secretName}\`, or export ${name} (${shapeLabel})`,
    name,
    shapeLabel,
  }),
  credentialsUnreachable: ({ apiHost, detail }: { apiHost: string; detail: string }): DatadogConfigError => ({
    ...listed({
      code: "CREDENTIALS_UNREACHABLE",
      reasons: [
        `could not reach Datadog at ${apiHost}: ${detail}`,
        "This is a connectivity failure, not a credential one — the keys were never checked",
      ],
    }),
    apiHost,
    detail,
  }),
  siteInvalid: ({ value, acceptedSites }: { value: string; acceptedSites: readonly string[] }): DatadogConfigError => ({
    acceptedSites,
    code: "SITE_INVALID",
    message: `DD_SITE is '${value}', which is not a Datadog site. Expected one of: ${acceptedSites.join(", ")}`,
    value,
  }),
  siteMissing: ({ acceptedSites }: { acceptedSites: readonly string[] }): DatadogConfigError => ({
    acceptedSites,
    code: "SITE_MISSING",
    message: `DD_SITE is not set, and it has no safe default — the SDK would fall back to datadoghq.com (US1), a different org that answers queries with silence rather than an error. Set profile.json's datadog.site (or export DD_SITE) to your org's site, one of: ${acceptedSites.join(", ")}`,
  }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the verb printed them before it had a type:
 * a list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function datadogConfigErrorLines({ error }: { error: DatadogConfigError }): readonly string[] {
  if (
    error.code === "CONFIG_INVALID" ||
    error.code === "API_KEY_REJECTED" ||
    error.code === "APP_KEY_REJECTED" ||
    error.code === "CREDENTIALS_UNREACHABLE"
  ) {
    return error.reasons;
  }
  return [error.message];
}
