/**
 * A call being MINTED holds the console's rebuild swap, the way a live call's page beat does — `consoleHold.ts`
 * names the incident and {@link mintLeaseOf} the bound. Separate from the route so a test drives it over a real
 * hold directory and watches the lease file itself.
 */
import { randomUUID } from "node:crypto";

import { removeCallLease, writeCallLease } from "./callLeaseFile";
import { leaseOf, mintLeaseOf } from "./consoleHold";

/**
 * Run a mint under a call lease. The lease is written, and awaited, BEFORE the mint starts — so before `talk offer`
 * is spawned. A mint that opened a call keeps one lease's worth, which the page's first live beat takes over; any
 * other outcome, a throw included, ends the lease at once. A lease that cannot be written never stops the call: the
 * hold protects the call, not the reverse.
 *
 * @param dir the hold directory the server was started with, or `undefined` for a server with no rebuild to hold
 * @param boundMs the longest the mint can take
 * @param mint the mint, answering whether it opened a call
 * @param nowMs the clock the leases are stamped from
 * @returns whatever the mint returned
 */
export async function heldWhileMinting<T>({
  dir,
  boundMs,
  mint,
  opened,
  nowMs,
}: {
  dir: string | undefined;
  boundMs: number;
  mint: () => Promise<T>;
  /** Whether the mint's result is a call that opened, which keeps its lease for the page's first beat. */
  opened: (result: T) => boolean;
  nowMs: () => number;
}): Promise<T> {
  if (dir === undefined) {
    return mint();
  }
  const callId = randomUUID();
  const held = await writeCallLease({ dir, lease: mintLeaseOf({ boundMs, callId, nowMs: nowMs() }) }).then(
    () => true,
    () => false,
  );
  let keep = false;
  try {
    const result = await mint();
    keep = opened(result);
    return result;
  } finally {
    if (held) {
      const settle = keep
        ? writeCallLease({ dir, lease: leaseOf({ callId, nowMs: nowMs() }) })
        : removeCallLease({ callId, dir });
      await settle.catch(() => undefined);
    }
  }
}
