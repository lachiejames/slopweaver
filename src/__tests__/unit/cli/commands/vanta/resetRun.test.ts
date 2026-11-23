import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyVantaKindFile, initialVantaManifest } from "../../../../../atlas/vanta/model.js";
import { publishVantaAtlas, vantaAtlasPaths } from "../../../../../atlas/vanta/store.js";
import { runVantaReset } from "../../../../../cli/commands/vanta/resetRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("runVantaReset", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-resetrun-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("--help prints usage and exits EXIT_OK", () => {
    expect(runVantaReset(["node", "slopweaver", "vanta", "reset", "--help"])).toBe(EXIT_OK);
  });

  it("refuses without --confirm archive", () => {
    expect(runVantaReset(["node", "slopweaver", "vanta", "reset", "--home", home])).toBe(EXIT_USAGE);
  });

  it("refuses when there is nothing to reset", () => {
    expect(runVantaReset(["node", "slopweaver", "vanta", "reset", "--home", home, "--confirm", "archive"])).toBe(
      EXIT_ERROR,
    );
  });

  it("resets an existing generation and exits EXIT_OK", () => {
    const paths = vantaAtlasPaths({ home });
    publishVantaAtlas({
      derivedFrom: null,
      files: { control: emptyVantaKindFile({ kind: "control", updatedAt: AT }) },
      manifest: initialVantaManifest({ updatedAt: AT }),
      paths,
    });
    expect(runVantaReset(["node", "slopweaver", "vanta", "reset", "--home", home, "--confirm", "archive"])).toBe(
      EXIT_OK,
    );
  });
});
