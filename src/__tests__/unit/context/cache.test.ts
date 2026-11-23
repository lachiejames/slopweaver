/**
 * The delivery cache: a round trip, and every typed way a read or a write is refused.
 *
 * The one that is not obvious is the fingerprint. A cache captured against one database and emitted
 * against another would describe a different install's owner with nothing in the block saying so, and a
 * machine that repoints `SLOPWEAVER_STORE_URL` is not hypothetical — every worktree proof on this repo
 * does it. The voice register is the deliberate exception and its own case says why.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ContextCache,
  cacheAgeMinutes,
  contextCopyPath,
  readCachedVoiceRegister,
  readContextCache,
  storeFingerprint,
  writeContextCache,
} from "../../../context/cache.js";
import { ContextCacheErrors } from "../../../context/errors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One cache, so a case can vary exactly one field off it. */
const CACHE: ContextCache = {
  capturedAtIso: "2026-09-12T00:00:00.000Z",
  lines: ["[slopweaver] always-loaded context — read at 2026-09-12T00:00:00.000Z", "## About the owner"],
  schemaVersion: 1,
  storeFingerprint: "0123456789abcdef",
  voiceRegister: [
    {
      ceilingWords: 50,
      cohort: "all-sent",
      measuredAt: "2026-08-23T00:00:00.000Z",
      medianWords: 14,
      p75Words: 29,
      p90Words: 54,
      qualification: "",
      sampleCount: 4718,
      source: "file:communication-style.md",
      surface: "slack",
    },
  ],
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-context-cache-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("storeFingerprint", () => {
  it("is short and does not carry the connection string it was made from", () => {
    const url = "postgresql://someone:a-password@localhost:54322/postgres";
    const fingerprint = storeFingerprint({ url });
    expect(fingerprint).toHaveLength(16);
    expect(url).not.toContain(fingerprint);
  });

  it("separates two databases", () => {
    expect(storeFingerprint({ url: "postgres://a" })).not.toBe(storeFingerprint({ url: "postgres://b" }));
  });
});

describe("writeContextCache and readContextCache", () => {
  it("round-trips every field", () => {
    const path = join(dir, "context.json");
    expect(unwrap(writeContextCache({ cache: CACHE, path }))).toBe(true);
    expect(unwrap(readContextCache({ expectedFingerprint: CACHE.storeFingerprint, path }))).toStrictEqual(CACHE);
  });

  // The one reader that cannot parse JSON — the bash recovery lane in `hooks/lib/profile-delivered.sh` — reads this.
  it("writes the lines beside the cache as plain text, stamped with when they were captured", () => {
    const path = join(dir, "context.json");
    unwrap(writeContextCache({ cache: CACHE, path }));
    expect(contextCopyPath({ cachePath: path })).toBe(join(dir, "context.txt"));
    expect(readFileSync(join(dir, "context.txt"), "utf8")).toBe(
      "# The owner's profile, as last read live from the store at 2026-09-12T00:00:00.000Z\n\n" +
        "[slopweaver] always-loaded context — read at 2026-09-12T00:00:00.000Z\n## About the owner\n",
    );
  });

  it("says there is no cache when the file has never been written", () => {
    expect(unwrapErr(readContextCache({ expectedFingerprint: "x", path: join(dir, "absent.json") }))).toStrictEqual(
      ContextCacheErrors.absent(),
    );
  });

  it("refuses a truncated file rather than reading half a cache", () => {
    const path = join(dir, "context.json");
    writeFileSync(path, '{"schemaVersion":1,"lines":[', "utf8");
    expect(unwrapErr(readContextCache({ expectedFingerprint: "x", path }))).toStrictEqual(
      ContextCacheErrors.unreadable(),
    );
  });

  it("refuses a cache at another schema version rather than reinterpreting it", () => {
    const path = join(dir, "context.json");
    writeFileSync(path, JSON.stringify({ ...CACHE, schemaVersion: 99 }), "utf8");
    expect(unwrapErr(readContextCache({ expectedFingerprint: CACHE.storeFingerprint, path }))).toStrictEqual(
      ContextCacheErrors.staleSchema(),
    );
  });

  it("refuses a cache captured against a different database, naming both fingerprints", () => {
    const path = join(dir, "context.json");
    unwrap(writeContextCache({ cache: CACHE, path }));
    expect(unwrapErr(readContextCache({ expectedFingerprint: "fedcba9876543210", path }))).toStrictEqual(
      ContextCacheErrors.foreignStore({ actual: CACHE.storeFingerprint, expected: "fedcba9876543210" }),
    );
  });

  it("distinguishes an absent cache from a corrupt one by code, not by prose", () => {
    const path = join(dir, "context.json");
    writeFileSync(path, "not json at all", "utf8");
    expect(unwrapErr(readContextCache({ expectedFingerprint: "x", path })).code).toBe("CACHE_UNREADABLE");
    expect(unwrapErr(readContextCache({ expectedFingerprint: "x", path: join(dir, "absent.json") })).code).toBe(
      "CACHE_ABSENT",
    );
  });

  it("names the filesystem's own reason when the write fails", () => {
    const path = join(dir, "context.json", "nested.json");
    writeFileSync(join(dir, "context.json"), "{}", "utf8");
    const failure = unwrapErr(writeContextCache({ cache: CACHE, path }));
    expect(failure.code).toBe("CACHE_WRITE_FAILED");
    expect(failure.message).toContain("could not write the context cache: ");
  });

  it("refuses to write a cohort the reader would refuse, and writes no file", () => {
    const path = join(dir, "context.json");
    const unreadable = { ...CACHE, voiceRegister: [{ ...CACHE.voiceRegister[0]!, source: "" }] };
    expect(unwrapErr(writeContextCache({ cache: unreadable, path })).code).toBe("CACHE_WRITE_FAILED");
    expect(unwrapErr(readContextCache({ expectedFingerprint: CACHE.storeFingerprint, path })).code).toBe(
      "CACHE_ABSENT",
    );
  });
});

describe("readCachedVoiceRegister", () => {
  it("returns the cohorts even when the cache came from another database", () => {
    const path = join(dir, "context.json");
    unwrap(writeContextCache({ cache: CACHE, path }));
    expect(readCachedVoiceRegister({ path }).map((cohort) => cohort.cohort)).toStrictEqual(["all-sent"]);
  });

  it("returns none rather than throwing when there is no cache at all", () => {
    expect(readCachedVoiceRegister({ path: join(dir, "absent.json") })).toStrictEqual([]);
  });
});

describe("cacheAgeMinutes", () => {
  it("counts whole minutes", () => {
    expect(cacheAgeMinutes({ cache: CACHE, nowIso: "2026-09-12T01:30:59.000Z" })).toBe(90);
  });

  it("never reports a negative age when a clock disagrees", () => {
    expect(cacheAgeMinutes({ cache: CACHE, nowIso: "2026-09-11T00:00:00.000Z" })).toBe(0);
  });
});
