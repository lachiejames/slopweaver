import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cloudflareSyncCommand,
  resolveSyncPrerequisites,
  runCloudflareSyncArgv,
  runCloudflareSyncOnce,
} from "../../../../../cli/commands/cloudflare/syncRun.js";
import { unwrapErr } from "../../../../../lib/result.js";

describe("resolveSyncPrerequisites", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cloudflare-syncrun-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses when no token is configured under the given home", async () => {
    const result = await resolveSyncPrerequisites({
      accountIdFlag: "0".repeat(32),
      deepZoneFlag: "x.test",
      env: {},
      home,
    });
    expect(unwrapErr(result).some((line) => line.includes("cloudflare-token"))).toBe(true);
  });

  it("refuses on an invalid selection before ever touching the network, once a token exists", async () => {
    // `cloudflareToken` reads the REAL process.env, not the `env` object passed to selection resolution —
    // so proving "a token exists" for this call means setting it here, restored immediately after.
    const previous = process.env["CLOUDFLARE_API_TOKEN"];
    process.env["CLOUDFLARE_API_TOKEN"] = "fake-token";
    try {
      const result = await resolveSyncPrerequisites({
        accountIdFlag: undefined,
        deepZoneFlag: undefined,
        env: {},
        home,
      });
      const errors = unwrapErr(result);
      expect(errors.some((line) => line.includes("account id"))).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env["CLOUDFLARE_API_TOKEN"];
      } else {
        process.env["CLOUDFLARE_API_TOKEN"] = previous;
      }
    }
  });
});

describe("runCloudflareSyncOnce", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cloudflare-syncrun-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("propagates a prerequisite failure without attempting a sync", async () => {
    const result = await runCloudflareSyncOnce({
      accountIdFlag: undefined,
      deepZoneFlag: undefined,
      env: {},
      home,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(unwrapErr(result).some((line) => line.includes("cloudflare-token"))).toBe(true);
  });
});

describe("runCloudflareSyncArgv", () => {
  it("prints usage and exits 0 on --help", async () => {
    expect(await runCloudflareSyncArgv(["node", "slopweaver", "cloudflare", "sync", "--help"])).toBe(0);
  });

  it("exits with usage status on an unknown flag", async () => {
    expect(await runCloudflareSyncArgv(["node", "slopweaver", "cloudflare", "sync", "--nope"])).toBe(2);
  });
});

describe("cloudflareSyncCommand", () => {
  it("is the same defineCommand-wrapped shape a future manifest entry would load", async () => {
    expect(await cloudflareSyncCommand(["node", "slopweaver", "cloudflare", "sync", "--help"])).toBe(0);
  });
});
