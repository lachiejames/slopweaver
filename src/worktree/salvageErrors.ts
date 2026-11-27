/**
 * Why a salvage could not bind its history check, scan, push and read-back to one repository —
 * `./salvageDestination`'s `boundDestination` and `oneDestination` and the reads that feed them. Each variant's `message` completes "the salvage declined
 * because …" and never says what happened next; the caller appends that.
 */

/** The remote pushes somewhere its fetch url is not, or to more than one place. */
export interface PushUrlMismatchError {
  readonly code: "PUSH_URL_MISMATCH";
  readonly message: string;
  readonly remote: string;
}

/** The remote's url is itself another configured remote's name. */
export interface UrlIsRemoteNameError {
  readonly code: "URL_IS_REMOTE_NAME";
  readonly message: string;
  readonly remote: string;
}

/**
 * The ssh transport runs a configured command — `core.sshCommand`, `GIT_SSH_COMMAND` or `GIT_SSH` — which
 * sees every connection and may route the scan's and the push's to two repositories behind one url.
 */
export interface SshCommandError {
  readonly code: "SSH_COMMAND";
  readonly message: string;
}

/**
 * TLS verification is off — `http.sslVerify` (or a url-scoped `http.<url>.sslVerify`) false, or
 * `GIT_SSL_NO_VERIFY` set — so no certificate binds an https url to a server, and whatever answers the
 * connection may route the scan's reads and the push to two repositories.
 */
export interface TlsUnverifiedError {
  readonly code: "TLS_UNVERIFIED";
  readonly message: string;
}

/**
 * A `url.<base>.insteadOf` or `pushInsteadOf` is configured: git rewrites every url argument through it
 * again, so the url the check accepted is not the one the scan and push reach.
 */
export interface InsteadOfError {
  readonly code: "INSTEAD_OF";
  readonly message: string;
}

/** The url names no host a key or certificate binds — a local path, `file://`, `git://`, `http://` or `ext::`. */
export interface UnauthenticatedDestinationError {
  readonly code: "UNAUTHENTICATED_DESTINATION";
  readonly message: string;
  readonly remote: string;
}

/** Git could not be asked where the remote pushes. */
export interface DestinationUnreadableError {
  readonly code: "DESTINATION_UNREADABLE";
  readonly message: string;
  readonly remote: string;
}

/** Every way a salvage's destination fails to resolve to one repository. */
export type SalvageDestinationError =
  | InsteadOfError
  | DestinationUnreadableError
  | PushUrlMismatchError
  | SshCommandError
  | TlsUnverifiedError
  | UnauthenticatedDestinationError
  | UrlIsRemoteNameError;

/** The one place each {@link SalvageDestinationError} is built. */
export const SalvageDestinationErrors = {
  insteadOf: (): InsteadOfError => ({
    code: "INSTEAD_OF",
    message:
      "a url.<base>.insteadOf or pushInsteadOf is configured, so git rewrites the checked url again and the scan or the push could reach a repository the check never saw",
  }),
  sshCommand: (): SshCommandError => ({
    code: "SSH_COMMAND",
    message:
      "core.sshCommand, GIT_SSH_COMMAND or GIT_SSH is set, so a command of its own carries every ssh connection and the scan and the push could reach two repositories behind one url",
  }),
  tlsUnverified: (): TlsUnverifiedError => ({
    code: "TLS_UNVERIFIED",
    message:
      "http.sslVerify is set to something other than true, or GIT_SSL_NO_VERIFY is set, so no certificate binds the https url to a server and the scan and the push could reach two repositories behind one url",
  }),
  pushUrlMismatch: ({ remote, count }: { remote: string; count: number }): PushUrlMismatchError => ({
    code: "PUSH_URL_MISMATCH",
    message: `${remote} pushes to ${String(count)} url(s) that are not exactly its fetch url, so no one destination binds the scan to the push`,
    remote,
  }),
  unauthenticatedDestination: ({ remote }: { remote: string }): UnauthenticatedDestinationError => ({
    code: "UNAUTHENTICATED_DESTINATION",
    message: `${remote}'s url is not an ssh or https host, so nothing binds the repository the scan read to the one the push reaches`,
    remote,
  }),
  unreadable: ({ remote, cause }: { remote: string; cause: unknown }): DestinationUnreadableError => ({
    code: "DESTINATION_UNREADABLE",
    message: `could not read where ${remote} pushes — ${cause instanceof Error ? cause.message : "git could not be asked"}`,
    remote,
  }),
  urlIsRemoteName: ({ remote }: { remote: string }): UrlIsRemoteNameError => ({
    code: "URL_IS_REMOTE_NAME",
    message: `${remote}'s url names another configured remote, which git would read and push through separately`,
    remote,
  }),
} as const;
