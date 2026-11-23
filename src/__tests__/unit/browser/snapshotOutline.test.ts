/**
 * The snapshot outline: a breadth-first, budgeted view of the client's accessibility snapshot, its collapse
 * markers, `--under` and `--find`. Every fixture is written the way `playwright-core`'s renderer writes a page —
 * two spaces a level, `- ` per node, `[ref=…]` ending the key.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ElementsErrors } from "../../../browser/elementsError.js";
import { findInSnapshot } from "../../../browser/snapshotFind.js";
import { estimateTokens, OUTLINE_BUDGET, outlineSnapshot } from "../../../browser/snapshotOutline.js";
import { readSnapshotYaml } from "../../../browser/snapshotOutlineRun.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PAGE = [
  "- banner [ref=e1]:",
  '  - link "Home" [ref=e2] [cursor=pointer]:',
  "    - /url: /",
  '  - navigation "Global" [ref=e3]:',
  '    - link "Pulls" [ref=e4]',
  '    - link "Issues" [ref=e5]',
  "- main [ref=e6]:",
  '  - heading "Fix the parser" [level=1] [ref=e7]',
  '  - button "Merge pull request" [ref=e8] [cursor=pointer]',
  "  - text: see [ref=e1] for details",
].join("\n");

const BIG = { maxBytes: 64 * 1024, maxLines: 1000 };

describe("outlineSnapshot", () => {
  it("prints a page that fits whole, with nothing collapsed or cut", () => {
    const view = unwrap(outlineSnapshot({ budget: BIG, under: undefined, yaml: PAGE }));
    expect(view.lines).toEqual(PAGE.split("\n"));
    expect(view.cut).toBe(false);
    expect(view.fullLines).toBe(10);
    expect(view.fullBytes).toBe(Buffer.byteLength(PAGE, "utf8"));
    expect(view.printedBytes).toBe(Buffer.byteLength(PAGE, "utf8"));
  });

  it("opens breadth-first and collapses what the budget does not reach to one line naming its ref", () => {
    // The two roots and their markers fit; opening either root does not.
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 120, maxLines: 100 }, under: undefined, yaml: PAGE }));
    expect(view.lines).toEqual([
      "- banner [ref=e1]:",
      "  … 5 more line(s) — --under e1",
      "- main [ref=e6]:",
      "  … 3 more line(s) — --under e6",
    ]);
    expect(view.cut).toBe(false);
  });

  it("opens a shallow node before any of its grandchildren, so the top of the page is seen first", () => {
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 260, maxLines: 100 }, under: undefined, yaml: PAGE }));
    expect(view.lines).toEqual([
      "- banner [ref=e1]:",
      '  - link "Home" [ref=e2] [cursor=pointer]:',
      "    - /url: /",
      '  - navigation "Global" [ref=e3]:',
      "    … 2 more line(s) — --under e3",
      "- main [ref=e6]:",
      "  … 3 more line(s) — --under e6",
    ]);
  });

  it("shows a shut part's one line in place of a marker that would cost more, and keeps the marker otherwise", () => {
    const long = `- link "Docs" [ref=e1]:\n  - /url: /${"a".repeat(80)}\n- link "Home" [ref=e2]:\n  - /url: /`;
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 140, maxLines: 100 }, under: undefined, yaml: long }));
    expect(view.lines).toEqual([
      '- link "Docs" [ref=e1]:',
      "  … 1 more line(s) — --under e1",
      '- link "Home" [ref=e2]:',
      "  - /url: /",
    ]);
  });

  it("opens one ref's subtree, rebased to the left margin", () => {
    const view = unwrap(outlineSnapshot({ budget: BIG, under: "e3", yaml: PAGE }));
    expect(view.lines).toEqual([
      '- navigation "Global" [ref=e3]:',
      '  - link "Pulls" [ref=e4]',
      '  - link "Issues" [ref=e5]',
    ]);
  });

  it("never opens a ref a page planted in its own text", () => {
    // `e1` appears twice, but only the banner's KEY carries it; the text line's copy is page content.
    const view = unwrap(outlineSnapshot({ budget: BIG, under: "e1", yaml: PAGE }));
    expect(view.lines[0]).toBe("- banner [ref=e1]:");
    expect(view.lines.length).toBe(6);
  });

  it("refuses a ref no element of the read carries", () => {
    const problem = unwrapErr(outlineSnapshot({ budget: BIG, under: "e99", yaml: PAGE }));
    expect(problem).toEqual(ElementsErrors.refAbsent({ ref: "e99" }));
    expect(problem.message).toContain("ref e99 is no element of this session's latest read");
  });

  it("refuses a ref two elements carry rather than guessing which", () => {
    const twice = '- button "A" [ref=e1]\n- button "B" [ref=e1]';
    const problem = unwrapErr(outlineSnapshot({ budget: BIG, under: "e1", yaml: twice }));
    expect(problem).toEqual(ElementsErrors.refAmbiguous({ count: 2, ref: "e1" }));
    expect(problem.message).toContain("names 2 elements");
  });

  it("cuts a top level the budget cannot hold, and says how much it left", () => {
    const wide = Array.from({ length: 50 }, (_, i) => `- listitem "row ${String(i)}" [ref=e${String(i)}]`).join("\n");
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 4096, maxLines: 5 }, under: undefined, yaml: wide }));
    expect(view.cut).toBe(true);
    expect(view.lines.length).toBe(5);
    expect(view.lines[4]).toBe("… excerpt cut: 46 more line(s) — open a ref above with --under, or search with --find");
  });

  it("opens a ref too wide for the budget and cuts it, rather than printing back the marker that named it", () => {
    // Counterexample: a group whose children overrun the budget stayed shut under --under, printing
    // the same `--under e1` marker again, so the advertised command could never make progress.
    const children = Array.from({ length: 300 }, (_, i) => `  - button "child ${String(i)}" [ref=c${String(i)}]`);
    const wide = ["- group [ref=e1]:", ...children].join("\n");
    const budget = { maxBytes: 4096, maxLines: 5 };
    const top = unwrap(outlineSnapshot({ budget, under: undefined, yaml: wide }));
    expect(top.lines).toEqual(["- group [ref=e1]:", "  … 300 more line(s) — --under e1"]);
    const opened = unwrap(outlineSnapshot({ budget, under: "e1", yaml: wide }));
    expect(opened.cut).toBe(true);
    expect(opened.lines).toEqual([
      "- group [ref=e1]:",
      '  - button "child 0" [ref=c0]',
      '  - button "child 1" [ref=c1]',
      '  - button "child 2" [ref=c2]',
      "… excerpt cut: 297 more line(s) — open a ref above with --under, or search with --find",
    ]);
  });

  it("shortens a child too big for the whole budget, so --under its parent still prints part of it", () => {
    // Second counterexample: a 7,010-byte text node left out whole took its parent with it, and
    // `--under e1` answered the closing line alone.
    const huge = `- group [ref=e1]:\n  - text: ${"x".repeat(7000)}`;
    const view = unwrap(outlineSnapshot({ budget: OUTLINE_BUDGET, under: "e1", yaml: huge }));
    expect(view.cut).toBe(true);
    expect(view.lines.length).toBe(2);
    expect(view.lines[0]).toBe("- group [ref=e1]:");
    expect(view.lines[1]!.startsWith("  - text: xxx")).toBe(true);
    expect(view.lines[1]!.endsWith(" … [5511 more byte(s) on this line]")).toBe(true);
    expect(Buffer.byteLength(view.lines[1]!, "utf8")).toBe(OUTLINE_BUDGET.maxBytes / 4);
  });

  it("never ends a cut between an element and its marker, so no element reads as having nothing under it", () => {
    // Counterexample: 61 closed groups render 122 lines against a 120-line ceiling, and a cut that
    // kept 119 would end on group 59's own line with its marker dropped.
    const groups = Array.from(
      { length: 61 },
      (_, i) =>
        `- group "row ${String(i)}" [ref=e${String(i)}]:\n  - button "a" [ref=a${String(i)}]\n  - button "b" [ref=b${String(i)}]`,
    ).join("\n");
    const view = unwrap(
      outlineSnapshot({ budget: { maxBytes: 64 * 1024, maxLines: 120 }, under: undefined, yaml: groups }),
    );
    expect(view.lines.length).toBe(119);
    expect(view.lines.slice(-3)).toEqual([
      '- group "row 58" [ref=e58]:',
      "  … 2 more line(s) — --under e58",
      "… excerpt cut: 4 more line(s) — open a ref above with --under, or search with --find",
    ]);
  });

  it("prices a root by the depth it renders at, so roots indented unevenly in the file never overrun the budget", () => {
    // Counterexample: a first root indented one level made every later root's children look cheaper
    // than they render, so the outline overran and the hard cut fell between `b`'s children.
    const children = Array.from({ length: 50 }, (_, i) => `  - c${String(i)} [ref=e${String(i + 4)}]`).join("\n");
    const uneven = `  - a [ref=e1]:\n    - x [ref=e2]\n- b [ref=e3]:\n${children}`;
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 829, maxLines: 1000 }, under: undefined, yaml: uneven }));
    expect(view.cut).toBe(false);
    expect(view.lines).toEqual([
      "- a [ref=e1]:",
      "  - x [ref=e2]",
      "- b [ref=e3]:",
      "  … 50 more line(s) — --under e3",
    ]);
  });

  it("prints nothing at all for a budget with no room for even its closing line", () => {
    // Counterexample: a zero-line budget used to get the closing line anyway.
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 1000, maxLines: 0 }, under: undefined, yaml: PAGE }));
    expect(view.lines).toEqual([]);
    expect(view.cut).toBe(true);
    expect(view.printedBytes).toBe(0);
  });

  it("never shortens the closing line: a byte budget it cannot fit whole prints nothing", () => {
    // Counterexample: a 10-byte budget used to print `… excerp`, losing the count it exists to state.
    const two = '- button "A" [ref=e1]\n- button "B" [ref=e2]';
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 10, maxLines: 10 }, under: undefined, yaml: two }));
    expect(view.lines).toEqual([]);
    expect(view.cut).toBe(true);
  });

  it("holds the printed bytes to the ceiling, multi-byte text included", () => {
    const wide = Array.from({ length: 40 }, (_, i) => `- text: 🚀 launch ${String(i)}`).join("\n");
    const view = unwrap(outlineSnapshot({ budget: { maxBytes: 200, maxLines: 1000 }, under: undefined, yaml: wide }));
    expect(view.cut).toBe(true);
    expect(view.printedBytes).toBeLessThanOrEqual(200);
    expect(view.printedBytes).toBe(Buffer.byteLength(view.lines.join("\n"), "utf8"));
  });

  it("keeps a line that is not a node, CRLF line ends and a closing newline, and drops only blank lines", () => {
    const odd = '- paragraph [ref=e1]:\r\n  - text: one\r\n  continued\r\n\r\n- button "Go" [ref=e2]\r\n';
    const view = unwrap(outlineSnapshot({ budget: BIG, under: undefined, yaml: odd }));
    expect(view.lines).toEqual(["- paragraph [ref=e1]:", "  - text: one", "  continued", '- button "Go" [ref=e2]']);
    expect(view.fullLines).toBe(4);
  });

  it("answers an empty snapshot with an empty outline", () => {
    const view = unwrap(outlineSnapshot({ budget: BIG, under: undefined, yaml: "" }));
    expect(view.lines).toEqual([]);
    expect(view.fullLines).toBe(0);
  });
});

describe("findInSnapshot", () => {
  it("prints each match under its ancestors, shared ancestors once, case-insensitively", () => {
    const view = unwrap(findInSnapshot({ budget: BIG, maxMatches: 20, text: "LINK", yaml: PAGE }));
    expect(view.lines).toEqual([
      "- banner [ref=e1]:",
      '  - link "Home" [ref=e2] [cursor=pointer]:',
      '  - navigation "Global" [ref=e3]:',
      '    - link "Pulls" [ref=e4]',
      '    - link "Issues" [ref=e5]',
    ]);
  });

  it("finds the one control a session is looking for without the rest of the page", () => {
    const view = unwrap(findInSnapshot({ budget: BIG, maxMatches: 20, text: "merge", yaml: PAGE }));
    expect(view.lines).toEqual(["- main [ref=e6]:", '  - button "Merge pull request" [ref=e8] [cursor=pointer]']);
  });

  it("says so when nothing matches", () => {
    const view = unwrap(findInSnapshot({ budget: BIG, maxMatches: 20, text: "Close", yaml: PAGE }));
    expect(view.lines).toEqual(['(no line of this read contains "Close")']);
  });

  it("echoes a search holding a newline as one line, escaped", () => {
    // Counterexample: `--find $'x\ny'` printed two physical lines while the budget counted one.
    const view = unwrap(
      findInSnapshot({ budget: { maxBytes: 1024, maxLines: 1 }, maxMatches: 20, text: "x\ny", yaml: PAGE }),
    );
    expect(view.lines).toEqual(['(no line of this read contains "x\\ny")']);
  });

  it("echoes a search holding a Unicode line separator as one line, escaped", () => {
    // JSON.stringify leaves U+2028 raw, and a reader may break the line on it.
    const view = unwrap(
      findInSnapshot({
        budget: { maxBytes: 1024, maxLines: 1 },
        maxMatches: 20,
        text: `x${String.fromCodePoint(0x2028)}y`,
        yaml: PAGE,
      }),
    );
    expect(view.lines).toEqual(['(no line of this read contains "x\\u2028y")']);
  });

  it("counts the matches past the cap instead of printing them", () => {
    const view = unwrap(findInSnapshot({ budget: BIG, maxMatches: 1, text: "link", yaml: PAGE }));
    expect(view.lines.at(-1)).toBe("… 2 more match(es) not shown — narrow --find, or open one with --under");
  });

  it("refuses an empty search", () => {
    const problem = unwrapErr(findInSnapshot({ budget: BIG, maxMatches: 20, text: "  ", yaml: PAGE }));
    expect(problem.code).toBe("EMPTY_FIND");
    expect(problem.message).toBe("--find needs the text to look for, e.g. --find Merge");
  });
});

describe("readSnapshotYaml", () => {
  it("reads a filed snapshot whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-outline-"));
    try {
      const path = join(dir, "observation-1.yml");
      writeFileSync(path, PAGE, "utf8");
      expect(unwrap(readSnapshotYaml({ path }))).toBe(PAGE);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("names the file it could not read, and never answers an empty outline", () => {
    const problem = unwrapErr(readSnapshotYaml({ path: "/nonexistent/observation-1.yml" }));
    expect(problem.code).toBe("SNAPSHOT_UNREADABLE");
    expect(problem.message).toContain("the look's snapshot at /nonexistent/observation-1.yml could not be read");
  });
});

describe("estimateTokens", () => {
  it("is bytes over four, rounded up", () => {
    expect(estimateTokens({ bytes: 0 })).toBe(0);
    expect(estimateTokens({ bytes: 9 })).toBe(3);
    expect(estimateTokens({ bytes: 6144 })).toBe(1536);
  });
});
