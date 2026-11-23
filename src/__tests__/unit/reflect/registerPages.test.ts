/**
 * The register read as pages: every listed page is read and attributed, and drift from the list in either
 * direction is a problem rather than a shorter inventory.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadRegister, REGISTER_DIRECTORY_RELATIVE_PATH, REGISTER_PAGES } from "../../../reflect/registerPages.js";
import type { SubstrateReader } from "../../../reflect/substrate.js";

const ROOT = "/repo";

/** One well-formed page per listed path, keyed by repo-relative path. */
const PAGES: Readonly<Record<string, string>> = {
  "docs/recurring-failure-register.md": ["# The recurring-failure register", "", "Opening prose."].join("\n"),
  "docs/recurring-failure-register/survivors.md": [
    "# Survivors — the live build candidates",
    "",
    "## Medium build cost",
    "",
    "| 1 | `a-survivor` | a seam | a cost |",
  ].join("\n"),
  "docs/recurring-failure-register/gated.md": ["# Gated", "", "- `a-gated-class` — closed by a gate."].join("\n"),
  "docs/recurring-failure-register/refuted-and-seed-candidates.md": [
    "# Refuted — 1 class",
    "",
    "| `a-dead-class` | refuted because it was already gated |",
    "",
    "## Filed separately",
    "",
    "- `a-filed-class` — has its own doc.",
    "",
    "## Two seed candidates",
    "",
    "- `not-a-filed-class` — a decoy.",
  ].join("\n"),
  "docs/recurring-failure-register/owner-ruled-additions.md": [
    "# Owner-ruled additions after the mining pass",
    "",
    "- **`an-owner-class`** — ruled in.",
  ].join("\n"),
  "docs/recurring-failure-register/silent-checks.md": [
    "# Owner-ruled additions: the silent-check family",
    "",
    "## The head of the family",
    "",
    "- **`a-silent-check-class`** — ruled in on a second page.",
  ].join("\n"),
  "docs/recurring-failure-register/bindings.md": [
    "# Bindings",
    "",
    "| class | binds | strength |",
    "| --- | --- | --- |",
    "| `a-survivor` | none | none |",
    "",
    "## Keeping it current",
    "",
    "Prose only.",
  ].join("\n"),
};

/**
 * A reader over an in-memory tree rooted at {@link ROOT}.
 *
 * @param files the repo-relative files it holds
 * @returns the reader
 */
function readerOver({ files }: { files: Readonly<Record<string, string>> }): SubstrateReader {
  const absolute = new Map(Object.entries(files).map(([path, text]) => [join(ROOT, path), text]));
  return {
    listNames: (dir) => [
      ...new Set(
        [...absolute.keys()]
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split("/")[0]!),
      ),
    ],
    readText: (path) => absolute.get(path),
  };
}

const PARENT = join(ROOT, "docs", "recurring-failure-register.md");

describe("REGISTER_PAGES", () => {
  it("lists the parent first and then every child under the register's directory", () => {
    expect(REGISTER_PAGES.length).toBeGreaterThan(0);
    expect(REGISTER_PAGES[0]!.path).toBe("docs/recurring-failure-register.md");
    expect(REGISTER_PAGES.slice(1).filter((page) => !page.path.startsWith(REGISTER_DIRECTORY_RELATIVE_PATH))).toEqual(
      [],
    );
  });
});

describe("loadRegister", () => {
  const loaded = loadRegister({ parentPath: PARENT, reader: readerOver({ files: PAGES }) });

  it("reads every listed page, in reading order, with each class on its own page and section", () => {
    expect(loaded.doc.classes.map((one) => [one.name, one.section, one.path])).toEqual([
      ["a-survivor", "survivors", "docs/recurring-failure-register/survivors.md"],
      ["a-gated-class", "gated", "docs/recurring-failure-register/gated.md"],
      ["a-dead-class", "refuted", "docs/recurring-failure-register/refuted-and-seed-candidates.md"],
      ["a-filed-class", "filed", "docs/recurring-failure-register/refuted-and-seed-candidates.md"],
      ["an-owner-class", "ownerRuled", "docs/recurring-failure-register/owner-ruled-additions.md"],
      ["a-silent-check-class", "ownerRuled", "docs/recurring-failure-register/silent-checks.md"],
    ]);
  });

  it("attributes a bindings row to the bindings page and reports no page unread", () => {
    expect(loaded.doc.bindings.map((row) => [row.className, row.path])).toEqual([
      ["a-survivor", "docs/recurring-failure-register/bindings.md"],
    ]);
    expect(loaded.unread).toEqual([]);
    expect(loaded.doc.problems).toEqual([]);
  });

  it("names a listed page that is absent, as unread and as a problem, and still reads the rest", () => {
    const { "docs/recurring-failure-register/gated.md": _gated, ...rest } = PAGES;
    const partial = loadRegister({ parentPath: PARENT, reader: readerOver({ files: rest }) });
    expect(partial.unread).toEqual(["docs/recurring-failure-register/gated.md"]);
    expect(partial.doc.problems.map((one) => one.path)).toEqual(["docs/recurring-failure-register/gated.md"]);
    expect(partial.doc.problems[0]!.message).toContain("listed in REGISTER_PAGES and absent");
    expect(partial.doc.classes.map((one) => one.name)).not.toContain("a-gated-class");
    expect(partial.doc.classes.map((one) => one.name)).toContain("a-survivor");
  });

  it("names a Markdown page in the register's directory that nobody listed", () => {
    const extra = {
      ...PAGES,
      "docs/recurring-failure-register/stray.md": "# Gated\n\n- `a-stray-class` — never read.",
    };
    const drifted = loadRegister({ parentPath: PARENT, reader: readerOver({ files: extra }) });
    expect(drifted.doc.problems.map((one) => one.path)).toEqual(["docs/recurring-failure-register/stray.md"]);
    expect(drifted.doc.problems[0]!.message).toContain("does not list");
    expect(drifted.doc.classes.map((one) => one.name)).not.toContain("a-stray-class");
    expect(drifted.unread).toEqual(["docs/recurring-failure-register/stray.md"]);
  });

  it("names any other entry, so a page in a subdirectory cannot hide, and names a Finder metadata entry too", () => {
    const extra = {
      ...PAGES,
      "docs/recurring-failure-register/.DS_Store/stray.md": "# Refuted",
      "docs/recurring-failure-register/extra/stray.md": "# Refuted\n\n| `a-nested-class` | x |",
      "docs/recurring-failure-register/notes.txt": "not a page",
    };
    const drifted = loadRegister({ parentPath: PARENT, reader: readerOver({ files: extra }) });
    expect(drifted.unread).toEqual([
      "docs/recurring-failure-register/.DS_Store",
      "docs/recurring-failure-register/extra",
      "docs/recurring-failure-register/notes.txt",
    ]);
    expect(drifted.doc.problems[0]!.message).toContain("not a register page");
  });

  it("marks a present page with a misspelt title unread, which keeps freeze from judging a partial read", () => {
    const misspelt = { ...PAGES, "docs/recurring-failure-register/gated.md": "# Gate\n\n- `a-gated-class` — closed." };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: misspelt }) });
    expect(read.doc.classes.map((one) => one.name)).not.toContain("a-gated-class");
    expect(read.unread).toEqual(["docs/recurring-failure-register/gated.md"]);
  });

  it("marks a page unread whose title only begins with its section's name, rather than reading it as that section", () => {
    const lookalike = {
      ...PAGES,
      "docs/recurring-failure-register/gated.md": "# Gatedness\n\n- `a-lookalike-class` — x",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: lookalike }) });
    expect(read.doc.classes.map((one) => one.name)).not.toContain("a-lookalike-class");
    expect(read.unread).toEqual(["docs/recurring-failure-register/gated.md"]);
  });

  it("marks the directory unread when its listing omits a page that was read, since an unlisted one would hide there too", () => {
    const blind: SubstrateReader = { ...readerOver({ files: PAGES }), listNames: () => [] };
    const read = loadRegister({ parentPath: PARENT, reader: blind });
    expect(read.unread).toEqual(["docs/recurring-failure-register"]);
    expect(read.doc.problems[0]!.message).toContain("listing omits a page that was read");
  });

  it("names a child whose first heading opens a different section than it is listed as opening", () => {
    const swapped = {
      ...PAGES,
      "docs/recurring-failure-register/gated.md": "# Survivors\n\n| 1 | `a-x-class` | a | b |",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: swapped }) });
    expect(read.doc.problems.map((one) => [one.path, one.message])).toEqual([
      [
        "docs/recurring-failure-register/gated.md",
        "has no `#` title opening the `gated` section, which REGISTER_PAGES lists it as opening",
      ],
    ]);
    expect(read.unread).toEqual(["docs/recurring-failure-register/gated.md"]);
  });

  it("judges a child's opening by its first heading outside a code fence", () => {
    const fencedTitle = {
      ...PAGES,
      "docs/recurring-failure-register/gated.md": "```md\n# Gated\n```\n# Survivors\n\n| 1 | `a-x-class` | a | b |",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: fencedTitle }) });
    expect(read.unread).toEqual(["docs/recurring-failure-register/gated.md"]);
  });

  it("keeps a shorter fence line inside a longer fence, so it cannot close it early", () => {
    const nested = {
      ...PAGES,
      "docs/recurring-failure-register/gated.md": [
        "````md",
        "```",
        "# Gated",
        "- `a-phantom-class` — code only.",
        "```",
        "````",
        "# Survivors",
      ].join("\n"),
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: nested }) });
    expect(read.doc.classes.map((one) => one.name)).not.toContain("a-phantom-class");
    expect(read.unread).toEqual(["docs/recurring-failure-register/gated.md"]);
  });

  it("names a child whose title is demoted to `##`, since its sibling `##` headings would end the section", () => {
    const demoted = {
      ...PAGES,
      "docs/recurring-failure-register/survivors.md":
        "## Survivors\n\n## Medium build cost\n\n| 1 | `a-survivor` | a | b |",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: demoted }) });
    expect(read.unread).toEqual(["docs/recurring-failure-register/survivors.md"]);
  });

  it("names a child with a second `#` title, which would end its section at a former `###`", () => {
    const twice = {
      ...PAGES,
      "docs/recurring-failure-register/survivors.md":
        "# Survivors\n\n# Medium build cost\n\n| 1 | `a-survivor` | a | b |",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: twice }) });
    expect(read.doc.problems.map((one) => one.message)).toEqual([
      "holds a second `#` title, which would end its section early — a child has one",
    ]);
    expect(read.unread).toEqual(["docs/recurring-failure-register/survivors.md"]);
  });

  it("names a page left inside a code fence, and never closes one on a no-break space", () => {
    const unclosed = {
      ...PAGES,
      "docs/recurring-failure-register/survivors.md":
        "# Survivors\n\n```\n```\u00A0\n| 1 | `a-hidden-survivor` | a | b |",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: unclosed }) });
    expect(read.doc.problems.map((one) => one.message)).toEqual([
      "ends inside a code fence, which hides every line after it — close the fence",
    ]);
    expect(read.unread).toEqual(["docs/recurring-failure-register/survivors.md"]);
  });

  it("closes a fence on a CRLF line, and reads the row after it", () => {
    const crlf = {
      ...PAGES,
      "docs/recurring-failure-register/survivors.md":
        "# Survivors\r\n\r\n```text\r\nexample\r\n```\r\n\r\n| 1 | `a-crlf-survivor` | a | b |\r\n",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: crlf }) });
    expect(read.doc.problems).toEqual([]);
    expect(read.doc.classes.some((one) => one.name === "a-crlf-survivor")).toBe(true);
  });

  it("names a later heading that opens a section its page is not listed as holding", () => {
    const stray = {
      ...PAGES,
      "docs/recurring-failure-register/survivors.md":
        "# Survivors\n\n## Gated details\n\n| 1 | `a-split-class` | x | y |",
    };
    const read = loadRegister({ parentPath: PARENT, reader: readerOver({ files: stray }) });
    expect(read.doc.problems.map((one) => [one.path, one.message])).toEqual([
      [
        "docs/recurring-failure-register/survivors.md",
        '"## Gated details" opens a section REGISTER_PAGES does not list this page as holding — rename it, or list it',
      ],
    ]);
    expect(read.unread).toEqual(["docs/recurring-failure-register/survivors.md"]);
  });

  it("passes a later heading opening a section its page is listed as holding", () => {
    expect(loaded.doc.classes.find((one) => one.name === "a-filed-class")!.section).toBe("filed");
    expect(loaded.unread).toEqual([]);
  });

  it("reads nothing and reports every page unread when the parent's directory holds no register", () => {
    const empty = loadRegister({ parentPath: PARENT, reader: readerOver({ files: {} }) });
    expect(empty.doc.classes).toEqual([]);
    expect(empty.unread).toEqual(REGISTER_PAGES.map((page) => page.path));
  });
});
