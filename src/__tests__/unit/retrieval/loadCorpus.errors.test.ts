/**
 * `LoadCorpusErrors`: the loader's own typed failures. Each test is named for the code it builds and pins that
 * code as a literal; nested causes are built through their own domain factories, never by hand.
 */
import { describe, expect, it } from "vitest";

import { CorpusStoreErrors } from "../../../corpus/corpusStore.errors.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { LoadCorpusErrors } from "../../../retrieval/loadCorpus.errors.js";
import { findRecordKeyCollisions } from "../../../retrieval/recordKey.js";

const MIB = 1024 * 1024;

const base: CorpusRecord = {
  container: "o/r",
  kind: "issue",
  refs: [],
  source: "github",
  sourceId: "#42",
  text: "x",
  tsIso: "2026-01-01T00:00:00.000Z",
  url: "https://example.test/42",
};

const rec = (over: Partial<CorpusRecord>): CorpusRecord => ({ ...base, ...over });

describe("LoadCorpusErrors", () => {
  it("bronzeReadFailed builds LOAD_CORPUS_BRONZE_READ_FAILED passing the reader's message through unchanged", () => {
    const error = LoadCorpusErrors.bronzeReadFailed({ message: "EACCES: permission denied, scandir '/c/slack'" });

    expect(error.code).toBe("LOAD_CORPUS_BRONZE_READ_FAILED");
    expect(error).toEqual({
      code: "LOAD_CORPUS_BRONZE_READ_FAILED",
      message: "EACCES: permission denied, scandir '/c/slack'",
    });
  });

  it("exclusionUnreadable builds LOAD_CORPUS_EXCLUSION_UNREADABLE passing the denylist failure through unchanged", () => {
    const error = LoadCorpusErrors.exclusionUnreadable({ message: "could not read /h/sync-author-denylist.txt" });

    expect(error.code).toBe("LOAD_CORPUS_EXCLUSION_UNREADABLE");
    expect(error).toEqual({
      code: "LOAD_CORPUS_EXCLUSION_UNREADABLE",
      message: "could not read /h/sync-author-denylist.txt",
    });
  });

  it("empty builds LOAD_CORPUS_EMPTY carrying the dir and the same text the bronze reader's not-found uses", () => {
    const error = LoadCorpusErrors.empty({ dir: "/h/corpus" });

    expect(error.code).toBe("LOAD_CORPUS_EMPTY");
    expect(error).toEqual({
      code: "LOAD_CORPUS_EMPTY",
      dir: "/h/corpus",
      message: "no corpus found at /h/corpus — run `slopweaver refresh` first",
    });
    expect(error.message).toBe(CorpusStoreErrors.dirNotFound({ dir: "/h/corpus" }).message);
  });

  it("heapCeiling builds LOAD_CORPUS_HEAP_CEILING at stage 'records', forwarding the cause's numbers and message", () => {
    const cause = CorpusStoreErrors.heapCeiling({
      band: { ceiling: 3, floor: 1.5 },
      diskBytes: 1024 * MIB,
      dir: "/h/corpus",
      fileCount: 12,
      readBytes: 0,
      shortfall: {
        collected: true,
        fits: false,
        limitBytes: 200 * MIB,
        projectedBytes: 16 * MIB,
        shortfallBytes: 4 * MIB,
        suggestedLimitMib: 65_536,
        usedBytes: 100 * MIB,
      },
    });

    const error = LoadCorpusErrors.heapCeiling({ cause });

    expect(error.code).toBe("LOAD_CORPUS_HEAP_CEILING");
    expect(error).toEqual({
      code: "LOAD_CORPUS_HEAP_CEILING",
      limitBytes: 209_715_200,
      message: cause.message,
      projectedBytes: 16_777_216,
      stage: "records",
      suggestedLimitMib: 65_536,
      usedBytes: 104_857_600,
    });
  });

  it("recordKeyCollision builds LOAD_CORPUS_RECORD_KEY_COLLISION keeping every collision in order and joining them with '; '", () => {
    const collisions = findRecordKeyCollisions({
      records: [
        rec({ container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" }),
        rec({ container: "notes/TEAM", source: "self", sourceId: "TEAM-9" }),
        rec({ container: "linear/OPS", source: "linear", sourceId: "OPS-1" }),
        rec({ container: "notes/OPS", source: "self", sourceId: "OPS-1" }),
      ],
    });

    const error = LoadCorpusErrors.recordKeyCollision({ collisions });

    expect(error.code).toBe("LOAD_CORPUS_RECORD_KEY_COLLISION");
    expect(error).toEqual({
      code: "LOAD_CORPUS_RECORD_KEY_COLLISION",
      collisions: [
        {
          key: "TEAM-9",
          refs: [
            { container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" },
            { container: "notes/TEAM", source: "self", sourceId: "TEAM-9" },
          ],
        },
        {
          key: "OPS-1",
          refs: [
            { container: "linear/OPS", source: "linear", sourceId: "OPS-1" },
            { container: "notes/OPS", source: "self", sourceId: "OPS-1" },
          ],
        },
      ],
      message:
        'retrieval key "TEAM-9" is shared by 2 distinct records (linear/linear/TEAM#TEAM-9, self/notes/TEAM#TEAM-9) — ' +
        "refusing rather than silently merging their postings into one; " +
        'retrieval key "OPS-1" is shared by 2 distinct records (linear/linear/OPS#OPS-1, self/notes/OPS#OPS-1) — ' +
        "refusing rather than silently merging their postings into one",
    });
  });
});
