/**
 * Whether a store the provider just refused is worth one refresh attempt, and whether an attempt achieved
 * anything. Pure: no clock, no keychain, no child process — the shell reads each store's own metadata, hands
 * it here, and performs what comes back.
 *
 * ## The reframing this module exists to perform
 *
 * **An expired access token is not a signed-out plan. It is a cache miss.** Every store's credential carries
 * a refresh grant weeks out beside its eight-hour access token, and MEASURED on this machine those
 * grants ran 27 to 29 days out against a seven-day bar. The eight-hour clock only ever
 * behaved like a sign-in deadline because nothing repaired a refusal at the moment something wanted the
 * store: the routing gate presented the cached token, was refused, reported the plan unreadable, and moved
 * on. So a timer was built, and then a better timer, and then a better one again, while the number that
 * actually decides when the owner must sign in sat unread in the same JSON object
 * (`credentialDocument.ts` § the refresh-grant readers).
 *
 * Repairing on demand removes the clock rather than improving it. Nothing is owed between spawns, because
 * nothing needs a token between spawns.
 *
 * ## Eligibility is NARROW on purpose, and every skip names itself
 *
 * One refresh command runs only for a store where all of these hold: the provider REFUSED it (an
 * `HTTP 401/403`, never a transport failure and never a successfully-read exhausted gauge), its own access
 * expiry is known and already past, it still holds a non-empty refresh token, and that grant's expiry is
 * known and in the future. Anything else is a named `skip`, and two of those names are the whole point:
 *
 * - **`not-credential-rejected`** covers the offline case the owner named. Probe failures that are TRANSPORT
 *   produce zero refresh commands, so a day without internet writes no credential and attempts nothing — it
 *   refuses the spawn and says which. A refresh storm against a dead network is the failure this prevents.
 * - **`access-not-expired`** is why a bare refusal is not enough. Claude Code refreshes a token only inside
 *   its last five minutes, so a command run against a credential with hours of life left does nothing at all
 *   and a refusal that is NOT an expiry is something else — a revoked grant, a wrong account, a store the
 *   owner has signed elsewhere — none of which a refresh repairs.
 *
 * An UNREADABLE deadline is never permission. An absent, mistyped or out-of-range refresh expiry answers
 * `unknown-refresh-expiry` and attempts nothing, because a reader that cannot see a grant has not seen a live
 * one.
 *
 * ## The offline guarantee is the REPAIR's, not the keep-alive TOUCH's — stated rather than discovered
 *
 * The routing gate and the `claude watch` repair both go through `probeRepair.ts`, so neither attempts anything
 * on a transport failure. The watch's TOUCH is a different mechanism: it computes which stores are due from
 * its own schedule, independently of any gauge, reads each due store's expiry, and runs the refresh once that
 * token is inside the CLI's own refresh window (`keepAliveTouch.ts`). So on a machine with no network a tick
 * can still run one refresh per due store in that window, which cannot succeed and is reported as a refresh
 * that did not advance the expiry, never recorded as a touch. Reproduce by running a non-dry `claude watch`
 * tick with networking down against a store inside its last five minutes.
 *
 * ## Why an attempt is judged by the EXPIRY, not by the command
 *
 * A refresh command that exits 0 proves nothing. MEASURED: `claude doctor` run from an empty directory
 * exited 0 against an expired store and wrote nothing at all, and in another run it exited 0 while writing
 * back an EMPTIED credential. So an attempt counts as a refresh only when that store's own expiry moved
 * strictly forward across a reading taken immediately BEFORE the command and one taken immediately after.
 * That witnesses a refresh WRITE across the interval and nothing more — not which process performed it, and
 * not that the provider will accept the new token. The second probe is the stronger witness, and the gate
 * takes it.
 *
 * Both the witness and its failure wordings are reused from the keep-alive timer rather than re-derived,
 * including the four cases a Codex review of it found: an unreadable reading after the attempt, an unreadable
 * one before it, a credential cleared across it, and a command that exited cleanly while the expiry stood
 * still. Only the `after`-unreadable and cleared-credential wordings are changed, and both for the same
 * reason: the keep-alive is a TIMER, so it could honestly promise "the next tick reads it
 * again" and could attribute a clearing to the provider's refusal. An on-demand gate has no next tick, and
 * two metadata readings do not observe an `invalid_grant`.
 */
import type { Result } from "../lib/result.js";
import type { ClaudeAccountGauge } from "./contracts.js";
import type { ClaudeRotationError } from "./errors.js";

/**
 * One store's own lifetime metadata, as the shell read it out of that store's credential.
 *
 * Every field is an instant or a boolean. No token fits into any of them, which is the bound that lets this
 * type cross a module boundary at all — `credentialDocument.ts` § Nothing here returns a credential's
 * contents carries the reasoning.
 */
export interface StoreLife {
  readonly alias: string;
  /** When this store's ACCESS token expires, ISO-8601. Absent when the credential carries no usable one. */
  readonly expiresAtIso?: string;
  /** Whether the store holds a non-empty access token at all. False means signed out, which no refresh repairs. */
  readonly hasCredential: boolean;
  /** Whether the store holds a non-empty REFRESH token — the grant a repair presents. */
  readonly hasRefreshToken: boolean;
  /**
   * When the REFRESH GRANT expires, ISO-8601 — the owner's real next-sign-in deadline. Absent means UNKNOWN
   * and never means alive.
   */
  readonly refreshExpiresAtIso?: string;
  /**
   * Whether the keychain item could not be READ at all this time — a locked keychain, a timeout, a
   * momentarily unavailable `security`. Distinct from a store that read fine and holds nothing: the reader
   * collapses both to "no credential", and reporting a transient read as a sign-out sends the owner to a
   * browser for a credential that is sitting there intact.
   */
  readonly unreadable?: boolean;
}

/**
 * What one refresh attempt achieved, judged by the store's expiry either side of it.
 *
 * @internal — the value {@link assessStoreRefresh} returns and the gate renders.
 */
export type StoreRefreshOutcome =
  | {
      readonly status: "refreshed";
      readonly alias: string;
      readonly beforeExpiresAtIso?: string;
      readonly afterExpiresAtIso: string;
      /** The command's own complaint, kept as a warning when the expiry advanced regardless. */
      readonly commandProblem?: string;
    }
  | {
      readonly status: "failed";
      readonly alias: string;
      readonly beforeExpiresAtIso?: string;
      readonly afterExpiresAtIso?: string;
      readonly problem: string;
    };

/**
 * Why a refused store was not worth one refresh command. Every reason is a case the gate prints.
 *
 * @internal — the `reason` of {@link StoreRepairDecision}'s skip arm; callers read the decision.
 */
export type StoreRepairSkipReason =
  /** The probe did not report a credential REFUSAL — a success, a transport failure, or an unread shape. */
  | "not-credential-rejected"
  /** The store's keychain item could not be read, so nothing is claimed about it either way. */
  | "unreadable-store"
  /** The store read fine and holds no access token: signed out, and only a browser sign-in repairs that. */
  | "no-credential"
  /** No refresh grant to present, so there is nothing a refresh could be made from. */
  | "no-refresh-token"
  /** The access expiry is absent, mistyped or out of range, so "already expired" cannot be established. */
  | "unknown-access-expiry"
  /** The access token has not expired, so the CLI's own five-minute window would refuse to refresh it. */
  | "access-not-expired"
  /** The refresh grant's expiry is absent, mistyped or out of range — UNKNOWN, which is never permission. */
  | "unknown-refresh-expiry"
  /** The refresh grant has itself expired, so only the owner's own browser repairs this store. */
  | "refresh-expired"
  /** The instant handed in could not be parsed, so no comparison against it means anything. */
  | "invalid-now"
  /** The refusal, the probed reading and the current reading do not all name one store. */
  | "identity-mismatch"
  /**
   * This physical store was already attempted in this same gate invocation. Two configured aliases can name
   * one store directory, and one invocation refreshes a store once.
   */
  | "already-attempted";

/**
 * What each skip whose ONLY repair is a fresh sign-in means, in the words the gate prints before naming the verb.
 *
 * Four reasons and no more. An unreadable store, an unknown expiry, an identity mismatch or an already-attempted
 * store does not establish that a sign-in is the repair, so none of them is told to sign in.
 *
 * `access-not-expired` is the one that needs saying. The CLI's refresh acts only inside a token's last five minutes,
 * and a provider refusing a token with hours left means that login was superseded — a refresh elsewhere minted a
 * new pair and revoked this copy (`watchTick.ts` § Never touch a store) — or revoked. MEASURED on this machine: one
 * plan printed the bare reason on every spawn for over three hours, and nothing said a sign-in was the fix.
 */
const SIGN_IN_ONLY_MEANINGS: Readonly<Partial<Record<StoreRepairSkipReason, string>>> = {
  "access-not-expired": "a refusal on an unexpired token is a superseded or revoked login, which no refresh repairs",
  "no-credential": "this store is signed out, which no refresh repairs",
  "no-refresh-token": "this store has no refresh grant, so no refresh can repair it",
  "refresh-expired": "this store's refresh grant has expired, which no refresh repairs",
};

/**
 * Why a skip's only repair is a sign-in, when it is one.
 *
 * @param reason the skip the gate took
 * @returns the meaning to print before the sign-in verb, or undefined when a sign-in is not established as the repair
 */
export function signInOnlyRepairSkipMeaning({ reason }: { reason: StoreRepairSkipReason }): string | undefined {
  return SIGN_IN_ONLY_MEANINGS[reason];
}

/** What to do about one store the routing gate could not read. */
export type StoreRepairDecision =
  /** Run exactly one refresh command under this store, then read it back and re-probe. */
  | { readonly kind: "attempt" }
  /**
   * Run NO command and re-probe: something else already advanced this store's access expiry into the future
   * between the probe and this reading, so the cached token the probe was refused on is no longer the one a
   * request would present.
   */
  | { readonly kind: "reprobe"; readonly reason: "advanced-since-probe" }
  /** Attempt nothing, for a named reason. */
  | { readonly kind: "skip"; readonly reason: StoreRepairSkipReason };

/**
 * An instant in epoch milliseconds, when it is one this build can compare.
 *
 * @param iso the instant to parse, when there is one
 * @returns the epoch-millisecond value, or undefined when it is absent or unparseable
 */
function parsedMs({ iso }: { iso: string | undefined }): number | undefined {
  if (iso === undefined) {
    return undefined;
  }
  const milliseconds = Date.parse(iso);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

/**
 * A store's ACCESS expiry in epoch milliseconds, when it holds a credential whose expiry this build can read.
 *
 * @param life one store's reading
 * @returns the expiry instant, or undefined for a signed-out store or an unreadable expiry
 */
function knownExpiryMs({ life }: { life: StoreLife }): number | undefined {
  // An UNREADABLE reading has no comparable expiry whatever else it carries, and that guard is here rather
  // than left to the reader because the TYPE permits the conflicting shape. Without it,
  // `{ hasCredential: true, expiresAtIso: <earlier>, unreadable: true }` before a reading with a later expiry
  // reports `refreshed`, on a store that was explicitly not read. `readStoreLife` never produces that
  // combination today — which is exactly why a witness must be bounded by its types and not by its producer.
  if (!life.hasCredential || life.unreadable === true) {
    return undefined;
  }
  return parsedMs({ iso: life.expiresAtIso });
}

/**
 * Whether a probe's reading was a credential REFUSAL rather than any other kind of failure.
 *
 * It reads the typed error's `code` and never its message, which is the whole reason `probePlan` carries a
 * real `Result` beside its renderable outcome: the old shape flattened a `401` and a dead network into one
 * `problem` string, and telling them apart by text is how a transport failure would have become a refresh
 * storm.
 *
 * @param reading what the probe concluded
 * @returns the refused alias when the provider refused a credential, or undefined otherwise
 */
export function refusedAlias({
  reading,
}: {
  reading: Result<ClaudeAccountGauge, ClaudeRotationError>;
}): string | undefined {
  if (reading.isOk()) {
    return undefined;
  }
  return reading.error.code === "CREDENTIAL_REJECTED" ? reading.error.alias : undefined;
}

/**
 * Decide what one refused store is worth, from its metadata as it stands NOW.
 *
 * The order of the checks is load-bearing and two places in it are not obvious.
 *
 * **The concurrent-advance branch comes before every refresh-grant requirement**, because it runs no command
 * at all. Another session, or the standing keep-alive, may have refreshed this store in the moments between
 * the probe being refused and this reading — in which case the cached token the refusal was about is already
 * gone and the correct act is one more probe, whatever the grant metadata says.
 *
 * **An advance that still leaves the token expired does not qualify for it.** A store refreshed from
 * yesterday to this morning has advanced and is still dead, so the remaining eligibility checks must run.
 *
 * @param current the store's metadata read immediately before any command, which is what decides
 * @param nowIso the instant to judge against, read AFTER `current` so a slow earlier store cannot stale it
 * @param probed the store's metadata as the probe itself read it, for the concurrent-advance comparison
 * @param reading what the probe concluded, which is what says whether this is a refusal at all
 * @returns the one act to perform for this store
 */
export function assessStoreRepair({
  current,
  nowIso,
  probed,
  reading,
}: {
  current: StoreLife;
  nowIso: string;
  probed: StoreLife;
  reading: Result<ClaudeAccountGauge, ClaudeRotationError>;
}): StoreRepairDecision {
  const refused = refusedAlias({ reading });
  if (refused === undefined) {
    return { kind: "skip", reason: "not-credential-rejected" };
  }
  if (refused !== probed.alias || probed.alias !== current.alias) {
    return { kind: "skip", reason: "identity-mismatch" };
  }
  const nowMs = parsedMs({ iso: nowIso });
  if (nowMs === undefined) {
    return { kind: "skip", reason: "invalid-now" };
  }
  if (current.unreadable === true) {
    return { kind: "skip", reason: "unreadable-store" };
  }
  if (!current.hasCredential) {
    return { kind: "skip", reason: "no-credential" };
  }
  const currentMs = knownExpiryMs({ life: current });
  const probedMs = knownExpiryMs({ life: probed });
  const advancedIntoTheFuture =
    currentMs !== undefined && probedMs !== undefined && currentMs > probedMs && currentMs > nowMs;
  if (advancedIntoTheFuture) {
    return { kind: "reprobe", reason: "advanced-since-probe" };
  }
  return repairableNow({ accessExpiresAtMs: currentMs, life: current, nowMs });
}

/**
 * Whether a refused, readable, still-credentialled store is worth one refresh command.
 *
 * Split out of {@link assessStoreRepair} for the branch ceiling rather than for a second idea: the caller has
 * already settled that this IS a refusal of a store it can read, and what remains is one question — is there a
 * live grant behind an access token that has actually expired.
 *
 * @param accessExpiresAtMs the store's access expiry in epoch milliseconds, when this build could read one
 * @param life the store's metadata as it stands now
 * @param nowMs the instant to judge against, in epoch milliseconds
 * @returns `attempt`, or the named reason not to
 */
function repairableNow({
  accessExpiresAtMs,
  life,
  nowMs,
}: {
  accessExpiresAtMs: number | undefined;
  life: StoreLife;
  nowMs: number;
}): StoreRepairDecision {
  if (!life.hasRefreshToken) {
    return { kind: "skip", reason: "no-refresh-token" };
  }
  const refreshMs = parsedMs({ iso: life.refreshExpiresAtIso });
  if (refreshMs === undefined) {
    return { kind: "skip", reason: "unknown-refresh-expiry" };
  }
  if (refreshMs <= nowMs) {
    return { kind: "skip", reason: "refresh-expired" };
  }
  if (accessExpiresAtMs === undefined) {
    return { kind: "skip", reason: "unknown-access-expiry" };
  }
  if (accessExpiresAtMs > nowMs) {
    return { kind: "skip", reason: "access-not-expired" };
  }
  return { kind: "attempt" };
}

/**
 * Judge one refresh attempt by the store's expiry either side of it.
 *
 * It counts as a refresh only when the store still holds a credential afterwards AND its expiry moved
 * strictly forward FROM A READING TAKEN BEFORE THE COMMAND. An unchanged expiry is a failure however cleanly
 * the command exited — that is exactly how `claude doctor` stopped refreshing anything without a single
 * error. An expiry that advanced despite a complaint from the command is still a refresh, and the complaint
 * rides along as a warning.
 *
 * **An unreadable BEFORE is a failure, not a success.** A
 * keychain read that transiently fails is `undefined`, exactly like a signed-out store, so treating an absent
 * before-reading as "anything afterwards is an improvement" reported a store as refreshed when the command
 * had timed out and its expiry had not moved at all. Nothing witnesses a refresh without both readings.
 *
 * @param after the store's reading immediately after the command
 * @param before the store's reading immediately before it
 * @param commandProblem why the command itself did not complete cleanly, when it did not
 * @returns what the attempt achieved
 */
export function assessStoreRefresh({
  after,
  before,
  commandProblem,
}: {
  after: StoreLife;
  before: StoreLife;
  commandProblem?: string;
}): StoreRefreshOutcome {
  // Both readings must be of the SAME store, or the "expiry moved" witness is comparing two accounts and
  // means nothing. The caller reads both from one account, so this is unreachable today — it is here because
  // a witness that can be satisfied by another store's reading is not a witness, and the Codex review pass
  // that named it was right that nothing in the types said so.
  if (before.alias !== after.alias) {
    return {
      alias: after.alias,
      problem: `the before and after readings are of different stores (${before.alias} and ${after.alias}), so nothing witnesses a refresh`,
      status: "failed",
    };
  }
  const beforeMs = knownExpiryMs({ life: before });
  const afterMs = knownExpiryMs({ life: after });
  const expiries = {
    ...(before.expiresAtIso === undefined ? {} : { beforeExpiresAtIso: before.expiresAtIso }),
    ...(after.expiresAtIso === undefined ? {} : { afterExpiresAtIso: after.expiresAtIso }),
  };
  if (afterMs !== undefined && after.expiresAtIso !== undefined && beforeMs !== undefined && afterMs > beforeMs) {
    return {
      alias: after.alias,
      status: "refreshed",
      ...expiries,
      afterExpiresAtIso: after.expiresAtIso,
      ...(commandProblem === undefined ? {} : { commandProblem }),
    };
  }
  const problem = refreshFailure({
    after,
    beforeUnreadable: beforeMs === undefined,
    ...(commandProblem === undefined ? {} : { commandProblem }),
  });
  return { alias: after.alias, problem, status: "failed", ...expiries };
}

/**
 * Why a refresh attempt that did not advance the expiry failed, in the words that send a reader to the fix.
 *
 * Two of these wordings differ from the keep-alive timer's, and both differ because that is a timer and this
 * is a gate. It can promise a reader that "the next tick reads it again"; there is no next tick here. And it
 * attributes a cleared credential to the provider refusing the grant, but two metadata readings either side of a command do not OBSERVE an `invalid_grant`, so the wording states
 * what was seen and stops there.
 *
 * @param after the store's reading after the attempt
 * @param beforeUnreadable whether the reading taken before the command gave no comparable expiry
 * @param commandProblem the command's own complaint, when it made one
 * @returns one sentence
 */
function refreshFailure({
  after,
  beforeUnreadable,
  commandProblem,
}: {
  after: StoreLife;
  beforeUnreadable: boolean;
  commandProblem?: string;
}): string {
  if (after.unreadable === true) {
    return (
      "the store could not be read back after the attempt, so nothing witnesses a refresh — its sign-in " +
      "state is unknown, and this is not evidence of one"
    );
  }
  if (beforeUnreadable) {
    return (
      "the store's own expiry could not be read before the attempt, so nothing witnesses a refresh — a " +
      "transient keychain read and a genuine repair are indistinguishable from the reading afterwards alone"
    );
  }
  if (!after.hasCredential) {
    return (
      "the store read back without an access credential after the attempt; the readings do not establish " +
      "why it was cleared — this store needs one browser sign-in"
    );
  }
  if (commandProblem !== undefined) {
    return `${commandProblem}, and the expiry did not advance`;
  }
  return "the refresh command exited cleanly and the expiry did not advance, so nothing was refreshed";
}
