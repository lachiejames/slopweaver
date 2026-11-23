/**
 * `readAtlasLiveRead` / `recordAtlasLiveRead` — the input the "a bounded live read counts
 * as fresh" rule would otherwise never receive.
 *
 * A round-trip through a `mkdtempSync` directory, for the reason the run store's test is: the file IS the
 * subject.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ATLAS_LIVE_READ_SCHEMA_VERSION,
  atlasLiveReadPath,
  readAtlasLiveRead,
  recordAtlasLiveRead,
} from "../../../../atlas/kit/liveReadStamp.js";
import { atlasSidecarErrorLines } from "../../../../atlas/kit/sidecarErrors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const dirs: string[] = [];

/** One throwaway atlas directory, removed after the test that minted it. */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("atlasLiveReadPath", () => {
  it("sits beside the manifest, under the atlas's own directory", () => {
    const atlasDir = join(sandbox(), "atlas", "vanta");
    expect(basename(atlasLiveReadPath({ atlasDir }))).toBe("live-read.json");
    expect(atlasLiveReadPath({ atlasDir })).toBe(join(atlasDir, "live-read.json"));
  });
});

describe("readAtlasLiveRead", () => {
  it("reads an atlas that has never had a live read as null rather than a failure", () => {
    expect(unwrap(readAtlasLiveRead({ atlasDir: sandbox() }))).toBeNull();
  });

  it("reads back what was recorded", () => {
    const atlasDir = sandbox();
    unwrap(
      recordAtlasLiveRead({
        atIso: "2026-09-08T12:00:00.000Z",
        atlasDir,
        scope: "control ctrl-42",
        verb: "atlas vanta control-evidence",
      }),
    );
    const stamp = unwrap(readAtlasLiveRead({ atlasDir }));
    expect(stamp!.atIso).toBe("2026-09-08T12:00:00.000Z");
    expect(stamp!.verb).toBe("atlas vanta control-evidence");
    expect(stamp!.scope).toBe("control ctrl-42");
  });

  it("overwrites rather than accumulating, so the ladder reads the LATEST read", () => {
    const atlasDir = sandbox();
    unwrap(recordAtlasLiveRead({ atIso: "2026-09-08T10:00:00.000Z", atlasDir, scope: "a", verb: "v" }));
    unwrap(recordAtlasLiveRead({ atIso: "2026-09-08T12:00:00.000Z", atlasDir, scope: "b", verb: "v" }));
    expect(unwrap(readAtlasLiveRead({ atlasDir }))!.atIso).toBe("2026-09-08T12:00:00.000Z");
  });

  it("refuses a stamp from a schema version this build does not write", () => {
    const atlasDir = sandbox();
    writeFileSync(
      atlasLiveReadPath({ atlasDir }),
      JSON.stringify({ atIso: "2026-09-08T12:00:00.000Z", schemaVersion: 99, scope: "s", verb: "v" }),
      "utf8",
    );
    expect(atlasSidecarErrorLines({ error: unwrapErr(readAtlasLiveRead({ atlasDir })) })[0]).toContain(
      "declares schema version 99",
    );
  });

  it("refuses a stamp missing a field the ladder reads", () => {
    const atlasDir = sandbox();
    writeFileSync(
      atlasLiveReadPath({ atlasDir }),
      JSON.stringify({ schemaVersion: ATLAS_LIVE_READ_SCHEMA_VERSION, scope: "s", verb: "v" }),
      "utf8",
    );
    expect(atlasSidecarErrorLines({ error: unwrapErr(readAtlasLiveRead({ atlasDir })) })[0]).toContain(
      "missing one of atIso, verb or scope",
    );
  });

  it("refuses a stamp that is not JSON", () => {
    const atlasDir = sandbox();
    writeFileSync(atlasLiveReadPath({ atlasDir }), "{not json", "utf8");
    expect(atlasSidecarErrorLines({ error: unwrapErr(readAtlasLiveRead({ atlasDir })) })[0]).toContain(
      "is not valid JSON",
    );
  });
});
