/**
 * `calendar prep-due`'s claimed-slug read against a real temp home: a row claims a meeting by its declared slug as
 * well as its filename, and a doc that will not read fails the read. `testing.md` allows the filesystem here: each
 * case is a round trip in a `mkdtempSync` directory passed as an explicit home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readClaimedSlugs } from "../../../../../cli/commands/calendar/prepDueLedgers.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SLUG = "meeting-brief-a45i_20261008t230000z";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A temp home with a board, its archive and a runs directory. */
function home(): { home: string; handovers: string; archive: string; runs: string } {
  const dir = mkdtempSync(join(tmpdir(), "sw-prep-"));
  dirs.push(dir);
  const handovers = join(dir, "handovers");
  const archive = join(handovers, "archive");
  const runs = join(dir, "runs");
  mkdirSync(archive, { recursive: true });
  mkdirSync(runs, { recursive: true });
  return { archive, handovers, home: dir, runs };
}

/** A row doc declaring `slug`, written under `file`. */
function row({ dir, slug, file }: { dir: string; slug: string; file: string }): void {
  writeFileSync(
    join(dir, file),
    ["---", `slug: ${slug}`, "kind: ask", "summary: a row", "status: ready", "---", "", "# a row", ""].join("\n"),
    "utf8",
  );
}

describe("readClaimedSlugs", () => {
  // A counterexample: the archived row is filed as `legacy.md` but declares the meeting's slug.
  it("finds an archived row by its declared slug when its filename is another", () => {
    const at = home();
    row({ dir: at.archive, file: "legacy.md", slug: SLUG });
    const claimed = unwrap(readClaimedSlugs({ home: at.home }));
    expect(claimed.has(SLUG)).toBe(true);
    expect(claimed.has("legacy")).toBe(true);
  });

  it("finds a live row by its declared slug, and a run journal by its filename", () => {
    const at = home();
    row({ dir: at.handovers, file: "renamed.md", slug: SLUG });
    writeFileSync(join(at.runs, "meeting-brief-b77k_20261008t233000z.jsonl"), "", "utf8");
    expect([...unwrap(readClaimedSlugs({ home: at.home }))].toSorted()).toEqual([
      SLUG,
      "meeting-brief-b77k_20261008t233000z",
      "renamed",
    ]);
  });

  it("reads an empty home as no claims", () => {
    expect([...unwrap(readClaimedSlugs({ home: home().home }))]).toEqual([]);
  });

  it("fails the read when a board doc will not read, rather than answering without it", () => {
    const at = home();
    mkdirSync(join(at.handovers, "trap.md"));
    expect(unwrapErr(readClaimedSlugs({ home: at.home }))).toContain("1 doc(s) in");
  });
});
