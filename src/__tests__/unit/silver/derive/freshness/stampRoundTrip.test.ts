/*
 * The stamp round-trips through a real home: what bronze and members hold, the whole tree the reader walks, an empty
 * home, a written stamp that reads fresh until a new file lands, and an absent stamp. Every case mints its own home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveFreshness, EMPTY_WITNESS, emptyObservation } from "../../../../../silver/derive/freshness.js";
import {
  freshnessStampPath,
  observeCorpus,
  observeSources,
  readFreshnessStamp,
  writeFreshnessStamp,
} from "../../../../../silver/derive/stamp.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("the stamp round-trips through a real home", () => {
  it("observes what bronze and members hold, and the roster revision it was handed", () => {
    const home = mkdtempSync(join(tmpdir(), "freshness-observe-"));
    fixtureDirs.push(home);
    mkdirSync(join(home, "corpus", "bronze", "slack"), { recursive: true });
    mkdirSync(join(home, "corpus", "members"), { recursive: true });
    mkdirSync(join(home, "corpus", "watermarks"), { recursive: true });
    writeFileSync(join(home, "corpus", "bronze", "slack", "a.jsonl"), "0123456789", "utf8");
    writeFileSync(join(home, "corpus", "members", "slack.jsonl"), "abc", "utf8");
    // A retired roster file in the home is read by nothing: the revision is what was handed in.
    writeFileSync(join(home, "identity.json"), "[]", "utf8");
    writeFileSync(
      join(home, "corpus", "watermarks", "slack.json"),
      JSON.stringify({ cursor: "2026-08-22T10:58:40Z", version: 1 }),
      "utf8",
    );

    const observed = observeSources({ home, rosterRevision: 6 });
    expect(observed.overrideRevision).toBe(6);
    expect(observed.sources.slack).toEqual({
      bronzeBytes: 10,
      bronzeFiles: 1,
      cursorIso: "2026-08-22T10:58:40Z",
      memberBytes: 3,
      structureBytes: 0,
    });
    expect(observed.sources.linear).toEqual(EMPTY_WITNESS);
    expect(observed.corpus).toBeNull();
  });

  it("witnesses the whole tree derive's reader walks — nested and loose files the per-source witness misses", () => {
    const home = mkdtempSync(join(tmpdir(), "freshness-corpus-"));
    fixtureDirs.push(home);
    mkdirSync(join(home, "corpus", "bronze", "slack", "archive"), { recursive: true });
    writeFileSync(join(home, "corpus", "bronze", "slack", "a.jsonl"), "0123456789", "utf8");
    writeFileSync(join(home, "corpus", "bronze", "slack", "archive", "b.jsonl"), "abcd", "utf8");
    writeFileSync(join(home, "corpus", "bronze", "loose.jsonl"), "xy", "utf8");
    expect(observeSources({ home, rosterRevision: null }).sources.slack.bronzeFiles).toBe(1);
    expect(observeCorpus({ home })).toEqual({
      bytes: 16,
      files: 3,
      root: join(home, "corpus", "bronze"),
      unreadable: 0,
    });
  });

  it("observes an empty home as zeroes rather than throwing", () => {
    const home = mkdtempSync(join(tmpdir(), "freshness-empty-"));
    fixtureDirs.push(home);
    expect(observeSources({ home, rosterRevision: null })).toEqual(emptyObservation());
  });

  it("writes a stamp a later read compares as fresh, and a new file makes it stale", () => {
    const home = mkdtempSync(join(tmpdir(), "freshness-roundtrip-"));
    fixtureDirs.push(home);
    mkdirSync(join(home, "corpus", "bronze", "slack"), { recursive: true });
    writeFileSync(join(home, "corpus", "bronze", "slack", "a.jsonl"), "one", "utf8");

    const path = writeFreshnessStamp({
      artefacts: null,
      derivedAtIso: "2026-08-23T09:00:00.000Z",
      home,
      observation: observeSources({ home, rosterRevision: null }),
      observedAtIso: "2026-08-23T08:59:00.000Z",
    });
    expect(path).toBe(freshnessStampPath({ home }));

    const stamp = readFreshnessStamp({ home })!;
    expect(stamp.derivedAtIso).toBe("2026-08-23T09:00:00.000Z");
    expect(stamp.observedAtIso).toBe("2026-08-23T08:59:00.000Z");
    expect(
      deriveFreshness({ artefactPresent: true, observed: observeSources({ home, rosterRevision: null }), stamp }),
    ).toEqual({
      kind: "fresh",
    });

    writeFileSync(join(home, "corpus", "bronze", "slack", "b.jsonl"), "two", "utf8");
    const after = deriveFreshness({
      artefactPresent: true,
      observed: observeSources({ home, rosterRevision: null }),
      stamp,
    });
    expect(after).toEqual({
      changed: [{ reasons: ["bronze 1 file(s)/3B → 2 file(s)/6B"], source: "slack" }],
      derivedAtIso: "2026-08-23T09:00:00.000Z",
      kind: "stale",
    });
  });

  it("reads an absent stamp as undefined", () => {
    const home = mkdtempSync(join(tmpdir(), "freshness-nostamp-"));
    fixtureDirs.push(home);
    expect(readFreshnessStamp({ home })).toBe(undefined);
  });
});
