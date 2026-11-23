/**
 * The KnowBe4 door's one way to the network: a GET, to KnowBe4's US Reporting API origin, on a path the closed
 * call list names, with only the query keys that path is read with. Nothing else is expressible here.
 *
 * Read-only by the owner's ask: nothing in KnowBe4 is changed. The Reporting API is
 * GET-only today, but the token is an account credential, so the method is a TYPE with one member and a URL is
 * refused before any call when it names a path or a query key this door never chose.
 *
 * The origin is a constant, not a setting: Acme's console is `training.knowbe4.com`, whose Reporting API is
 * `us.api.knowbe4.com` (KnowBe4's regional table: us, eu, ca, uk, de). A stored host would be one more place a
 * token could be pointed somewhere else, and there is no second region to serve. If one ever appears, it is a
 * closed region enum in its own change, never a free-text host.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type Knowbe4ReadError, Knowbe4ReadErrors } from "./errors.js";

/** The only HTTP method this door sends. A second member here is the read-only ask broken. */
type Knowbe4HttpMethod = "GET";

/** KnowBe4's US Reporting API origin — the region `training.knowbe4.com` implies. The token goes nowhere else. */
export const KNOWBE4_API_ORIGIN = "https://us.api.knowbe4.com";

/** How long one GET may take before it fails, so a stalled response cannot hang the run. Trelica's too. */
const KNOWBE4_REQUEST_TIMEOUT_MS = 30_000;

/** The paging keys every list read sends; `/v1/account` is one object and sends none. */
const PAGING = ["page", "per_page"] as const;

/**
 * Every path this door reads, `{id}` standing for one numeric KnowBe4 id, mapped to the only query keys that
 * path is read with. The closed call list: a path or key outside this table is refused before the token leaves
 * the process.
 */
const TEMPLATE_QUERY_KEYS = {
  "/v1/account": [],
  "/v1/groups": PAGING,
  "/v1/groups/{id}/members": PAGING,
  "/v1/phishing/campaigns": PAGING,
  "/v1/phishing/security_tests": PAGING,
  "/v1/phishing/security_tests/{id}/recipients": PAGING,
  // KnowBe4: any `exclude_percentages` other than `true` caps this list at TEN rows, so a read always sends it.
  "/v1/training/campaigns": [...PAGING, "exclude_percentages"],
  "/v1/training/enrollments": [...PAGING, "exclude_archived_users", "include_campaign_id", "include_store_purchase_id"],
  "/v1/training/policies": PAGING,
  "/v1/training/store_purchases": PAGING,
  "/v1/users": PAGING,
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** One closed-list path template. */
export type Knowbe4PathTemplate = keyof typeof TEMPLATE_QUERY_KEYS;

/** Every closed-list path template, sorted — what the descriptor's `reached` counts. */
export const KNOWBE4_PATH_TEMPLATES: readonly Knowbe4PathTemplate[] = Object.keys(TEMPLATE_QUERY_KEYS)
  .filter(isKnowbe4PathTemplate)
  .toSorted();

/**
 * Whether a string is one of the closed-list path templates.
 *
 * @param value any string, a key of the table or not
 * @returns `true` only for a template the table declares
 */
function isKnowbe4PathTemplate(value: string): value is Knowbe4PathTemplate {
  return Object.hasOwn(TEMPLATE_QUERY_KEYS, value);
}

/** A KnowBe4 id as it appears in a path: digits only, so no segment can carry a slash, a dot or an escape. */
const NUMERIC_ID = /^[0-9]+$/;

/**
 * Whether a URL is one {@link buildKnowbe4Url} could have built: KnowBe4's origin with no credentials or
 * fragment, a closed-list path with digits where `{id}` stands, and only that path's query keys.
 *
 * @param url the URL about to carry the token
 * @returns `true` only for a URL on the closed call list
 * @internal
 */
export function isClosedListUrl({ url }: { url: URL }): boolean {
  if (url.origin !== KNOWBE4_API_ORIGIN || url.username !== "" || url.password !== "" || url.hash !== "") {
    return false;
  }
  const template = KNOWBE4_PATH_TEMPLATES.find((each) =>
    new RegExp(`^${each.replace("{id}", "[0-9]+")}$`).test(url.pathname),
  );
  if (template === undefined) {
    return false;
  }
  const admitted: readonly string[] = TEMPLATE_QUERY_KEYS[template];
  return [...url.searchParams.keys()].every((name) => admitted.includes(name));
}

/** What a failure says instead when its own words quote the token. */
const TOKEN_QUOTED = "the request failed and its error quoted the token, so its words are withheld";

/**
 * A failure's words go to logs and coverage cells, so words that quote the token are withheld whole rather than
 * edited. The fixed sentence has no run of more than eight non-space characters, and the reader refuses a token
 * shorter than `KNOWBE4_TOKEN_MIN_LENGTH` or holding a space, so the sentence can never contain one.
 *
 * @param message the failure's own words
 * @param token the bearer token the request carried
 * @returns the words unchanged, or the fixed sentence when they quote the token anywhere
 */
export function tokenWithheld({ message, token }: { message: string; token: string }): string {
  return message.includes(token) ? TOKEN_QUOTED : message;
}

/**
 * Build the URL for one read, refusing anything outside the closed call list.
 *
 * The template is filled by substitution of a digits-only id, and the built URL is checked again AFTER the URL
 * parser has normalised it, so neither a dot segment nor a percent-encoded one can walk out.
 *
 * @param template which closed-list path to read
 * @param id the parent's numeric id, for a template carrying `{id}`; omitted for one that does not
 * @param query the query to send — only keys this template is read with
 * @returns the URL, or `PATH_REFUSED`
 */
export function buildKnowbe4Url({
  template,
  id,
  query,
}: {
  template: Knowbe4PathTemplate;
  id?: string;
  query: Readonly<Record<string, string>>;
}): Result<URL, Knowbe4ReadError> {
  const wantsId = template.includes("{id}");
  if (wantsId && (id === undefined || !NUMERIC_ID.test(id))) {
    return err(Knowbe4ReadErrors.pathRefused({ path: template, why: "the parent id is not a KnowBe4 numeric id" }));
  }
  if (!wantsId && id !== undefined) {
    return err(Knowbe4ReadErrors.pathRefused({ path: template, why: "this path takes no parent id" }));
  }
  const admitted: readonly string[] = TEMPLATE_QUERY_KEYS[template];
  const unknownKey = Object.keys(query).find((name) => !admitted.includes(name));
  if (unknownKey !== undefined) {
    return err(
      Knowbe4ReadErrors.pathRefused({
        path: template,
        why: `query parameter ${unknownKey} is not one this path is read with`,
      }),
    );
  }
  const expected = id === undefined ? template : template.replace("{id}", id);
  const url = new URL(expected, KNOWBE4_API_ORIGIN);
  if (url.origin !== KNOWBE4_API_ORIGIN || url.pathname !== expected) {
    return err(Knowbe4ReadErrors.pathRefused({ path: url.pathname, why: "the path leaves the closed call list" }));
  }
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  return ok(url);
}

/**
 * The read seam the sync is written against: production is {@link knowbe4Get}, a test passes a fake. It answers
 * the body's TEXT; the fill parses it next to the endpoint's strict boundary, so this module only fetches.
 */
export type Knowbe4Get = (request: { url: URL }) => Promise<Result<string, Knowbe4ReadError>>;

/** A non-2xx, carried in the shape `toIngestError` reads a status and a `retry-after` off. */
class Knowbe4HttpStatusError extends Error {
  readonly status: number;
  readonly response: { readonly status: number; readonly headers: Readonly<Record<string, string>> };

  /**
   * @param status the HTTP status KnowBe4 answered
   * @param headers its response headers, lower-cased by `fetch`
   * @param path the request path, for the message — never the query or the token
   */
  constructor({ status, headers, path }: { status: number; headers: Readonly<Record<string, string>>; path: string }) {
    super(`KnowBe4 answered ${status} on ${path}`);
    this.status = status;
    this.response = { headers, status };
  }
}

/**
 * Send ONE GET through the paced provider door, with the token as a bearer header.
 *
 * @param token the Reporting API token, read from `$SLOPWEAVER_HOME/secrets/knowbe4-api-token`
 * @param url a URL {@link buildKnowbe4Url} built — the only way this module makes one
 * @param scopeId the shared rate scope, already hashed from the token
 * @returns the body's text, for the fill to parse and a per-endpoint boundary to read, or why it failed
 */
export async function knowbe4Get({
  token,
  url,
  scopeId,
}: {
  token: string;
  url: URL;
  scopeId: string;
}): Promise<Result<string, Knowbe4ReadError>> {
  // Checked again HERE, at the send, so a URL from anywhere but `buildKnowbe4Url` never carries the token.
  if (!isClosedListUrl({ url })) {
    return err(
      Knowbe4ReadErrors.pathRefused({ path: url.pathname, why: "the URL is not one the closed call list builds" }),
    );
  }
  const method: Knowbe4HttpMethod = "GET";
  const answered = await safeProviderCall({
    execute: async () => {
      // `redirect: "error"`: a 3xx would be KnowBe4 sending the bearer somewhere this door never chose.
      const response = await fetch(url, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(KNOWBE4_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Knowbe4HttpStatusError({
          headers: Object.fromEntries(response.headers.entries()),
          path: url.pathname,
          status: response.status,
        });
      }
      return response.text();
    },
    // One attempt per GET, so the run's request ceiling counts every request that reaches KnowBe4, never a quarter.
    maxAttempts: 1,
    operation: "knowbe4.api.read",
    provider: "knowbe4",
    retryMode: "transient",
    scopeId,
  });
  if (answered.isErr()) {
    return err(
      Knowbe4ReadErrors.transportFailed({
        message: tokenWithheld({ message: answered.error.message, token }),
        status: unsetFieldAsNull({ key: "status", record: answered.error }),
      }),
    );
  }
  return ok(answered.value);
}
