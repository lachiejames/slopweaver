/**
 * The two doors a fifth source has to get through, and both of them dropped it silently before this.
 *
 * `bucketRecordsBySource` iterated the FETCH list, so a `self` record was discarded at the write with the run
 * reporting `written: 0` and exiting clean. `validateRowCore` validated against the same list, so a `self` line
 * already on disk was rejected on read as an unknown source. Either failure alone produces a green run and an
 * empty corpus — which is exactly why both directions are pinned here rather than left to the connector's tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { bucketRecordsBySource } from "../../../corpus/bronzeAppend.js";
import { bronzeStorageBySource } from "../../../corpus/bronzeStorage.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { bronzeDir } from "../../../corpus/corpusPaths.js";
import { parseRow } from "../../../corpus/corpusRowCore.js";
import { writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import { serialiseRecord } from "../../../corpus/recordSerialisation.js";
import { type CorpusRecord } from "../../../corpus/types.js";
import { BRONZE_SOURCES, CORPUS_SOURCES } from "../../../integrations/corpusSources.js";
import { ok, unwrap } from "../../../lib/result.js";

const selfRecord: CorpusRecord = {
  attrs: { dir: "junkyard", ordinal: 0, part: 0, parts: 1, root: "state", timeSource: "git" },
  author: "me",
  container: "state/junkyard",
  kind: "document",
  refs: [],
  source: "self",
  sourceId: "state/junkyard/an-old-idea.md#0.0:owned-paths",
  text: "the idea, restated",
  tsIso: "2026-07-19T10:00:00+10:00",
  url: "/dev/state/junkyard/an-old-idea.md",
  visibility: "private",
};

const window = { since: "1970-01-01", until: "2026-08-06" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("the two source lists say different things, on purpose", () => {
  it("keeps self OUT of the fetch-and-watermark list", () => {
    expect(CORPUS_SOURCES.includes("self")).toBe(false);
    expect(CORPUS_SOURCES).toEqual(["github", "slack", "linear", "notion"]);
  });

  it("puts self IN the list of sources that have bytes in bronze", () => {
    expect(BRONZE_SOURCES).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "self",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
      "outlook",
    ]);
  });

  it("keeps gold out of both, because it is synthesised at query time and never persisted", () => {
    // Widened to `string` on purpose: BRONZE_SOURCES is typed without `gold`, which is the claim under test.
    const bronze: readonly string[] = BRONZE_SOURCES;
    expect(CORPUS_SOURCES.includes("gold")).toBe(false);
    expect(bronze.includes("gold")).toBe(false);
  });
});

describe("the write door", () => {
  it("buckets a self record instead of dropping it", () => {
    const buckets = bucketRecordsBySource({ records: [selfRecord] });

    expect(buckets.get("self")?.length).toBe(1);
  });

  it("actually writes it to bronze", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-bronze-self-"));
    fixtureDirs.push(home);

    const written = unwrap(writeCorpusRecords({ home, protection: () => ok([]), records: [selfRecord], window }));

    expect(written.written).toBe(1);
    expect(written.bySource["self"]).toBe(1);
  });
});

describe("the read door", () => {
  it("accepts a self line rather than rejecting it as an unknown source", () => {
    const parsed = parseRow({ line: serialiseRecord({ record: selfRecord }) });

    expect("record" in parsed).toBe(true);
    expect("record" in parsed ? parsed.record.source : "").toBe("self");
  });

  it("round-trips every field, including the time-source mark and the private stamp", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-bronze-self-rt-"));
    fixtureDirs.push(home);

    writeCorpusRecords({ home, protection: () => ok([]), records: [selfRecord], window });
    const { records: read } = unwrap(readCorpusDir({ dir: bronzeDir({ home }), home, protection: () => ok([]) }));

    expect(read.length).toBe(1);
    expect(read[0]!.attrs?.["timeSource"]).toBe("git");
    expect(read[0]!.visibility).toBe("private");
    expect(read[0]!.author).toBe("me");
    expect(read[0]!.url).toBe("/dev/state/junkyard/an-old-idea.md");
  });

  it("still rejects a genuinely unknown source", () => {
    const parsed = parseRow({ line: JSON.stringify({ ...selfRecord, source: "telepathy" }) });

    expect("error" in parsed).toBe(true);
    expect("error" in parsed ? parsed.error : "").toContain("unknown source");
  });
});

describe("the storage report", () => {
  it("names self, so its footprint is visible rather than invisible", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-bronze-self-size-"));
    fixtureDirs.push(home);
    writeCorpusRecords({ home, protection: () => ok([]), records: [selfRecord], window });

    const { storage } = unwrap(bronzeStorageBySource({ home, protection: () => ok([]) }));

    expect(storage.map((entry) => entry.source)).toEqual(["self"]);
    expect(storage[0]!.files).toBe(1);
    expect(storage[0]!.bytes).toBeGreaterThan(0);
  });
});
