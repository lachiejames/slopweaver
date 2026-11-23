import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  emptyTwilioKindFile,
  initialTwilioManifest,
  TWILIO_ATLAS_KINDS,
  TWILIO_ATLAS_PLATFORM,
  TWILIO_ATLAS_SCHEMA_VERSION,
} from "../../../../atlas/twilio/model.js";
import { resetTwilioAtlas } from "../../../../atlas/twilio/reset.js";
import {
  publishTwilioAtlas,
  readTwilioAtlas,
  readTwilioManifest,
  twilioAtlasPaths,
} from "../../../../atlas/twilio/store.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

/** Every scratch home this file mints, removed on the way out — an uncleaned fixture accumulates forever. */
const homes: string[] = [];

/** A throwaway state home, so nothing here writes to the ambient one. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-twilio-store-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("the Twilio atlas store", () => {
  it("has at least one entry in TWILIO_ATLAS_KINDS, so the guards below are not vacuously green", () => {
    expect(TWILIO_ATLAS_KINDS.length).toBeGreaterThan(0);
  });

  it("reads back exactly what it published, kind for kind", () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    const file = emptyTwilioKindFile({ kind: "api", updatedAt: AT });

    unwrap(
      publishTwilioAtlas({
        derivedFrom: null,
        files: { api: file },
        manifest: initialTwilioManifest({ updatedAt: AT }),
        paths,
      }),
    );
    const snapshot = unwrap(readTwilioAtlas({ paths }));

    expect(snapshot.files.api!.kind).toBe("api");
    expect(snapshot.files.api!.platform).toBe(TWILIO_ATLAS_PLATFORM);
    expect(snapshot.files.api!.schemaVersion).toBe(TWILIO_ATLAS_SCHEMA_VERSION);
  });

  // The kit's `publishAtlas` leaves an omitted kind alone, which is what stops the sync and the walk
  // truncating each other's rows.
  it("leaves a kind this publish did not name exactly as it was", () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    const manifest = initialTwilioManifest({ updatedAt: AT });

    unwrap(
      publishTwilioAtlas({
        derivedFrom: null,
        files: { page: emptyTwilioKindFile({ kind: "page", updatedAt: AT }) },
        manifest,
        paths,
      }),
    );
    unwrap(
      publishTwilioAtlas({
        derivedFrom: unwrap(readTwilioManifest({ paths })),
        files: { api: emptyTwilioKindFile({ kind: "api", updatedAt: AT }) },
        manifest,
        paths,
      }),
    );
    const snapshot = unwrap(readTwilioAtlas({ paths }));

    expect(snapshot.files.page!.kind).toBe("page");
    expect(snapshot.files.api!.kind).toBe("api");
  });

  it("gives every declared kind its own file path under the state home", () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });

    for (const kind of TWILIO_ATLAS_KINDS) {
      expect(paths.kinds[kind].startsWith(paths.directory)).toBe(true);
    }
    expect(new Set(Object.values(paths.kinds)).size).toBe(TWILIO_ATLAS_KINDS.length);
  });

  // Nothing is ever deleted: the reset archives and installs a complete empty generation.
  it("archives the current generation and installs a complete empty one", () => {
    const paths = twilioAtlasPaths({ home: scratchHome() });
    unwrap(
      publishTwilioAtlas({
        derivedFrom: null,
        files: { api: emptyTwilioKindFile({ kind: "api", updatedAt: AT }) },
        manifest: initialTwilioManifest({ updatedAt: AT }),
        paths,
      }),
    );

    const outcome = unwrap(resetTwilioAtlas({ at: AT, paths }));
    const snapshot = unwrap(readTwilioAtlas({ paths }));

    expect(outcome.archivedTo.startsWith(paths.superseded)).toBe(true);
    for (const kind of TWILIO_ATLAS_KINDS) {
      expect(snapshot.files[kind]!.entities).toEqual([]);
    }
  });

  it("starts every kind unsynced in a fresh manifest", () => {
    const manifest = initialTwilioManifest({ updatedAt: AT });

    for (const kind of TWILIO_ATLAS_KINDS) {
      expect(manifest.kinds[kind].lastSuccessAt).toBe(null);
      expect(manifest.kinds[kind].entityCount).toBe(0);
    }
  });
});
