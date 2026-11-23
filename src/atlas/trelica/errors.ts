/**
 * The Trelica atlas's own typed failures.
 *
 * A union rather than `readonly string[]` because callers genuinely branch here, which is the test
 * `.claude/rules/error-handling.md` sets: a missing tenant host is a configuration problem an operator
 * fixes with one command, a lost session is a state the OWNER has to fix in their own browser, and a refused
 * call is a finding the atlas records as a gap and carries on from. Three different next steps, so three
 * codes rather than three sentences.
 *
 * The tenant-host reader's own refusals — a loose, empty or unreadable host file, an unset host, a host of
 * the wrong shape — are members too. None carries the host VALUE: a refusal names the file path, the secret
 * name and the vendor suffix, and {@link trelicaAtlasErrorLines} prints them one line per problem.
 */
import type { BoundaryDrift } from "#lib/boundary.js";
import { errorMessage } from "#lib/errorMessage.js";

/** How many drifted keys a shape refusal's message names before it counts the rest. */
const DRIFT_NAMED = 3;

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** The tenant host is unset or does not look like one. */
export interface TenantUnresolvedError {
  readonly code: "TENANT_UNRESOLVED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The signed-in session this channel stands on is gone, so nothing beneath it can be read. */
export interface SessionLostError {
  readonly code: "SESSION_LOST";
  readonly message: string;
  /** The origin whose session went missing — an origin, never a cookie. */
  readonly origin: string;
}

/** One call in the closed inventory answered something other than success. */
export interface CallRefusedError {
  readonly code: "CALL_REFUSED";
  readonly message: string;
  /** The inventory's own id for the call, never a URL carrying a tenant label. */
  readonly callId: string;
  readonly statusCode: number;
}

/** A call went out and nothing usable came back — a transport failure rather than a refusal. */
export interface TransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly callId: string;
  readonly cause?: unknown;
}

/**
 * A call that answered 2xx with a body that is not the JSON it declares. Its message is closed: a parse error
 * quotes the body it choked on, and that body is provider-written text — a short secret, an error page — so neither
 * the body nor the parser's words about it are carried.
 */
export interface BodyUnparseableError {
  readonly code: "BODY_UNPARSEABLE";
  readonly message: string;
  readonly callId: string;
}

/**
 * A call that answered JSON in a shape its strict boundary does not admit. Nothing it answered is held, and the
 * message names the first few drifted keys — a key a whole page grew is one drift per record, so the full list
 * rides `drift` rather than a message that would carry a thousand copies of one finding.
 */
export interface BodyShapeChangedError {
  readonly code: "BODY_SHAPE_CHANGED";
  readonly message: string;
  readonly callId: string;
  readonly drift: readonly BoundaryDrift[];
}

/** A call handed a boundary bound to a different call — a programming error, refused before any request. */
export interface BoundaryUnboundError {
  readonly code: "BOUNDARY_UNBOUND";
  readonly message: string;
  readonly callId: string;
  /** The call the boundary is bound to, or `null` for one bound to none. */
  readonly boundaryCallId: string | null;
}

/** A document the vendor's own client names, which this tenant does not serve or does not parse. */
export interface DocumentUnreadableError {
  readonly code: "DOCUMENT_UNREADABLE";
  readonly message: string;
  /** The document's own short name, e.g. `apps`. */
  readonly document: string;
}

/** Every way this atlas's acquisition can fail. */
export type TrelicaAtlasError =
  | TenantUnresolvedError
  | SessionLostError
  | CallRefusedError
  | TransportFailedError
  | BodyUnparseableError
  | BodyShapeChangedError
  | BoundaryUnboundError
  | DocumentUnreadableError
  | (Plain<"HOST_FILE_LOOSE"> & { readonly path: string })
  | (Plain<"HOST_FILE_EMPTY"> & { readonly path: string })
  | (Plain<"HOST_FILE_UNREADABLE"> & { readonly path: string; readonly cause: unknown })
  | (Listed<"TENANT_HOST_UNSET"> & { readonly problems: readonly string[]; readonly secretName: string })
  | (Listed<"TENANT_HOST_MALFORMED"> & { readonly secretName: string; readonly suffix: string });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** The only way a {@link TrelicaAtlasError} is constructed, so a test builds one the way the code does. */
export const TrelicaAtlasErrors = {
  callRefused: ({ callId, statusCode }: { callId: string; statusCode: number }): CallRefusedError => ({
    callId,
    code: "CALL_REFUSED",
    message: `${callId} answered HTTP ${String(statusCode)} — this account's roles do not open it`,
    statusCode,
  }),
  boundaryUnbound: ({
    boundaryCallId,
    callId,
  }: {
    boundaryCallId: string | null;
    callId: string;
  }): BoundaryUnboundError => ({
    boundaryCallId,
    callId,
    code: "BOUNDARY_UNBOUND",
    message: `${callId} was asked to admit its answer through ${boundaryCallId === null ? "a boundary bound to no call" : `${boundaryCallId}'s boundary`}; nothing was requested`,
  }),
  bodyUnparseable: ({ callId }: { callId: string }): BodyUnparseableError => ({
    callId,
    code: "BODY_UNPARSEABLE",
    message: `${callId} answered a body that is not the JSON it declares; the body is not held`,
  }),
  bodyShapeChanged: ({ callId, drift }: { callId: string; drift: readonly BoundaryDrift[] }): BodyShapeChangedError => {
    const named = drift.slice(0, DRIFT_NAMED).map((entry) => entry.detail);
    const more = drift.length > DRIFT_NAMED ? ` (+${String(drift.length - DRIFT_NAMED)} more)` : "";
    return {
      callId,
      code: "BODY_SHAPE_CHANGED",
      drift,
      message: `${callId} answered a shape this version does not read, so nothing it answered is held: ${named.join("; ")}${more}`,
    };
  },
  documentUnreadable: ({ document, detail }: { document: string; detail: string }): DocumentUnreadableError => ({
    code: "DOCUMENT_UNREADABLE",
    document,
    message: `the ${document} API document could not be read: ${detail}`,
  }),
  hostFileEmpty: ({ path }: { path: string }): TrelicaAtlasError => ({
    code: "HOST_FILE_EMPTY",
    message: `the Trelica tenant host file is empty: ${path}`,
    path,
  }),
  hostFileLoose: ({ path }: { path: string }): TrelicaAtlasError => ({
    code: "HOST_FILE_LOOSE",
    message: `the Trelica tenant host must be owner-only (mode 0600 or stricter): ${path}`,
    path,
  }),
  hostFileUnreadable: ({ cause, path }: { cause: unknown; path: string }): TrelicaAtlasError => ({
    cause,
    code: "HOST_FILE_UNREADABLE",
    message: `could not read the Trelica tenant host at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  sessionLost: ({ origin }: { origin: string }): SessionLostError => ({
    code: "SESSION_LOST",
    message: `the signed-in session for ${origin} is gone — open it in Chrome and sign in, then run this again`,
    origin,
  }),
  tenantHostMalformed: ({ secretName, suffix }: { secretName: string; suffix: string }): TrelicaAtlasError => ({
    secretName,
    suffix,
    ...listed({
      code: "TENANT_HOST_MALFORMED",
      reasons: [
        `${secretName} does not look like a tenant host: expected one label beneath ${suffix}`,
        "the value is the host your browser shows once signed in, not the shared sign-in host",
      ],
    }),
  }),
  tenantHostUnset: ({
    problems,
    secretName,
  }: {
    problems: readonly string[];
    secretName: string;
  }): TrelicaAtlasError => ({
    problems,
    secretName,
    ...listed({
      code: "TENANT_HOST_UNSET",
      reasons: [
        ...problems,
        `set it with: slopweaver secrets set ${secretName} — the value is your own tenant host, the one your browser is on after signing in`,
        "nothing here guesses a tenant: a guessed one would either not exist or belong to somebody else",
      ],
    }),
  }),
  // At least one reason, so the first is the message: an unresolved tenant with no reason would say nothing.
  tenantUnresolved: ({ reasons }: { reasons: readonly [string, ...string[]] }): TenantUnresolvedError => ({
    code: "TENANT_UNRESOLVED",
    message: reasons[0],
    reasons: [...reasons],
  }),
  transportFailed: ({ callId, cause }: { callId: string; cause: unknown }): TransportFailedError => ({
    callId,
    cause,
    code: "TRANSPORT_FAILED",
    message: `${callId} did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;

/**
 * The lines a {@link TrelicaAtlasError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message`.
 *
 * @param error the Trelica failure to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function trelicaAtlasErrorLines({ error }: { error: TrelicaAtlasError }): readonly string[] {
  if (
    error.code === "TENANT_UNRESOLVED" ||
    error.code === "TENANT_HOST_UNSET" ||
    error.code === "TENANT_HOST_MALFORMED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
