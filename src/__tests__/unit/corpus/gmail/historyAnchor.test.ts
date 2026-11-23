import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  anchorTakenAt,
  readGmailHistoryAnchor,
  writeGmailHistoryAnchor,
} from "../../../../corpus/gmail/historyAnchor.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home — a real round-trip through the file, never a mock of one. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "gmail-anchor-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Write raw bytes at the anchor path, for the degradation cases. */
function seed({ dir, contents }: { dir: string; contents: string }): void {
  const path = stateHomePaths({ home: dir }).corpus.gmailHistory;
  mkdirSync(join(dir, "corpus"), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

describe("readGmailHistoryAnchor", () => {
  it("is undefined when the mailbox has never been crawled", () => {
    expect(readGmailHistoryAnchor({ home: home() })).toBeUndefined();
  });

  it("degrades an unparseable file to absent rather than throwing", () => {
    const dir = home();
    seed({ contents: "{ not json", dir });
    expect(readGmailHistoryAnchor({ home: dir })).toBeUndefined();
  });

  it("degrades a file with no historyId to absent", () => {
    const dir = home();
    seed({ contents: JSON.stringify({ anchor: { fullCrawl: true }, version: 1 }), dir });
    expect(readGmailHistoryAnchor({ home: dir })).toBeUndefined();
  });

  it("reads back an anchor written with no recorded time as an empty time, never a stand-in date", () => {
    const dir = home();
    seed({ contents: JSON.stringify({ anchor: { fullCrawl: false, historyId: "42" }, version: 1 }), dir });
    const anchor = readGmailHistoryAnchor({ home: dir })!;
    expect(anchor.historyId).toBe("42");
    expect(anchor.anchoredAtIso).toBe("");
  });
});

describe("anchorTakenAt", () => {
  it("names the instant an anchor was taken", () => {
    const anchor = { anchoredAtIso: "2026-09-01T10:00:00.000Z", fullCrawl: true, historyId: "42" };
    expect(anchorTakenAt({ anchor })).toBe("2026-09-01T10:00:00.000Z");
  });

  it("says the time went unrecorded for an anchor read back with no time", () => {
    const dir = home();
    seed({ contents: JSON.stringify({ anchor: { fullCrawl: false, historyId: "42" }, version: 1 }), dir });
    expect(anchorTakenAt({ anchor: readGmailHistoryAnchor({ home: dir })! })).toBe("at an unrecorded time");
  });
});

describe("writeGmailHistoryAnchor", () => {
  it("round-trips an anchor", () => {
    const dir = home();
    unwrap(
      writeGmailHistoryAnchor({ fullCrawl: true, historyId: "9903", home: dir, nowIso: "2026-08-28T00:00:00.000Z" }),
    );
    const anchor = readGmailHistoryAnchor({ home: dir })!;
    expect(anchor.historyId).toBe("9903");
    expect(anchor.fullCrawl).toBe(true);
    expect(anchor.anchoredAtIso).toBe("2026-08-28T00:00:00.000Z");
  });

  it("REPLACES the historyId rather than merging it, because Google's sequence does not string-compare", () => {
    const dir = home();
    unwrap(
      writeGmailHistoryAnchor({ fullCrawl: false, historyId: "9903", home: dir, nowIso: "2026-08-28T00:00:00.000Z" }),
    );
    unwrap(
      writeGmailHistoryAnchor({ fullCrawl: false, historyId: "11542", home: dir, nowIso: "2026-08-28T01:00:00.000Z" }),
    );
    expect(readGmailHistoryAnchor({ home: dir })!.historyId).toBe("11542");
  });

  it("keeps the full-crawl marker sticky across a later narrow pass", () => {
    const dir = home();
    unwrap(writeGmailHistoryAnchor({ fullCrawl: true, historyId: "1", home: dir, nowIso: "2026-08-28T00:00:00.000Z" }));
    unwrap(
      writeGmailHistoryAnchor({ fullCrawl: false, historyId: "2", home: dir, nowIso: "2026-08-28T01:00:00.000Z" }),
    );
    expect(readGmailHistoryAnchor({ home: dir })!.fullCrawl).toBe(true);
  });

  it("reports a write it could not make instead of returning ok", () => {
    const result = writeGmailHistoryAnchor({
      fullCrawl: false,
      historyId: "1",
      home: "/dev/null/not-a-directory",
      nowIso: "2026-08-28T00:00:00.000Z",
    });
    expect(unwrapErr(result)).toEqual(["ENOTDIR: not a directory, mkdir '/dev/null/not-a-directory/corpus'"]);
  });
});
