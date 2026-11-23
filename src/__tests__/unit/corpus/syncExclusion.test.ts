/**
 * The sync-side author denylist — what it excludes, what it refuses, and what it must never touch.
 *
 * The `excludeFromSync` cases are ordinary. The one that matters most is the LAST describe block, which is
 * not about behaviour at all: it asserts that nothing under `src/live/` imports this module. That is the
 * owner's own refinement to the ruling — a bot tagged into a thread must see every message every human in
 * that thread sees — and a convention nobody can grep is a convention that lasts until the next session.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptySyncExclusion,
  excludeFromSync,
  isSyncExcluded,
  loadSyncExclusion,
  type SyncExclusion,
} from "../../../corpus/syncExclusion.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { repoRootOf, workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { unwrap } from "../../../lib/result.js";

/** One record, with only the fields a case cares about spelled out. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "slack/C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "C1:1.0",
    text: "hello",
    tsIso: "2026-09-01T00:00:00.000Z",
    url: "https://example.invalid/1",
    ...over,
  };
}

/** A denylist holding exactly these ids. */
function denying({ ids }: { ids: readonly string[] }): SyncExclusion {
  return { ids: new Set(ids), path: "/fixture/sync-author-denylist.txt", scoped: [] };
}

describe("emptySyncExclusion", () => {
  it("excludes nothing, which is what a fresh home must do", () => {
    expect(isSyncExcluded({ exclusion: emptySyncExclusion(), record: record({ author: "UBOT" }) })).toBe(false);
  });
});

describe("isSyncExcluded", () => {
  it("denies a record whose author is listed", () => {
    expect(isSyncExcluded({ exclusion: denying({ ids: ["ubot"] }), record: record({ author: "UBOT" }) })).toBe(true);
  });

  it("admits a record whose author is not listed", () => {
    expect(isSyncExcluded({ exclusion: denying({ ids: ["ubot"] }), record: record({ author: "UHUMAN" }) })).toBe(false);
  });

  it("admits a record with no author at all", () => {
    expect(isSyncExcluded({ exclusion: denying({ ids: ["ubot"] }), record: record() })).toBe(false);
  });

  it("matches case-insensitively, because an id is copied by hand out of a Slack URL", () => {
    expect(isSyncExcluded({ exclusion: denying({ ids: ["ubot"] }), record: record({ author: "uBoT" }) })).toBe(true);
  });

  it("denies on the raw app id, which survives a reinstall that remints the bot", () => {
    const denied = record({ author: "USOMEONE", raw: { app_id: "AAPP" } });
    expect(isSyncExcluded({ exclusion: denying({ ids: ["aapp"] }), record: denied })).toBe(true);
  });

  it("denies on the raw bot id", () => {
    const denied = record({ author: "USOMEONE", raw: { bot_id: "BBOT" } });
    expect(isSyncExcluded({ exclusion: denying({ ids: ["bbot"] }), record: denied })).toBe(true);
  });

  it("ignores a raw key that is not an identity key", () => {
    const kept = record({ author: "USOMEONE", raw: { team_id: "AAPP" } });
    expect(isSyncExcluded({ exclusion: denying({ ids: ["aapp"] }), record: kept })).toBe(false);
  });

  it("falls back to the author when a projection has dropped raw", () => {
    // The read side works in projections that discard `raw`, so an install that listed ONLY an app id
    // excludes new records and not historical ones. Pinned because it decides what an operator must list.
    expect(isSyncExcluded({ exclusion: denying({ ids: ["aapp"] }), record: record({ author: "UBOT" }) })).toBe(false);
  });
});

describe("excludeFromSync", () => {
  it("drops the denied records and counts them", () => {
    const outcome = excludeFromSync({
      exclusion: denying({ ids: ["ubot"] }),
      records: [record({ author: "UBOT" }), record({ author: "UHUMAN" }), record({ author: "UBOT" })],
    });
    expect(outcome.kept.length).toBe(1);
    expect(outcome.kept[0]!.author).toBe("UHUMAN");
    expect(outcome.excluded).toBe(2);
  });

  it("returns the batch untouched when the denylist is empty", () => {
    const records = [record({ author: "UBOT" })];
    const outcome = excludeFromSync({ exclusion: emptySyncExclusion(), records });
    expect(outcome.kept).toBe(records);
    expect(outcome.excluded).toBe(0);
  });

  it("keeps an empty batch empty", () => {
    const outcome = excludeFromSync({ exclusion: denying({ ids: ["ubot"] }), records: [] });
    expect(outcome.kept).toStrictEqual([]);
    expect(outcome.excluded).toBe(0);
  });

  it("drops every record when they are all denied", () => {
    const outcome = excludeFromSync({
      exclusion: denying({ ids: ["ubot"] }),
      records: [record({ author: "UBOT" }), record({ author: "UBOT" })],
    });
    expect(outcome.kept).toStrictEqual([]);
    expect(outcome.excluded).toBe(2);
  });
});

describe("loadSyncExclusion", () => {
  it("reads one id per line, ignoring comments and blanks", () => {
    const loaded = unwrap(
      loadSyncExclusion({
        home: "/fixture",
        readText: () => "# the datadog app\nAAPP\n\n  UBOT  \n",
      }),
    );
    expect([...loaded.ids].toSorted()).toStrictEqual(["aapp", "ubot"]);
  });

  it("excludes nothing when the file does not exist", () => {
    const loaded = unwrap(
      loadSyncExclusion({
        home: "/fixture",
        readText: () => {
          throw Object.assign(new Error("nope"), { code: "ENOENT" });
        },
      }),
    );
    expect(loaded.ids.size).toBe(0);
  });

  it("names the file it read so a report can point at it", () => {
    const loaded = unwrap(loadSyncExclusion({ home: "/fixture", readText: () => "UBOT\n" }));
    expect(loaded.path).toBe("/fixture/sync-author-denylist.txt");
  });

  it("REFUSES an existing file it cannot read, rather than excluding nothing", () => {
    const loaded = loadSyncExclusion({
      home: "/fixture",
      readText: () => {
        throw Object.assign(new Error("nope"), { code: "EACCES" });
      },
    });
    expect(loaded.isErr()).toBe(true);
    expect(loaded._unsafeUnwrapErr()[0]).toContain("EACCES");
  });
});

describe("the live read path never sees this module", () => {
  it("is imported by nothing under src/live/", () => {
    // Live reads keep Datadog; only the sync excludes it. A live thread read that filtered would hand a tagged bot a different conversation from the
    // one every human in it is looking at. Asserted structurally because a rule this quiet does not survive
    // review — see the module header.
    const root = repoRootOf({ importMetaUrl: import.meta.url });
    const live = workingTreeFilesOf({ pathspec: "src/live", root }).filter((path) => path.endsWith(".ts"));
    expect(live.length).toBeGreaterThan(0);
    const importers = live.filter((path) => readFileSync(join(root, path), "utf8").includes("syncExclusion"));
    expect(importers).toStrictEqual([]);
  });
});
