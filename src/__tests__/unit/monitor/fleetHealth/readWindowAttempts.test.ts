/*
 * `fleet-unhealthy`'s ledger read, `readWindowAttempts`: an absent ledger read as empty, and a window that skips an
 * old file, names a torn one and probes each holder pid — over a throwaway directory each case mints.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readWindowAttempts } from "../../../../monitor/fleetHealthSource.js";

import { probed } from "../fleetHealthFixtures.js";

describe("readWindowAttempts", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleet-health-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads an absent ledger as empty, never as unmeasurable", () => {
    expect(readWindowAttempts({ directory: join(dir, "absent"), processAlive: () => true, sinceMs: 0 })).toEqual({
      attempts: [],
      unread: [],
    });
  });

  it("skips a file older than the window, names one that will not parse, and probes each holder pid", () => {
    const ledger = join(dir, "slot-attempts");
    mkdirSync(ledger);
    const live = probed({ holderPid: 4242, outcome: null }).attempt;
    writeFileSync(join(ledger, "live.json"), JSON.stringify(live));
    writeFileSync(join(ledger, "old.json"), JSON.stringify(probed({}).attempt));
    utimesSync(join(ledger, "old.json"), new Date("2026-09-20T00:00:00Z"), new Date("2026-09-20T00:00:00Z"));
    writeFileSync(join(ledger, "torn.json"), "{");
    const read = readWindowAttempts({
      directory: ledger,
      processAlive: ({ pid }) => pid !== 4242,
      sinceMs: Date.parse("2026-09-28T00:00:00Z"),
    });
    expect(read).toEqual({ attempts: [{ attempt: live, holderAlive: false }], unread: ["torn.json"] });
  });
});
