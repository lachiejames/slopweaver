/**
 * Resolving `--platform` over an injected platform list and lookup: each failure carries the exit code it
 * earns (a missing or misspelled platform is the caller's usage mistake, an unreadable store is a fault), and
 * a found registration is read with exactly the home the caller passed — `{}` when none was, never a
 * `{ home: undefined }` that would defeat the store's own default.
 */
import { describe, expect, it } from "vitest";

import { type AtlasReadError, AtlasReadErrors, type AtlasReadSnapshot } from "../../../../../atlas/kit/read.js";
import {
  type AtlasPlatformLookup,
  resolvePlatformSnapshot,
} from "../../../../../cli/commands/atlas/platformResolve.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

const KNOWN = ["slack", "vanta"] as const;

/** The platform list this build "has". */
const platforms = (): readonly string[] => KNOWN;

/** A small, valid, published vanta snapshot. */
function snapshot(): AtlasReadSnapshot {
  return {
    descriptor: {
      excludes: [],
      kinds: ["control"],
      platform: "vanta",
      question: "what does this tenant hold",
      resyncCommand: "slopweaver atlas vanta sync",
      surfaces: [],
      visibilityScope: "this tenant",
      writePolicy: "refuse-every-write",
    },
    generation: {
      mismatched: [],
      missing: [],
      platform: "vanta",
      schemaVersion: 3,
      superseded: [],
      unpublished: [],
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    kinds: [],
  };
}

/** A lookup that knows only `vanta`, answers `read`, and records every lookup and every read's args. */
function lookup({ read }: { read: Result<AtlasReadSnapshot, AtlasReadError> }): {
  find: AtlasPlatformLookup;
  looked: string[];
  reads: { home?: string }[];
} {
  const looked: string[] = [];
  const reads: { home?: string }[] = [];
  return {
    find: ({ platform }) => {
      looked.push(platform);
      if (platform !== "vanta") {
        return null;
      }
      return {
        readSnapshot: async (args) => {
          reads.push(args);
          return read;
        },
      };
    },
    looked,
    reads,
  };
}

describe("resolvePlatformSnapshot", () => {
  it("refuses a missing platform as ATLAS_PLATFORM_MISSING with EXIT_USAGE, looking nothing up", async () => {
    const { find, looked, reads } = lookup({ read: ok(snapshot()) });

    const result = await resolvePlatformSnapshot({ find, home: undefined, platform: undefined, platforms });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.exitCode).toBe(EXIT_USAGE);
    expect(failure.error.code).toBe("ATLAS_PLATFORM_MISSING");
    expect(failure.error.message).toBe("name an atlas: slopweaver atlas <platform> — this build has slack, vanta");
    expect(failure.error).toEqual(AtlasReadErrors.platformMissing({ known: KNOWN }));
    expect(looked).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("refuses an unknown platform as ATLAS_PLATFORM_UNKNOWN with EXIT_USAGE, reading no store", async () => {
    const { find, looked, reads } = lookup({ read: ok(snapshot()) });

    const result = await resolvePlatformSnapshot({ find, home: "/h", platform: "vatna", platforms });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.exitCode).toBe(EXIT_USAGE);
    expect(failure.error.code).toBe("ATLAS_PLATFORM_UNKNOWN");
    expect(failure.error.message).toBe("no atlas for platform vatna — this build has: slack, vanta");
    expect(failure.error).toEqual(AtlasReadErrors.platformUnknown({ known: KNOWN, platform: "vatna" }));
    expect(looked).toEqual(["vatna"]);
    expect(reads).toEqual([]);
  });

  it("passes an unreadable store's error through unchanged, with EXIT_ERROR", async () => {
    const storeError = AtlasReadErrors.storeUnreadable({ platform: "vanta", reasons: ["manifest.json is not JSON"] });
    const { find, reads } = lookup({ read: err(storeError) });

    const result = await resolvePlatformSnapshot({ find, home: "/h", platform: "vanta", platforms });

    expect(result.isErr()).toBe(true);
    const failure = unwrapErr(result);
    expect(failure.exitCode).toBe(EXIT_ERROR);
    expect(failure.error.code).toBe("ATLAS_STORE_UNREADABLE");
    expect(failure.error.message).toBe("the vanta atlas could not be read: manifest.json is not JSON");
    expect(failure.error).toBe(storeError);
    expect(reads).toEqual([{ home: "/h" }]);
  });

  it("returns the registration's snapshot, read under the caller's home", async () => {
    const value = snapshot();
    const { find, looked, reads } = lookup({ read: ok(value) });

    const result = await resolvePlatformSnapshot({ find, home: "/h", platform: "vanta", platforms });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(value);
    expect(looked).toEqual(["vanta"]);
    expect(reads).toEqual([{ home: "/h" }]);
  });

  it("reads with an empty argument, carrying no home key at all, when the caller passed no home", async () => {
    const { find, reads } = lookup({ read: ok(snapshot()) });

    const result = await resolvePlatformSnapshot({ find, home: undefined, platform: "vanta", platforms });

    expect(result.isOk()).toBe(true);
    expect(reads).toEqual([{}]);
    expect(Object.keys(reads[0]!)).toEqual([]);
  });
});
