/**
 * The typed failures of the 1Password Events API half — resolving its token and host in `credentials.ts`,
 * and every request, status and body `eventsClient.ts` refuses.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside the `op` and generation unions: nothing
 * that reads the Events API also runs `op` or writes a generation. A variant carrying `reasons` keeps one
 * line per problem, and {@link onepasswordEventsErrorLines} is how a caller prints them without
 * re-composing the joined `message`.
 *
 * No variant carries the token, the configured host, a URL, a header or a response body — a variable NAME,
 * a token LENGTH, a request method and a path only. The bearer travels in a header, never in the path.
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

/** Every way resolving the Events API credential or reading the Events API can fail. */
export type OnepasswordEventsError =
  | (Plain<"TOKEN_UNSET"> & { readonly name: string })
  | (Plain<"TOKEN_LENGTH_IMPLAUSIBLE"> & { readonly name: string; readonly length: number })
  | (Plain<"TOKEN_HAS_WHITESPACE"> & { readonly name: string })
  | (Plain<"HOST_NOT_BARE"> & { readonly name: string; readonly example: string })
  | (Plain<"REQUEST_FAILED"> & { readonly method: string; readonly path: string })
  | (Listed<"HTTP_REFUSED"> & { readonly path: string; readonly status: number })
  | Plain<"RESPONSE_CHANGED">
  | (Plain<"ENDPOINT_UNLISTED"> & { readonly surface: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** A non-2xx in this atlas's own words, without ever echoing the response body. */
function refusalLines({ path, status }: { path: string; status: number }): readonly string[] {
  if (status === 401) {
    return [
      `${path} returned HTTP 401 — the Events API token was refused`,
      "either the token is wrong, it has expired, or the account is served from a different region than ONEPASSWORD_EVENTS_HOST names",
    ];
  }
  if (status === 403) {
    return [
      `${path} returned HTTP 403 — this token was not issued with the event family this surface needs`,
      "re-issue it at 1Password.com → Integrations → Events Reporting with that family ticked",
    ];
  }
  return [`${path} returned HTTP ${String(status)}`];
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const OnepasswordEventsErrors = {
  endpointUnlisted: ({ surface }: { surface: string }): OnepasswordEventsError => ({
    code: "ENDPOINT_UNLISTED",
    message: `the ${surface} surface is not in the closed endpoint allowlist`,
    surface,
  }),
  hostNotBare: ({ name, example }: { name: string; example: string }): OnepasswordEventsError => ({
    code: "HOST_NOT_BARE",
    example,
    message: `${name} is not a bare hostname — set it to something like ${example}, with no scheme and no path`,
    name,
  }),
  httpRefused: ({ path, status }: { path: string; status: number }): OnepasswordEventsError => ({
    ...listed({ code: "HTTP_REFUSED", reasons: refusalLines({ path, status }) }),
    path,
    status,
  }),
  /** The page's strict boundary refused it; `message` is the boundary's own, naming a key and never a value. */
  responseChanged: ({ message }: { message: string }): OnepasswordEventsError => ({
    code: "RESPONSE_CHANGED",
    message,
  }),
  requestFailed: ({
    method,
    path,
    cause,
  }: {
    method: string;
    path: string;
    cause: unknown;
  }): OnepasswordEventsError => ({
    code: "REQUEST_FAILED",
    message: `${method} ${path} failed: ${errorMessage({ error: cause })}`,
    method,
    path,
  }),
  tokenHasWhitespace: ({ name }: { name: string }): OnepasswordEventsError => ({
    code: "TOKEN_HAS_WHITESPACE",
    message: `${name} is set but contains whitespace, which is not part of any token 1Password issues — re-copy it`,
    name,
  }),
  tokenLengthImplausible: ({ name, length }: { name: string; length: number }): OnepasswordEventsError => ({
    code: "TOKEN_LENGTH_IMPLAUSIBLE",
    length,
    message: `${name} is set (${String(length)} chars) but is not a plausible token length — re-issue it rather than editing it`,
    name,
  }),
  tokenUnset: ({ name }: { name: string }): OnepasswordEventsError => ({
    code: "TOKEN_UNSET",
    message: `${name} is not set — mint a token at 1Password.com → Integrations → Events Reporting, then: slopweaver secrets set onepassword-events-token`,
    name,
  }),
} as const;

/**
 * The lines one failure prints, exactly as the Events half returned them before it had a type: a
 * list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function onepasswordEventsErrorLines({ error }: { error: OnepasswordEventsError }): readonly string[] {
  if (error.code === "HTTP_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
