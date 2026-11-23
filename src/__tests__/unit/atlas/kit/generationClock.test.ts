/** The clock a published atlas generation carries, read off its manifest alone. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generationClock } from "../../../../atlas/kit/generationClock.js";

const dirs: string[] = [];

/** A fresh directory holding a `manifest.json` with exactly `text`, removed after each test. */
function manifestWith({ text }: { text: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "gen-clock-"));
  dirs.push(dir);
  const path = join(dir, "manifest.json");
  writeFileSync(path, text);
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("generationClock", () => {
  it("reads the manifest's own updatedAt", () => {
    const manifestPath = manifestWith({ text: JSON.stringify({ kinds: {}, updatedAt: "2026-11-06T02:00:00.000Z" }) });
    expect(generationClock({ manifestPath })).toBe("2026-11-06T02:00:00.000Z");
  });

  it("is null for a generation never published", () => {
    const dir = mkdtempSync(join(tmpdir(), "gen-clock-"));
    dirs.push(dir);
    expect(generationClock({ manifestPath: join(dir, "manifest.json") })).toBe(null);
  });

  it("is null for a manifest that does not parse", () => {
    expect(generationClock({ manifestPath: manifestWith({ text: "{ not json" }) })).toBe(null);
  });

  it("is null for a manifest that is not an object", () => {
    expect(generationClock({ manifestPath: manifestWith({ text: "[1, 2]" }) })).toBe(null);
  });

  it("is null for a manifest whose updatedAt is not a string", () => {
    expect(generationClock({ manifestPath: manifestWith({ text: JSON.stringify({ updatedAt: 42 }) }) })).toBe(null);
  });
});
