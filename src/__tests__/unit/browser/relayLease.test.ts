import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OperationLockResult } from "../../../admit/operationLock.js";
import { browserErrorLines } from "../../../browser/browserErrors.js";
import {
  acquireRelayLease,
  acquireRelayLeaseWaiting,
  isOnLeaseOrigin,
  RELAY_LEASE_KEY,
  RELAY_LEASE_WAIT_SECONDS,
  type RelayLease,
  type RelayLeaseWait,
} from "../../../browser/relayLease.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS, LOCAL_WAIT_SCHEDULE_MS } from "../../../wait/loop.js";

const NOW = "2026-09-07T10:00:00.000Z";

/** A wait whose clock advances only when it sleeps, recording every sleep and every line it was handed. */
function fakeWait({ timeoutSeconds }: { timeoutSeconds: number }): {
  wait: RelayLeaseWait;
  slept: number[];
  lines: string[];
} {
  let now = 0;
  const slept: number[] = [];
  const lines: string[] = [];
  return {
    lines,
    slept,
    wait: {
      clock: {
        nowMs: () => now,
        sleep: ({ ms }) => {
          slept.push(ms);
          now += ms;
          return Promise.resolve();
        },
      },
      emit: (line) => {
        lines.push(line);
      },
      timeoutSeconds,
    },
  };
}

/** One lock attempt, as the waiting acquisition hands it to the injected acquire. */
interface Attempt {
  readonly key: string;
  readonly staleAfterMs: number | undefined;
}

/**
 * An acquire standing in for ANOTHER process holding the relay: it refuses `refusals` times, naming a pid that
 * is not this one, then hands over a handle whose releases it counts.
 */
function otherProcessHolds({ refusals }: { refusals: number }): {
  acquire: (input: {
    home: string;
    directory?: string | undefined;
    key: string;
    nowIso: string;
    staleAfterMs?: number | undefined;
  }) => OperationLockResult;
  attempts: Attempt[];
  releases: { count: number };
} {
  const attempts: Attempt[] = [];
  const releases = { count: 0 };
  return {
    acquire: ({ key, staleAfterMs }) => {
      attempts.push({ key, staleAfterMs });
      if (attempts.length <= refusals) {
        return err(`held by pid 4242 since ${NOW}`);
      }
      return ok({
        release: () => {
          releases.count += 1;
        },
        stillHeld: () => true,
        stoleFromPid: undefined,
      });
    },
    attempts,
    releases,
  };
}

describe("acquireRelayLease", () => {
  let home: string;
  const held: RelayLease[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "relay-lease-"));
  });

  afterEach(() => {
    held.splice(0).forEach((lease) => {
      lease.release();
    });
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a second walk while the first holds the relay, whatever platform it is", () => {
    const first = acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" });
    expect(first.isOk()).toBe(true);
    held.push(unwrap(first));

    const second = acquireRelayLease({ home, nowIso: NOW, origins: ["https://linear.app"], platform: "linear" });
    expect(second.isErr()).toBe(true);
    expect(browserErrorLines({ error: unwrapErr(second) })[0]).toContain(
      "another browser walk is driving the owner's Chrome",
    );
    expect(browserErrorLines({ error: unwrapErr(second) })[0]).toContain("the linear walk may not start");
  });

  it("tells the loser the lease is never-stale BY DESIGN, not that its threshold is a bad number", () => {
    const first = acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" });
    held.push(unwrap(first));

    const second = acquireRelayLease({
      home,
      nowIso: "2026-09-07T10:04:00.000Z",
      origins: ["https://linear.app"],
      platform: "linear",
    });

    expect(second.isErr()).toBe(true);
    expect(browserErrorLines({ error: unwrapErr(second) })[0]).toContain(
      `held by pid ${String(process.pid)} since ${NOW} (240000ms old, under a lease declared never to go stale while its holder lives, and the holder answered signal 0 — it was ALIVE when checked at 2026-09-07T10:04:00.000Z, so this is contention rather than a lock left behind by a dead process; wait for the holder to finish)`,
    );
    expect(browserErrorLines({ error: unwrapErr(second) })[0]).not.toContain("is not a finite number of milliseconds");
  });

  it("hands the relay to the next walk once the first releases it", () => {
    const first = acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" });
    unwrap(first).release();

    const second = acquireRelayLease({ home, nowIso: NOW, origins: ["https://linear.app"], platform: "linear" });
    expect(second.isOk()).toBe(true);
    held.push(unwrap(second));
    expect(unwrap(second).origins).toEqual(["https://linear.app"]);
  });

  it("refuses a walk that declared no origin at all", () => {
    const taken = acquireRelayLease({ home, nowIso: NOW, origins: [], platform: "notion" });
    expect(taken.isErr()).toBe(true);
    expect(browserErrorLines({ error: unwrapErr(taken) })).toEqual([
      "the notion walk declared no origin, so there is nothing a relay lease could bind it to",
    ]);
  });

  it("refuses an origin carrying a path, so a lease's text and its meaning are the same thing", () => {
    const taken = acquireRelayLease({
      home,
      nowIso: NOW,
      origins: ["https://app.notion.com/settings"],
      platform: "notion",
    });
    expect(taken.isErr()).toBe(true);
    expect(browserErrorLines({ error: unwrapErr(taken) })[0]).toContain("is not a bare origin");
    expect(browserErrorLines({ error: unwrapErr(taken) })[0]).toContain('"https://app.notion.com"');
  });

  it("refuses something that is not an absolute URL, and takes no lock doing it", () => {
    const taken = acquireRelayLease({ home, nowIso: NOW, origins: ["app.notion.com"], platform: "notion" });
    expect(taken.isErr()).toBe(true);
    expect(browserErrorLines({ error: unwrapErr(taken) })).toEqual([
      '"app.notion.com" is not an absolute URL, so it cannot bind a relay lease',
    ]);

    const after = acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" });
    expect(after.isOk()).toBe(true);
    held.push(unwrap(after));
  });
});

describe("acquireRelayLeaseWaiting", () => {
  let home: string;
  const held: RelayLease[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "relay-lease-wait-"));
  });

  afterEach(() => {
    held.splice(0).forEach((lease) => {
      lease.release();
    });
    rmSync(home, { force: true, recursive: true });
  });

  it("waits the bound the shared wait contract sets for a foreground call", () => {
    expect(RELAY_LEASE_WAIT_SECONDS).toBe(DEFAULT_WAIT_TIMEOUT_SECONDS);
  });

  it("takes a free relay on the first attempt without sleeping", async () => {
    const { acquire, attempts } = otherProcessHolds({ refusals: 0 });
    const { wait, slept } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    expect(taken.isOk()).toBe(true);
    held.push(unwrap(taken));
    expect(attempts.length).toBe(1);
    expect(slept).toEqual([]);
  });

  it("waits out another process's live walk on the local schedule, then takes the relay", async () => {
    const { acquire, attempts } = otherProcessHolds({ refusals: 3 });
    const { wait, slept, lines } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    expect(taken.isOk()).toBe(true);
    held.push(unwrap(taken));
    expect(unwrap(taken).origins).toEqual(["https://linear.app"]);
    expect(attempts.length).toBe(4);
    expect(slept).toEqual(LOCAL_WAIT_SCHEDULE_MS.slice(0, 3));
    expect(lines).toEqual([
      `the linear walk is waiting for the browser-relay operation lock: held by pid 4242 since ${NOW}`,
    ]);
  });

  it("takes every attempt under the never-stale threshold, so waiting can never steal from a live holder", async () => {
    const { acquire, attempts } = otherProcessHolds({ refusals: 2 });
    const { wait } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    held.push(unwrap(taken));
    expect(attempts).toEqual([
      { key: RELAY_LEASE_KEY, staleAfterMs: Number.POSITIVE_INFINITY },
      { key: RELAY_LEASE_KEY, staleAfterMs: Number.POSITIVE_INFINITY },
      { key: RELAY_LEASE_KEY, staleAfterMs: Number.POSITIVE_INFINITY },
    ]);
  });

  it("gives up at the bound naming the holder and how long it waited", async () => {
    const { acquire } = otherProcessHolds({ refusals: 1000 });
    const { wait } = fakeWait({ timeoutSeconds: 3 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    expect(taken.isErr()).toBe(true);
    expect(unwrapErr(taken).code).toBe("RELAY_HELD");
    expect(browserErrorLines({ error: unwrapErr(taken) })).toEqual([
      `another browser walk is driving the owner's Chrome, and the linear walk waited 3s for it without it coming free: held by pid 4242 since ${NOW}`,
      "the relay's shared context is one tab — run this walk again once the other one has finished",
    ]);
  });

  it("refuses at once, without a single attempt, when THIS process already holds the relay", async () => {
    const mine = acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" });
    held.push(unwrap(mine));
    const { acquire, attempts } = otherProcessHolds({ refusals: 0 });
    const { wait, slept } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    expect(unwrapErr(taken).code).toBe("RELAY_HELD_BY_THIS_PROCESS");
    expect(unwrapErr(taken).message).toContain("this process already holds the owner's Chrome relay");
    expect(attempts).toEqual([]);
    expect(slept).toEqual([]);
  });

  it("waits again once this process has released its own lease, however often it released it", async () => {
    const mine = acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" });
    unwrap(mine).release();
    unwrap(mine).release();
    const { acquire } = otherProcessHolds({ refusals: 0 });
    const { wait } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    expect(taken.isOk()).toBe(true);
    held.push(unwrap(taken));
  });

  it("releases the underlying lock exactly once, however often the lease is released", async () => {
    const { acquire, releases } = otherProcessHolds({ refusals: 0 });
    const { wait } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait,
    });
    unwrap(taken).release();
    unwrap(taken).release();
    expect(releases.count).toBe(1);
  });

  // The slot is reserved before the first await, so two walks this process starts in the same tick cannot both
  // pass the check and then sit out the bound behind each other.
  it("refuses a second walk at once while this process's first is still WAITING for the relay", async () => {
    const first = otherProcessHolds({ refusals: 2 });
    const firstWait = fakeWait({ timeoutSeconds: 540 });
    const pending = acquireRelayLeaseWaiting({
      acquire: first.acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://app.notion.com"],
      platform: "notion",
      wait: firstWait.wait,
    });
    const second = otherProcessHolds({ refusals: 0 });
    const secondWait = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire: second.acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait: secondWait.wait,
    });
    held.push(unwrap(await pending));
    expect(unwrapErr(taken).code).toBe("RELAY_HELD_BY_THIS_PROCESS");
    expect(second.attempts).toEqual([]);
    expect(secondWait.slept).toEqual([]);
  });

  it("frees the slot when a wait times out, so the next walk waits rather than being refused", async () => {
    const lost = await acquireRelayLeaseWaiting({
      acquire: otherProcessHolds({ refusals: 1000 }).acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait: fakeWait({ timeoutSeconds: 3 }).wait,
    });
    const taken = await acquireRelayLeaseWaiting({
      acquire: otherProcessHolds({ refusals: 0 }).acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait: fakeWait({ timeoutSeconds: 540 }).wait,
    });
    expect(unwrapErr(lost).code).toBe("RELAY_HELD");
    held.push(unwrap(taken));
  });

  it("frees the slot when the acquisition itself throws", async () => {
    const thrown = acquireRelayLeaseWaiting({
      acquire: () => {
        throw new Error("the lock directory could not be made");
      },
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait: fakeWait({ timeoutSeconds: 540 }).wait,
    });
    await expect(thrown).rejects.toThrow("the lock directory could not be made");
    const taken = await acquireRelayLeaseWaiting({
      acquire: otherProcessHolds({ refusals: 0 }).acquire,
      home,
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      wait: fakeWait({ timeoutSeconds: 540 }).wait,
    });
    held.push(unwrap(taken));
  });

  // The count reads free only once the lock has been given back, never while the lock file still names us.
  it("still counts the lease as held while its underlying lock is being released", async () => {
    const during: ReturnType<typeof acquireRelayLeaseWaiting>[] = [];
    const taken = await acquireRelayLeaseWaiting({
      acquire: () =>
        ok({
          release: () => {
            during.push(
              acquireRelayLeaseWaiting({
                acquire: otherProcessHolds({ refusals: 0 }).acquire,
                home,
                nowIso: () => NOW,
                origins: ["https://linear.app"],
                platform: "linear",
                wait: fakeWait({ timeoutSeconds: 540 }).wait,
              }),
            );
          },
          stillHeld: () => true,
          stoleFromPid: undefined,
        }),
      home,
      nowIso: () => NOW,
      origins: ["https://app.notion.com"],
      platform: "notion",
      wait: fakeWait({ timeoutSeconds: 540 }).wait,
    });
    unwrap(taken).release();
    expect(during.length).toBe(1);
    expect(unwrapErr(await during[0]!).code).toBe("RELAY_HELD_BY_THIS_PROCESS");
  });

  it("refuses a malformed origin at once rather than after the bound", async () => {
    const { acquire, attempts } = otherProcessHolds({ refusals: 1000 });
    const { wait, slept } = fakeWait({ timeoutSeconds: 540 });
    const taken = await acquireRelayLeaseWaiting({
      acquire,
      home,
      nowIso: () => NOW,
      origins: ["app.notion.com"],
      platform: "notion",
      wait,
    });
    expect(browserErrorLines({ error: unwrapErr(taken) })).toEqual([
      '"app.notion.com" is not an absolute URL, so it cannot bind a relay lease',
    ]);
    expect(attempts).toEqual([]);
    expect(slept).toEqual([]);
  });
});

describe("isOnLeaseOrigin", () => {
  const lease: RelayLease = {
    origins: ["https://app.notion.com", "https://www.notion.so"],
    platform: "notion",
    release: () => {},
  };

  it("accepts any path on any origin the lease names", () => {
    expect(isOnLeaseOrigin({ lease, url: "https://app.notion.com/settings/members" })).toBe(true);
    expect(isOnLeaseOrigin({ lease, url: "https://www.notion.so/" })).toBe(true);
  });

  it("refuses another platform's origin — the cross-platform origin check", () => {
    expect(isOnLeaseOrigin({ lease, url: "https://linear.app/settings" })).toBe(false);
  });

  it("refuses a host that merely starts with one the lease names", () => {
    expect(isOnLeaseOrigin({ lease, url: "https://app.notion.com.example.invalid/x" })).toBe(false);
  });

  it("refuses a different scheme or port on the same host", () => {
    expect(isOnLeaseOrigin({ lease, url: "http://app.notion.com/x" })).toBe(false);
    expect(isOnLeaseOrigin({ lease, url: "https://app.notion.com:8443/x" })).toBe(false);
  });

  it("refuses something that is not a URL", () => {
    expect(isOnLeaseOrigin({ lease, url: "/settings/members" })).toBe(false);
  });
});
