import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import { citeToken } from "../../../retrieval/citeToken.js";
import { findRecordKeyCollisions, recordKey, recordKeyCollisionMessage } from "../../../retrieval/recordKey.js";

const base: CorpusRecord = {
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#42",
  text: "x",
  tsIso: "2026-01-01T00:00:00.000Z",
  url: "https://github.com/o/r/pull/42",
};

const rec = (over: Partial<CorpusRecord>): CorpusRecord => ({ ...base, ...over });

describe("recordKey", () => {
  it("is exactly citeToken — the same string retrieval indexes and the model is told to cite", () => {
    const record = rec({ container: "a/one" });
    expect(recordKey({ record })).toBe(citeToken({ record }));
  });
});

describe("findRecordKeyCollisions", () => {
  it("reports nothing for a set with no genuine collision", () => {
    const records = [rec({ container: "a/one" }), rec({ container: "b/two" })];
    expect(findRecordKeyCollisions({ records })).toEqual([]);
  });

  it("does NOT flag the same identity appearing more than once — that is latestRecords's decision, already made", () => {
    const records = [rec({ text: "first pass" }), rec({ text: "second pass" })];
    expect(findRecordKeyCollisions({ records })).toEqual([]);
  });

  // The doc's own example: citeToken drops `source` when the id already carries its container's tail, so
  // two records from DIFFERENT sources can render the same token.
  it("catches two distinct identities colliding on one key", () => {
    const linear = rec({ container: "linear/TEAM", kind: "issue", source: "linear", sourceId: "TEAM-9" });
    const self = rec({ container: "notes/TEAM", source: "self", sourceId: "TEAM-9" });
    const collisions = findRecordKeyCollisions({ records: [linear, self] });
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.key).toBe("TEAM-9");
    expect(collisions[0]!.refs).toEqual([
      { container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" },
      { container: "notes/TEAM", source: "self", sourceId: "TEAM-9" },
    ]);
  });

  it("reports every colliding key at once, not just the first", () => {
    const records = [
      rec({ container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" }),
      rec({ container: "notes/TEAM", source: "self", sourceId: "TEAM-9" }),
      rec({ container: "linear/OPS", source: "linear", sourceId: "OPS-1" }),
      rec({ container: "notes/OPS", source: "self", sourceId: "OPS-1" }),
    ];
    const collisions = findRecordKeyCollisions({ records });
    expect(collisions.map((c) => c.key).toSorted()).toEqual(["OPS-1", "TEAM-9"]);
  });
});

describe("recordKeyCollisionMessage", () => {
  it("names the key and every distinct record it merges", () => {
    const text = recordKeyCollisionMessage({
      collision: {
        key: "TEAM-9",
        refs: [
          { container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" },
          { container: "notes/TEAM", source: "self", sourceId: "TEAM-9" },
        ],
      },
    });
    expect(text).toContain('"TEAM-9"');
    expect(text).toContain("linear/linear/TEAM#TEAM-9");
    expect(text).toContain("self/notes/TEAM#TEAM-9");
  });
});
