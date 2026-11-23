/**
 * The on-disk view compaction rewrites and `audit` measures. It must agree with both, so the listing is
 * exercised against a real temp-dir corpus: sorted, flat, `.jsonl` only, honest about a layout it
 * refuses to touch, and refused outright where the owner's protect list covers the source.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { bronzeStorageBySource, listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import { bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { OwnerProtectionErrors } from "../../../protectedPaths/ownerEntries.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

/** A protect list holding exactly one no-access entry at `path`. */
const noAccessAt = ({ path }: { path: string }): OwnerProtectionResolver => {
  const entry: ProtectedPath = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access", path, why: "fixture" };
  return () => ok([entry]);
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-storage-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function seed({ source, name, content }: { source: CorpusSource; name: string; content: string }): void {
  const dir = bronzeSourceDir({ home, source });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf8");
}

/** One source's listing under an empty protect list, unwrapped. */
const listed = ({ source, strict = false }: { source: CorpusSource; strict?: boolean }) =>
  unwrap(listBronzeFiles({ home, protection: NO_ENTRIES, source, strict }));

describe("listBronzeFiles", () => {
  it("lists a source's .jsonl files sorted by name, with their exact byte sizes", () => {
    seed({ content: "bb\n", name: "2026-06-08_2026-06-15.jsonl", source: "github" });
    seed({ content: "a\n", name: "2026-06-01_2026-06-08.jsonl", source: "github" });

    const files = listed({ source: "github" });

    expect(files.map((file) => file.path)).toStrictEqual([
      join(bronzeSourceDir({ home, source: "github" }), "2026-06-01_2026-06-08.jsonl"),
      join(bronzeSourceDir({ home, source: "github" }), "2026-06-08_2026-06-15.jsonl"),
    ]);
    expect(files.map((file) => file.bytes)).toStrictEqual([2, 3]);
  });

  it("ignores non-.jsonl siblings, including a staged .tmp left by an interrupted compaction", () => {
    seed({ content: "a\n", name: "2026-06-01_2026-06-08.jsonl", source: "github" });
    seed({ content: "junk\n", name: "compact.jsonl.tmp", source: "github" });
    seed({ content: "notes\n", name: "README.md", source: "github" });

    expect(listed({ source: "github" })).toHaveLength(1);
  });

  it("reads a never-ingested source as empty, not as an error", () => {
    expect(listed({ source: "notion" })).toStrictEqual([]);
  });

  it("RECURSES into a nested directory, so it sees exactly what the corpus reader sees", () => {
    seed({ content: "top\n", name: "2026-06-01_2026-06-08.jsonl", source: "slack" });
    const nested = join(bronzeSourceDir({ home, source: "slack" }), "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "deep.jsonl"), "deep\n", "utf8");

    expect(listed({ source: "slack" }).map((file) => file.bytes)).toStrictEqual([4, 5]);
  });

  it("ignores an empty nested directory", () => {
    mkdirSync(join(bronzeSourceDir({ home, source: "slack" }), "nested"), { recursive: true });

    expect(listed({ source: "slack" })).toStrictEqual([]);
  });
});

describe("listBronzeFiles under the owner's protect list", () => {
  it("refuses a source marked no-access, naming the entry, rather than listing it as empty", () => {
    seed({ content: "a\n", name: "w.jsonl", source: "slack" });
    const dir = bronzeSourceDir({ home, source: "slack" });

    const refusal = unwrapErr(listBronzeFiles({ home, protection: noAccessAt({ path: dir }), source: "slack" }));

    expect(refusal).toStrictEqual({
      code: "BRONZE_LIST_PROTECTED",
      message: `refusing to read slack: it would search ${dir}, which the owner's protect list marks no-access at ${dir} (fixture)`,
    });
  });

  it("refuses a symlink inside the source that leads into a protected tree", () => {
    seed({ content: "a\n", name: "w.jsonl", source: "slack" });
    // The entry is recorded at its real path, as the owner's registry reader resolves one (`/var` is `/private/var`).
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "slop-protected-")));
    writeFileSync(join(outside, "secret.jsonl"), "s\n", "utf8");
    const link = join(bronzeSourceDir({ home, source: "slack" }), "linked");
    symlinkSync(outside, link);

    const refusal = unwrapErr(listBronzeFiles({ home, protection: noAccessAt({ path: outside }), source: "slack" }));
    rmSync(outside, { force: true, recursive: true });

    expect(refusal).toStrictEqual({
      code: "BRONZE_LIST_PROTECTED",
      message: `refusing to read slack: it would search ${link}, which the owner's protect list marks no-access at ${outside} (fixture)`,
    });
  });

  it("refuses when the protect list cannot be read, rather than listing as if it held nothing", () => {
    seed({ content: "a\n", name: "w.jsonl", source: "slack" });

    const unreadable: OwnerProtectionResolver = () => err(OwnerProtectionErrors.unknown({ reason: "not JSON" }));

    const refusal = unwrapErr(listBronzeFiles({ home, protection: unreadable, source: "slack" }));

    expect(refusal).toStrictEqual({
      code: "BRONZE_LIST_PROTECTED",
      message:
        "refusing to read slack: the owner's protect list could not be read, so nothing it might cover is touched: not JSON",
    });
  });

  it("lists a read-only source, because reading is what read-only allows", () => {
    seed({ content: "a\n", name: "w.jsonl", source: "slack" });
    const dir = bronzeSourceDir({ home, source: "slack" });
    const entry: ProtectedPath = { addedIso: "2026-01-01T00:00:00.000Z", mode: "read-only", path: dir, why: "fixture" };

    expect(unwrap(listBronzeFiles({ home, protection: () => ok([entry]), source: "slack" }))).toHaveLength(1);
  });
});

describe("bronzeStorageBySource", () => {
  it("reports only the sources that occupy disk, with per-source file counts and bytes", () => {
    seed({ content: "aaaa\n", name: "2026-06-01_2026-06-08.jsonl", source: "github" });
    seed({ content: "bb\n", name: "2026-06-08_2026-06-15.jsonl", source: "github" });
    seed({ content: "c\n", name: "2026-06-01_2026-06-08.jsonl", source: "linear" });

    expect(unwrap(bronzeStorageBySource({ home, protection: NO_ENTRIES }))).toStrictEqual({
      protectedSources: [],
      storage: [
        { bytes: 8, files: 2, source: "github" },
        { bytes: 2, files: 1, source: "linear" },
      ],
    });
  });

  it("reports an empty corpus as no sources at all", () => {
    expect(unwrap(bronzeStorageBySource({ home, protection: NO_ENTRIES }))).toStrictEqual({
      protectedSources: [],
      storage: [],
    });
  });

  it("names a protected source and measures every other, never reading it as one occupying nothing", () => {
    seed({ content: "aaaa\n", name: "w.jsonl", source: "github" });
    seed({ content: "c\n", name: "w.jsonl", source: "linear" });
    const dir = bronzeSourceDir({ home, source: "linear" });

    expect(unwrap(bronzeStorageBySource({ home, protection: noAccessAt({ path: dir }) }))).toStrictEqual({
      protectedSources: [
        {
          line: `refusing to read linear: it would search ${dir}, which the owner's protect list marks no-access at ${dir} (fixture)`,
          source: "linear",
        },
      ],
      storage: [{ bytes: 5, files: 1, source: "github" }],
    });
  });

  it("refuses the whole report when the protect list cannot be read", () => {
    seed({ content: "c\n", name: "w.jsonl", source: "linear" });
    const unreadable: OwnerProtectionResolver = () => err(OwnerProtectionErrors.unknown({ reason: "not JSON" }));

    expect(unwrapErr(bronzeStorageBySource({ home, protection: unreadable }))).toStrictEqual({
      code: "BRONZE_LIST_PROTECTED",
      message:
        "refusing to read the corpus: the owner's protect list could not be read, so nothing it might cover is touched: not JSON",
    });
  });
});

describe("listBronzeFiles strict mode", () => {
  it("lists an unreadable directory as empty by default, which is what the compactor and audit want", () => {
    seed({ content: '{"a":1}\n', name: "w.jsonl", source: "slack" });
    const dir = bronzeSourceDir({ home, source: "slack" });
    chmodSync(dir, 0o000);
    const files = listBronzeFiles({ home, protection: NO_ENTRIES, source: "slack" });
    chmodSync(dir, 0o700);
    expect(unwrap(files)).toStrictEqual([]);
  });

  it("refuses an unreadable directory under strict, because an unreadable source is not an empty one", () => {
    seed({ content: '{"a":1}\n', name: "w.jsonl", source: "slack" });
    const dir = bronzeSourceDir({ home, source: "slack" });
    chmodSync(dir, 0o000);
    const files = listBronzeFiles({ home, protection: NO_ENTRIES, source: "slack", strict: true });
    chmodSync(dir, 0o700);
    const failure = unwrapErr(files);
    expect(failure.code).toBe("BRONZE_LIST_UNREADABLE");
    expect(failure.message).toContain("EACCES");
  });

  it("lists a directory that does not exist as empty under strict too — nobody ingested it", () => {
    expect(listed({ source: "notion", strict: true })).toStrictEqual([]);
  });
});
