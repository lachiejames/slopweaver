/**
 * The run hooks rank journals BEFORE the cap — held by this session, then mentioning it unverified, then the rest,
 * each newest first, then slug — and say how many they left out, never calling a skipped journal open or closed.
 */
import { describe, expect, it } from "vitest";

import {
  type JournalRankEntry,
  type JournalTier,
  journalSkipLines,
  rankJournals,
} from "../../../handover/hookJournalRank.js";

/** An entry, defaulting to one with no tie to the session. */
const entry = ({
  slug,
  mtimeMs,
  tier = "other",
}: {
  slug: string;
  mtimeMs: number;
  tier?: JournalTier;
}): JournalRankEntry => ({ mtimeMs, slug, tier });

describe("rankJournals", () => {
  it("puts a run this session holds ahead of newer ones, and an unverified mention between them", () => {
    const ranked = rankJournals({
      cap: 24,
      entries: [
        entry({ mtimeMs: 300, slug: "a-newest" }),
        entry({ mtimeMs: 200, slug: "m-mentioned", tier: "mentioned" }),
        entry({ mtimeMs: 100, slug: "z-held", tier: "held" }),
      ],
    });

    expect(ranked).toEqual({ considered: ["z-held", "m-mentioned", "a-newest"], skippedBeyondCap: 0 });
  });

  it("orders each tier newest first, and breaks an mtime tie by slug", () => {
    const ranked = rankJournals({
      cap: 24,
      entries: [
        entry({ mtimeMs: 100, slug: "old" }),
        entry({ mtimeMs: 50, slug: "held-old", tier: "held" }),
        entry({ mtimeMs: 500, slug: "tie-b" }),
        entry({ mtimeMs: 90, slug: "held-new", tier: "held" }),
        entry({ mtimeMs: 500, slug: "tie-a" }),
      ],
    });

    expect(ranked.considered).toEqual(["held-new", "held-old", "tie-a", "tie-b", "old"]);
  });

  it("keeps the cap and counts the rest — 30 journals at a cap of 24 skip exactly 6, the oldest", () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry({ mtimeMs: index, slug: `run-${String(index)}` }));

    const ranked = rankJournals({ cap: 24, entries });

    expect(ranked.considered.length).toBe(24);
    expect(ranked.skippedBeyondCap).toBe(6);
    expect(ranked.considered[0]).toBe("run-29");
    expect(ranked.considered.includes("run-5")).toBe(false);
    expect(ranked.considered.includes("run-6")).toBe(true);
  });

  it("skips nothing from an empty directory", () => {
    expect(rankJournals({ cap: 24, entries: [] })).toEqual({ considered: [], skippedBeyondCap: 0 });
  });
});

describe("journalSkipLines", () => {
  it("says nothing when every journal was examined", () => {
    expect(journalSkipLines({ summary: { cap: 24, skippedBeyondCap: 0, skippedUnavailable: 0 } })).toEqual([]);
  });

  it("names the cap and the count beyond it, and keeps unavailable journals a separate line", () => {
    const lines = journalSkipLines({ summary: { cap: 24, skippedBeyondCap: 6, skippedUnavailable: 2 } });

    expect(lines).toEqual([
      "ℹ 6 run journal(s) ranked below the 24 examined (this session's own first, then most recently written) were NOT checked by this hook; `slopweaver handover list` reads them all.",
      "ℹ 2 further run journal(s) were oversized or unreadable and were NOT checked by this hook.",
    ]);
  });

  it("states unavailable journals alone when none ranked below the cap", () => {
    expect(journalSkipLines({ summary: { cap: 24, skippedBeyondCap: 0, skippedUnavailable: 1 } })).toEqual([
      "ℹ 1 further run journal(s) were oversized or unreadable and were NOT checked by this hook.",
    ]);
  });
});
