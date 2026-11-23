/**
 * Projection into the one atom, and the two properties the handover called out as the ones that must not be
 * got wrong: **every `self` record is private**, and **a re-scan produces identical records** so the write is
 * a no-op rather than a duplicate.
 *
 * The privacy half is asserted through the WRITE and READ paths as well as on the projected object, because
 * the default is public and the failure mode is a record that looks stamped and reads back public.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../../corpus/corpusDirRead.js";
import { bronzeDir } from "../../../../corpus/corpusPaths.js";
import { writeCorpusRecords } from "../../../../corpus/corpusWriter.js";
import type { DatedSelfFile } from "../../../../corpus/self/project.js";
import { projectSelfFile, projectSelfRecords, selfContainer, selfSourceId } from "../../../../corpus/self/project.js";
import type { SelfFile } from "../../../../corpus/self/scan.js";
import { visibilityForRecord } from "../../../../corpus/visibility.js";
import { ok } from "../../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const FILE: SelfFile = {
  absPath: "/dev/state/junkyard/an-old-idea.md",
  controlBytesStripped: 0,
  mtimeIso: "2026-08-05T00:00:00.000Z",
  relPath: "junkyard/an-old-idea.md",
  root: "/dev/state",
  rootName: "state",
  text: "## Owned paths\nthe idea, restated\n\n## Risk classes\nand the other half TEAM-123",
};

const DATED: DatedSelfFile = { file: FILE, timeSource: "git", tsIso: "2026-07-19T10:00:00+10:00" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("selfContainer", () => {
  it("groups by root and top-level directory, which is where live-versus-discarded lives", () => {
    expect(selfContainer({ file: FILE })).toBe("state/junkyard");
  });

  it("uses the root alone for a file sitting at the root", () => {
    expect(selfContainer({ file: { ...FILE, relPath: "README.md" } })).toBe("state");
  });
});

describe("selfSourceId", () => {
  it("names the path, the heading ordinal, the slice and the heading slug", () => {
    const id = selfSourceId({
      ordinal: 2,
      part: 1,
      relPath: "daily/monday.md",
      rootName: "state",
      slug: "owned-paths",
    });

    expect(id).toBe("state/daily/monday.md#2.1:owned-paths");
  });
});

describe("projectSelfFile", () => {
  it("emits one record per section, in file order", () => {
    const records = projectSelfFile({ author: "me", dated: DATED });

    expect(records.length).toBe(2);
    expect(records[0]!.title).toBe("Owned paths");
    expect(records[0]!.text).toBe("the idea, restated");
    expect(records[1]!.title).toBe("Risk classes");
  });

  it("emits the one atom, with every required field the corpus contract demands", () => {
    const record = projectSelfFile({ author: "me", dated: DATED })[0]!;

    expect(record.source).toBe("self");
    expect(record.kind).toBe("document");
    expect(record.container).toBe("state/junkyard");
    expect(record.author).toBe("me");
    expect(record.url).toBe("/dev/state/junkyard/an-old-idea.md");
    expect(record.tsIso).toBe("2026-07-19T10:00:00+10:00");
    expect(record.sourceId).toBe("state/junkyard/an-old-idea.md#0.0:owned-paths");
  });

  it("extracts cross-references, so the graph gets the same edges it gets from every other source", () => {
    const records = projectSelfFile({ author: "me", dated: DATED });

    expect(records[1]!.refs).toEqual(["TEAM-123"]);
  });

  it("records WHICH evidence dated it, plus the finer directory the container omits", () => {
    const record = projectSelfFile({ author: "me", dated: DATED })[0]!;

    expect(record.attrs).toEqual({
      dir: "junkyard",
      ordinal: 0,
      part: 0,
      parts: 1,
      root: "state",
      timeSource: "git",
    });
  });

  it("marks an undated file's records as mtime-derived, never as measured", () => {
    const record = projectSelfFile({
      author: "me",
      dated: { file: FILE, timeSource: "mtime", tsIso: FILE.mtimeIso },
    })[0]!;

    expect(record.attrs?.["timeSource"]).toBe("mtime");
    expect(record.tsIso).toBe("2026-08-05T00:00:00.000Z");
  });

  it("omits the title for an untitled pre-amble section rather than writing an empty one", () => {
    const record = projectSelfFile({
      author: "me",
      dated: { ...DATED, file: { ...FILE, text: "loose prose, no heading" } },
    })[0]!;

    expect(record.title).toBeUndefined();
    expect(record.text).toBe("loose prose, no heading");
  });

  it("yields nothing for an empty file", () => {
    expect(projectSelfFile({ author: "me", dated: { ...DATED, file: { ...FILE, text: "  \n\n" } } })).toEqual([]);
  });
});

describe("every self record is private — the one thing that must not be got wrong", () => {
  it("stamps visibility private on the projected record", () => {
    const records = projectSelfFile({ author: "me", dated: DATED });

    expect(records.map((record) => record.visibility)).toEqual(["private", "private"]);
  });

  it("reads back private after a real bronze write-then-read round trip", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-private-"));
    fixtureDirs.push(home);
    const records = projectSelfFile({ author: "me", dated: DATED });

    const written = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records,
      window: { since: "1970-01-01", until: "2026-08-06" },
    });
    const read = readCorpusDir({ dir: bronzeDir({ home }), home, protection: NO_ENTRIES });

    expect(written.isOk()).toBe(true);
    expect(read.isOk()).toBe(true);
    expect(read.isOk() ? read.value.records.length : 0).toBe(2);
    expect(read.isOk() ? read.value.records.map((record) => visibilityForRecord({ record })) : []).toEqual([
      "private",
      "private",
    ]);
  });

  it("reads a self record with NO visibility field as private, because the source has no public lane", () => {
    const record = projectSelfFile({ author: "me", dated: DATED })[0]!;
    const { visibility: _dropped, ...unstamped } = record;

    expect(Object.keys(unstamped).includes("visibility")).toBe(false);
    expect(visibilityForRecord({ record: unstamped })).toBe("private");
  });
});

describe("a re-scan writes nothing — the idempotence a cursorless full re-scan depends on", () => {
  it("projects byte-identical records the second time", () => {
    expect(projectSelfRecords({ author: "me", files: [DATED] })).toEqual(
      projectSelfRecords({ author: "me", files: [DATED] }),
    );
  });

  it("writes zero new records on the second write of the same projection", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-self-idempotent-"));
    fixtureDirs.push(home);
    const window = { since: "1970-01-01", until: "2026-08-06" };
    const records = projectSelfRecords({ author: "me", files: [DATED] });

    const first = writeCorpusRecords({ home, protection: NO_ENTRIES, records, window });
    const second = writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: projectSelfRecords({ author: "me", files: [DATED] }),
      window,
    });

    expect(first.isOk() ? first.value.written : -1).toBe(2);
    expect(second.isOk() ? second.value.written : -1).toBe(0);
    expect(second.isOk() ? second.value.deduped : -1).toBe(2);
  });
});

describe("projectSelfRecords", () => {
  it("projects every file, in file order then section order", () => {
    const second: DatedSelfFile = {
      file: { ...FILE, absPath: "/dev/state/daily/b.md", relPath: "daily/b.md", text: "## Later\nthought" },
      timeSource: "filename",
      tsIso: "2026-07-20T00:00:00.000Z",
    };

    const records = projectSelfRecords({ author: "me", files: [DATED, second] });

    expect(records.map((record) => record.sourceId)).toEqual([
      "state/junkyard/an-old-idea.md#0.0:owned-paths",
      "state/junkyard/an-old-idea.md#1.0:risk-classes",
      "state/daily/b.md#0.0:later",
    ]);
  });

  it("projects nothing for no files", () => {
    expect(projectSelfRecords({ author: "me", files: [] })).toEqual([]);
  });
});
