/**
 * The typed failures of talking to the Vanta Manage API — the transport (`transport.ts`), cursor pagination
 * (`pagination.ts`), the read client (`client.ts`), the write body parser (`writeTransport.ts`) and the token
 * endpoint's body (`oauth.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`.
 *
 * The HTTP layer, the token provider and the page walk carry it TYPED, as {@link VantaTransportFailure}, so
 * every decision downstream is made on `code`:
 * `noteIfUnauthorized` reads `HTTP_STATUS` and `status`, and `surfaceErrors.ts` grades a sync gap from the
 * code rather than from the sentence. {@link vantaHttpErrorLines} is where a failure becomes exactly the
 * lines it printed before it had a type, and the only place it does.
 *
 * No variant carries a request's headers, body, bearer token or raw path: a transport failure carries the
 * `safePath` already stripped of every secret the request sent. Pagination's `id` and `cursor` can echo a
 * token a page reflected back, so the client renders a walk's failure to lines and redacts every token the walk
 * presented before those lines go anywhere.
 *
 * Pure: values in, values out.
 */
import type { BoundaryError } from "#lib/boundary.js";
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

/** A failure naming the surface (or endpoint) that produced it. */
interface SurfaceError<C extends string> extends Plain<C> {
  readonly surface: string;
}

/** A body a schema refused: a header naming the surface, then one line per schema issue. */
type UnreadableError<C extends string> = Listed<C> & { readonly surface: string };

/** One schema issue, as zod reports it — a path of keys and a message naming the expected shape. */
export type VantaSchemaIssues = readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];

/** Every way a Vanta Manage API request, page walk or body parse can fail. */
export type VantaHttpError =
  | (Listed<"HTTP_STATUS"> & { readonly safePath: string; readonly status: number })
  | (Listed<"REDIRECT_REFUSED"> & { readonly safePath: string; readonly status: number })
  | (Plain<"BODY_UNREAD"> & { readonly safePath: string; readonly cause: unknown })
  | (Plain<"UNREACHABLE"> & { readonly safePath: string; readonly host: string; readonly cause: unknown })
  | (Plain<"RETRIES_EXHAUSTED"> & { readonly safePath: string })
  | (Plain<"DUPLICATE_PROVIDER_ID"> & { readonly id: string })
  | Plain<"CURSOR_MISSING">
  | (Plain<"CURSOR_REPEATED"> & { readonly cursor: string })
  | (Plain<"PAGE_LIMIT_EXCEEDED"> & { readonly maxPages: number })
  | SurfaceError<"BODY_NOT_JSON">
  | UnreadableError<"PAGE_UNREADABLE">
  | UnreadableError<"OBJECT_UNREADABLE">
  | UnreadableError<"BODY_UNREADABLE">
  | (Plain<"SAMPLE_LIMIT_INVALID"> & { readonly limit: number })
  | SurfaceError<"NOT_CENSUS_FAMILY">
  | SurfaceError<"NOT_CHILD_SURFACE">;

/**
 * One line per schema issue, indented under the header that names the surface — the dotted path, then the
 * schema's own message. Zod's messages name keys and expected types, never the value it received.
 *
 * @param issues the schema's issues, in the order it reported them
 * @returns one indented line per issue
 */
export function vantaIssueLines({ issues }: { issues: VantaSchemaIssues }): readonly string[] {
  return issues.map((issue) => `  ${issue.path.map(String).join(".")}: ${issue.message}`);
}

/** A body that is not JSON at all — shared by the factory and the boundary builder, so the two cannot drift. */
function bodyNotJson({ surface }: { surface: string }): VantaHttpError {
  return { code: "BODY_NOT_JSON", message: `${surface} returned a body that is not valid JSON`, surface };
}

/**
 * A read a boundary refused: an answer that is not JSON stays `BODY_NOT_JSON`, exactly as before the read had a
 * boundary, and a shape that drifted is the header naming the surface and its endpoint, then one line per
 * drifted field. A drift line names keys and expected types, never a value the provider sent.
 */
function boundaryUnreadable<C extends "PAGE_UNREADABLE" | "OBJECT_UNREADABLE" | "BODY_UNREADABLE">({
  code,
  surface,
  header,
  boundaryError,
}: {
  code: C;
  surface: string;
  header: string;
  boundaryError: BoundaryError;
}): VantaHttpError {
  if (boundaryError.code === "BOUNDARY_NOT_JSON") {
    return bodyNotJson({ surface });
  }
  const reasons = [
    `${surface} (${boundaryError.endpoint}) returned ${header} this package cannot read:`,
    ...boundaryError.drift.map((entry) => `  ${entry.detail}`),
  ];
  return { code, message: reasons.join("; "), reasons, surface };
}

/** The builder behind `BODY_UNREADABLE`: a body a plain schema, not a boundary, refused. */
function unreadable<C extends string>({
  code,
  surface,
  header,
  issues,
}: {
  code: C;
  surface: string;
  header: string;
  issues: VantaSchemaIssues;
}): UnreadableError<C> {
  const reasons = [`${surface} returned ${header} this package cannot read:`, ...vantaIssueLines({ issues })];
  return { code, message: reasons.join("; "), reasons, surface };
}

/** The lines one refused status prints: the path and status, plus what the status means when it means more. */
function httpStatusLines({ safePath, status }: { safePath: string; status: number }): readonly string[] {
  if (status === 401 || status === 403) {
    return [
      `${safePath} returned HTTP ${String(status)}`,
      "this is an entitlement or credential problem, not a transient fault",
    ];
  }
  if (status === 404) {
    return [
      `${safePath} returned HTTP 404`,
      "the route is not there — check the endpoint path before concluding the surface is empty",
    ];
  }
  if (status === 429) {
    return [`${safePath} was rate limited and the retries were exhausted`];
  }
  return [`${safePath} returned HTTP ${String(status)}`];
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VantaHttpErrors = {
  bodyNotJson: ({ surface }: { surface: string }): VantaHttpError => bodyNotJson({ surface }),
  bodyUnread: ({ safePath, cause }: { safePath: string; cause: unknown }): VantaHttpError => ({
    cause,
    code: "BODY_UNREAD",
    message: `${safePath} returned headers but its body could not be read: ${errorMessage({ error: cause })}`,
    safePath,
  }),
  /** A write's body its endpoint's boundary refused — the header, then one line per drifted field. */
  bodyRefused: ({ surface, boundaryError }: { surface: string; boundaryError: BoundaryError }): VantaHttpError =>
    boundaryUnreadable({ boundaryError, code: "BODY_UNREADABLE", header: "a body", surface }),
  bodyUnreadable: ({ surface, issues }: { surface: string; issues: VantaSchemaIssues }): VantaHttpError =>
    unreadable({ code: "BODY_UNREADABLE", header: "a body", issues, surface }),
  /**
   * A non-2xx, non-redirect status. The provider's response BODY is deliberately absent from every line:
   * a line is published into a coverage cell, a gap and the manifest, and the body is text Vanta chose — see
   * `transport.ts`'s `AttemptOutcome.diagnosticBody`, which carries it to a log instead.
   */
  httpStatus: ({ safePath, status }: { safePath: string; status: number }): VantaHttpError => {
    const reasons = httpStatusLines({ safePath, status });
    return { code: "HTTP_STATUS", message: reasons.join("; "), reasons, safePath, status };
  },
  cursorMissing: (): VantaHttpError => ({
    code: "CURSOR_MISSING",
    message:
      "hasNextPage is true but the page carried no cursor to continue from — a pagination fault, not a silent stop",
  }),
  cursorRepeated: ({ cursor }: { cursor: string }): VantaHttpError => ({
    code: "CURSOR_REPEATED",
    cursor,
    message: `cursor ${cursor} repeated — refusing rather than looping forever`,
  }),
  duplicateProviderId: ({ id }: { id: string }): VantaHttpError => ({
    code: "DUPLICATE_PROVIDER_ID",
    id,
    message: `provider id ${id} appeared twice within one surface's read — refusing rather than silently deduplicating`,
  }),
  notCensusFamily: ({ surface }: { surface: string }): VantaHttpError => ({
    code: "NOT_CENSUS_FAMILY",
    message: `${surface} is not a census family declared in census.ts`,
    surface,
  }),
  notChildSurface: ({ surface }: { surface: string }): VantaHttpError => ({
    code: "NOT_CHILD_SURFACE",
    message: `${surface} is not a child surface declared in childCensus.ts`,
    surface,
  }),
  objectUnreadable: ({ surface, boundaryError }: { surface: string; boundaryError: BoundaryError }): VantaHttpError =>
    boundaryUnreadable({ boundaryError, code: "OBJECT_UNREADABLE", header: "an object", surface }),
  pageLimitExceeded: ({ maxPages }: { maxPages: number }): VantaHttpError => ({
    code: "PAGE_LIMIT_EXCEEDED",
    maxPages,
    message: `exceeded ${String(maxPages)} pages without reaching hasNextPage: false — refusing rather than looping forever`,
  }),
  pageUnreadable: ({ surface, boundaryError }: { surface: string; boundaryError: BoundaryError }): VantaHttpError =>
    boundaryUnreadable({ boundaryError, code: "PAGE_UNREADABLE", header: "a page", surface }),
  redirectRefused: ({ safePath, status }: { safePath: string; status: number }): VantaHttpError => {
    const reasons = [
      `${safePath} returned an HTTP ${String(status)} redirect, which this transport refuses to follow`,
      "Vanta's Manage API has no documented redirect behaviour — following one would resend the bearer token to an unverified host",
    ];
    return { code: "REDIRECT_REFUSED", message: reasons.join("; "), reasons, safePath, status };
  },
  retriesExhausted: ({ safePath }: { safePath: string }): VantaHttpError => ({
    code: "RETRIES_EXHAUSTED",
    message: `${safePath} exhausted its retries without producing a result`,
    safePath,
  }),
  sampleLimitInvalid: ({ limit }: { limit: number }): VantaHttpError => ({
    code: "SAMPLE_LIMIT_INVALID",
    limit,
    message: "test entity sample limit must be an integer from 1 to 10",
  }),
  unreachable: ({ safePath, host, cause }: { safePath: string; host: string; cause: unknown }): VantaHttpError => ({
    cause,
    code: "UNREACHABLE",
    host,
    message: `the request to ${safePath} never reached ${host}: ${errorMessage({ error: cause })}`,
    safePath,
  }),
} as const;

/**
 * The lines one failure prints, exactly as the transport, walk or parser printed them before it had a type:
 * a list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function vantaHttpErrorLines({ error }: { error: VantaHttpError }): readonly string[] {
  if (
    error.code === "HTTP_STATUS" ||
    error.code === "REDIRECT_REFUSED" ||
    error.code === "PAGE_UNREADABLE" ||
    error.code === "OBJECT_UNREADABLE" ||
    error.code === "BODY_UNREADABLE"
  ) {
    return error.reasons;
  }
  return [error.message];
}

/**
 * What the transport, the token provider and the page walk fail with: a typed {@link VantaHttpError}, or the
 * lines of something that is not an HTTP fact at all — the dead-host POLICY refusal
 * (`deadHostRefusal.ts`, a refusal and so not a domain error per `.claude/rules/error-handling.md`) and the
 * mint lock another process holds. A decision reads the typed arm's `code`; the lines arm is only ever
 * printed.
 */
export type VantaTransportFailure = VantaHttpError | readonly string[];

/**
 * Whether a transport failure is the typed arm. Structural, on the one thing that tells the arms apart — the
 * lines arm is an array and no typed variant is — never on what either arm says, and never on a key an array
 * could also be given.
 *
 * @returns true for a {@link VantaHttpError}, false for the printed-only lines arm
 */
export function isVantaHttpError(failure: VantaTransportFailure): failure is VantaHttpError {
  return !Array.isArray(failure);
}

/**
 * The lines one transport failure prints: the typed arm through {@link vantaHttpErrorLines}, the lines arm
 * unchanged.
 *
 * @returns the lines, in order
 */
export function vantaTransportFailureLines({ error }: { error: VantaTransportFailure }): readonly string[] {
  if (isVantaHttpError(error)) {
    return vantaHttpErrorLines({ error });
  }
  return error;
}
