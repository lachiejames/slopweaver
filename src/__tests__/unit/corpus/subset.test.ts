/**
 * The subset contract, at both levels: the PURE window arithmetic, banner and manifest round-trip, and the
 * effectful build against a REAL temp-dir corpus — including the two refusals that are the only thing
 * standing between a mistyped `--out` and the corpus it was slicing.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { bronzeSourceDir, historyFile } from "../../../corpus/corpusPaths.js";
import {
  buildSubsetManifest,
  emptySubsetSources,
  LIMIT_ONLY_DAYS,
  parseSubsetManifest,
  renderSubsetLines,
  SUBSET_MANIFEST_VERSION,
  type SubsetManifest,
  subsetBanner,
  subsetWindow,
  windowVerdict,
} from "../../../corpus/subset.js";
import { buildSubset } from "../../../corpus/subsetBuild.js";
import { readSubsetManifest } from "../../../corpus/subsetStore.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { NO_PROTECTION } from "../../noProtection.js";

const NOW = new Date("2026-08-24T16:00:00.000Z");

const manifest = (over: Partial<SubsetManifest> = {}): SubsetManifest =>
  buildSubsetManifest({
    builtAtIso: "2026-08-24T16:00:00.000Z",
    days: 7,
    sinceIso: "2026-08-17T16:00:00.000Z",
    sourceHome: "/corpus/full",
    sources: [{ kept: 3, newestIso: "2026-08-20T00:00:00.000Z", scanned: 10, source: "github", undated: 0 }],
    untilIso: "2026-08-24T16:00:00.000Z",
    ...over,
  });

const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "body",
  tsIso: "2026-08-20T00:00:00.000Z",
  url: "https://example.invalid/1",
  ...over,
});

describe("subsetWindow", () => {
  it("measures the window back from the injected instant", () => {
    expect(subsetWindow({ days: 7, now: NOW })).toEqual({
      sinceIso: "2026-08-17T16:00:00.000Z",
      untilIso: "2026-08-24T16:00:00.000Z",
    });
  });

  it("widens with --days, which is the whole graduation mechanism", () => {
    expect(subsetWindow({ days: 90, now: NOW }).sinceIso).toBe("2026-05-26T16:00:00.000Z");
  });
});

describe("windowVerdict", () => {
  const bounds = { sinceIso: "2026-08-17T16:00:00.000Z", untilIso: "2026-08-24T16:00:00.000Z" };

  it("keeps a record inside the window", () => {
    expect(windowVerdict({ ...bounds, tsIso: "2026-08-20T00:00:00.000Z" })).toBe("in-window");
  });

  it("keeps the record sitting exactly on the lower bound", () => {
    expect(windowVerdict({ ...bounds, tsIso: "2026-08-17T16:00:00.000Z" })).toBe("in-window");
  });

  it("drops a record older than the window", () => {
    expect(windowVerdict({ ...bounds, tsIso: "2026-08-17T15:59:59.999Z" })).toBe("out-of-window");
  });

  it("drops a record stamped in the FUTURE, so the stated window stays true", () => {
    expect(windowVerdict({ ...bounds, tsIso: "2027-01-01T00:00:00.000Z" })).toBe("out-of-window");
  });

  it("calls a missing timestamp undated rather than guessing either way", () => {
    expect(windowVerdict({ ...bounds, tsIso: undefined })).toBe("undated");
  });

  it("calls an unparseable timestamp undated", () => {
    expect(windowVerdict({ ...bounds, tsIso: "last tuesday" })).toBe("undated");
  });
});

describe("subsetBanner", () => {
  it("names the width, the window, the count and the home it came from", () => {
    expect(subsetBanner({ manifest: manifest() })).toBe(
      "SUBSET — this world model holds only the last 7 day(s) " +
        "(2026-08-17T16:00:00.000Z → 2026-08-24T16:00:00.000Z), 3 record(s) sliced from /corpus/full. " +
        "Everything else is ABSENT from this home, not absent from the world.",
    );
  });

  it("names the cap as well when a window build was ALSO capped", () => {
    expect(subsetBanner({ manifest: manifest({ limit: 2 }) })).toContain(
      "Capped to the newest 2 record(s) per source.",
    );
  });

  it("phrases a COUNT-only build by its cap, because a 3,650-day window is true and useless", () => {
    expect(subsetBanner({ manifest: manifest({ days: LIMIT_ONLY_DAYS, limit: 500 }) })).toBe(
      "SUBSET — this world model holds only the newest 500 record(s) per source, 3 record(s) sliced from " +
        "/corpus/full. Everything else is ABSENT from this home, not absent from the world.",
    );
  });
});

describe("emptySubsetSources", () => {
  it("names a source that has bronze upstream but nothing inside the window", () => {
    const withSelf = manifest({
      sources: [
        { kept: 3, scanned: 10, source: "github", undated: 0 },
        { kept: 0, scanned: 59670, source: "self", undated: 0 },
      ],
    });
    expect(emptySubsetSources({ manifest: withSelf })).toEqual(["self"]);
  });

  it("is empty when every source contributed", () => {
    expect(emptySubsetSources({ manifest: manifest() })).toEqual([]);
  });
});

describe("renderSubsetLines", () => {
  it("reports the per-source tally, the undated count and the structurally absent sources", () => {
    const rendered = renderSubsetLines({
      manifest: manifest({
        sources: [
          { kept: 3, newestIso: "2026-08-20T00:00:00.000Z", scanned: 10, source: "github", undated: 2 },
          { kept: 0, scanned: 59670, source: "self", undated: 0 },
        ],
      }),
    });
    expect(rendered[2]).toContain("Cut on each record's own `tsIso`");
    expect(rendered[3]).toBe("  github: kept 3 of 10 scanned, 2 undated · newest 2026-08-20T00:00:00.000Z");
    expect(rendered[4]).toBe("  self: kept 0 of 59670 scanned · newest none");
    expect(rendered[5]).toContain("STRUCTURALLY ABSENT at this width: self");
  });

  it("says what a cap dropped, so a count never hides its own selection", () => {
    const rendered = renderSubsetLines({
      manifest: manifest({
        limit: 3,
        sources: [
          {
            inWindow: 42701,
            kept: 3,
            newestIso: "2026-08-20T00:00:00.000Z",
            scanned: 42703,
            source: "github",
            undated: 2,
          },
        ],
      }),
    });
    expect(rendered[3]).toBe(
      "  github: kept 3 (capped from 42701 in window) of 42703 scanned, 2 undated · newest 2026-08-20T00:00:00.000Z",
    );
  });
});

describe("parseSubsetManifest", () => {
  it("round-trips a manifest through JSON", () => {
    const parsed = parseSubsetManifest({ value: JSON.parse(JSON.stringify(manifest())) });
    expect(parsed).toEqual(manifest());
  });

  it("refuses a manifest from a different schema version rather than reading it optimistically", () => {
    expect(parseSubsetManifest({ value: { ...manifest(), version: SUBSET_MANIFEST_VERSION + 1 } })).toBeUndefined();
  });

  it("refuses a manifest missing its window rather than returning a half-read one", () => {
    const { sinceIso: _dropped, ...withoutSince } = manifest();
    expect(parseSubsetManifest({ value: withoutSince })).toBeUndefined();
  });

  it("refuses when any source tally is malformed", () => {
    expect(parseSubsetManifest({ value: { ...manifest(), sources: [{ source: "github" }] } })).toBeUndefined();
  });

  it("reads an absent manifest as not-a-subset rather than as an error", () => {
    expect(parseSubsetManifest({ value: undefined })).toBeUndefined();
  });
});

describe("buildSubset", () => {
  let source = "";
  let out = "";

  const writeBronze = ({ file, records }: { file: string; records: readonly CorpusRecord[] }): void => {
    mkdirSync(bronzeSourceDir({ home: source, source: "github" }), { recursive: true });
    writeFileSync(
      join(bronzeSourceDir({ home: source, source: "github" }), file),
      `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
      "utf8",
    );
  };

  beforeEach(() => {
    source = mkdtempSync(join(tmpdir(), "slop-subset-src-"));
    out = join(mkdtempSync(join(tmpdir(), "slop-subset-out-")), "home");
  });

  afterEach(() => {
    rmSync(source, { force: true, recursive: true });
    rmSync(join(out, ".."), { force: true, recursive: true });
  });

  it("copies only the records inside the window, verbatim", () => {
    writeBronze({
      file: "1970-01-01_2026-08-24.jsonl",
      records: [
        record({ sourceId: "#old", tsIso: "2020-01-01T00:00:00.000Z" }),
        record({ sourceId: "#new", tsIso: "2026-08-20T00:00:00.000Z" }),
      ],
    });
    const built = unwrap(
      buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(built.sources).toEqual([
      { kept: 1, newestIso: "2026-08-20T00:00:00.000Z", scanned: 2, source: "github", undated: 0 },
    ]);
    const written = readFileSync(
      join(bronzeSourceDir({ home: out, source: "github" }), "2026-08-17T16-00-00-000Z_2026-08-24T16-00-00-000Z.jsonl"),
      "utf8",
    );
    expect(written).toBe(`${JSON.stringify(record({ sourceId: "#new" }))}\n`);
  });

  it("counts an unparseable line as undated and leaves it out", () => {
    mkdirSync(bronzeSourceDir({ home: source, source: "github" }), { recursive: true });
    writeFileSync(
      join(bronzeSourceDir({ home: source, source: "github" }), "w.jsonl"),
      `${JSON.stringify(record())}\nnot json at all\n`,
      "utf8",
    );
    const built = unwrap(
      buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(built.sources[0]).toEqual({
      kept: 1,
      newestIso: "2026-08-20T00:00:00.000Z",
      scanned: 2,
      source: "github",
      undated: 1,
    });
  });

  it("writes the manifest the answer path reads back", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    unwrap(buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    const readBack = readSubsetManifest({ home: out });
    expect(readBack?.days).toBe(7);
    expect(readBack?.sinceIso).toBe("2026-08-17T16:00:00.000Z");
  });

  it("filters the activity-history stream by the same window", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    mkdirSync(stateHomePaths({ home: source }).corpus.history, { recursive: true });
    writeFileSync(
      historyFile({ home: source, source: "linear" }),
      `${JSON.stringify({ eventId: "old", source: "linear", tsIso: "2020-01-01T00:00:00.000Z" })}\n` +
        `${JSON.stringify({ eventId: "new", source: "linear", tsIso: "2026-08-20T00:00:00.000Z" })}\n`,
      "utf8",
    );
    unwrap(buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    expect(readFileSync(historyFile({ home: out, source: "linear" }), "utf8")).toBe(
      `${JSON.stringify({ eventId: "new", source: "linear", tsIso: "2026-08-20T00:00:00.000Z" })}\n`,
    );
  });

  it("caps the history stream too, so a limited home's contents match its own description", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    mkdirSync(stateHomePaths({ home: source }).corpus.history, { recursive: true });
    writeFileSync(
      historyFile({ home: source, source: "linear" }),
      `${JSON.stringify({ eventId: "a", source: "linear", tsIso: "2026-08-18T00:00:00.000Z" })}\n` +
        `${JSON.stringify({ eventId: "b", source: "linear", tsIso: "2026-08-22T00:00:00.000Z" })}\n`,
      "utf8",
    );
    unwrap(buildSubset({ days: 7, limit: 1, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    expect(readFileSync(historyFile({ home: out, source: "linear" }), "utf8")).toBe(
      `${JSON.stringify({ eventId: "b", source: "linear", tsIso: "2026-08-22T00:00:00.000Z" })}\n`,
    );
  });

  it("copies the scaffolding whole, because a person is not an activity", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    mkdirSync(stateHomePaths({ home: source }).corpus.members, { recursive: true });
    writeFileSync(join(stateHomePaths({ home: source }).corpus.members, "github.jsonl"), '{"id":"u1"}\n', "utf8");
    unwrap(buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    expect(readFileSync(join(stateHomePaths({ home: out }).corpus.members, "github.jsonl"), "utf8")).toBe(
      '{"id":"u1"}\n',
    );
  });

  it("never copies the retired identity roster file, which a subset store would otherwise import as its roster", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    writeFileSync(join(source, "identity.json"), "[]\n", "utf8");
    unwrap(buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    expect(existsSync(join(out, "identity.json"))).toBe(false);
  });

  it("never imports gold, whose claims were distilled from outside the window", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    mkdirSync(stateHomePaths({ home: source }).corpus.gold, { recursive: true });
    writeFileSync(join(stateHomePaths({ home: source }).corpus.gold, "overview.md"), "# distilled\n", "utf8");
    unwrap(buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    expect(existsSync(join(stateHomePaths({ home: out }).corpus.gold, "overview.md"))).toBe(false);
  });

  it("keeps only the newest N per source when a limit is given", () => {
    writeBronze({
      file: "w.jsonl",
      records: [
        record({ sourceId: "#a", tsIso: "2026-08-18T00:00:00.000Z" }),
        record({ sourceId: "#b", tsIso: "2026-08-22T00:00:00.000Z" }),
        record({ sourceId: "#c", tsIso: "2026-08-20T00:00:00.000Z" }),
      ],
    });
    const built = unwrap(
      buildSubset({ days: 7, limit: 2, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(built.sources[0]).toEqual({
      inWindow: 3,
      kept: 2,
      newestIso: "2026-08-22T00:00:00.000Z",
      scanned: 3,
      source: "github",
      undated: 0,
    });
    const written = readFileSync(
      join(bronzeSourceDir({ home: out, source: "github" }), "2026-08-17T16-00-00-000Z_2026-08-24T16-00-00-000Z.jsonl"),
      "utf8",
    );
    expect(written).toBe(
      `${JSON.stringify(record({ sourceId: "#c", tsIso: "2026-08-20T00:00:00.000Z" }))}\n` +
        `${JSON.stringify(record({ sourceId: "#b", tsIso: "2026-08-22T00:00:00.000Z" }))}\n`,
    );
  });

  it("records the limit on the manifest, so the banner can state the cap", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    unwrap(buildSubset({ days: 7, limit: 5, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }));
    expect(readSubsetManifest({ home: out })?.limit).toBe(5);
  });

  it("omits inWindow when the cap never bit, because it would repeat kept and say nothing", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    const built = unwrap(
      buildSubset({ days: 7, limit: 5, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(built.sources[0]?.inWindow).toBeUndefined();
  });

  it("selects the newest across MULTIPLE files, not the newest within each", () => {
    writeBronze({ file: "a.jsonl", records: [record({ sourceId: "#old", tsIso: "2026-08-18T00:00:00.000Z" })] });
    writeBronze({ file: "b.jsonl", records: [record({ sourceId: "#new", tsIso: "2026-08-23T00:00:00.000Z" })] });
    const built = unwrap(
      buildSubset({ days: 7, limit: 1, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(built.sources[0]?.kept).toBe(1);
    const written = readFileSync(
      join(bronzeSourceDir({ home: out, source: "github" }), "2026-08-17T16-00-00-000Z_2026-08-24T16-00-00-000Z.jsonl"),
      "utf8",
    );
    expect(written).toBe(`${JSON.stringify(record({ sourceId: "#new", tsIso: "2026-08-23T00:00:00.000Z" }))}\n`);
  });

  it("refuses a source home with no bronze", () => {
    const error = unwrapErr(
      buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(error.code).toBe("NO_SOURCE_CORPUS");
  });

  it("refuses to write into the home it is slicing", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    const error = unwrapErr(
      buildSubset({ days: 7, now: NOW, outHome: source, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(error.code).toBe("DESTINATION_IS_SOURCE");
  });

  it("refuses a destination that already holds a corpus", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    mkdirSync(stateHomePaths({ home: out }).corpus.bronze, { recursive: true });
    const error = unwrapErr(
      buildSubset({ days: 7, now: NOW, outHome: out, protection: NO_PROTECTION, sourceHome: source }),
    );
    expect(error.code).toBe("DESTINATION_OCCUPIED");
  });

  it("refuses a source home whose scaffolding holds a no-access entry, copying nothing", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    const members = stateHomePaths({ home: source }).corpus.members;
    const entry = join(members, "private.jsonl");
    const protection: OwnerProtectionResolver = () =>
      ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "no-access", path: entry, why: "never read" }]);
    expect(unwrapErr(buildSubset({ days: 7, now: NOW, outHome: out, protection, sourceHome: source }))).toEqual({
      code: "SUBSET_PROTECTED",
      message:
        `refusing to build a subset into ${out}: it would search ${members}, which the owner's protect list marks ` +
        `no-access at ${entry} (never read) — nothing was copied`,
    });
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a destination under a read-only entry, which a plain read would let through", () => {
    writeBronze({ file: "w.jsonl", records: [record()] });
    const parent = join(out, "..");
    const protection: OwnerProtectionResolver = () =>
      ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path: parent, why: "held" }]);
    expect(unwrapErr(buildSubset({ days: 7, now: NOW, outHome: out, protection, sourceHome: source })).code).toBe(
      "SUBSET_PROTECTED",
    );
    expect(existsSync(out)).toBe(false);
  });
});
