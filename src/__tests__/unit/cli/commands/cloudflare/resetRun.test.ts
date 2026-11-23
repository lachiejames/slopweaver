import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyCloudflareKindFile, initialCloudflareManifest } from "../../../../../atlas/cloudflare/model.js";
import { cloudflareAtlasPaths, publishCloudflareAtlas } from "../../../../../atlas/cloudflare/store.js";
import { runCloudflareReset } from "../../../../../cli/commands/cloudflare/resetRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("runCloudflareReset", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cloudflare-resetrun-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("--help prints usage and exits EXIT_OK", () => {
    expect(runCloudflareReset(["node", "slopweaver", "cloudflare", "reset", "--help"])).toBe(EXIT_OK);
  });

  it("refuses without --confirm archive", () => {
    expect(runCloudflareReset(["node", "slopweaver", "cloudflare", "reset", "--home", home])).toBe(EXIT_USAGE);
  });

  it("refuses when there is nothing to reset", () => {
    expect(
      runCloudflareReset(["node", "slopweaver", "cloudflare", "reset", "--home", home, "--confirm", "archive"]),
    ).toBe(EXIT_ERROR);
  });

  it("resets an existing generation and exits EXIT_OK", () => {
    const paths = cloudflareAtlasPaths({ home });
    publishCloudflareAtlas({
      derivedFrom: null,
      files: { zone: emptyCloudflareKindFile({ kind: "zone", updatedAt: AT }) },
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      paths,
    });
    expect(
      runCloudflareReset(["node", "slopweaver", "cloudflare", "reset", "--home", home, "--confirm", "archive"]),
    ).toBe(EXIT_OK);
  });
});
