/**
 * Proving both credentials work, before a verb blames its query for an auth failure.
 *
 * ## Why it takes TWO calls
 *
 * Neither endpoint alone can name the variable to fix:
 *
 * | `DD_API_KEY` | `DD_APP_KEY`          | `/api/v1/validate` | `/api/v2/permissions` |
 * | ------------ | --------------------- | ------------------ | --------------------- |
 * | good         | good                  | `200`              | `200`                 |
 * | **bad**      | good                  | `403`              | `403`                 |
 * | good         | **bad** (right length) | `200`              | `403`                 |
 * | good         | **missing/malformed** | `200`              | `401`                 |
 * | bad          | bad                   | `403`              | `403`                 |
 *
 * Two facts fall out of that table, and both are easy to get wrong in the obvious direction:
 *
 * 1. **`/api/v1/validate` ignores the application key entirely.** It answers `200` for a real API key even
 *    with a garbage app key attached. A preflight built on it alone reports a green environment on a
 *    machine whose app key is stale, and the failure then surfaces as a `401`/`403` from the first real
 *    query — which reads as "my query is wrong", the most expensive way to be misled here.
 * 2. **`/api/v2/permissions` needs both keys, but its `403` is ambiguous.** A bad API key and a
 *    well-formed-but-wrong app key both produce `403`, so a probe using only this endpoint has to guess
 *    which variable to name — and naming the wrong one sends the reader to re-issue a key that was fine.
 *
 * Used TOGETHER they disambiguate completely: `validate` isolates the API key, and `permissions` then
 * attributes anything still failing to the app key. Both endpoints have been observed unmetered — neither
 * returns any `x-ratelimit-*` header — so verifying on every invocation costs nothing against the tight
 * budgets `rateLimit.ts` describes. Probing on the logs aggregate endpoint instead would spend a real share
 * of a much tighter allowance proving the keys before asking anything.
 *
 * A `401` and a `403` from the permissions stage are reported differently because the remedies differ: a
 * `401` means the value is missing or not a key at all, a `403` means it is a key this org will not accept.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import { type DdSite, datadogKeyPages } from "./config.js";
import { type DatadogConfigError, DatadogConfigErrors } from "./configErrors.js";

/** What a successful verification establishes. Deliberately small — the point is that both keys work. */
export interface VerifiedCredentials {
  readonly site: string;
  readonly apiHost: string;
}

/**
 * An HTTP status carried by a thrown SDK error, or `null` when the throw never reached Datadog.
 *
 * A structural check on a NUMERIC `code`, not `instanceof ApiException`: Node's own network errors also
 * carry `code`, as a string (`'ENOTFOUND'`), and the numeric test separates "Datadog answered and refused"
 * from "nothing answered" without depending on class identity surviving the module graph.
 *
 * @param error the thrown value
 * @returns the HTTP status, or `null` when this was not an HTTP response at all
 */
export function httpStatusOf({ error }: { error: unknown }): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const { code } = error;
  return typeof code === "number" ? code : null;
}

/**
 * What a failing `/api/v1/validate` means. This stage sees ONLY the API key.
 *
 * @param status the HTTP status the validate call came back with
 * @param site the site the probe was aimed at — a key valid for another site fails exactly this way
 * @returns the reasons, most-likely-cause first
 */
export function classifyApiKeyFailure({ status, site }: { status: number; site: DdSite }): readonly string[] {
  if (status === 403) {
    return [
      `Datadog rejected DD_API_KEY (403 from ${site}). Re-issue it at ${datadogKeyPages({ site }).apiKeys}`,
      `A key that is valid for a DIFFERENT site fails identically — confirm DD_SITE is meant to be ${site}`,
    ];
  }
  return [`Datadog refused to validate DD_API_KEY with HTTP ${String(status)} from ${site}`];
}

/**
 * What a failing `/api/v2/permissions` means, GIVEN that `/api/v1/validate` already passed.
 *
 * That precondition is what makes this attributable: the API key has been proven good by the previous
 * stage, so whatever is still being refused is the application key.
 *
 * @param status the HTTP status the permissions call came back with
 * @param site the site the probe was aimed at
 * @returns the reasons, most-likely-cause first
 */
export function classifyAppKeyFailure({ status, site }: { status: number; site: DdSite }): readonly string[] {
  const reissue = `Create one at ${datadogKeyPages({ site }).appKeys}`;
  if (status === 401) {
    return [
      `DD_APP_KEY is missing or is not an application key (401 from ${site}), while DD_API_KEY verified fine. ${reissue}`,
    ];
  }
  if (status === 403) {
    return [
      `Datadog rejected DD_APP_KEY (403 from ${site}), while DD_API_KEY verified fine — so it is the application key that this org will not accept, not the API key. ${reissue}`,
    ];
  }
  return [
    `Datadog refused the application-key probe with HTTP ${String(status)} from ${site}, while DD_API_KEY verified fine`,
  ];
}

/**
 * Describe a throw that never got an HTTP answer.
 *
 * Its own class because "could not reach Datadog" and "Datadog said no" have completely different fixes,
 * and collapsing them is how a network outage gets diagnosed as a bad key.
 *
 * @param error the thrown value
 * @param apiHost the host that was not reached
 * @returns the typed failure
 */
function unreachable({ error, apiHost }: { error: unknown; apiHost: string }): DatadogConfigError {
  return DatadogConfigErrors.credentialsUnreachable({
    apiHost,
    detail: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Verify both credentials against Datadog.
 *
 * @param client the shared client
 * @returns what was verified, or every reason it could not be
 */
export async function verifyCredentials({
  client,
}: {
  client: DatadogClient;
}): Promise<Result<VerifiedCredentials, DatadogConfigError>> {
  const { site, apiHost } = client.config;

  try {
    const validation = await client.authentication.validate();
    // A `200` with `valid: false` has not been observed, but the field is optional in the response model
    // and treating a negative answer as a pass would be the one failure this whole module exists to
    // prevent.
    if (validation.valid === false) {
      return err(DatadogConfigErrors.apiKeyReportedInvalid({ site }));
    }
  } catch (error: unknown) {
    const status = httpStatusOf({ error });
    if (status === null) {
      return err(unreachable({ error, apiHost }));
    }
    return err(DatadogConfigErrors.apiKeyRejected({ reasons: classifyApiKeyFailure({ status, site }), site, status }));
  }

  try {
    await client.roles.listPermissions();
  } catch (error: unknown) {
    const status = httpStatusOf({ error });
    if (status === null) {
      return err(unreachable({ error, apiHost }));
    }
    return err(DatadogConfigErrors.appKeyRejected({ reasons: classifyAppKeyFailure({ status, site }), site, status }));
  }

  return ok({ site, apiHost });
}
