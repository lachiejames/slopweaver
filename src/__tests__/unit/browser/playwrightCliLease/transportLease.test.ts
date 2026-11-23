/**
 * The invariants the shipped transport holds, exercised through the shipped constructor.
 *
 * Nothing here reaches a browser, and that is the point rather than a limitation: every refusal below
 * happens BEFORE the terminal client is ever run, so the deps carry paths that do not exist and no test in
 * this file could touch the owner's Chrome even if the guard it is checking were removed. What is under test is
 * `createPlaywrightCliTransport` itself — the thing every atlas walk constructs — not a restatement of it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlaywrightCliTransport } from "../../../../browser/playwrightCli.js";
import { takeWalkStops } from "../../../../browser/walkStops.js";
import { unwrapErr } from "../../../../lib/result.js";

describe("createPlaywrightCliTransport, bound to a relay lease", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "relay-transport-"));
    slept.splice(0);
    clockMs = 0;
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    // The shipped transport notes every refusal below in the process-scoped walk-stop register, and the unit
    // lane reuses this worker for the next file, so the stops are taken here rather than left for it to read.
    takeWalkStops();
  });

  /** Every sleep a lease wait took — a clock that only advances when slept on, so nothing here really waits. */
  const slept: number[] = [];
  let clockMs = 0;

  const deps = ({ platform, origins }: { platform: string; origins: readonly string[] }) => ({
    chromePinPath: join(home, "no-such-pin"),
    extensionToken: "not-a-real-token",
    home,
    leaseWait: {
      clock: {
        nowMs: () => clockMs,
        sleep: ({ ms }: { ms: number }) => {
          slept.push(ms);
          clockMs += ms;
          return Promise.resolve();
        },
      },
      emit: () => {},
      timeoutSeconds: 540,
    },
    nowIso: () => "2026-09-07T10:00:00.000Z",
    origins,
    platform,
    scratchDir: home,
  });

  it("refuses an address off its own origins without running the client at all", async () => {
    const transport = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://app.notion.com"], platform: "notion" }),
    });
    const visited = await transport.visit({ settleMs: 1, url: "https://linear.app/settings/members" });
    expect(visited.isErr()).toBe(true);
    expect(unwrapErr(visited).code).toBe("OFF_LEASE_ORIGIN");
    expect(unwrapErr(visited).message).toContain("https://linear.app/settings/members");
    await transport.release();
  });

  it("stays refused for every later page, so one confused relay cannot degrade a whole walk", async () => {
    const transport = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://app.notion.com"], platform: "notion" }),
    });
    await transport.visit({ settleMs: 1, url: "https://linear.app/settings" });
    const second = await transport.visit({ settleMs: 1, url: "https://app.notion.com/settings" });
    expect(second.isErr()).toBe(true);
    expect(unwrapErr(second).code).toBe("OFF_LEASE_ORIGIN");
    await transport.release();
  });

  it("refuses a second walk in the same process at once, without waiting on a lease it holds itself", async () => {
    const first = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://app.notion.com"], platform: "notion" }),
    });
    // The lease is taken on the first visit, and this one is refused for being off-origin AFTER it is held.
    await first.visit({ settleMs: 1, url: "https://linear.app/x" });

    const second = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://linear.app"], platform: "linear" }),
    });
    const blocked = await second.visit({ settleMs: 1, url: "https://linear.app/settings" });
    expect(blocked.isErr()).toBe(true);
    expect(unwrapErr(blocked).code).toBe("TRANSPORT_UNAVAILABLE");
    expect(unwrapErr(blocked).message).toContain("this process already holds the owner's Chrome relay");
    expect(slept).toEqual([]);
    await second.release();
    await first.release();
  });

  it("stays refused for every later page once the lease was not got, so the wait is paid once per walk", async () => {
    const first = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://app.notion.com"], platform: "notion" }),
    });
    await first.visit({ settleMs: 1, url: "https://linear.app/x" });

    const second = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://linear.app"], platform: "linear" }),
    });
    await second.visit({ settleMs: 1, url: "https://linear.app/settings" });
    // The holder lets go, but a walk that already lost its lease does not come back to life page by page.
    await first.release();
    const later = await second.visit({ settleMs: 1, url: "https://linear.app/members" });
    expect(unwrapErr(later).code).toBe("TRANSPORT_UNAVAILABLE");
    expect(unwrapErr(later).message).toContain("this process already holds the owner's Chrome relay");
    await second.release();
  });

  it("hands the relay on once the first walk releases it", async () => {
    const first = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://app.notion.com"], platform: "notion" }),
    });
    await first.visit({ settleMs: 1, url: "https://linear.app/x" });
    await first.release();

    const second = createPlaywrightCliTransport({
      deps: deps({ origins: ["https://linear.app"], platform: "linear" }),
    });
    const taken = await second.visit({ settleMs: 1, url: "https://app.notion.com/x" });
    expect(taken.isErr()).toBe(true);
    // Off-origin for THIS walk, which proves the lease was taken rather than refused as busy.
    expect(unwrapErr(taken).code).toBe("OFF_LEASE_ORIGIN");
    await second.release();
  });
});
