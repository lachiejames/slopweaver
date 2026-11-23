/**
 * Which held export is the newer snapshot: by its latest chat, then by when the owner came by it, never by when it was taken
 * in — and a tie on both listed in hash order, so two reads agree. Pure.
 */
import { describe, expect, it } from "vitest";

import { orderByChronology } from "../../../../corpus/chatgpt/exportChronology.js";
import type { StoredExport } from "../../../../corpus/chatgpt/exportStore.js";

/** A held export with the three dates the order reads, and its hash repeated from one letter. */
function stored({
  letter,
  latestActivityIso,
  acquiredAtIso,
  importedAtIso,
}: {
  letter: string;
  latestActivityIso: string | null;
  acquiredAtIso: string;
  importedAtIso: string;
}): StoredExport {
  return {
    acquiredAtIso,
    contentHash: letter.repeat(64),
    directory: `/x/${letter}`,
    files: [],
    importedAtIso,
    latestActivityIso,
  };
}

describe("orderByChronology", () => {
  it("puts the latest chat first, then the one the owner came by later, an undatable one last, whatever the import order", () => {
    const early = stored({
      acquiredAtIso: "2026-10-01T00:00:00.000Z",
      importedAtIso: "2026-10-16T00:00:00.000Z",
      latestActivityIso: "2026-09-23T00:00:00.000Z",
      letter: "a",
    });
    const later = stored({
      acquiredAtIso: "2026-10-10T00:00:00.000Z",
      importedAtIso: "2026-10-11T00:00:00.000Z",
      latestActivityIso: "2026-09-23T00:00:00.000Z",
      letter: "b",
    });
    const newest = stored({
      acquiredAtIso: "2026-09-25T00:00:00.000Z",
      importedAtIso: "2026-09-25T00:00:00.000Z",
      latestActivityIso: "2026-09-24T00:00:00.000Z",
      letter: "c",
    });
    const undated = stored({
      acquiredAtIso: "2026-10-17T00:00:00.000Z",
      importedAtIso: "2026-10-17T00:00:00.000Z",
      latestActivityIso: null,
      letter: "d",
    });
    const ordered = orderByChronology({ exports: [undated, early, newest, later] });
    expect(ordered.map((one) => one.directory)).toEqual(["/x/c", "/x/b", "/x/a", "/x/d"]);
  });

  it("orders two exports that tie on both their latest chat and when the owner came by them by hash, either way given", () => {
    const dates = {
      acquiredAtIso: "2026-10-10T00:00:00.000Z",
      importedAtIso: "2026-10-10T00:00:00.000Z",
      latestActivityIso: "2026-09-23T00:00:00.000Z",
    };
    const a = stored({ ...dates, letter: "a" });
    const b = stored({ ...dates, letter: "b" });
    expect(orderByChronology({ exports: [a, b] }).map((one) => one.directory)).toEqual(["/x/b", "/x/a"]);
    expect(orderByChronology({ exports: [b, a] }).map((one) => one.directory)).toEqual(["/x/b", "/x/a"]);
  });
});
