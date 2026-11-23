/**
 * The Nx Cloud atlas's own failure vocabulary.
 *
 * A domain earns a typed union when its failures are genuinely distinct and a caller BRANCHES on them
 * (`.claude/rules/error-handling.md`), and these three are. `SESSION_ABSENT` is the owner's problem and is
 * fixed in the owner's browser; `CALL_FAILED` may clear on a later run and must not publish a half-generation;
 * `PAYLOAD_UNREADABLE` means the platform changed shape under us and is the one that wants a person to look.
 * Reporting all three as one string list would leave the sync unable to tell "run it again" from "the owner has to sign in".
 */

/** The owner's Chrome holds no usable session for Nx Cloud, so no channel can read anything. */
export interface NxCloudSessionAbsentError {
  readonly code: "SESSION_ABSENT";
  readonly message: string;
  /** What the jar read did report, so a keyring refusal is distinguishable from a signed-out browser. */
  readonly detail: string;
}

/** One read against the platform failed in a way a later run could clear. */
export interface NxCloudCallFailedError {
  readonly code: "CALL_FAILED";
  readonly message: string;
  /** The call id from `inventory.ts`, so a reader knows which surface is missing. */
  readonly call: string;
  /** The HTTP status, or `null` when the request never got one. */
  readonly statusCode: number | null;
}

/** A response arrived and could not be read as the shape this build expects. */
export interface NxCloudPayloadUnreadableError {
  readonly code: "PAYLOAD_UNREADABLE";
  readonly message: string;
  readonly call: string;
}

export type NxCloudAtlasError = NxCloudSessionAbsentError | NxCloudCallFailedError | NxCloudPayloadUnreadableError;

/** Construct this atlas's errors. Tests build fixtures through these, never through a literal. */
export const NxCloudAtlasErrors = {
  callFailed: ({
    call,
    statusCode,
    detail,
  }: {
    call: string;
    statusCode: number | null;
    detail: string;
  }): NxCloudCallFailedError => ({
    call,
    code: "CALL_FAILED",
    message:
      statusCode === null
        ? `the ${call} call did not complete: ${detail}`
        : `the ${call} call answered HTTP ${String(statusCode)}: ${detail}`,
    statusCode,
  }),
  payloadUnreadable: ({ call, detail }: { call: string; detail: string }): NxCloudPayloadUnreadableError => ({
    call,
    code: "PAYLOAD_UNREADABLE",
    message: `the ${call} response could not be read as this build expects — ${detail}`,
  }),
  sessionAbsent: ({ detail }: { detail: string }): NxCloudSessionAbsentError => ({
    code: "SESSION_ABSENT",
    detail,
    message:
      "your Chrome profile holds no Nx Cloud session, so nothing here can read the platform:" +
      ` ${detail}. Sign in at cloud.nx.app in the profile \`slopweaver browser profile\` reports`,
  }),
} as const;
