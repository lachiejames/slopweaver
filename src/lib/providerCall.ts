/**
 * The PACED provider call — one execution path for every lifecycle mutation.
 *
 * This is the door that `safeApiCall` alone could not be. `safeApiCall` maps a thrown SDK error into a
 * typed one and does nothing else; call sites then wrap it AROUND `retryTransient`, which puts the retry
 * loop outside any pacing. That ordering has two consequences worth stating, because both are subtle and
 * both are the reason this file exists: retried attempts are not individually paced, and a 429 only
 * reaches a shared block after the whole retry budget is spent — during which every other caller has been
 * hammering the same exhausted quota.
 *
 * So the order is inverted here. Per ATTEMPT:
 *
 *   1. wait for the shared per-(provider, scope) block to open
 *   2. pace through the throttle for this operation's endpoint class
 *   3. run exactly ONE raw SDK call
 *   4. on failure map it to a typed error and record a 429 on the block IMMEDIATELY
 *   5. consult {@link retryDecision}, and only then maybe go round again
 *
 * ## Why posting is a first-class special case
 *
 * `chat.postMessage` is irreversible and must stay AT-MOST-ONCE — PR5.1 found it running under up to ~44
 * combined attempts, where a processed-but-lost response double-posts invisibly to the O_EXCL reservation.
 * `retryMode: "never"` is therefore a correctness requirement, not a tuning knob, and this file has to
 * honour the shared block without ever re-attempting:
 *
 *   - an EXISTING block DELAYS the first attempt, which is safe precisely because nothing has been sent
 *     yet, so waiting cannot duplicate anything;
 *   - a 429 earned BY the post records the block and returns the failure. No second attempt, ever.
 *
 * Refusing outright rather than delaying would be needlessly lossy; ignoring the block would defeat the
 * point of sharing one.
 *
 * ## Which layer owns the rate-limit wait
 *
 * The BLOCK does. A `Retry-After` hint goes to `recordLimited`, which stores an ABSOLUTE deadline that
 * every caller of this door then waits on; the retry loop deliberately does not also sleep `retryAfterMs`
 * itself. Nothing is waited twice as a result, because an absolute deadline ABSORBS the generic backoff
 * taken before it: the next attempt starts at `max(backoff, retryAfter)` from the failure, never at their
 * sum. So the hint is honoured in exactly one place, and honouring it there honours it for every caller
 * rather than only for the request that earned the 429.
 *
 * Generic exponential backoff still applies to a 429 as it does to a 5xx, and is redundant on the
 * absorbed path — but it is the only ordering that keeps `p-retry` owning the attempt budget. Skipping a
 * 429's backoff would mean not consuming a retry for it, and a persistent 429 would then never terminate.
 *
 * ## What is NOT claimed
 *
 * Pacing is applied where {@link PACED_CLASSES} says to pace, which is narrower than the registry's
 * coverage — see that constant for why. And GitHub keeps its own `@octokit/plugin-retry` +
 * `plugin-throttling` (a settled decision predating this file), so Octokit's internal retries do not come
 * through here. "One path" is scoped to the calls that route through this function, and is not asserted
 * over the whole program.
 */
import { createHash } from "node:crypto";

import { ResultAsync } from "neverthrow";

import { type IngestError, toIngestError } from "./ingestError.js";
import { type RateBlock, sharedRateBlock } from "./rateBlock.js";
import { effectiveRatePerSec, endpointClassFor } from "./rateLimits.js";
import {
  createRateScheduler,
  type RateScheduler,
  type RetryPolicy,
  retryDecision,
  retryTransient,
} from "./resilience.js";
import { err, ok, type Result } from "./result.js";

/** Whether shared retry may try again, or whether exactly one attempt is permitted. */
export type ApiRetryMode = "transient" | "never";

/** The backoff knobs this door hands the shared retry driver. */
export type ProviderBackoff = Pick<RetryPolicy, "minTimeoutMs" | "maxTimeoutMs" | "randomize">;

/**
 * The observer for each backoff about to be taken — deliberately SEPARATE from {@link ProviderBackoff}.
 *
 * Keeping it out of the tuning object is what lets a test watch the schedule while leaving the schedule
 * itself at its shipped default. Folded in, every observing test would have to supply its own numbers, and
 * "the default is actually wired to the call" would be assertable only by re-stating the constant — which
 * is a test of a literal, not of the program.
 */
export type ProviderRetryObserver = RetryPolicy["onRetryDelay"];

/**
 * No override: the spacing is whatever {@link retryTransient} ships — 500ms, doubling, jittered, capped at
 * 30s.
 *
 * Deliberately NOT restated as a constant here. PR5.2 moved the retry loop into this door and left the
 * backoff behind, so a transient 5xx on an unpaced class re-fired four times with no spacing at all; the fix
 * is to route through the shared driver, and a second copy of its numbers would be a second thing to keep in
 * step — one that no test could distinguish from the original while the two agreed.
 */
const NO_BACKOFF_OVERRIDE: ProviderBackoff = {};

/**
 * Which provider/class pairs are actually PACED, as opposed to merely registered.
 *
 * The registry records what the limits ARE; this records where slopweaver currently ENFORCES them, and the
 * two are deliberately different. Slack's write and update classes are paced because their volume is tiny
 * and a progress tick loop is the one thing in this program that mutates a remote resource repeatedly, so
 * pacing costs nothing there.
 *
 * Slack's READ lane is deliberately excluded. Pacing a crawl at the documented tier-3 rate would serialise
 * it to forty calls a minute; measured against the real workspace the crawl sustains ~62, so
 * enforcing the registry rate is a ~1.55x SLOWDOWN, not a speed-up. That belongs in a measured change about
 * ingest speed, not as a side effect of a migration. The shared BLOCK still applies to every call routed
 * through here regardless, so a 429 anywhere still stops everyone — which is the locked requirement.
 *
 * Note the CLASS is not a fine enough key to express that on its own, which PR5.2.1b discovered the hard
 * way: `chat.update` and `conversations.history` are both tier3, so once the read seams moved onto this
 * door, `slack:tier3` silently began pacing the crawl that this set was written to leave alone. The same
 * label is genuinely used by both lanes — `writeApi` reads history too — so no class-level or label-level
 * rule can separate them. The read seams therefore pass `paced` `false` explicitly, and
 * the `operation-labels` gate keeps that opt-out to the two files entitled to it.
 *
 * ## One behaviour change this DID make, stated rather than buried
 *
 * PR5.2 migrated six write-lane calls onto this door and left six behind. Bringing the other six over means
 * three of them — `chat.update` (attach-media), `chat.delete`, and the post-send `conversations.history`
 * read-back — are tier3 and therefore now PACED, where on the old door they were not. That is a real change:
 * consecutive tier3 calls in one composite send are now spaced ~1.5s apart, so sending an image can take a
 * couple of seconds longer.
 *
 * It is kept rather than exempted because it is what this set already SAYS: the write lane is paced, its
 * volume is tiny, and `chat.update` was already paced at its sibling call site — leaving the other one
 * unpaced would have been the inconsistency. The crawl, which is the case the rate actually matters for, is
 * untouched.
 *
 * ## Two READ classes are paced, because a burst costs someone else
 *
 * `make:read` is paced because Make's quota is per ORGANISATION and small — 60 a minute on its lowest plan —
 * and a fill walks one blueprint and one execution list per scenario, so an unpaced fill of a large
 * organisation would spend the whole quota other integrations on that organisation share.
 *
 * `knowbe4:read` is paced because KnowBe4 meters the whole account at 50 a minute with a five-minute lockout
 * past it, and Vanta's KnowBe4 connector draws on that same allowance, so an unpaced sync's burst is a lockout
 * of Vanta's evidence collection rather than a slow crawl of our own. A sync is at
 * most 250 requests, so pacing it at the registry rate costs minutes, not the hours the Slack crawl argument
 * above is about.
 */
const PACED_CLASSES: ReadonlySet<string> = new Set([
  "github:write",
  "knowbe4:read",
  "make:read",
  "slack:chat-post",
  "slack:tier3",
]);

/**
 * Whether calls on one provider class are spaced at the registry rate, rather than only stopped by the block.
 *
 * @param provider the registry's provider key
 * @param endpointClass the class within it
 * @returns whether {@link PACED_CLASSES} names the pair
 * @internal
 */
export function isPacedClass({ provider, endpointClass }: { provider: string; endpointClass: string }): boolean {
  return PACED_CLASSES.has(`${provider}:${endpointClass}`);
}

/** How many attempts a `transient` call makes in total, including the first. */
const MAX_ATTEMPTS = 4;

/**
 * The attempt budget for a client that has GIVEN UP its SDK's own retries (PR5.2.1b).
 *
 * The Slack read clients set `retries: 0` so a 429 reaches the shared block instead of being slept off
 * inside the SDK. That is the right trade, but it removes patience the crawl was relying on:
 * `@slack/web-api` defaults to `tenRetriesInAboutThirtyMinutes`, and against the real workspace a
 * ten-minute crawl slice absorbed 29 rate limits. Channel discovery (`conversations.list`) is the one FATAL
 * seam in the Slack crawl — if it fails, the whole run fails — so a budget smaller than the SDK's turns a
 * survivable burst of 429s into an aborted crawl.
 *
 * ELEVEN, not ten, and not a round number chosen for feel: the SDK's policy is ten RETRIES after the first
 * attempt, so eleven total attempts is exactly what it used to provide. An earlier draft of this constant
 * was eight, on the reasoning that each attempt here waits the block's absolute `Retry-After` deadline while
 * every other caller is stopped too, so our attempts are worth more than the SDK's were. That reasoning is
 * sound but it is not a proof, and an adversarial review produced the obvious counter-example — nine
 * consecutive 429s. Matching the SDK exactly costs nothing and leaves no regression to argue about.
 */
export const SDK_REPLACEMENT_ATTEMPTS = 11;

/** The per-(provider, scope, class) throttles, built once and shared for the process's lifetime. */
const SCHEDULERS = new Map<string, RateScheduler>();

/** The shared throttle for one provider/scope/class, created on first use. */
function schedulerFor({
  provider,
  scopeId,
  endpointClass,
  ratePerSec,
}: {
  provider: string;
  scopeId: string;
  endpointClass: string;
  ratePerSec: number;
}): RateScheduler {
  const key = `${provider} ${scopeId} ${endpointClass}`;
  const existing = SCHEDULERS.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = createRateScheduler({ ratePerSec });
  SCHEDULERS.set(key, created);
  return created;
}

/**
 * A stable, NON-REVERSIBLE scope id for a token.
 *
 * Slack's quota is per-workspace and one bot token belongs to one workspace, so a token digest is a
 * correct workspace key without an extra `auth.test` round trip. It is hashed and truncated because this
 * value lands in map keys and possibly in a diagnostic line, and a token must never be in either.
 *
 * @param token the provider credential
 * @returns a short opaque digest usable as a scope key
 */
export function scopeIdForToken({ token }: { token: string }): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/** Wait for the block, pace, and run exactly ONE raw call. */
async function runOneAttempt<T>({
  execute,
  operation,
  provider,
  scopeId,
  block,
  blockWait,
  paced,
}: {
  execute: () => Promise<T> | T;
  operation: string;
  provider: string;
  scopeId: string;
  block: RateBlock;
  blockWait: boolean;
  paced: boolean;
}): Promise<Result<T, IngestError>> {
  const scope = { provider, scopeId };
  if (blockWait) {
    await block.waitUntilOpen({ scope });
  }
  const { endpointClass } = endpointClassFor({ operation, provider });
  const rate = effectiveRatePerSec({ operation, provider });
  const scheduler =
    paced && rate !== undefined && rate > 0 && isPacedClass({ endpointClass, provider })
      ? schedulerFor({ endpointClass, provider, ratePerSec: rate, scopeId })
      : undefined;
  try {
    const value = scheduler === undefined ? await execute() : await scheduler(async () => execute());
    return ok(value);
  } catch (error) {
    const typed = toIngestError({ defaultKind: "http", error, operation, provider });
    const decision = retryDecision({ error: typed });
    if (decision.retryable && decision.reason === "rate-limit") {
      // Recorded on the FIRST 429, before any backoff, so every other caller stops immediately rather
      // than after this one request has exhausted its own retries.
      block.recordLimited({
        scope,
        ...(decision.retryAfterMs !== undefined ? { retryAfterMs: decision.retryAfterMs } : {}),
      });
    }
    return err(typed);
  }
}

/**
 * Thrown by a retryable attempt SOLELY to hand control back to `p-retry`, and caught in this module.
 *
 * A sentinel rather than the provider's own error, for two reasons. It cannot be mistaken downstream for a
 * real failure, and it sidesteps `p-retry`'s rule that a non-network `TypeError` always aborts the retries
 * — a provider SDK that fails with a `TypeError` is exactly the transient case this path must retry.
 */
class RetryAttemptSignal extends Error {
  constructor() {
    super("provider attempt failed retryably");
    this.name = "RetryAttemptSignal";
  }
}

/** Drive the attempts, honouring `retryMode` and the typed retry decision. */
async function runAttempts<T>({
  execute,
  operation,
  provider,
  scopeId,
  retryMode,
  block,
  blockWait,
  backoff,
  onRetryDelay,
  maxAttempts,
  paced,
}: {
  execute: () => Promise<T> | T;
  operation: string;
  provider: string;
  scopeId: string;
  retryMode: ApiRetryMode;
  block: RateBlock;
  blockWait: boolean;
  backoff: ProviderBackoff;
  onRetryDelay: ProviderRetryObserver;
  maxAttempts: number;
  paced: boolean;
}): Promise<Result<T, IngestError>> {
  if (retryMode === "never") {
    // AT-MOST-ONCE, structurally: the irreversible path never enters the retry driver, so there is no
    // attempt budget and no backoff branch that a later change could widen into a second POST.
    return runOneAttempt({ block, blockWait, execute, operation, paced, provider, scopeId });
  }
  // `last` is held OUTSIDE the driver because `p-retry` reports an exhausted budget by throwing, and what
  // this door owes its caller is the final TYPED failure rather than the sentinel that ended the loop.
  let last: Result<T, IngestError> | undefined;
  const attempt = async (): Promise<Result<T, IngestError>> => {
    // ONE attempt per call: the block wait and the pacing are INSIDE the retried unit, so a retried attempt
    // re-waits the block and re-paces rather than jumping the queue on the strength of having failed once.
    last = await runOneAttempt({ block, blockWait, execute, operation, paced, provider, scopeId });
    if (last.isOk() || !retryDecision({ error: last.error }).retryable) {
      return last;
    }
    throw new RetryAttemptSignal();
  };
  try {
    return await retryTransient({
      operation: attempt,
      // `isRetryable: () => true` because the sentinel is thrown ONLY when `retryDecision` already said so.
      // Letting the driver classify as well would be a second, weaker classifier over a synthetic error —
      // and it is the one that would have to re-learn that a cassette replay miss must never be retried.
      policy: {
        ...backoff,
        ...(onRetryDelay !== undefined ? { onRetryDelay } : {}),
        isRetryable: () => true,
        retries: maxAttempts - 1,
      },
    });
  } catch (error) {
    return exhausted({ error, last, operation, provider });
  }
}

/**
 * Turn whatever ended the retry loop into an outcome, because {@link runAttempts} must never reject — the
 * door wraps it in `fromSafePromise`.
 *
 * The sentinel is thrown only AFTER `last` is recorded, so an exhausted budget returns the final typed
 * failure. Anything else can only have come from a seam that threw on its own account, and is mapped here
 * rather than escaping.
 */
function exhausted<T>({
  error,
  last,
  operation,
  provider,
}: {
  error: unknown;
  last: Result<T, IngestError> | undefined;
  operation: string;
  provider: string;
}): Result<T, IngestError> {
  if (error instanceof RetryAttemptSignal && last !== undefined) {
    return last;
  }
  return err(toIngestError({ defaultKind: "http", error, operation, provider }));
}

/**
 * Run an external provider call through the shared block, the registry's pacing, and typed error mapping.
 *
 * @param execute exactly ONE raw SDK call — never a retry loop, which would sit outside the pacing
 * @param operation the operation label, e.g. `slack.chat.update`; it also selects the endpoint class
 * @param provider the external system, e.g. `slack`
 * @param scopeId what the quota is counted against — a workspace key for Slack (see {@link scopeIdForToken})
 * @param retryMode `never` for an irreversible call, `transient` for a repeatable one
 * @param block the shared 429 block; defaults to the process-wide one, which is the real behaviour — a
 *   test injects its own so a recorded block cannot leak into the next test
 * @param blockWait whether to WAIT on the shared block before attempting; `true` by default and for every
 *   ingest call. `false` is the preflight exemption — a `connect --check` probe must answer fast and must
 *   not look broken because an unrelated crawl earned a 429. The exemption is deliberately ASYMMETRIC: a
 *   non-waiting call still RECORDS any 429 it earns, so a probe never free-rides on the block it skips
 * @param backoff overrides the spacing between attempts; omitted — the real behaviour — the shared
 *   {@link retryTransient} default applies, and a test shrinks it to assert an exact schedule without waiting
 * @param onRetryDelay observes each backoff before it is taken; the seam that makes the spacing assertable
 *   at all, since `p-retry` owns the sleep and accepts no injected sleeper
 * @param maxAttempts total attempts for a `transient` call including the first; defaults to four. A client
 *   that disabled its SDK's own retries passes {@link SDK_REPLACEMENT_ATTEMPTS}. Ignored by `never`, which
 *   never enters the retry driver at all
 * @param paced whether this call may be throttled by {@link PACED_CLASSES}; `true` by default. The Slack
 *   READ seams pass `false`, because their class (tier3) is shared with the write lane that IS paced and no
 *   class- or label-level rule can tell the two apart. Opting out of the throttle does NOT opt out of the
 *   shared block — a read still waits on a 429 and still records one
 * @returns a typed result: the value, or the mapped error from the last permitted attempt
 */
export function safeProviderCall<T>({
  execute,
  operation,
  provider,
  scopeId,
  retryMode,
  block = sharedRateBlock(),
  blockWait = true,
  backoff = NO_BACKOFF_OVERRIDE,
  onRetryDelay,
  maxAttempts = MAX_ATTEMPTS,
  paced = true,
}: {
  execute: () => Promise<T> | T;
  operation: string;
  provider: string;
  scopeId: string;
  retryMode: ApiRetryMode;
  block?: RateBlock;
  blockWait?: boolean;
  backoff?: ProviderBackoff;
  onRetryDelay?: ProviderRetryObserver;
  maxAttempts?: number;
  paced?: boolean;
}): ResultAsync<T, IngestError> {
  // `fromSafePromise` is correct rather than lax: `runAttempts` catches every throw itself and returns an
  // outcome, so this promise cannot reject and there is no rejection for `fromPromise` to map.
  return ResultAsync.fromSafePromise(
    runAttempts({
      backoff,
      block,
      blockWait,
      execute,
      maxAttempts,
      onRetryDelay,
      operation,
      paced,
      provider,
      retryMode,
      scopeId,
    }),
    // `runAttempts` already produces the typed outcome, so this only flattens the nesting `fromSafePromise` added.
  ).andThen((result) => result);
}
