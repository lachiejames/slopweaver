/**
 * How a relay transport takes the machine's one relay lease: `leaseFor` at once, `holdRelayLease` waiting and
 * then STOPPING the session on a lease it never got, so the wait is paid once per run. Every case runs against
 * a real lock under a throwaway home; "another holder" is a lease this same process took first, which the
 * waiting half refuses at once rather than sleeping on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireRelayLease, type RelayLease } from "../../../browser/relayLease.js";
import { holdRelayLease, leaseFor } from "../../../browser/relayLeaseHold.js";
import { openSession, type PlaywrightCliDeps } from "../../../browser/relaySession.js";
import { takeWalkCollisions } from "../../../browser/walkStops.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-10-01T00:00:00.000Z";

describe("relayLeaseHold", () => {
  let home: string;
  const held: RelayLease[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "relay-lease-hold-"));
  });

  afterEach(() => {
    held.splice(0).forEach((lease) => {
      lease.release();
    });
    rmSync(home, { force: true, recursive: true });
  });

  /** A walk's deps whose wait never sleeps. */
  function deps({ sleeps }: { sleeps: number[] }): PlaywrightCliDeps {
    return {
      chromePinPath: join(home, "no-such-pin"),
      extensionToken: "not-a-real-token",
      home,
      leaseWait: {
        clock: {
          nowMs: () => 0,
          sleep: ({ ms }) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        },
        emit: () => {},
        timeoutSeconds: 540,
      },
      nowIso: () => NOW,
      origins: ["https://linear.app"],
      platform: "linear",
      scratchDir: home,
    };
  }

  /** The relay taken by a first walk in this process, so the next one meets it held. */
  function heldByFirstWalk(): void {
    held.push(
      unwrap(acquireRelayLease({ home, nowIso: NOW, origins: ["https://app.notion.com"], platform: "notion" })),
    );
  }

  it("takes a free relay and keeps it on the session", async () => {
    const session = openSession();
    const taken = await holdRelayLease({ deps: deps({ sleeps: [] }), session });
    held.push(unwrap(taken));
    expect(session.lease).toBe(unwrap(taken));
    expect(session.stopped).toBe(null);
  });

  it("hands back the lease the session already holds rather than taking a second", async () => {
    const session = openSession();
    const first = unwrap(await holdRelayLease({ deps: deps({ sleeps: [] }), session }));
    held.push(first);
    expect(unwrap(await holdRelayLease({ deps: deps({ sleeps: [] }), session }))).toBe(first);
  });

  it("stops the session on a lease it did not get, naming why, without sleeping", async () => {
    heldByFirstWalk();
    const session = openSession();
    const sleeps: number[] = [];
    const refused = await holdRelayLease({ deps: deps({ sleeps }), session });
    expect(unwrapErr(refused).code).toBe("TRANSPORT_UNAVAILABLE");
    expect(unwrapErr(refused).message).toContain("this process already holds the owner's Chrome relay");
    expect(session.stopped).toBe(unwrapErr(refused));
    expect(sleeps).toEqual([]);
  });

  it("refuses every later call on a stopped session with the same failure, even once the relay is free", async () => {
    heldByFirstWalk();
    const session = openSession();
    const first = unwrapErr(await holdRelayLease({ deps: deps({ sleeps: [] }), session }));
    held.splice(0).forEach((lease) => {
      lease.release();
    });
    expect(unwrapErr(await holdRelayLease({ deps: deps({ sleeps: [] }), session }))).toBe(first);
  });

  it("leaseFor refuses at once while another walk holds the relay", () => {
    heldByFirstWalk();
    const refused = leaseFor({ deps: deps({ sleeps: [] }) });
    expect(unwrapErr(refused).code).toBe("TRANSPORT_UNAVAILABLE");
    expect(unwrapErr(refused).message).toContain("another browser walk is driving the owner's Chrome");
  });

  it("leaseFor takes a free relay", () => {
    const taken = leaseFor({ deps: deps({ sleeps: [] }) });
    held.push(unwrap(taken));
    expect(unwrap(taken).platform).toBe("linear");
  });

  // The lock file cannot tell this process from another, so `acquireRelayLease` reads a lease taken here as
  // another walk's — exactly the RELAY_HELD a second process meets.
  it("notes a collision when leaseFor is refused because another walk holds the relay", () => {
    heldByFirstWalk();
    takeWalkCollisions();
    const refused = unwrapErr(leaseFor({ deps: deps({ sleeps: [] }) }));
    const collisions = takeWalkCollisions();
    expect(collisions.length).toBe(1);
    expect(refused.message).toContain(collisions[0]!);
    expect(collisions[0]).toContain("another browser walk is driving the owner's Chrome");
  });

  it("notes no collision when the waiting take is refused for a lease this process already holds", async () => {
    heldByFirstWalk();
    takeWalkCollisions();
    unwrapErr(await holdRelayLease({ deps: deps({ sleeps: [] }), session: openSession() }));
    expect(takeWalkCollisions()).toEqual([]);
  });

  it("notes no collision when the relay is free", () => {
    takeWalkCollisions();
    held.push(unwrap(leaseFor({ deps: deps({ sleeps: [] }) })));
    expect(takeWalkCollisions()).toEqual([]);
  });
});
