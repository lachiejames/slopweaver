/*
 * A call being minted holds the rebuild swap: a follow-on press after the 90-minute limit holding no lease would let
 * the refresh round signal the server tree with `talk offer` mid-composition. The round
 * holds while any unexpired `calls/*.json` stands (`scripts/docs-site.sh` `live_calls`), so this watches that file
 * over a real hold directory: there while the mint runs, gone after one that did not open, one lease after one that
 * did.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CALL_LEASE_MS } from "../../lib/consoleHold";
import { heldWhileMinting } from "../../lib/mintHold";

const BOUND_MS = 300_000;
const NOW_MS = 1_000_000;

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mint-hold-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Every lease standing in the hold directory, as the round's `jq` would read it. */
function leases(): readonly { callId: string; untilMs: number }[] {
  const calls = join(dir, "calls");
  return readdirSync(calls)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(calls, name), "utf8")) as { callId: string; untilMs: number });
}

describe("heldWhileMinting", () => {
  it("stands a lease for the whole bound while the mint runs, so a round finds a call live", async () => {
    const seen = await heldWhileMinting({
      boundMs: BOUND_MS,
      dir,
      mint: () => Promise.resolve(leases()),
      nowMs: () => NOW_MS,
      opened: () => false,
    });
    expect(seen.map((lease) => lease.untilMs)).toEqual([NOW_MS + BOUND_MS + CALL_LEASE_MS]);
  });

  it("ends the lease at once when the mint did not open a call", async () => {
    await heldWhileMinting({
      boundMs: BOUND_MS,
      dir,
      mint: () => Promise.resolve("refused"),
      nowMs: () => NOW_MS,
      opened: () => false,
    });
    expect(leases()).toEqual([]);
  });

  it("ends the lease when the mint throws, and lets the throw through", async () => {
    await expect(
      heldWhileMinting({
        boundMs: BOUND_MS,
        dir,
        mint: () => Promise.reject(new Error("the handshake threw")),
        nowMs: () => NOW_MS,
        opened: () => true,
      }),
    ).rejects.toThrow("the handshake threw");
    expect(leases()).toEqual([]);
  });

  it("leaves an opened call one lease's worth, under the same id, for the page's first beat to take over", async () => {
    let clock = NOW_MS;
    const during = await heldWhileMinting({
      boundMs: BOUND_MS,
      dir,
      mint: () => {
        clock = NOW_MS + 5_000;
        return Promise.resolve(leases());
      },
      nowMs: () => clock,
      opened: () => true,
    });
    const after = leases();
    expect(after.map((lease) => lease.untilMs)).toEqual([NOW_MS + 5_000 + CALL_LEASE_MS]);
    expect(after.map((lease) => lease.callId)).toEqual(during.map((lease) => lease.callId));
  });

  it("runs the mint unheld on a server started with no hold directory", async () => {
    const answer = await heldWhileMinting({
      boundMs: BOUND_MS,
      dir: undefined,
      mint: () => Promise.resolve("open"),
      nowMs: () => NOW_MS,
      opened: () => true,
    });
    expect(answer).toBe("open");
  });

  it("still mints when the lease cannot be written", async () => {
    const answer = await heldWhileMinting({
      boundMs: BOUND_MS,
      dir: join(dir, "missing", "\u0000"),
      mint: () => Promise.resolve("open"),
      nowMs: () => NOW_MS,
      opened: () => true,
    });
    expect(answer).toBe("open");
  });
});
