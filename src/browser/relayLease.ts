/**
 * The one thing a browser walk must hold before it may drive the owner's Chrome: an exclusive, origin-bound
 * lease on the extension relay.
 *
 * ## Why a lease rather than a convention
 *
 * MEASURED: four walks — github, linear, notion and a fourth — started at once
 * against the owner's real Chrome. The relay's shared context is ONE tab (`playwrightCli.ts` carries that
 * measurement), every walk NAVIGATES that same tab, and nothing serialised access to it. Three of the four
 * died; the survivor was worse. The Notion walk's pages landed on `linear.app` — its own report said *"the
 * client sent this address to https://linear.app, which is not where it was asked to go"* — and it KEPT
 * 36 of 37 and 107 of 114 response bodies from the wrong site, filed under Notion. A crashed walk still
 * wrote its stores, so `github`'s `/settings/profile` went from landed, photographed and nine endpoints to
 * `outcome: failed` with no screenshots, overwriting a good record.
 *
 * The rule is that it is structurally impossible for two atlas runs on the same integration to run at the
 * same time, and structurally impossible for one integration's atlas to land in another. So this is not a warning and not a convention both walks promise to keep. It is the object a
 * transport cannot be driven without, and it carries BOTH properties in one value:
 *
 * - **Exclusion.** One key for the whole machine, not one per platform. The corruption measured was
 *   CROSS-platform, because the contended resource is the single relay tab rather than any atlas's store —
 *   so a per-platform key would have refused nothing that actually happened.
 * - **Origin binding.** A lease names the origins its walk is allowed to touch, and
 *   {@link isOnLeaseOrigin} is what the transport asks before it visits and after the page settles. A walk
 *   that cannot ask for another platform's address, and cannot return a byte that came from one, cannot
 *   file one platform's pages under another.
 *
 * ## A live holder is never stolen from
 *
 * `admit/operationLock.ts` takes over a lock older than its stale threshold, which is right for a
 * `github stack push` that a crash left behind and catastrophically wrong here: a walk of thirty pages at
 * the measured 7.7 seconds each runs for minutes, and a longer one runs past any threshold worth setting.
 * Stealing from a walk that is still driving the tab reproduces the exact measured failure. So the threshold
 * is {@link RELAY_LEASE_STALE_AFTER_MS} — infinite — which leaves the lock's OTHER recovery path intact and
 * is the one that matters: a holder whose pid the kernel no longer knows is taken over at once, whatever
 * its age. An abandoned lease therefore heals itself on the next attempt rather than wedging the tool, and
 * no exit hook is needed to make that true.
 *
 * The lock reads that infinity as the DECLARATION it is and refuses the loser with *"under a lease declared
 * never to go stale while its holder lives"*. An earlier build read it as an unusable argument instead,
 * and the loser of two concurrent `browser shot` walks was told *"the stale threshold it was given,
 * Infinity, is not a finite number of milliseconds"* — a working mechanism reporting itself broken, which
 * is what sent two sessions into `operationLock.ts` looking for a bug that was not there.
 *
 * ## A contender WAITS for a live holder, for a bound, instead of losing at once
 *
 * MEASURED, one scheduled pass: the typeform, vanta and
 * xero resyncs all stopped at this lease, each holder confirmed ALIVE by signal 0 — and a hand retry
 * lost again to a live holder. Vanta's API half had
 * already synced for 1825 seconds before its walk met the lease and the whole row graded failed. A refusal
 * the instant the tab is busy made every browser-backed resync a coin toss against whichever bot turn or
 * hand walk happened to be running, on the one browser this device has by standing rule.
 *
 * So {@link acquireRelayLeaseWaiting} re-attempts on the shared local wait schedule (`wait/loop.ts`) for
 * {@link RELAY_LEASE_WAIT_SECONDS}, and every attempt is a WHOLE acquisition with the same infinite stale
 * threshold — waiting changes WHEN a contender gets the tab, never WHETHER a live holder keeps it. One case
 * refuses at once instead: THIS process already holding — or already waiting for — a lease, which waiting
 * could only ever time out on. The residue, stated: a release whose unlink genuinely fails (not "already
 * gone") only warns, so the lock file can outlive a count that reads free, and a later walk in the same
 * process then waits out its bound on itself and fails naming its own pid — bounded, and preceded by that
 * warning on stderr.
 */
import { acquireOperationLock } from "../admit/operationLock.js";
import { acquireOperationLockWaiting } from "../admit/operationLockWait.js";
import { logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS, realWaitClock, type WaitClock } from "../wait/loop.js";
import { type BrowserError, BrowserErrors } from "./browserErrors.js";

/**
 * The single lock key every browser walk on this machine contends for.
 *
 * One key, deliberately: see this module's header on why a per-platform key would have refused nothing.
 *
 * @internal
 */
export const RELAY_LEASE_KEY = "browser-relay";

/**
 * How old a held lease may be before a later caller may take it over: never, while its holder lives.
 *
 * @internal
 */
export const RELAY_LEASE_STALE_AFTER_MS = Number.POSITIVE_INFINITY;

/**
 * How long a walk waits for a live holder before it gives up: the shared default wait (`wait/loop.ts` carries
 * why it sits under the 600-second FOREGROUND Bash ceiling). That makes the WAIT's own verdict reach a hand
 * run; a lease got late in the bound still has its walk to run, so a foreground run can outlast the ceiling —
 * background a walk rather than trusting this number to cover it.
 *
 * A holder that outlives it still wins — a 251-page Linear walk runs past it — and the loser fails exactly as
 * it did before this wait existed, naming the holder.
 */
export const RELAY_LEASE_WAIT_SECONDS = DEFAULT_WAIT_TIMEOUT_SECONDS;

/** How one walk waits for the relay: the clock it sleeps on, where a waiting line goes, and for how long. */
export interface RelayLeaseWait {
  readonly clock: WaitClock;
  readonly emit: (line: string) => void;
  readonly timeoutSeconds: number;
}

/**
 * The production wait: the real clock, stderr — where a scheduled pass's slot and a watching session both
 * read a walk's progress — and {@link RELAY_LEASE_WAIT_SECONDS}.
 *
 * @returns the wait every real transport is built with
 */
export function realRelayLeaseWait(): RelayLeaseWait {
  return {
    clock: realWaitClock(),
    emit: (line) => {
      logger.error({ msg: line });
    },
    timeoutSeconds: RELAY_LEASE_WAIT_SECONDS,
  };
}

/**
 * How many relay leases THIS process holds right now — raised by a successful acquisition, lowered once by its
 * release. What makes a self-contended wait refuse at once rather than sleep out its whole bound.
 */
let leasesHeldHere = 0;

/** An exclusive claim on the extension relay, bound to the origins one walk may touch. */
export interface RelayLease {
  /** The platform whose walk holds this, so a refusal on the other side can name it. */
  readonly platform: string;
  /** Every origin this walk may address. Non-empty, and each is a bare origin with no path. */
  readonly origins: readonly string[];
  /** Give the relay back. Safe to call more than once. */
  readonly release: () => void;
}

/**
 * Normalise one declared origin, refusing anything carrying a path, a query or a fragment.
 *
 * A declaration like `https://app.notion.com/settings` would bind the lease to the ORIGIN and silently
 * permit every other path under it, which reads like a narrower grant than it is. Refusing it keeps a
 * lease's own text and its meaning the same thing.
 *
 * @param origin the origin a walk declared
 * @returns the origin, or why it is not one
 */
function normaliseOrigin({ origin }: { origin: string }): Result<string, BrowserError> {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return err(BrowserErrors.relayOriginNotAbsolute({ origin }));
  }
  if (parsed.origin !== origin) {
    return err(BrowserErrors.relayOriginNotBare({ bareOrigin: parsed.origin, origin }));
  }
  return ok(parsed.origin);
}

/**
 * Whether a URL is one the lease permits.
 *
 * Compared by ORIGIN rather than by prefix, because a prefix test says yes to
 * `https://app.notion.com.example.invalid` — scheme, host and port together are the only thing that decides
 * whether two addresses are the same site.
 *
 * @param lease the lease the walk holds
 * @param url the address about to be asked for, or the one a page settled on
 * @returns whether the address is on one of the lease's own origins
 */
export function isOnLeaseOrigin({ lease, url }: { lease: RelayLease; url: string }): boolean {
  try {
    return lease.origins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Take the machine's one relay lease for one walk.
 *
 * @param home the state home the lock file lives under
 * @param platform the atlas whose walk is asking, named in a refusal so the reader knows who is holding
 * @param origins every origin this walk may address; at least one, each a bare origin
 * @param nowIso the instant of the attempt
 * @returns the lease, or every reason this walk may not drive the relay
 */
export function acquireRelayLease({
  home,
  platform,
  origins,
  nowIso,
}: {
  home: string;
  platform: string;
  origins: readonly string[];
  nowIso: string;
}): Result<RelayLease, BrowserError> {
  const normalised = normaliseOrigins({ origins, platform });
  if (normalised.isErr()) {
    return err(normalised.error);
  }
  const held = acquireOperationLock({
    home,
    key: RELAY_LEASE_KEY,
    nowIso,
    staleAfterMs: RELAY_LEASE_STALE_AFTER_MS,
  });
  if (held.isErr()) {
    return err(BrowserErrors.relayHeld({ detail: held.error, platform }));
  }
  leasesHeldHere += 1;
  return ok(countedLease({ origins: normalised.value, platform, release: held.value.release }));
}

/**
 * Take the machine's one relay lease for one walk, WAITING a bounded time for a live holder to finish.
 *
 * Origins are checked before anything waits, so a malformed declaration is refused at once rather than after
 * the bound. A lease this process already holds is refused at once too — see this module's header.
 *
 * @param home the state home the lock file lives under
 * @param platform the atlas whose walk is asking, named in every waiting line and in a refusal
 * @param origins every origin this walk may address; at least one, each a bare origin
 * @param nowIso read again per attempt, because each attempt records its own instant in the lock file
 * @param wait the clock, the waiting-line sink and the bound
 * @param acquire the injected lock acquisition, so a unit test can stand in a holder that is another process
 * @returns the lease, or every reason this walk may not drive the relay
 */
export async function acquireRelayLeaseWaiting({
  home,
  platform,
  origins,
  nowIso,
  wait,
  acquire = acquireOperationLock,
}: {
  home: string;
  platform: string;
  origins: readonly string[];
  nowIso: () => string;
  wait: RelayLeaseWait;
  acquire?: typeof acquireOperationLock;
}): Promise<Result<RelayLease, BrowserError>> {
  const normalised = normaliseOrigins({ origins, platform });
  if (normalised.isErr()) {
    return err(normalised.error);
  }
  if (leasesHeldHere > 0) {
    return err(BrowserErrors.relayHeldByThisProcess({ platform }));
  }
  // Reserved BEFORE the await, so a second walk this process starts while this one is still waiting is
  // refused at once rather than sleeping out its own bound behind a lease that is ours.
  leasesHeldHere += 1;
  let got = false;
  let held: Awaited<ReturnType<typeof acquireOperationLockWaiting>>;
  try {
    held = await acquireOperationLockWaiting({
      acquire,
      clock: wait.clock,
      emit: (line) => {
        wait.emit(`the ${platform} walk is ${line}`);
      },
      home,
      key: RELAY_LEASE_KEY,
      nowIso,
      staleAfterMs: RELAY_LEASE_STALE_AFTER_MS,
      timeoutSeconds: wait.timeoutSeconds,
    });
    got = held.isOk();
  } finally {
    if (!got) {
      leasesHeldHere -= 1;
    }
  }
  if (held.isErr()) {
    return err(BrowserErrors.relayWaitTimedOut({ detail: held.error, platform, waitedSeconds: wait.timeoutSeconds }));
  }
  return ok(countedLease({ origins: normalised.value, platform, release: held.value.release }));
}

/** Every declared origin, normalised, or the first reason one cannot bind a lease. */
function normaliseOrigins({
  origins,
  platform,
}: {
  origins: readonly string[];
  platform: string;
}): Result<readonly string[], BrowserError> {
  if (origins.length === 0) {
    return err(BrowserErrors.relayOriginsEmpty({ platform }));
  }
  const normalised: string[] = [];
  for (const origin of origins) {
    const one = normaliseOrigin({ origin });
    if (one.isErr()) {
      return err(one.error);
    }
    normalised.push(one.value);
  }
  return ok(normalised);
}

/**
 * A lease the caller has already counted, lowered exactly once however often it is released — and only
 * AFTER the lock has been given back, so the count never reads free while the lock file still names us.
 */
function countedLease({
  origins,
  platform,
  release,
}: {
  origins: readonly string[];
  platform: string;
  release: () => void;
}): RelayLease {
  let released = false;
  return {
    origins,
    platform,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      try {
        release();
      } finally {
        leasesHeldHere -= 1;
      }
    },
  };
}
