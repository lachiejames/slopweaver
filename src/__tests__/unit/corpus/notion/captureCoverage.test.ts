import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  notionCrawlCoversWindow,
  readNotionCaptureCoverage,
  recordNotionCaptureCoverage,
} from "../../../../corpus/notion/captureCoverage.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const freshHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-coverage-"));
  fixtureDirs.push(dir);
  return dir;
};
const sidecar = ({ home }: { home: string }): string =>
  join(home, "corpus", "bronze", "notion", ".capture-coverage.json");

describe("readNotionCaptureCoverage", () => {
  it("is undefined before any qualifying crawl, so the index trusts no unmarked capture", () => {
    expect(readNotionCaptureCoverage({ home: freshHome() })).toBe(undefined);
  });

  it("reads back exactly what a completed crawl recorded", () => {
    const home = freshHome();
    recordNotionCaptureCoverage({ home, sinceIso: "2026-01-01" });
    expect(readNotionCaptureCoverage({ home })).toBe("2026-01-01");
  });

  it("is undefined for a sidecar written by a future version, rather than reinterpreting it", () => {
    const home = freshHome();
    mkdirSync(join(home, "corpus", "bronze", "notion"), { recursive: true });
    writeFileSync(sidecar({ home }), JSON.stringify({ coveredSinceIso: "2026-01-01", version: 2 }));
    expect(readNotionCaptureCoverage({ home })).toBe(undefined);
  });

  it("is undefined for a corrupt sidecar", () => {
    const home = freshHome();
    mkdirSync(join(home, "corpus", "bronze", "notion"), { recursive: true });
    writeFileSync(sidecar({ home }), "{ not json");
    expect(readNotionCaptureCoverage({ home })).toBe(undefined);
  });
});

describe("recordNotionCaptureCoverage keeps the OLDEST since ever completed", () => {
  it("widens when a later crawl reached further back", () => {
    const home = freshHome();
    recordNotionCaptureCoverage({ home, sinceIso: "2026-05-01" });
    recordNotionCaptureCoverage({ home, sinceIso: "2024-01-01" });
    expect(readNotionCaptureCoverage({ home })).toBe("2024-01-01");
  });

  it("does not NARROW when a later crawl covered less — those pages were already marked", () => {
    const home = freshHome();
    recordNotionCaptureCoverage({ home, sinceIso: "2024-01-01" });
    recordNotionCaptureCoverage({ home, sinceIso: "2026-08-20" });
    expect(readNotionCaptureCoverage({ home })).toBe("2024-01-01");
  });
});

describe("notionCrawlCoversWindow", () => {
  it("is true for a complete, unbounded, gap-free, fully-enumerated crawl", () => {
    expect(notionCrawlCoversWindow({ bounded: false, enumerationIncomplete: false, gaps: [] })).toBe(true);
  });

  it("is false for a capped run, which stopped short of its own window", () => {
    expect(notionCrawlCoversWindow({ bounded: true, enumerationIncomplete: false, gaps: [] })).toBe(false);
  });

  it("is false when a transient gap means the window was not fully read", () => {
    expect(
      notionCrawlCoversWindow({
        bounded: false,
        enumerationIncomplete: false,
        gaps: ["notion: 3 node(s) rate-limited"],
      }),
    ).toBe(false);
  });

  it("is false when a data source or search page was never enumerated, even with no gaps", () => {
    expect(notionCrawlCoversWindow({ bounded: false, enumerationIncomplete: true, gaps: [] })).toBe(false);
  });
});
