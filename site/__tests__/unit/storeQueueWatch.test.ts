/**
 * The console's store listen loop over a scripted port: a store lacking a trigger never says `ready`, every
 * re-established `LISTEN` says `ready` again (the catch-up), a heartbeat is a real round trip that re-reads the
 * triggers, and the loop ends on a failed round trip, a trigger dropped while listening, or the caller's abort,
 * unlistening once either way. No store, no timers: the port, the delay and
 * the clock are plain functions the test supplies.
 */
import { describe, expect, it } from "vitest";

import { STORE_QUEUE_TRIGGERS, type StoreQueueEvent } from "../../lib/storeQueueCore";
import { type StoreQueuePort, watchStoreQueue } from "../../lib/storeQueueWatch";

/** What a scripted port saw, and the handlers the loop gave its `listen`. */
interface Script {
  listened: number;
  unlistened: number;
  roundTrips: number;
  handlers: { onNotify: (payload: string) => void; onReady: () => void } | undefined;
}

/**
 * A port whose first trigger read reports `installed` and whose heartbeat reads report `later`, succeeding until
 * `failAt`, and whose listen says `ready` once.
 */
function scriptedPort({
  installed = STORE_QUEUE_TRIGGERS,
  later = installed,
  failAt,
  onRoundTrip,
}: {
  installed?: readonly { table: string; name: string }[];
  later?: readonly { table: string; name: string }[];
  failAt?: number;
  onRoundTrip?: (script: Script) => void;
}): { port: StoreQueuePort; script: Script } {
  const script: Script = { handlers: undefined, listened: 0, roundTrips: 0, unlistened: 0 };
  let reads = 0;
  const port: StoreQueuePort = {
    installedTriggers: async () => {
      reads += 1;
      if (reads === 1) {
        return installed;
      }
      script.roundTrips += 1;
      if (script.roundTrips === failAt) {
        throw new Error("connection terminated");
      }
      onRoundTrip?.(script);
      return later;
    },
    listen: async (handlers) => {
      script.listened += 1;
      script.handlers = handlers;
      handlers.onReady();
      return {
        unlisten: async () => {
          script.unlistened += 1;
        },
      };
    },
  };
  return { port, script };
}

/** Run the loop, aborting it after `rounds` delays, and collect what it emitted. */
async function run({
  port,
  rounds,
  controller = new AbortController(),
}: {
  port: StoreQueuePort;
  rounds: number;
  controller?: AbortController;
}): Promise<{ events: StoreQueueEvent[]; ended: Awaited<ReturnType<typeof watchStoreQueue>> }> {
  const events: StoreQueueEvent[] = [];
  let delays = 0;
  let clock = 1_000;
  const ended = await watchStoreQueue({
    delay: async () => {
      delays += 1;
      if (delays >= rounds) {
        controller.abort();
      }
    },
    emit: (event) => {
      events.push(event);
    },
    heartbeatMs: 15_000,
    nowMs: () => {
      clock += 15_000;
      return clock;
    },
    port,
    signal: controller.signal,
  });
  return { ended, events };
}

describe("watchStoreQueue", () => {
  it("never listens or says ready on a store lacking a trigger", async () => {
    const [first, ...rest] = STORE_QUEUE_TRIGGERS;
    const { port, script } = scriptedPort({ installed: rest });
    const { ended, events } = await run({ port, rounds: 1 });
    expect(ended._unsafeUnwrapErr()).toEqual({
      code: "TRIGGERS_MISSING",
      message: `the store lacks 1 notify trigger(s): ${first.name}; \`slopweaver store push\` installs them`,
      missing: [first.name],
    });
    expect(events).toEqual([]);
    expect(script.listened).toBe(0);
  });

  it("says ready, then a stamped heartbeat for each round trip, until aborted", async () => {
    const { port, script } = scriptedPort({});
    const { ended, events } = await run({ port, rounds: 2 });
    expect(ended._unsafeUnwrap()).toBe(null);
    expect(events).toEqual([
      { kind: "ready" },
      { atMs: 16_000, kind: "heartbeat" },
      { atMs: 31_000, kind: "heartbeat" },
    ]);
    expect(script.unlistened).toBe(1);
  });

  it("says ready again on every re-established LISTEN, so the broker catches up each time", async () => {
    const { port } = scriptedPort({
      onRoundTrip: (script) => {
        script.handlers!.onReady();
      },
    });
    const { events } = await run({ port, rounds: 1 });
    expect(events.filter((event) => event.kind === "ready")).toEqual([{ kind: "ready" }, { kind: "ready" }]);
  });

  it("turns a store-kept register's notification into a change and ignores any other payload", async () => {
    const { port } = scriptedPort({
      onRoundTrip: (script) => {
        script.handlers!.onNotify("standing-asks");
        script.handlers!.onNotify("drafts");
      },
    });
    const { events } = await run({ port, rounds: 1 });
    expect(events.filter((event) => event.kind === "changed")).toEqual([{ kind: "changed", slug: "standing-asks" }]);
  });

  it("ends on a failed round trip, naming it, and unlistens once", async () => {
    const { port, script } = scriptedPort({ failAt: 2 });
    const { ended, events } = await run({ port, rounds: 5 });
    expect(ended._unsafeUnwrapErr()).toEqual({
      code: "HEARTBEAT_FAILED",
      message: "the store stopped answering: connection terminated",
    });
    expect(events).toEqual([{ kind: "ready" }, { atMs: 16_000, kind: "heartbeat" }]);
    expect(script.unlistened).toBe(1);
  });

  it("ends at the next heartbeat when a trigger is dropped while listening, naming it, and unlistens once", async () => {
    const [first, ...rest] = STORE_QUEUE_TRIGGERS;
    const { port, script } = scriptedPort({ later: rest });
    const { ended, events } = await run({ port, rounds: 5 });
    expect(ended._unsafeUnwrapErr()).toEqual({
      code: "TRIGGERS_MISSING",
      message: `the store lacks 1 notify trigger(s): ${first.name}; \`slopweaver store push\` installs them`,
      missing: [first.name],
    });
    expect(events).toEqual([{ kind: "ready" }]);
    expect(script.roundTrips).toBe(1);
    expect(script.unlistened).toBe(1);
  });

  it("is a clean end, with no round trip, when the caller aborts while the LISTEN opens", async () => {
    const controller = new AbortController();
    const { port, script } = scriptedPort({ failAt: 1 });
    const listen = port.listen;
    const aborting: StoreQueuePort = {
      ...port,
      listen: async (handlers) => {
        const listening = await listen(handlers);
        controller.abort();
        return listening;
      },
    };
    const { ended, events } = await run({ controller, port: aborting, rounds: 5 });
    expect(ended._unsafeUnwrap()).toBe(null);
    expect(events).toEqual([{ kind: "ready" }]);
    expect(script.roundTrips).toBe(0);
    expect(script.unlistened).toBe(1);
  });

  it("emits nothing a listener says after the abort", async () => {
    const { port, script } = scriptedPort({});
    const { events } = await run({ port, rounds: 1 });
    expect(events).toEqual([{ kind: "ready" }, { atMs: 16_000, kind: "heartbeat" }]);
    script.handlers!.onReady();
    script.handlers!.onNotify("autonomy");
    expect(events).toEqual([{ kind: "ready" }, { atMs: 16_000, kind: "heartbeat" }]);
  });
});
