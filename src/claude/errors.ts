/**
 * The typed failure kinds of Claude plan ROUTING — the gate that decides which credential store a session
 * boots against, and repairs one that has merely expired. A caller branches on `code` and displays `message`;
 * per `.claude/rules/error-handling.md` this union stands alone and shares no base type with any other domain.
 *
 * The kinds here are genuinely distinct decisions rather than one message with variants: a shape change
 * closes the spawn gate, a REFUSED credential closes the same gate and is the ONE failure the gate now tries
 * to repair on demand, a transport failure closes it while repairing nothing, and a configuration that cannot
 * be read closes it for a reason no credential fixes. Four different things a caller does.
 *
 * ## Why `Rotation` is still in the name
 *
 * It predates the retirement of credential COPYING and it is kept deliberately rather than renamed in the
 * same change: the union is the one decision boundary for "which store, and may this session boot at all",
 * and a rename would touch every consumer in a diff whose subject is the mechanism. The three swap-only
 * variants this union used to carry — a check-in that could not return a credential, a post-write identity
 * mismatch, and an ambient credential outranking a swap — went with the writer they described, because
 * nothing copies a credential between slots any more.
 *
 * **No variant carries a credential value.** A domain error is printed into events and logs, and that is
 * exactly the path a secret must never take. Nor does any variant carry a caught exception: a thrown `fetch`
 * can hold a request object, and {@link ProbeTransportFailedError} deliberately keeps a constant wording
 * instead.
 */
import {
  type MintAddressUnboundError,
  type MintArgsInvalidError,
  type MintAuthorizeUrlUnexpectedError,
  MintErrors,
  type MintNoTokenError,
  type MintPtyFailedError,
  type MintTimedOutError,
} from "./mintErrors.js";

/** The response shape a gauge read returned is not one this code recognises — the FAIL-CLOSED case. */
export interface UsageShapeChangedError {
  readonly code: "USAGE_SHAPE_CHANGED";
  readonly message: string;
  /** Which required field was missing or unparseable, for the alert and for the next reader of this code. */
  readonly field: string;
}

/**
 * The provider REFUSED the credential a store presented, so there was no reading to take at all.
 *
 * Distinct from {@link UsageShapeChangedError} because the two send a reader to opposite places, and the
 * absence of this variant is what made a real outage unreadable. MEASURED: `plan-two` and
 * `plan-three` had been dead for roughly 39 and 42 hours, and `slopweaver claude gauge` said of both that
 * `the rate-limit gauge is missing or unparseable at anthropic-ratelimit-unified-5h-status — ... run
 * slopweaver claude gauge once the shape is confirmed`. Every word of that was true and the whole of it was
 * wrong: a `401` carries no rate-limit headers, so the fail-closed parser reported the FIRST field it could
 * not find and named a remedy — confirm the header shape — that does nothing at all for a dead credential,
 * while the reader who needed to sign in twice was told to go and read a header contract.
 *
 * A refusal is not an unrecognised shape. It closes the same gate, and it says a different thing.
 */
export interface CredentialRejectedError {
  readonly code: "CREDENTIAL_REJECTED";
  readonly message: string;
  /** Which configured plan's store was refused, so the refusal names the account to repair. */
  readonly alias: string;
  /** The HTTP status the provider answered with, which is what separates a refusal from a shape change. */
  readonly status: number;
}

/** The configured set of accounts is not usable — too few, duplicated, or missing a store directory. */
export interface SetupTokenRejectedError {
  readonly code: "SETUP_TOKEN_REJECTED";
  readonly message: string;
  /** Which configured plan's setup token was refused, so the refusal names the token to re-mint. */
  readonly alias: string;
  /** The HTTP status the provider answered with. */
  readonly status: number;
}

export interface SetupTokenUnreadableError {
  readonly code: "SETUP_TOKEN_UNREADABLE";
  readonly message: string;
  /** Which configured plan's token file is present and unusable. */
  readonly alias: string;
}

export interface SetupTokenInvalidError {
  readonly code: "SETUP_TOKEN_INVALID";
  readonly message: string;
}

export interface TokenArgsInvalidError {
  readonly code: "TOKEN_ARGS_INVALID";
  readonly message: string;
  /** Every reason the argument tail was refused, in the order they were found. */
  readonly problems: readonly string[];
}

export interface SetupTokenWriteFailedError {
  readonly code: "SETUP_TOKEN_WRITE_FAILED";
  readonly message: string;
  /** Where the token was being written, so the reader can go and look. */
  readonly path: string;
}

export interface AccountConfigInvalidError {
  readonly code: "ACCOUNT_CONFIG_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A named alias is not one of the configured accounts. */
export interface UnknownAccountError {
  readonly code: "UNKNOWN_ACCOUNT";
  readonly message: string;
  readonly alias: string;
}

/** A credential store directory does not exist, or holds no login for its account. */
export interface StoreNotReadyError {
  readonly code: "STORE_NOT_READY";
  readonly message: string;
  readonly alias: string;
}

/**
 * The probe request never got an answer at all — a dead network, a DNS failure, a timeout.
 *
 * It is its own variant rather than a second reading of {@link CredentialRejectedError} because the two send
 * the gate in opposite directions, and conflating them is how a dead network would become a storm of useless
 * refresh commands. A refusal is a statement ABOUT the credential; a transport failure is the absence of any
 * statement, so the only correct response is to attempt nothing, write nothing, and say which it was. An
 * owner closing a laptop for a day and an internet outage for a day are not the same case.
 *
 * It carries no cause. A thrown `fetch` can hold the whole request, headers included, and this message is
 * printed into logs and events.
 */
export interface ProbeTransportFailedError {
  readonly code: "PROBE_TRANSPORT_FAILED";
  readonly message: string;
  /** Which configured plan's probe could not be completed. */
  readonly alias: string;
}

/**
 * The install's configuration is PRESENT and could not be read — a permission error, a directory where a
 * file should be, an I/O failure. Either file can raise it: the plan register, or the Claude accounts file
 * an unadopted install still derives from.
 *
 * Distinct from {@link AccountConfigInvalidError}, which is a file read fine and holding something unusable,
 * and distinct again from nothing being configured, which is not an error at all: an install without the
 * fleet registers no Claude destination and boots on whatever credential is ambient. Collapsing all three
 * into one empty list is what let the routing gate fall silently through to an ambient credential — the
 * hazard sits at `spawnStore.ts`'s `configuredAccounts`, and it is the reason this variant exists.
 */
export interface AccountConfigUnreadableError {
  readonly code: "ACCOUNT_CONFIG_UNREADABLE";
  readonly message: string;
  /** Where the unreadable file is, so the reader can go and look at it. */
  readonly path: string;
}

/**
 * The plan register lives in the store, and the store could not be reached or queried — so which Claude plans
 * this install has is UNKNOWN, exactly as with {@link AccountConfigUnreadableError}, and the same refusal
 * follows: never boot on whatever credential is ambient.
 *
 * Its own variant rather than a widened unreadable one because there is no file to name: the remedy is the
 * store (`slopweaver store status`), not a permission check on a path. Never relabelled as invalid JSON
 * either, which would send the reader to edit a projection that was never the problem.
 */
export interface AccountConfigStoreUnavailableError {
  readonly code: "ACCOUNT_CONFIG_STORE_UNAVAILABLE";
  readonly message: string;
  /** The store answered and was refused as stale — the one outage the `stale-store` hatch lets the register read through. */
  readonly staleStore?: true;
}

/**
 * `claude pause` was asked to pause a plan that is already out of the fleet.
 *
 * It carries `sinceIso` because the useful answer to "pause plan-one" when plan-one is already paused is the
 * date somebody paused it, not the word "already": a pause nobody can date is the forgotten-pause failure
 * this whole shape exists to make visible.
 */
export interface PlanAlreadyPausedError {
  readonly code: "PLAN_ALREADY_PAUSED";
  readonly message: string;
  readonly alias: string;
  /** When the standing pause was recorded, ISO-8601. */
  readonly sinceIso: string;
}

/** `claude resume` was asked to put back a plan that was never taken out. */
export interface PlanNotPausedError {
  readonly code: "PLAN_NOT_PAUSED";
  readonly message: string;
  readonly alias: string;
}

/** A token was captured and did not prove the windows and the enrolled account, so nothing was written. */
export interface SetupTokenUnprovenError {
  readonly code: "SETUP_TOKEN_UNPROVEN";
  readonly message: string;
  readonly alias: string;
  /** The judge's own lines, which name the check that failed. */
  readonly lines: readonly string[];
}

/** Every failure kind Claude plan routing can produce. */
export type ClaudeRotationError =
  | PlanAlreadyPausedError
  | PlanNotPausedError
  | UsageShapeChangedError
  | CredentialRejectedError
  | SetupTokenRejectedError
  | SetupTokenUnreadableError
  | SetupTokenInvalidError
  | SetupTokenWriteFailedError
  | TokenArgsInvalidError
  | AccountConfigInvalidError
  | AccountConfigUnreadableError
  | AccountConfigStoreUnavailableError
  | UnknownAccountError
  | StoreNotReadyError
  | ProbeTransportFailedError
  | MintArgsInvalidError
  | MintAddressUnboundError
  | MintAuthorizeUrlUnexpectedError
  | MintTimedOutError
  | MintPtyFailedError
  | MintNoTokenError
  | SetupTokenUnprovenError;

/** Construct a {@link ClaudeRotationError}. Tests build fixtures through here, never as object literals. */
export const ClaudeRotationErrors = {
  usageShapeChanged: ({ field }: { field: string }): UsageShapeChangedError => ({
    code: "USAGE_SHAPE_CHANGED",
    field,
    message:
      `the rate-limit gauge is missing or unparseable at \`${field}\` — refusing to rotate on a reading ` +
      `this code does not understand; run \`slopweaver claude gauge\` once the shape is confirmed`,
  }),
  credentialRejected: ({ alias, status }: { alias: string; status: number }): CredentialRejectedError => ({
    alias,
    code: "CREDENTIAL_REJECTED",
    message:
      `the provider REFUSED \`${alias}\`'s stored credential with HTTP ${String(status)}, so this plan has ` +
      `no reading and no header shape to confirm — the pre-spawn routing gate repairs this on demand when that ` +
      `store still holds a live refresh grant, and reports per store what it attempted and why; one further ` +
      `refusal is not a diagnosis of that grant, whose own expiry is weeks out on an ordinary store`,
    status,
  }),
  setupTokenRejected: ({ alias, status }: { alias: string; status: number }): SetupTokenRejectedError => ({
    alias,
    code: "SETUP_TOKEN_REJECTED",
    message:
      `the provider REFUSED \`${alias}\`'s setup token with HTTP ${String(status)} — a setup token has no ` +
      `refresh grant, so nothing repairs it on demand; a seat mints a fresh one with ` +
      `\`slopweaver claude mint --plan ${alias}\`, and the owner only enters the code mailed to the plan's address`,
    status,
  }),
  setupTokenUnreadable: ({ alias }: { alias: string }): SetupTokenUnreadableError => ({
    alias,
    code: "SETUP_TOKEN_UNREADABLE",
    message:
      `\`${alias}\`'s setup token file exists and holds no readable token, so this plan is read as UNREADABLE ` +
      `rather than on its store — fix the file's permissions or replace it with ` +
      `\`slopweaver claude token --plan ${alias}\``,
  }),
  setupTokenInvalid: ({ problem }: { problem: string }): SetupTokenInvalidError => ({
    code: "SETUP_TOKEN_INVALID",
    message: `that is not a usable setup token — ${problem}; nothing was written`,
  }),
  tokenArgsInvalid: ({ problems }: { problems: readonly string[] }): TokenArgsInvalidError => ({
    code: "TOKEN_ARGS_INVALID",
    message: `claude token takes exactly one of --status or --plan <alias>: ${problems.join("; ")}`,
    problems,
  }),
  setupTokenWriteFailed: ({ cause, path }: { cause: unknown; path: string }): SetupTokenWriteFailedError => ({
    code: "SETUP_TOKEN_WRITE_FAILED",
    message: `could not write the setup token at ${path}: ${cause instanceof Error ? cause.message : "unknown failure"}`,
    path,
  }),
  accountConfigInvalid: ({ problems }: { problems: readonly string[] }): AccountConfigInvalidError => ({
    code: "ACCOUNT_CONFIG_INVALID",
    message: `the configured Claude accounts are not usable: ${problems.join("; ")}`,
    problems,
  }),
  planAlreadyPaused: ({ alias, sinceIso }: { alias: string; sinceIso: string }): PlanAlreadyPausedError => ({
    alias,
    code: "PLAN_ALREADY_PAUSED",
    message: `\`${alias}\` has been paused since ${sinceIso}; nothing changed`,
    sinceIso,
  }),
  planNotPaused: ({ alias }: { alias: string }): PlanNotPausedError => ({
    alias,
    code: "PLAN_NOT_PAUSED",
    message: `\`${alias}\` is not paused, so there is nothing to resume`,
  }),
  unknownAccount: ({ alias }: { alias: string }): UnknownAccountError => ({
    alias,
    code: "UNKNOWN_ACCOUNT",
    message: `no configured Claude account is called \`${alias}\``,
  }),
  storeNotReady: ({ alias }: { alias: string }): StoreNotReadyError => ({
    alias,
    code: "STORE_NOT_READY",
    message:
      `the credential store for \`${alias}\` holds no login — sign in once with ` +
      `\`CLAUDE_SECURESTORAGE_CONFIG_DIR=<its store> claude auth login\`, which is the one step that stays ` +
      `the owner's hand`,
  }),
  probeTransportFailed: ({ alias }: { alias: string }): ProbeTransportFailedError => ({
    alias,
    code: "PROBE_TRANSPORT_FAILED",
    message:
      `the probe request for \`${alias}\` could not be completed, so nothing was learned about its ` +
      `credential — this is the network, not a refusal, and no refresh is attempted for it`,
  }),
  accountConfigUnreadable: ({ path }: { path: string }): AccountConfigUnreadableError => ({
    code: "ACCOUNT_CONFIG_UNREADABLE",
    message:
      `the configured Claude accounts at \`${path}\` exist and could not be read, so which plans this ` +
      `install has is UNKNOWN — refusing rather than booting a session on whatever credential is ambient; ` +
      `check that file's permissions and that it is a file`,
    path,
  }),
  accountConfigStoreUnavailable: ({
    message,
    staleStore,
  }: {
    message: string;
    staleStore?: boolean;
  }): AccountConfigStoreUnavailableError => ({
    code: "ACCOUNT_CONFIG_STORE_UNAVAILABLE",
    message,
    ...(staleStore === true ? { staleStore: true as const } : {}),
  }),
  ...MintErrors,
  setupTokenUnproven: ({ alias, lines }: { alias: string; lines: readonly string[] }): SetupTokenUnprovenError => ({
    alias,
    code: "SETUP_TOKEN_UNPROVEN",
    lines,
    message: lines.join("; "),
  }),
} as const;
