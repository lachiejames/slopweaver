import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { syncVantaAtlasLive } from "../../../../atlas/vanta/liveSync.js";
import { unwrap } from "../../../../lib/result.js";

describe("syncVantaAtlasLive", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-live-sync-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reports credentials unconfigured when neither the environment nor the store holds a pair", async () => {
    const report = unwrap(await syncVantaAtlasLive({ at: "2026-09-30T00:00:00.000Z", env: {}, home }));
    expect(report.credentialsConfigured).toBe(false);
  });
});
