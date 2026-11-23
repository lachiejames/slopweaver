/**
 * The drift SCAN, driven over a real bronze tree with a plain function standing in for the store.
 *
 * Every property under test here is filesystem-side and none of it needs Postgres: which files the scope
 * reads, that an id repeated across two window files is ONE candidate, that the scan counts what the
 * denylist excluded separately from what is missing, and that the omission clause bounds the claim. A
 * store the probe answers for is a fake function passed in, which `testing.md` allows and a mock is not.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../lib/result.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import { measureBronzeDrift, type PresenceProbe } from "../../../store/bronzeDrift.js";
import { StoreErrors } from "../../../store/errors.js";

let home = "";

/** One bronze line the ingest projection accepts, addressed by its native id. */
const line = ({ sourceId, author = "someone@example.test" }: { sourceId: string; author?: string }): string =>
  JSON.stringify({
    attrs: {},
    author,
    container: "primary",
    kind: "event",
    raw: {},
    refs: [],
    source: "calendar",
    sourceId,
    text: `body for ${sourceId}`,
    title: null,
    tsIso: "2026-09-18T04:00:00.000Z",
    url: `https://example.test/${sourceId}`,
    visibility: "private",
  });

/** Write one bronze file under the throwaway home, under the source DIRECTORY named. */
const writeBronze = ({
  basename,
  lines,
  directory = "calendar",
}: {
  basename: string;
  lines: readonly string[];
  directory?: string;
}): void => {
  const dir = join(home, "corpus", "bronze", directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, basename), `${lines.join("\n")}\n`, "utf8");
};

/** A probe that answers with exactly the ids named, whatever it was asked. */
const holding = ({ ids }: { ids: readonly string[] }): PresenceProbe => {
  return async ({ sourceIds }) => ok(new Set(sourceIds.filter((id) => ids.includes(id))));
};

/** A probe that answers per (source, id) pair, so a cross-source question gets a different answer. */
const holdingPairs = ({ pairs }: { pairs: readonly string[] }): PresenceProbe => {
  return async ({ source, sourceIds }) => ok(new Set(sourceIds.filter((id) => pairs.includes(`${source}\u0000${id}`))));
};

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  home = "";
});

describe("measureBronzeDrift over a real bronze tree", () => {
  it("counts an id the store does not hold, and names it", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" }), line({ sourceId: "b" })] });
    const report = unwrap(
      await measureBronzeDrift({ home, probe: holding({ ids: ["a"] }), protection: [], source: "calendar" }),
    );
    expect(report.candidates).toBe(2);
    expect(report.present).toBe(1);
    expect(report.missing).toBe(1);
    expect(report.examples).toEqual(["b"]);
    expect(report.linesRead).toBe(2);
    expect(report.filesScanned).toBe(1);
  });

  it("counts an id repeated across two window files ONCE, because a duplicate is not a second miss", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-16_2026-09-17.jsonl", lines: [line({ sourceId: "a" })] });
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" }), line({ sourceId: "b" })] });
    const report = unwrap(
      await measureBronzeDrift({ home, probe: holding({ ids: [] }), protection: [], source: "calendar" }),
    );
    expect(report.linesRead).toBe(3);
    expect(report.candidates).toBe(2);
    expect(report.missing).toBe(2);
    expect(report.filesScanned).toBe(2);
  });

  it("reports nothing missing, and nothing omitted, when the store holds every id", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const report = unwrap(
      await measureBronzeDrift({ home, probe: holding({ ids: ["a"] }), protection: [], source: "calendar" }),
    );
    expect(report.missing).toBe(0);
    expect(report.examples).toEqual([]);
    expect(report.filesOmitted).toBe(0);
    expect(report.bytesOmitted).toBe(0);
  });

  it("omits the canonical compact.jsonl under the default scope, and SAYS how much it left", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "compact.jsonl", lines: [line({ sourceId: "old" })] });
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const report = unwrap(
      await measureBronzeDrift({ home, probe: holding({ ids: [] }), protection: [], source: "calendar" }),
    );
    expect(report.filesScanned).toBe(1);
    expect(report.filesOmitted).toBe(1);
    expect(report.bytesOmitted).toBeGreaterThan(0);
    expect(report.candidates).toBe(1);
    expect(report.examples).toEqual(["a"]);
  });

  it("reads the canonical file too under the full scope, so the count covers the whole corpus", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "compact.jsonl", lines: [line({ sourceId: "old" })] });
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const report = unwrap(
      await measureBronzeDrift({
        home,
        probe: holding({ ids: [] }),
        protection: [],
        scope: "full",
        source: "calendar",
      }),
    );
    expect(report.filesScanned).toBe(2);
    expect(report.filesOmitted).toBe(0);
    expect(report.candidates).toBe(2);
    expect(report.missing).toBe(2);
  });

  it("reports a source with no bronze at all as an empty scan, never as a failure", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    const report = unwrap(
      await measureBronzeDrift({ home, probe: holding({ ids: [] }), protection: [], source: "calendar" }),
    );
    expect(report.filesScanned).toBe(0);
    expect(report.candidates).toBe(0);
    expect(report.missing).toBe(0);
    expect(report.linesRead).toBe(0);
  });

  it("carries the probe's failure out rather than reporting a gap it could not measure", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const refused = await measureBronzeDrift({
      home,
      probe: async () => err(StoreErrors.queryFailed({ cause: new Error("no route"), what: "the probe under test" })),
      protection: [],
      source: "calendar",
    });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("STORE_QUERY_FAILED");
    expect(refused._unsafeUnwrapErr().message).toContain("no route");
  });

  it("asks the store about the PROJECTED source, so a row stored elsewhere is not a false miss", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({
      basename: "2026-09-17_2026-09-18.jsonl",
      directory: "slack",
      lines: [line({ sourceId: "a" })],
    });
    const report = unwrap(
      await measureBronzeDrift({
        home,
        probe: holdingPairs({ pairs: ["calendar\u0000a"] }),
        protection: [],
        source: "slack",
      }),
    );
    expect(report.source).toBe("slack");
    expect(report.candidates).toBe(1);
    expect(report.present).toBe(1);
    expect(report.missing).toBe(0);
    expect(report.examples).toEqual([]);
  });

  it("names a cross-source miss as source:id, so the anomaly reads as one rather than as a plain gap", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({
      basename: "2026-09-17_2026-09-18.jsonl",
      directory: "slack",
      lines: [line({ sourceId: "a" })],
    });
    const report = unwrap(
      await measureBronzeDrift({
        home,
        probe: holdingPairs({ pairs: ["slack\u0000a"] }),
        protection: [],
        source: "slack",
      }),
    );
    expect(report.missing).toBe(1);
    expect(report.examples).toEqual(["calendar:a"]);
  });
  it("types an unreadable bronze file as a store failure, rather than throwing a raw EACCES at the verb", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const path = join(home, "corpus", "bronze", "calendar", "2026-09-17_2026-09-18.jsonl");
    chmodSync(path, 0o000);
    const refused = await measureBronzeDrift({ home, probe: holding({ ids: [] }), protection: [], source: "calendar" });
    chmodSync(path, 0o600);
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("BRONZE_UNREADABLE");
    expect(refused._unsafeUnwrapErr().message).toContain("2026-09-17_2026-09-18.jsonl");
  });
  it("types an unlistable bronze DIRECTORY, so an unmeasurable scan cannot read as a clean one", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const dir = join(home, "corpus", "bronze", "calendar");
    chmodSync(dir, 0o000);
    const refused = await measureBronzeDrift({ home, probe: holding({ ids: [] }), protection: [], source: "calendar" });
    chmodSync(dir, 0o700);
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("BRONZE_UNREADABLE");
    expect(refused._unsafeUnwrapErr().message).toContain(dir);
  });

  it("still reads a source whose bronze directory does not exist as an empty scan, never as a failure", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    const report = unwrap(
      await measureBronzeDrift({ home, probe: holding({ ids: [] }), protection: [], source: "github" }),
    );
    expect(report.filesScanned).toBe(0);
    expect(report.candidates).toBe(0);
    expect(report.missing).toBe(0);
  });
});

/** One protect-list entry, as the registry parser yields it. */
const entry = ({ path, mode = "no-access" }: { path: string; mode?: ProtectedPath["mode"] }): ProtectedPath => ({
  addedIso: "2026-11-21T10:42:00.000Z",
  mode,
  path,
  why: "synthetic: the owner keeps this folder private",
});

/** A probe that fails loudly, so a scan that reached the store would report THIS rather than the refusal. */
const unreachedProbe: PresenceProbe = async () =>
  err(StoreErrors.queryFailed({ cause: new Error("the probe was reached"), what: "a protected scan" }));

describe("measureBronzeDrift honours the owner's protect list", () => {
  it("withholds a no-access source directory before the store is asked anything", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const dir = join(home, "corpus", "bronze", "calendar");
    const refused = await measureBronzeDrift({
      home,
      probe: unreachedProbe,
      protection: [entry({ path: dir })],
      source: "calendar",
    });
    expect(refused._unsafeUnwrapErr()).toEqual(
      StoreErrors.bronzeProtected({
        path: dir,
        protectedPath: dir,
        why: "synthetic: the owner keeps this folder private",
      }),
    );
  });

  it("refuses BEFORE listing: an unlistable no-access directory is protected, never unreadable", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const dir = join(home, "corpus", "bronze", "calendar");
    chmodSync(dir, 0o000);
    const refused = await measureBronzeDrift({
      home,
      probe: unreachedProbe,
      protection: [entry({ path: dir })],
      source: "calendar",
    });
    chmodSync(dir, 0o700);
    expect(refused._unsafeUnwrapErr().code).toBe("BRONZE_PROTECTED");
  });

  it("withholds the whole source when one FILE inside it is no-access, since the listing recurses into it", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const file = join(home, "corpus", "bronze", "calendar", "2026-09-17_2026-09-18.jsonl");
    const refused = await measureBronzeDrift({
      home,
      probe: unreachedProbe,
      protection: [entry({ path: file })],
      source: "calendar",
    });
    expect(refused._unsafeUnwrapErr().code).toBe("BRONZE_PROTECTED");
    expect(refused._unsafeUnwrapErr().message).toContain(file);
  });

  it("refuses a nested symlink into a no-access tree before following it", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const elsewhere = mkdtempSync(join(tmpdir(), "drift-elsewhere-"));
    writeFileSync(join(elsewhere, "private.jsonl"), `${line({ sourceId: "secret" })}\n`, "utf8");
    symlinkSync(elsewhere, join(home, "corpus", "bronze", "calendar", "linked"));
    const refused = await measureBronzeDrift({
      home,
      probe: unreachedProbe,
      protection: [entry({ path: realpathSync(elsewhere) })],
      source: "calendar",
    });
    rmSync(elsewhere, { force: true, recursive: true });
    expect(refused._unsafeUnwrapErr().code).toBe("BRONZE_PROTECTED");
    expect(refused._unsafeUnwrapErr().message).toContain("linked");
  });

  it("scans a read-only source as normal: only no-access withholds a read", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const dir = join(home, "corpus", "bronze", "calendar");
    const report = unwrap(
      await measureBronzeDrift({
        home,
        probe: holding({ ids: [] }),
        protection: [entry({ mode: "read-only", path: dir })],
        source: "calendar",
      }),
    );
    expect(report.missing).toBe(1);
    expect(report.examples).toEqual(["a"]);
  });

  it("scans a source beside a no-access sibling as normal", async () => {
    home = mkdtempSync(join(tmpdir(), "drift-"));
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", lines: [line({ sourceId: "a" })] });
    const report = unwrap(
      await measureBronzeDrift({
        home,
        probe: holding({ ids: ["a"] }),
        protection: [entry({ path: join(home, "corpus", "bronze", "chatgpt") })],
        source: "calendar",
      }),
    );
    expect(report.candidates).toBe(1);
    expect(report.missing).toBe(0);
  });
});
