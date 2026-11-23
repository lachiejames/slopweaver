/**
 * The typed failures the Linear corpus lane authors itself: a hydration lane that threw past the transport's
 * retry budget, and a mutation payload that answered 200 without meaning what its status implies.
 *
 * Two unions of their own per `.claude/rules/error-handling.md`, scoped to this directory. They stay apart
 * because no caller can meet both: a hydration lane never parses a mutation payload, and a write never pages.
 * A payload failure still leaves this directory as the `IngestError` its transport already carries — that is
 * the write seam's contract — so its `message` is the reason text, exactly as the bare string it replaced.
 */

/** Paging the issue and project lanes threw after the transport's retry budget. */
export interface LinearActivityFetchFailedError {
  readonly code: "ACTIVITY_FETCH_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Paging the `users` lane threw after the transport's retry budget. */
export interface LinearMemberHydrationFailedError {
  readonly code: "MEMBER_HYDRATION_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Reading the organization, its memberships or its teams threw after the transport's retry budget. */
export interface LinearStructureHydrationFailedError {
  readonly code: "STRUCTURE_HYDRATION_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Every fatal failure a Linear hydration lane authors. */
export type LinearHydrationError =
  LinearActivityFetchFailedError | LinearMemberHydrationFailedError | LinearStructureHydrationFailedError;

/** The response body was not an object at all, so no payload field could be read from it. */
export interface LinearPayloadNoDataError {
  readonly code: "PAYLOAD_NO_DATA";
  readonly message: string;
}

/** The mutation's payload field was absent or not an object. */
export interface LinearPayloadMissingError {
  readonly code: "PAYLOAD_MISSING";
  readonly message: string;
  readonly field: string;
}

/** The payload was present and its `success` was anything but `true`. */
export interface LinearPayloadUnsuccessfulError {
  readonly code: "PAYLOAD_UNSUCCESSFUL";
  readonly message: string;
  readonly field: string;
  readonly success: unknown;
}

/** The payload reported success and carried no written object, or none with the fields a caller needs. */
export interface LinearPayloadNodeMissingError {
  readonly code: "PAYLOAD_NODE_MISSING";
  readonly message: string;
  readonly field: string;
  readonly node: string;
}

/** The written object came back without its id — the one field every SDK payload promises. */
export interface LinearPayloadIdMissingError {
  readonly code: "PAYLOAD_ID_MISSING";
  readonly message: string;
  readonly field: string;
  readonly node: string;
}

/** Every false success a mutation payload parser names. */
export type LinearPayloadError =
  | LinearPayloadNoDataError
  | LinearPayloadMissingError
  | LinearPayloadUnsuccessfulError
  | LinearPayloadNodeMissingError
  | LinearPayloadIdMissingError;

/**
 * The text a thrown value contributes to a hydration failure: its own message, or `unknown`.
 *
 * @returns the cause's message, or `unknown` for a thrown non-Error
 */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : "unknown";
}

/** How to raise a hydration failure — the factory the real code calls, so a test built the same way catches a drift. */
export const LinearHydrationErrors = {
  activityFetchFailed: ({ cause }: { cause: unknown }): LinearActivityFetchFailedError => ({
    cause,
    code: "ACTIVITY_FETCH_FAILED",
    message: `fetch failed: ${causeText({ cause })}`,
  }),
  memberHydrationFailed: ({ cause }: { cause: unknown }): LinearMemberHydrationFailedError => ({
    cause,
    code: "MEMBER_HYDRATION_FAILED",
    message: `linear member hydration failed: ${causeText({ cause })}`,
  }),
  structureHydrationFailed: ({ cause }: { cause: unknown }): LinearStructureHydrationFailedError => ({
    cause,
    code: "STRUCTURE_HYDRATION_FAILED",
    message: `linear structure hydration failed: ${causeText({ cause })}`,
  }),
} as const;

/** How to name a false success — the factory the real code calls, so a test built the same way catches a drift. */
export const LinearPayloadErrors = {
  idMissing: ({ field, node }: { field: string; node: string }): LinearPayloadIdMissingError => ({
    code: "PAYLOAD_ID_MISSING",
    field,
    message: `${field} returned a ${node} missing its id`,
    node,
  }),
  noData: (): LinearPayloadNoDataError => ({
    code: "PAYLOAD_NO_DATA",
    message: "the response carried no data object",
  }),
  nodeMissing: ({ field, node }: { field: string; node: string }): LinearPayloadNodeMissingError => ({
    code: "PAYLOAD_NODE_MISSING",
    field,
    message: `${field} reported success but returned no ${node}`,
    node,
  }),
  payloadMissing: ({ field }: { field: string }): LinearPayloadMissingError => ({
    code: "PAYLOAD_MISSING",
    field,
    message: `the response carried no ${field} payload`,
  }),
  unsuccessful: ({ field, success }: { field: string; success: unknown }): LinearPayloadUnsuccessfulError => ({
    code: "PAYLOAD_UNSUCCESSFUL",
    field,
    message: `${field} reported success: ${String(success)}`,
    success,
  }),
  uploadNoPayload: ({ field }: { field: string }): LinearPayloadMissingError => ({
    code: "PAYLOAD_MISSING",
    field,
    message: `${field} returned no payload`,
  }),
  uploadNotReserved: ({ field }: { field: string }): LinearPayloadNodeMissingError => ({
    code: "PAYLOAD_NODE_MISSING",
    field,
    message: `${field} reported success with no uploadFile — nothing was reserved`,
    node: "uploadFile",
  }),
  uploadSlotIncomplete: ({ field }: { field: string }): LinearPayloadNodeMissingError => ({
    code: "PAYLOAD_NODE_MISSING",
    field,
    message: `${field} reserved a slot with no uploadUrl, assetUrl or contentType`,
    node: "uploadFile",
  }),
} as const;
