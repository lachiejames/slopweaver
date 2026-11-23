/**
 * The literal search, proven over real files in a temp directory.
 *
 * Every budget here is asserted by CROSSING it rather than by reading the constant back: a test that only
 * compared `TOTAL_EXCERPT_BYTES` to itself would pass against a search that ignored it. So the excerpt case
 * feeds in more matching lines than the budget can carry and asserts the count the constants predict, and
 * the binary-probe case puts its NUL byte one byte PAST the probe window and asserts the file was searched.
 */
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import {
  BINARY_PROBE_BYTES,
  type CodeHit,
  type CodeHitLine,
  EXCERPT_CHARS,
  PER_FILE_SCAN_BYTES,
  searchTrackedFiles,
  TOTAL_EXCERPT_BYTES,
  TOTAL_SCAN_BYTES,
} from "../../../talk/codeSearch.js";

/** The measurement `codeSearch.ts` sizes {@link TOTAL_SCAN_BYTES} against: tracked TEXT at the time of measuring. */
const MEASURED_TRACKED_TEXT_BYTES = 79_834_503;

let root: string;

/** Write one fixture file under the checkout root and hand back its repo-relative path. */
const put = ({ path, text }: { path: string; text: string }): string => {
  writeFileSync(join(root, path), text);
  return path;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "talk-search-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("searchTrackedFiles", () => {
  it("returns the matching lines of a matching file, 1-indexed and trimmed", () => {
    const path = put({ path: "a.ts", text: "const x = 1;\n    const needle = 2;\nconst y = 3;\n" });
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked: [path] }));
    const hit: CodeHit = found.hits[0]!;
    const line: CodeHitLine = hit.lines[0]!;
    expect(hit.path).toBe("a.ts");
    expect(hit.partiallyScanned).toBe(false);
    expect(hit.lines.length).toBe(1);
    expect(line.line).toBe(2);
    expect(line.excerpt).toBe("const needle = 2;");
    expect(found.filesScanned).toBe(1);
  });

  it("reports a file with no match by omitting it, while still counting it as scanned", () => {
    const tracked = [put({ path: "a.ts", text: "nothing here\n" })];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.hits).toEqual([]);
    expect(found.filesScanned).toBe(1);
    expect(found.binarySkipped).toBe(0);
  });

  it("compares the needle LITERALLY, so a regular expression finds only its own characters", () => {
    const tracked = [
      put({ path: "literal.ts", text: "this line has a.*b in it\n" }),
      put({ path: "pattern.ts", text: "axxxxb would match the pattern\n" }),
    ];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "a.*b", tracked }));
    expect(found.hits.map((hit) => hit.path)).toEqual(["literal.ts"]);
  });

  it("skips a binary file as binary rather than as a file with no match", () => {
    const tracked = [
      put({ path: "image.bin", text: "PNG\u0000needle\u0000" }),
      put({ path: "a.ts", text: "const needle = 1;\n" }),
    ];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.binarySkipped).toBe(1);
    expect(found.filesScanned).toBe(1);
    expect(found.hits.map((hit) => hit.path)).toEqual(["a.ts"]);
  });

  it("searches a file whose first NUL sits one byte past the probe window", () => {
    const tracked = [put({ path: "late.ts", text: `${"a".repeat(BINARY_PROBE_BYTES)}\u0000needle\n` })];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.binarySkipped).toBe(0);
    expect(found.filesScanned).toBe(1);
    expect(found.hits.map((hit) => hit.path)).toEqual(["late.ts"]);
  });

  it("skips a tracked path that is no longer on disk instead of failing the whole search", () => {
    const tracked = [put({ path: "a.ts", text: "const needle = 1;\n" }), "deleted.ts"];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.filesScanned).toBe(1);
    expect(found.hits.map((hit) => hit.path)).toEqual(["a.ts"]);
  });

  it("skips a tracked file the open itself refuses, rather than failing the whole search", () => {
    // Mode 000 is the one state that leaves every name check satisfied and still fails at `open` — a
    // deleted path is refused a step earlier, by the listing check, so it never reaches this arm. The
    // witness is the needle: it really is IN the locked file, and the search really does not report it.
    const locked = put({ path: "locked.ts", text: "const needle = 1;\n" });
    expect(readFileSync(join(root, locked), "utf8")).toContain("needle");
    chmodSync(join(root, locked), 0o000);

    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked: [locked] }));
    chmodSync(join(root, locked), 0o600);
    expect(found.hits).toEqual([]);
    expect(found.filesScanned).toBe(0);
    expect(found.aliasSkipped).toBe(0);
    expect(found.unreadableSkipped).toBe(1);
  });

  it("reports the excerpt budget even when it runs out before a later file's first excerpt", () => {
    const line = `needle${"z".repeat(EXCERPT_CHARS)}`;
    const affordable = Math.floor(TOTAL_EXCERPT_BYTES / EXCERPT_CHARS);
    const tracked = [
      put({ path: "a-fills.ts", text: `${line}\n`.repeat(affordable) }),
      put({ path: "b-late.ts", text: `${line}\n` }),
    ];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.hits.map((hit) => hit.path)).toEqual(["a-fills.ts"]);
    expect(found.excerptBudgetExhausted).toBe(true);
    expect(found.unreadableSkipped).toBe(0);
  });

  it("stops at maxHits and says the limit is why", () => {
    const tracked = [
      put({ path: "a.ts", text: "needle\n" }),
      put({ path: "b.ts", text: "needle\n" }),
      put({ path: "c.ts", text: "needle\n" }),
    ];
    const found = unwrap(searchTrackedFiles({ maxHits: 2, root, text: "needle", tracked }));
    expect(found.hits.map((hit) => hit.path)).toEqual(["a.ts", "b.ts"]);
    expect(found.hitLimitReached).toBe(true);
    expect(found.filesScanned).toBe(2);
  });

  it("says the limit was NOT why when every tracked file fitted", () => {
    const tracked = [put({ path: "a.ts", text: "needle\n" })];
    const found = unwrap(searchTrackedFiles({ maxHits: 2, root, text: "needle", tracked }));
    expect(found.hitLimitReached).toBe(false);
    expect(found.scanBudgetExhausted).toBe(false);
    expect(found.excerptBudgetExhausted).toBe(false);
  });

  it("caps one excerpt at EXCERPT_CHARS rather than quoting a whole long line", () => {
    const tracked = [put({ path: "wide.ts", text: `needle${"z".repeat(EXCERPT_CHARS * 2)}\n` })];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.hits[0]!.lines[0]!.excerpt.length).toBe(EXCERPT_CHARS);
  });

  it("stops excerpting at the total output budget and reports that it bit", () => {
    const line = `needle${"z".repeat(EXCERPT_CHARS)}`;
    const affordable = Math.floor(TOTAL_EXCERPT_BYTES / EXCERPT_CHARS);
    const tracked = [put({ path: "many.ts", text: `${`${line}\n`.repeat(affordable + 10)}` })];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.excerptBudgetExhausted).toBe(true);
    expect(found.hits[0]!.lines.length).toBe(affordable);
  });

  it("reports a file bigger than the per-file scan cap as partially scanned, not as fully searched", () => {
    const tail = "needle in the tail";
    const tracked = [
      put({ path: "huge.ts", text: `needle at the head\n${"x".repeat(PER_FILE_SCAN_BYTES)}\n${tail}\n` }),
    ];
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked }));
    expect(found.hits[0]!.partiallyScanned).toBe(true);
    expect(found.hits[0]!.lines.map((hit) => hit.excerpt)).toEqual(["needle at the head"]);
  });

  it("finds nothing, and no budget bites, over an empty tracked set", () => {
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "needle", tracked: [] }));
    expect(found.hits).toEqual([]);
    expect(found.filesScanned).toBe(0);
    expect(found.binarySkipped).toBe(0);
    expect(found.hitLimitReached).toBe(false);
    expect(found.scanBudgetExhausted).toBe(false);
  });
});

describe("the budgets", () => {
  it("sizes the whole-search scan budget above the tree it was measured against", () => {
    expect(TOTAL_SCAN_BYTES).toBeGreaterThan(MEASURED_TRACKED_TEXT_BYTES);
  });

  it("lets any one file be scanned whole within the whole-search budget", () => {
    expect(TOTAL_SCAN_BYTES).toBeGreaterThan(PER_FILE_SCAN_BYTES);
  });

  it("probes for binary inside what one file is allowed to be scanned", () => {
    expect(BINARY_PROBE_BYTES).toBeLessThan(PER_FILE_SCAN_BYTES);
  });

  it("can afford more than one excerpt", () => {
    expect(TOTAL_EXCERPT_BYTES).toBeGreaterThan(EXCERPT_CHARS);
  });
});

/*
 * The alias arm. A review reproduced a tracked symlink whose target sat OUTSIDE
 * the checkout coming back from `talk code find` as an ordinary hit, quoting the outside file's line, while
 * `talk code read` refused the identical name. Each case below is falsifiable the way that finding was: the
 * outside file CARRIES the needle, so an assertion that the search found nothing reddens the moment the
 * refusal is dropped, rather than passing over an input that never held anything to leak.
 */
describe("aliases a tracked name can hide", () => {
  it("does not follow a tracked symlink whose target is outside the checkout", () => {
    const outside = mkdtempSync(join(tmpdir(), "talk-outside-"));
    try {
      const target = join(outside, "secret.txt");
      writeFileSync(target, "OUTSIDE_MARKER=private-value\n");
      symlinkSync(target, join(root, "alias.txt"));
      const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "OUTSIDE_MARKER", tracked: ["alias.txt"] }));
      expect(found.hits).toEqual([]);
      expect(found.aliasSkipped).toBe(1);
      expect(found.filesScanned).toBe(0);
      expect(readFileSync(target, "utf8")).toContain("OUTSIDE_MARKER");
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("does not follow a tracked symlink whose target is an untracked file inside the checkout", () => {
    writeFileSync(join(root, "untracked.txt"), "INSIDE_MARKER=1\n");
    symlinkSync(join(root, "untracked.txt"), join(root, "alias.txt"));
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "INSIDE_MARKER", tracked: ["alias.txt"] }));
    expect(found.hits).toEqual([]);
    expect(found.aliasSkipped).toBe(1);
    expect(found.filesScanned).toBe(0);
  });

  it("does not read through a tracked name hard-linked to a file outside the checkout", () => {
    const outside = mkdtempSync(join(tmpdir(), "talk-outside-"));
    try {
      const target = join(outside, "secret.txt");
      writeFileSync(target, "HARDLINK_MARKER=private-value\n");
      linkSync(target, join(root, "alias.txt"));
      const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "HARDLINK_MARKER", tracked: ["alias.txt"] }));
      expect(found.hits).toEqual([]);
      expect(found.aliasSkipped).toBe(1);
      expect(readFileSync(target, "utf8")).toContain("HARDLINK_MARKER");
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("does not read a tracked name reached through a symlinked parent directory", () => {
    const outside = mkdtempSync(join(tmpdir(), "talk-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "ANCESTOR_MARKER=private-value\n");
      symlinkSync(outside, join(root, "vendor"));
      const found = unwrap(
        searchTrackedFiles({ maxHits: 10, root, text: "ANCESTOR_MARKER", tracked: ["vendor/secret.txt"] }),
      );
      expect(found.hits).toEqual([]);
      expect(found.aliasSkipped).toBe(1);
      expect(readFileSync(join(outside, "secret.txt"), "utf8")).toContain("ANCESTOR_MARKER");
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("reads an ordinary tracked file beside an alias, and counts the two apart", () => {
    const outside = mkdtempSync(join(tmpdir(), "talk-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "SHARED_MARKER=outside\n");
      symlinkSync(join(outside, "secret.txt"), join(root, "alias.txt"));
      const kept = put({ path: "kept.ts", text: "const SHARED_MARKER = 1;\n" });
      const found = unwrap(
        searchTrackedFiles({ maxHits: 10, root, text: "SHARED_MARKER", tracked: ["alias.txt", kept] }),
      );
      expect(found.hits.map((hit) => hit.path)).toEqual(["kept.ts"]);
      expect(found.aliasSkipped).toBe(1);
      expect(found.filesScanned).toBe(1);
      expect(found.binarySkipped).toBe(0);
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it("refuses a tracked name that escapes the root by traversal", () => {
    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "anything", tracked: ["../escape.txt"] }));
    expect(found.hits).toEqual([]);
    expect(found.aliasSkipped).toBe(1);
    expect(found.filesScanned).toBe(0);
  });
});

/*
 * The search's own view of the same alias kinds the read edge refuses. The `not-a-regular-file` kind carried a phrase and no test at all on either reader, which is how a refusal
 * arm decays into one nobody notices has stopped firing.
 */
describe("a tracked name that is not a regular file", () => {
  it("skips a tracked name that is a directory on disk, and says so as an alias", () => {
    mkdirSync(join(root, "as-a-dir.ts"));
    writeFileSync(join(root, "as-a-dir.ts", "inside.txt"), "DIRECTORY_MARKER=1\n");
    expect(readFileSync(join(root, "as-a-dir.ts", "inside.txt"), "utf8")).toContain("DIRECTORY_MARKER");

    const found = unwrap(searchTrackedFiles({ maxHits: 10, root, text: "DIRECTORY_MARKER", tracked: ["as-a-dir.ts"] }));
    expect(found.hits).toEqual([]);
    expect(found.aliasSkipped).toBe(1);
    expect(found.filesScanned).toBe(0);
  });
});
