/**
 * How a relay transport takes the machine's one relay lease (`relayLease.ts`) for its run — once, at once
 * for a console operation, or WAITING a bounded time for a live holder for a walk's pages and a capture.
 *
 * Split out of `relaySession.ts` when the waiting half arrived, so the session module stays about attaching
 * to and driving the relay while this one is about who may.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { BrowserError } from "./browserErrors.js";
import { type BrowserTransportError, BrowserTransportErrors } from "./pageTransport.js";
import { acquireRelayLease, acquireRelayLeaseWaiting, type RelayLease } from "./relayLease.js";
import type { PlaywrightCliDeps, RelaySession } from "./relaySession.js";
import { noteWalkCollision } from "./walkStops.js";

/**
 * Take the machine's one relay lease for this run, as a transport failure rather than a list of lines.
 *
 * @param deps the run's own home, platform and origins
 * @returns the lease, or why this run may not drive the owner's browser
 */
export function leaseFor({ deps }: { deps: PlaywrightCliDeps }): Result<RelayLease, BrowserTransportError> {
  const taken = acquireRelayLease({
    home: deps.home,
    nowIso: deps.nowIso(),
    origins: deps.origins,
    platform: deps.platform,
  });
  if (taken.isErr()) {
    noteCollisionOf({ error: taken.error });
    return err(BrowserTransportErrors.unavailable({ reason: taken.error.message }));
  }
  return ok(taken.value);
}

/**
 * Note a refused take as a collision when, and only when, ANOTHER live process held the relay.
 * `RELAY_HELD_BY_THIS_PROCESS` is this process's own bug, and a malformed origin is the walk's own — neither
 * is cleared by waiting for someone else to finish (`./walkStops.ts#noteWalkCollision`).
 */
function noteCollisionOf({ error }: { error: BrowserError }): void {
  if (error.code === "RELAY_HELD") {
    noteWalkCollision({ reason: error.message });
  }
}

/**
 * Make sure this session holds the machine's one relay lease, WAITING a bounded time for a live holder
 * (`relayLease.ts` § A contender WAITS).
 *
 * A wait that ends without the lease STOPS the session: every later operation is refused with the same
 * failure at once, so a thirty-page walk that lost the wait does not wait thirty more times.
 *
 * @param session the transport's own mutable state
 * @param deps the run's own home, platform, origins and wait
 * @returns the held lease, or why this run may not drive the owner's browser
 */
export async function holdRelayLease({
  session,
  deps,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
}): Promise<Result<RelayLease, BrowserTransportError>> {
  if (session.stopped !== null) {
    return err(session.stopped);
  }
  if (session.lease !== null) {
    return ok(session.lease);
  }
  const taken = await acquireRelayLeaseWaiting({
    home: deps.home,
    nowIso: deps.nowIso,
    origins: deps.origins,
    platform: deps.platform,
    wait: deps.leaseWait,
  });
  if (taken.isErr()) {
    noteCollisionOf({ error: taken.error });
    session.stopped = BrowserTransportErrors.unavailable({ reason: taken.error.message });
    return err(session.stopped);
  }
  session.lease = taken.value;
  return ok(taken.value);
}
