/**
 * The marks a failed landing leaves: written with no lock, cleared only as far as a sweep saw them.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { holdCardLandingLock } from "../../../talk/cardLandingStore.js";
import { clearSweepOwed, markSweepOwed, sweepOwedDir, sweepOwedMarks } from "../../../talk/sweepOwed.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-sweep-owed-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("the sweep a failed landing owes", () => {
  it("owes nothing before any landing failed", () => {
    expect(unwrap(sweepOwedMarks({ home }))).toEqual([]);
  });

  // The failure being recorded was the ledger's lock held past its wait, and the mark waited on it too.
  it("leaves a mark while a live process holds the ledger's lock", () => {
    const release = unwrap(holdCardLandingLock({ home }));
    try {
      expect(markSweepOwed({ home }).isOk()).toBe(true);
    } finally {
      release();
    }
    expect(unwrap(sweepOwedMarks({ home }))).toHaveLength(1);
  });

  it("clears the marks a sweep read, and keeps one written while it swept", () => {
    unwrap(markSweepOwed({ home }));
    const read = unwrap(sweepOwedMarks({ home }));
    unwrap(markSweepOwed({ home }));
    unwrap(clearSweepOwed({ home, marks: read }));
    const left = unwrap(sweepOwedMarks({ home }));
    expect([left.length, left.includes(read[0]!)]).toEqual([1, false]);
  });

  // A dangling link refused every mark, and the reader called it no marks, so no batch swept again.
  it("reads a dangling link where the marks live as unreadable, never as none owed", () => {
    const dir = sweepOwedDir({ home });
    mkdirSync(join(dir, ".."), { recursive: true });
    symlinkSync(join(home, "nowhere"), dir);
    const failures = [unwrapErr(markSweepOwed({ home })), unwrapErr(sweepOwedMarks({ home }))];
    expect(failures.map((failure) => failure.split(",")[0])).toEqual([
      "ENOENT: no such file or directory",
      "ENOENT: no such file or directory",
    ]);
    expect(failures.map((failure) => failure.split(" ").at(-2))).toEqual(["mkdir", "scandir"]);
  });
});
