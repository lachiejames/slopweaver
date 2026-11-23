/**
 * The Make atlas's own typed failures.
 *
 * A discriminated union scoped to this one bounded module, per `.claude/rules/error-handling.md`. The callers
 * genuinely branch: a missing credential publishes a `not-configured` cell naming the one step that fills it
 * and exits 0, a refused write is the read-only rail firing and must never read as a network blip, and a call
 * Make answered with a status carries that status into the coverage cell.
 */

/** Where the owner mints a Make API token, and the read scopes the fill needs ticked — one sentence, shared. */
export const MAKE_TOKEN_MINT_STEPS =
  "In Make: avatar → Profile → API → Add token, ticking organizations:read, teams:read, scenarios:read, " +
  "connections:read and hooks:read and nothing else; then run `slopweaver secrets set make-api-token` and " +
  "`slopweaver secrets set make-zone` (the host in the Make URL, e.g. eu2.make.com)";

/** A secret this atlas needs is not in the secrets store. */
export interface MakeCredentialMissingError {
  readonly code: "CREDENTIAL_MISSING";
  readonly message: string;
  /** Every secret file that was absent, in the order checked. */
  readonly missing: readonly string[];
}

/**
 * A secret file exists but could not be read, or is empty. It is named by its secrets-store name, never its
 * absolute path: the path carries the state home, which is text this module has no reason to print.
 */
export interface MakeCredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly name: string;
}

/**
 * The zone file names a host that is not one of Make's published zones. It carries no copy of what the file
 * held: a secret file holding the wrong value may hold the token, pasted into the wrong one.
 */
export interface MakeZoneNotAllowedError {
  readonly code: "ZONE_NOT_ALLOWED";
  readonly message: string;
}

/** The read-only rail refused a request before it left the process. */
export interface MakeWriteRefusedError {
  readonly code: "WRITE_REFUSED";
  readonly message: string;
  readonly method: string;
  readonly url: string;
}

/** A read Make answered with an error status, or that never got an answer. */
export interface MakeReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly operation: string;
  /** Make's HTTP status, or `null` when the failure was never an answer. */
  readonly status: number | null;
}

/** A read answered, and a field the atlas keeps was missing or the wrong type. */
export interface MakeMalformedResponseError {
  readonly code: "MALFORMED_RESPONSE";
  readonly message: string;
  readonly operation: string;
}

export type MakeAtlasError =
  | MakeCredentialMissingError
  | MakeCredentialUnreadableError
  | MakeZoneNotAllowedError
  | MakeWriteRefusedError
  | MakeReadFailedError
  | MakeMalformedResponseError;

/** Construct one of this atlas's typed failures. The real code calls these, so a test should too. */
export const MakeAtlasErrors = {
  credentialMissing: ({ missing }: { missing: readonly string[] }): MakeCredentialMissingError => ({
    code: "CREDENTIAL_MISSING",
    message: `no Make credential is configured — absent from the secrets store: ${missing.join(", ")}. ${MAKE_TOKEN_MINT_STEPS}`,
    missing: [...missing],
  }),
  credentialUnreadable: ({ name, reason }: { name: string; reason: string }): MakeCredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message: `could not use the ${name} secret: ${reason}; check it with \`slopweaver secrets status\``,
    name,
  }),
  zoneNotAllowed: ({ allowed }: { allowed: readonly string[] }): MakeZoneNotAllowedError => ({
    code: "ZONE_NOT_ALLOWED",
    message: `the make-zone secret is not a Make zone this atlas addresses (its value is not printed) — expected one of ${allowed.join(", ")}; fix it with \`slopweaver secrets set make-zone\``,
  }),
  malformedResponse: ({ operation, reason }: { operation: string; reason: string }): MakeMalformedResponseError => ({
    code: "MALFORMED_RESPONSE",
    message: `${operation} answered with a body this atlas cannot read: ${reason}`,
    operation,
  }),
  readFailed: ({
    operation,
    status,
    reason,
  }: {
    operation: string;
    status: number | null;
    reason: string;
  }): MakeReadFailedError => ({
    code: "READ_FAILED",
    message:
      status === null
        ? `${operation} failed before Make answered — ${reason}`
        : `${operation} answered ${String(status)} — ${reason}`,
    operation,
    status,
  }),
  writeRefused: ({ method, url, why }: { method: string; url: string; why: string }): MakeWriteRefusedError => ({
    code: "WRITE_REFUSED",
    message: `the Make atlas is read-only: refused ${method} ${url} before sending — ${why}`,
    method,
    url,
  }),
} as const;
