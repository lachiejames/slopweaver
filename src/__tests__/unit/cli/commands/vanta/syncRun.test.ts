import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { VANTA_CLIENT_ID_ENV, VANTA_CLIENT_SECRET_ENV } from "../../../../../atlas/vanta/credentials.js";
import { runVantaSync } from "../../../../../cli/commands/vanta/syncRun.js";
import { EXIT_DEFERRED, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";

describe("runVantaSync", () => {
  it("--help prints usage and exits EXIT_OK without touching the home", async () => {
    const code = await runVantaSync(["node", "slopweaver", "atlas", "vanta", "sync", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  describe("with credentials genuinely absent", () => {
    let home: string;
    let savedId: string | undefined;
    let savedSecret: string | undefined;
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), "vanta-syncrun-"));
      savedId = process.env[VANTA_CLIENT_ID_ENV];
      savedSecret = process.env[VANTA_CLIENT_SECRET_ENV];
      delete process.env[VANTA_CLIENT_ID_ENV];
      delete process.env[VANTA_CLIENT_SECRET_ENV];
    });
    afterEach(() => {
      rmSync(home, { force: true, recursive: true });
      if (savedId !== undefined) {
        process.env[VANTA_CLIENT_ID_ENV] = savedId;
      }
      if (savedSecret !== undefined) {
        process.env[VANTA_CLIENT_SECRET_ENV] = savedSecret;
      }
    });

    it("exits EXIT_EXPECTED_EMPTY and reports which env vars are missing", async () => {
      const code = await runVantaSync(["node", "slopweaver", "vanta", "sync", "--home", home, "--json"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });

    it("exits EXIT_DEFERRED while a live holder has the sync lock, so a scheduled slot is given back", async () => {
      const holder = unwrap(acquireOperationLock({ home, key: "vanta-atlas-sync", nowIso: new Date().toISOString() }));
      try {
        const code = await runVantaSync(["node", "slopweaver", "vanta", "sync", "--home", home]);
        expect(code).toBe(EXIT_DEFERRED);
      } finally {
        holder.release();
      }
    });
  });
});
