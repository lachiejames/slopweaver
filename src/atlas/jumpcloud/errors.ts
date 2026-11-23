/**
 * The failure kinds a JumpCloud read can genuinely produce, as a typed union.
 *
 * Per `.claude/rules/error-handling.md` this domain earns a union rather than `readonly string[]`, because
 * callers BRANCH on these: a `surface-refused` is a programming error that must fail the sync outright, a
 * `redirect-refused` is a boundary violation worth reporting distinctly from a transport failure, and an
 * `unauthorised` on one family while others succeed is the difference between a credential problem and a
 * permission boundary this account genuinely does not cross.
 *
 * `IngestError` from the `safe*` boundary is mapped into this union at the point of the call, carrying the
 * useful fields forward rather than discarding them.
 */
import type { BoundaryDrift } from "#lib/boundary.js";

/** How many drifted keys a shape refusal's message names before it counts the rest. */
const DRIFT_NAMED = 3;

/**
 * A caller named a surface the closed registry does not admit, or admits only as excluded.
 * @internal
 */
export interface SurfaceRefusedError {
  readonly code: "SURFACE_REFUSED";
  readonly message: string;
  readonly surface: string;
  /** Present when the surface exists but is inventoried-and-refused, so the reason can be shown. */
  readonly excludedBecause?: string;
}

/**
 * A row exists and is admitted, but a `{brace}` parameter in its path was never bound to a value.
 *
 * Its own variant rather than a {@link SurfaceRefusedError}, because the two are acted on differently. A
 * refused surface is a caller naming something the registry does not admit, which is always a defect here.
 * An unbound path is an operation this atlas fully intends to call and CANNOT yet, because the parent
 * collection that supplies the id was not read — so it is a coverage fact about this generation rather than
 * a mistake in the code, and coverage grades it as such.
 * @internal
 */
export interface PathUnboundError {
  readonly code: "PATH_UNBOUND";
  readonly message: string;
  readonly surface: string;
  /** Every parameter still unbound, in the order the path declares them. */
  readonly parameters: readonly string[];
}

/**
 * The provider answered with a redirect, which the boundary refuses rather than follows.
 * @internal
 */
export interface RedirectRefusedError {
  readonly code: "REDIRECT_REFUSED";
  readonly message: string;
  readonly surface: string;
  readonly status: number;
}

/**
 * The credential itself was rejected — HTTP 401.
 *
 * Kept apart from {@link PermissionRefusedError} because the two are cleared by completely different
 * things, and a sync that conflates them publishes a generation it should have refused. A 401 says the key
 * is wrong, revoked or expired, so REPLACING it makes the next run succeed — which is exactly what
 * "a failure a later run could clear" means, and exactly why it blocks publication.
 * @internal
 */
export interface CredentialRejectedError {
  readonly code: "CREDENTIAL_REJECTED";
  readonly message: string;
  readonly surface: string;
  readonly status: number;
}

/**
 * This administrator may not read this family — HTTP 403.
 *
 * A fact about what the credential is allowed to see rather than about whether it works, so it never
 * blocks a publication: a tenancy where one family is off-limits is a tenancy this atlas describes
 * honestly, and refusing to publish would make the whole atlas hostage to one permission.
 * @internal
 */
export interface PermissionRefusedError {
  readonly code: "PERMISSION_REFUSED";
  readonly message: string;
  readonly surface: string;
  readonly status: number;
}

/**
 * The provider answered 404: this account has no such route, product or record.
 *
 * Its own variant because it is a fact about the TENANCY rather than about the read. A JumpCloud account
 * that has not provisioned Apple MDM answers 404 on every Apple MDM path, and that is the honest answer to
 * "what does this organisation hold" — so it grades `unavailable` and never blocks a publication, while a
 * transport failure on the same path does both the opposite things.
 * @internal
 */
export interface RouteAbsentError {
  readonly code: "ROUTE_ABSENT";
  readonly message: string;
  readonly surface: string;
}

/**
 * The provider answered 501: its origin does not implement this operation at all.
 *
 * Its own variant rather than a detail string on {@link OperationUnusableError}, because the two call for
 * opposite remedies. An unusable operation is a request contract THIS atlas does not yet hold, which a fix
 * closes; a 501 is the provider saying no request could ever be served, so it is an answer, and a surface
 * whose every other read finished is not left unfilled for it.
 * @internal
 */
export interface NotImplementedError {
  readonly code: "NOT_IMPLEMENTED";
  readonly message: string;
  readonly surface: string;
}

/**
 * The provider answered that the request itself is not one it will serve — a 4xx other than 401, 403 or
 * 404, or a 2xx whose body is not JSON at all.
 *
 * A fact about the OPERATION rather than about the read, which is why it never blocks a publication.
 * MEASURED against the live tenancy: `GET /api/v2/systems/{id}/associations` answered HTTP 400
 * until a `targets` parameter named what the association is to — neither transient nor a credential
 * problem, but a request contract this atlas did not yet hold (`requestContracts.ts` now pins it). An
 * operation that answers with a FILE rather than a document is read through `fileResponses.ts` instead.
 *
 * Reproduce with `slopweaver atlas jumpcloud sync` and read the gap list it publishes.
 * @internal
 */
export interface OperationUnusableError {
  readonly code: "OPERATION_UNUSABLE";
  readonly message: string;
  readonly surface: string;
  readonly detail: string;
}

/**
 * The provider answered, but not with something this surface's schema admits.
 * @internal
 */
export interface UnexpectedShapeError {
  readonly code: "UNEXPECTED_SHAPE";
  readonly message: string;
  readonly surface: string;
  readonly detail: string;
}

/**
 * The provider answered JSON in a shape this surface's strict boundary does not admit, so nothing the page carried
 * is absorbed. The message names the first few drifted keys — a key a whole page grew is one drift per record, so
 * the full list rides `drift` rather than a message carrying a thousand copies of one finding.
 *
 * Deliberately NOT a settled failure (`JUMPCLOUD_SETTLED_FAILURE_CODES`): a build that declares the drift clears
 * it, so journalling it would keep refusing a surface the code already reads.
 * @internal
 */
export interface BodyShapeChangedError {
  readonly code: "BODY_SHAPE_CHANGED";
  readonly message: string;
  readonly surface: string;
  readonly drift: readonly BoundaryDrift[];
}

/**
 * The call did not complete — transport, timeout, or a status with no more specific meaning.
 * @internal
 */
export interface TransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly surface: string;
  readonly cause?: unknown;
}

/**
 * Every way a JumpCloud read can fail.
 * @internal
 */
export type JumpcloudReadError =
  | SurfaceRefusedError
  | PathUnboundError
  | RedirectRefusedError
  | CredentialRejectedError
  | PermissionRefusedError
  | RouteAbsentError
  | NotImplementedError
  | OperationUnusableError
  | UnexpectedShapeError
  | BodyShapeChangedError
  | TransportFailedError;

/**
 * One line describing whatever a boundary threw, without assuming it is an `Error`.
 *
 * @param cause the value the transport failed with
 * @returns a human-readable description, never `[object Object]`
 */
function describeCause({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "object" && cause !== null) {
    const fields: Record<string, unknown> = { ...cause };
    const message = fields["message"];
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    return JSON.stringify(cause);
  }
  return String(cause);
}

/**
 * Construct each failure the same way the real code does, so a test built from these catches a factory that
 * stops matching its own type.
 * @internal
 */
export const JumpcloudReadErrors = {
  pathUnbound: ({ surface, parameters }: { surface: string; parameters: readonly string[] }): PathUnboundError => ({
    code: "PATH_UNBOUND",
    message: `${surface} declares path parameter(s) ${parameters.join(", ")} that nothing bound, so no request was made — the collection that supplies them was not read this run`,
    parameters: [...parameters],
    surface,
  }),
  operationUnusable: ({ surface, detail }: { surface: string; detail: string }): OperationUnusableError => ({
    code: "OPERATION_UNUSABLE",
    detail,
    message: `${surface} will not serve the request as this atlas constructs it: ${detail}. That is a fact about the operation rather than a failed read, so it does not stop a generation being published`,
    surface,
  }),
  notImplemented: ({ surface }: { surface: string }): NotImplementedError => ({
    code: "NOT_IMPLEMENTED",
    message: `${surface} answered 501: the provider does not implement this operation at all. That is an answer about the operation, not a failed read`,
    surface,
  }),
  routeAbsent: ({ surface }: { surface: string }): RouteAbsentError => ({
    code: "ROUTE_ABSENT",
    message: `${surface} answered 404: this organisation has no such route, product or record. That is an answer about the tenancy, not a failed read`,
    surface,
  }),
  redirectRefused: ({ surface, status }: { surface: string; status: number }): RedirectRefusedError => ({
    code: "REDIRECT_REFUSED",
    message: `${surface} answered ${String(status)} with a redirect; the boundary refuses redirects rather than following one, because the allowlist checked the request that was sent and not the one it would land on`,
    status,
    surface,
  }),
  surfaceRefused: ({ surface, excludedBecause }: { surface: string; excludedBecause?: string }): SurfaceRefusedError =>
    excludedBecause === undefined
      ? {
          code: "SURFACE_REFUSED",
          message: `${surface} is not a surface this atlas admits — the registry is closed, so this is a programming error rather than a provider condition`,
          surface,
        }
      : {
          code: "SURFACE_REFUSED",
          excludedBecause,
          message: `${surface} is inventoried and deliberately never called: ${excludedBecause}`,
          surface,
        },
  transportFailed: ({ surface, cause }: { surface: string; cause: unknown }): TransportFailedError => ({
    cause,
    code: "TRANSPORT_FAILED",
    // `String(cause)` on a plain object is `[object Object]`, which is what a live run actually printed
    // for a typed `IngestError`. A message nobody can act on is the same as no message.
    message: `${surface} did not complete: ${describeCause({ cause })}`,
    surface,
  }),
  credentialRejected: ({ surface, status }: { surface: string; status: number }): CredentialRejectedError => ({
    code: "CREDENTIAL_REJECTED",
    message: `${surface} answered ${String(status)}: the credential itself was rejected. Replacing the key is what clears this, so a generation is not published while it stands`,
    status,
    surface,
  }),
  permissionRefused: ({ surface, status }: { surface: string; status: number }): PermissionRefusedError => ({
    code: "PERMISSION_REFUSED",
    message: `${surface} answered ${String(status)}: this administrator may not read it. One family refused this way while others succeed is a permission boundary, not a broken credential`,
    status,
    surface,
  }),
  unexpectedShape: ({ surface, detail }: { surface: string; detail: string }): UnexpectedShapeError => ({
    code: "UNEXPECTED_SHAPE",
    detail,
    message: `${surface} answered with a shape this surface does not admit: ${detail}`,
    surface,
  }),
  bodyShapeChanged: ({
    surface,
    drift,
  }: {
    surface: string;
    drift: readonly BoundaryDrift[];
  }): BodyShapeChangedError => {
    const named = drift.slice(0, DRIFT_NAMED).map((entry) => entry.detail);
    const more = drift.length > DRIFT_NAMED ? ` (+${String(drift.length - DRIFT_NAMED)} more)` : "";
    return {
      code: "BODY_SHAPE_CHANGED",
      drift,
      message: `${surface} answered a shape this version does not read, so nothing it answered is held: ${named.join("; ")}${more}`,
      surface,
    };
  },
  // A 2xx body that is not JSON is a fact about the operation, worded by its length alone: the body is
  // provider-written text — an error page, a short secret — so neither it nor a parser's words about it are carried.
  bodyNotJson: ({ surface, length }: { surface: string; length: number }): OperationUnusableError =>
    JumpcloudReadErrors.operationUnusable({
      detail: `the response body is not JSON — ${String(length)} byte(s) that this atlas cannot store as a document`,
      surface,
    }),
} as const;

/**
 * A read window a caller asked for that no read could answer.
 *
 * Its own union rather than a member of {@link JumpcloudReadError}, because the two are different KINDS of
 * fact and a caller does different things with them: a read error describes what the provider said about a
 * request that was made, and this describes a request that was never made at all. Folding one into the
 * other would put "the operator typed a year" in the same switch as "the credential was rejected".
 *
 * It is a union rather than the default `readonly string[]` for the reason `error-shape-threshold` names:
 * this directory is already past the threshold at which a domain declares one, so a new failure here joins
 * the union instead of lengthening the plain-string list.
 * @internal
 */
export interface WindowUnusableError {
  readonly code: "WINDOW_UNUSABLE";
  readonly message: string;
  /** Which of the three ways a window can be unusable, so a caller can branch without matching prose. */
  readonly reason: "start-missing" | "not-an-instant" | "empty-window" | "past-retention";
}

/**
 * Every way a caller's read window can be refused before a request is made.
 * @internal
 */
export type JumpcloudWindowError = WindowUnusableError;

/**
 * Construct each window refusal the same way the real code does.
 * @internal
 */
export const JumpcloudWindowErrors = {
  startMissing: (): WindowUnusableError => ({
    code: "WINDOW_UNUSABLE",
    message: "--since <iso> is required: this read is bounded by a window, and there is no default start",
    reason: "start-missing",
  }),
  notAnInstant: ({ flag, raw }: { flag: string; raw: string }): WindowUnusableError => ({
    code: "WINDOW_UNUSABLE",
    message: `${flag} ${raw} is not an ISO instant`,
    reason: "not-an-instant",
  }),
  emptyWindow: ({ since, endIso }: { since: string; endIso: string }): WindowUnusableError => ({
    code: "WINDOW_UNUSABLE",
    message: `--until ${endIso} is not after --since ${since}, so the window holds no time at all`,
    reason: "empty-window",
  }),
  pastRetention: ({
    since,
    floorIso,
    providerSaid,
    retentionDays,
  }: {
    since: string;
    floorIso: string;
    providerSaid: string;
    retentionDays: number;
  }): WindowUnusableError => ({
    code: "WINDOW_UNUSABLE",
    message: `--since ${since} is further back than Directory Insights keeps anything. The provider's own answer is: "${providerSaid}", so the oldest start this read can carry is ${floorIso}. A silence over a window longer than ${String(retentionDays)} days is not something JumpCloud can be asked about at all`,
    reason: "past-retention",
  }),
} as const;

/**
 * The failure codes a later run cannot clear on its own, so a journal entry for one is a saving rather
 * than a lie.
 *
 * MEASURED on the live tenancy: one full walk produced one of these per call to a settled operation, almost
 * all HTTP 400 from operations that need a query parameter the registry does not record. Re-attempting them
 * every sync would make the atlas repeat every one of those calls forever to be told the same thing.
 */
export const JUMPCLOUD_SETTLED_FAILURE_CODES: ReadonlySet<string> = new Set([
  "NOT_IMPLEMENTED",
  "OPERATION_UNUSABLE",
  "PERMISSION_REFUSED",
  "ROUTE_ABSENT",
]);

/**
 * Rebuild the typed failure a journalled settled entry recorded.
 *
 * The CODE is carried through rather than flattened. Collapsing every settled failure into one kind was a
 * live defect: a 403 came back from the journal as an unusable operation, so its coverage cell said
 * "permission boundary" in the reason while its state and its remedy described a missing query parameter.
 *
 * @param surface the operation the journalled entry was read from
 * @param code the failure code the entry recorded
 * @param message the failure's own message, as the original read produced it
 * @returns the typed failure, as the original read produced it
 */
export function settledJumpcloudError({
  surface,
  code,
  message,
}: {
  surface: string;
  code: string;
  message: string;
}): JumpcloudReadError {
  if (code === "PERMISSION_REFUSED") {
    return { code: "PERMISSION_REFUSED", message, status: 403, surface };
  }
  if (code === "ROUTE_ABSENT" || code === "NOT_IMPLEMENTED") {
    return { code, message, surface };
  }
  return { code: "OPERATION_UNUSABLE", detail: code, message, surface };
}

/**
 * The administrator console could not be reached at all, so no page was walked.
 *
 * Its own typed error for the reason {@link JumpcloudWindowError} gives: this directory is past the threshold at
 * which a domain declares one, so a new failure joins a union instead of the plain-string list. The kit's
 * page walk takes a `readonly string[]` from `resolveRoot`, so the walk forwards the `message`.
 * @internal
 */
export interface ConsoleUnreachableError {
  readonly code: "CONSOLE_UNREACHABLE";
  readonly message: string;
  /** Why the probe could not land: the transport failed, or the console sent this browser to sign in. */
  readonly reason: "transport-failed" | "signed-out";
}

/**
 * Construct each console-walk refusal the same way the real code does.
 * @internal
 */
export const JumpcloudConsoleWalkErrors = {
  transportFailed: ({ cause }: { cause: string }): ConsoleUnreachableError => ({
    code: "CONSOLE_UNREACHABLE",
    message: `could not reach the JumpCloud administrator console: ${cause}`,
    reason: "transport-failed",
  }),
  signedOut: (): ConsoleUnreachableError => ({
    code: "CONSOLE_UNREACHABLE",
    message:
      "the JumpCloud console sent this browser to its sign-in page or end-user portal, so no page could be walked — " +
      "sign in to the JumpCloud administrator console in your own Chrome and run the walk again",
    reason: "signed-out",
  }),
} as const;
