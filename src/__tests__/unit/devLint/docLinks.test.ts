import { describe, expect, it } from "vitest";
import { docLinkFindings, docTreeOf, sourceDocReferencesIn, unreachableDocs } from "../../../devLint/docLinks.js";
import { markdownAnchorsIn, markdownLinksIn } from "../../../devLint/docLinksRead.js";

describe("markdownAnchorsIn", () => {
  it("slugs headings the way GitHub does, an em dash leaving a double hyphen", () => {
    const anchors = markdownAnchorsIn({ content: "# Title\n\n## Rule 10 — worked examples\n" });
    expect([...anchors]).toEqual(["title", "rule-10--worked-examples"]);
  });

  it("suffixes a repeated heading in document order", () => {
    expect([...markdownAnchorsIn({ content: "## Why\n\n## Why\n" })]).toEqual(["why", "why-1"]);
  });

  it("slugs a heading's rendered text, not its inline code, link or emphasis markup", () => {
    const content = "## The `agent-doc-size` gate\n## See [the store](store.md)\n## **Bold** and _soft_\n";
    expect([...markdownAnchorsIn({ content })]).toEqual(["the-agent-doc-size-gate", "see-the-store", "bold-and-soft"]);
  });

  it("offers an explicit id or name anchor", () => {
    const anchors = markdownAnchorsIn({
      content: '<a id="supervisor-loop"></a>\n<a name="older"></a>\n<a id=\'single\'></a>\n<a id=" padded "></a>\n',
    });
    expect([...anchors]).toEqual(["supervisor-loop", "older", "single", " padded "]);
  });

  it("offers no id on an element GitHub's sanitiser drops, and a name only on an a", () => {
    const content =
      '<div id="kept" name="not-on-a-div"></div>\n\n<input id="dropped">\n\n<made-up id="also-dropped"></made-up>\n';
    expect([...markdownAnchorsIn({ content })]).toEqual(["kept"]);
  });

  it("offers no anchor from a template's content, whether or not GitHub draws it", () => {
    expect([...markdownAnchorsIn({ content: "<template><h2>Hidden</h2></template>\n\n## Shown\n" })]).toEqual([
      "shown",
    ]);
  });

  it("offers a setext heading's id, which an ATX-only reader never sees", () => {
    expect([...markdownAnchorsIn({ content: "Underlined\n==========\n" })]).toEqual(["underlined"]);
  });

  it("ignores a heading inside a fenced code block", () => {
    expect([...markdownAnchorsIn({ content: "```bash\n# a comment\n```\n## Real\n" })]).toEqual(["real"]);
  });
});

describe("markdownLinksIn", () => {
  it("resolves a relative link against the linking document's directory, with its fragment", () => {
    expect(markdownLinksIn({ content: "See [x](../docs/store.md#backup).\n", path: "skills/store/SKILL.md" })).toEqual([
      {
        fragment: "backup",
        line: 1,
        sourcePath: "skills/store/SKILL.md",
        targetPath: "skills/docs/store.md",
        via: "link",
      },
    ]);
  });

  it("reads link text Prettier wrapped across two lines, reporting the target's line", () => {
    const links = markdownLinksIn({
      content: "intro [`testing.md` § Recording a\ncassette](testing.md#rec)\n",
      path: "a.md",
    });
    expect(links.map((link) => [link.targetPath, link.fragment, link.line])).toEqual([["testing.md", "rec", 2]]);
  });

  it("resolves a fragment-only link to the document itself", () => {
    const links = markdownLinksIn({ content: "[up](#top)\n", path: "docs/a.md" });
    expect(links.map((link) => [link.targetPath, link.fragment])).toEqual([["docs/a.md", "top"]]);
  });

  it("skips an external URL, a fenced block and an inline code span", () => {
    const content = "[web](https://example.com)\n```\n[x](gone.md)\n```\n`[y](gone.md)` and\n";
    expect(markdownLinksIn({ content, path: "a.md" })).toEqual([]);
  });

  it("reads an angle-bracket destination with a space, inline and as a reference definition", () => {
    const content = "[a](<my notes.md#part>) [b][ref]\n\n[ref]: <other notes.md>\n";
    expect(markdownLinksIn({ content, path: "a.md" }).map((link) => [link.targetPath, link.fragment])).toEqual([
      ["my notes.md", "part"],
      ["other notes.md", undefined],
    ]);
  });

  it("marks an image apart from a link, raw or markdown", () => {
    const content = '![pic](docs/a.md) [doc](docs/b.md) <img src="docs/c.md">\n';
    expect(markdownLinksIn({ content, path: "README.md" }).map((link) => [link.targetPath, link.via])).toEqual([
      ["docs/a.md", "image"],
      ["docs/b.md", "link"],
      ["docs/c.md", "image"],
    ]);
  });

  it("reads a raw HTML href and image src, and treats an unused reference definition as drawing nothing", () => {
    const content = '<a href="docs/a.md#part">a</a> <img src="img/b.png">\n\n[unused]: gone.md\n';
    expect(markdownLinksIn({ content, path: "README.md" }).map((link) => [link.targetPath, link.fragment])).toEqual([
      ["docs/a.md", "part"],
      ["img/b.png", undefined],
    ]);
  });

  it("reads an @-import of any extension, a trailing full stop left off, and trims a padded raw href", () => {
    const content =
      'See @config/settings.json, @./local.json and @AGENTS.md. Mail a@b.com or ping @someone.\n\n<a href=" docs/a.md ">a</a>\n';
    expect(markdownLinksIn({ content, path: "CLAUDE.md" }).map((link) => [link.targetPath, link.via])).toEqual([
      ["docs/a.md", "link"],
      ["config/settings.json", "import"],
      ["local.json", "import"],
      ["AGENTS.md", "import"],
    ]);
  });

  it("reads an @-import whose extension carries punctuation, and skips one outside the checkout", () => {
    const content = "See @present.c++ and @~/notes.md and @../up.md and @/etc/x.md\n";
    expect(markdownLinksIn({ content, path: "CLAUDE.md" }).map((link) => link.targetPath)).toEqual(["present.c++"]);
  });

  it("reads an @-import from the source, as Claude Code does, so emphasis cannot split it", () => {
    const content = "See @missing*file.md* and `@in-code.md`\n";
    expect(markdownLinksIn({ content, path: "NOTE.md" }).map((link) => [link.targetPath, link.via])).toEqual([
      ["missing*file.md*", "import"],
    ]);
  });

  it("reads a backslash in a relative href as a path separator, as a browser does", () => {
    const content = '<a href="docs\\foo.md#part">x</a>\n';
    expect(markdownLinksIn({ content, path: "README.md" }).map((link) => [link.targetPath, link.fragment])).toEqual([
      ["docs/foo.md", "part"],
    ]);
  });

  it("resolves a target as a browser's URL parser does: tabs dropped, \\\\host external, a climb above the root outside, a leading \\ never repo-rooted", () => {
    const content =
      '<a href="ok\t.md">a</a> <a href="\\\\example.com/x.md">b</a> [c](../../up.md) [d](/docs/e.md) <a href="\\docs\\f.md">g</a>\n';
    expect(markdownLinksIn({ content, path: "docs/a.md" }).map((link) => link.targetPath)).toEqual([
      "docs/ok.md",
      "/(outside the checkout)/../../up.md",
      "docs/e.md",
      "/(outside the checkout)/\\docs\\f.md",
    ]);
  });

  it("treats any absolute URL as external, and resolves from a page whose own path carries a #", () => {
    const content = "[a](https://one.invalid/x) [s](//one.invalid/owner/repo/blob/main/x.md) [b](child.md)\n";
    expect(markdownLinksIn({ content, path: "docs/hash#dir/page.md" }).map((link) => link.targetPath)).toEqual([
      "docs/hash#dir/child.md",
    ]);
  });

  it("still checks a link inside a template, but never as a tree edge, whether or not GitHub draws it", () => {
    const content = '<template><a href="missing.md">x</a></template>\n';
    expect(markdownLinksIn({ content, path: "README.md" }).map((link) => [link.targetPath, link.via])).toEqual([
      ["missing.md", "template"],
    ]);
  });

  it("reports a relative reference the URL parser refuses, which goes nowhere when clicked", () => {
    expect(markdownLinksIn({ content: "[x](//)\n", path: "README.md" }).map((link) => link.targetPath)).toEqual([
      "/(not a URL)///",
    ]);
  });

  it("reports a segment naming no filename, never aliasing it onto a nested or literally-named file", () => {
    const content = "[a](r315%2Fchild.md) [b](sub%2F) [e](%FF.md) [c](my%20notes.md) [d](sub//a.md) [f](..//)\n";
    expect(markdownLinksIn({ content, path: "docs/README.md" }).map((link) => link.targetPath)).toEqual([
      "/(no such filename)/r315%2Fchild.md",
      "/(no such filename)/sub%2F",
      "/(no such filename)/%FF.md",
      "docs/my notes.md",
      "/(no such filename)/sub//a.md",
      "/(no such filename)/..//",
    ]);
  });

  it("resolves a link to the repository root, relative or rooted, and a rooted one past the stand-in prefix", () => {
    const content = "[a](./) [b](/) [c](../) [d](/owner/repo/blob/main)\n";
    expect(markdownLinksIn({ content, path: "docs/a.md" }).map((link) => link.targetPath)).toEqual([
      "docs/",
      ".",
      ".",
      "owner/repo/blob/main",
    ]);
  });

  it("keeps a non-breaking space a browser keeps in a URL, and reads a non-ASCII @-import", () => {
    const content = '<a href=" ok.md ">x</a>\n\nSee @docs/é.md.\n';
    expect(markdownLinksIn({ content, path: "README.md" }).map((link) => link.targetPath)).toEqual([
      " ok.md ",
      "docs/é.md",
    ]);
  });

  it("keeps a fence open past a shorter or different marker, closing only on one at least as long", () => {
    const content = "````\n```\n[x](gone.md)\n~~~~\n````\n[after](b.md)\n";
    expect(markdownLinksIn({ content, path: "a.md" }).map((link) => [link.targetPath, link.line])).toEqual([
      ["b.md", 6],
    ]);
  });

  it("treats a double-backtick span as code, and a lone backtick as no span at all", () => {
    const content = "``[x](gone.md)`` and a stray ` then [real](b.md)\n";
    expect(markdownLinksIn({ content, path: "a.md" }).map((link) => link.targetPath)).toEqual(["b.md"]);
  });

  it("reads a link whatever quoting its title uses", () => {
    const content = '[a](one.md \'single\') [b](two.md "a \\"quoted\\" title") [c](three.md (paren))\n';
    expect(markdownLinksIn({ content, path: "a.md" }).map((link) => link.targetPath)).toEqual([
      "one.md",
      "two.md",
      "three.md",
    ]);
  });

  it("reads a used reference definition and an @-import, the import carrying no fragment", () => {
    const content = "[x][ref]\n\n[ref]: ./b.md#part\n\n@AGENTS.md\n";
    const links = markdownLinksIn({ content, path: "CLAUDE.md" });
    expect(links.map((link) => [link.targetPath, link.fragment, link.via])).toEqual([
      ["b.md", "part", "link"],
      ["AGENTS.md", undefined, "import"],
    ]);
  });
});

describe("sourceDocReferencesIn", () => {
  it("takes a repo-rooted doc reference with its fragment", () => {
    const links = sourceDocReferencesIn({
      content: "// see docs/constraints/hard.md#2-nothing-is-silently-degraded\n",
      path: "src/a.ts",
    });
    expect(links.map((link) => [link.targetPath, link.fragment, link.line])).toEqual([
      ["docs/constraints/hard.md", "2-nothing-is-silently-degraded", 1],
    ]);
  });

  it("ignores a placeholder path and a path nested under another directory", () => {
    const content = "// skills/<name>/SKILL.md and ../../docs/a.md and $HOME/docs/b.md\n";
    expect(sourceDocReferencesIn({ content, path: "src/a.ts" })).toEqual([]);
  });
});

describe("docLinkFindings", () => {
  const anchorsByPath = new Map([["docs/a.md", new Set(["kept"])]]);
  const trackedPaths = new Set(["docs/a.md", "src/b.ts", "skills/x/SKILL.md"]);
  const link = ({ targetPath, fragment }: { targetPath: string; fragment: string | undefined }) => ({
    fragment,
    line: 3,
    sourcePath: "README.md",
    targetPath,
    via: "link" as const,
  });

  it("passes a tracked file, a present anchor, a directory and a source line anchor", () => {
    const links = [
      link({ fragment: "kept", targetPath: "docs/a.md" }),
      link({ fragment: undefined, targetPath: "skills/x" }),
      link({ fragment: "L10", targetPath: "src/b.ts" }),
      link({ fragment: undefined, targetPath: "." }),
    ];
    expect(docLinkFindings({ anchorsByPath, links, trackedPaths })).toEqual([]);
  });

  it("matches a fragment case-sensitively, as an HTML id is", () => {
    const links = [link({ fragment: "KEPT", targetPath: "docs/a.md" })];
    expect(docLinkFindings({ anchorsByPath, links, trackedPaths })).toEqual([
      { kind: "missing-anchor", line: 3, sourcePath: "README.md", target: "docs/a.md#KEPT" },
    ]);
  });

  it("lands a fragment on an id matching it as written or percent-decoded, a malformed escape kept literal", () => {
    const anchors = new Map([["docs/a.md", new Set(["a/b%zz", "c%2Fd", "é"])]]);
    const links = [
      link({ fragment: "a%2Fb%zz", targetPath: "docs/a.md" }),
      link({ fragment: "c%2Fd", targetPath: "docs/a.md" }),
      link({ fragment: "%C3%A9", targetPath: "docs/a.md" }),
      link({ fragment: "%FF", targetPath: "docs/a.md" }),
    ];
    expect(docLinkFindings({ anchorsByPath: anchors, links, trackedPaths })).toEqual([
      { kind: "missing-anchor", line: 3, sourcePath: "README.md", target: "docs/a.md#%FF" },
    ]);
  });

  it("checks a fragment on a directory against its README, and a directory with none offers no anchor", () => {
    const anchors = new Map([
      ["docs/README.md", new Set(["index"])],
      ["README.md", new Set(["top"])],
    ]);
    const tracked = new Set(["README.md", "docs/README.md", "docs/a.md", "src/b.ts"]);
    const links = [
      link({ fragment: "index", targetPath: "docs" }),
      link({ fragment: "top", targetPath: "." }),
      link({ fragment: "definitely-missing", targetPath: "docs/" }),
      link({ fragment: "anything", targetPath: "src" }),
    ];
    expect(docLinkFindings({ anchorsByPath: anchors, links, trackedPaths: tracked })).toEqual([
      { kind: "missing-anchor", line: 3, sourcePath: "README.md", target: "docs/#definitely-missing" },
      { kind: "missing-anchor", line: 3, sourcePath: "README.md", target: "src#anything" },
    ]);
  });

  it("lets a trailing slash name a directory, never a file of that name", () => {
    const links = [
      link({ fragment: undefined, targetPath: "docs/" }),
      link({ fragment: undefined, targetPath: "docs/a.md/" }),
    ];
    expect(docLinkFindings({ anchorsByPath, links, trackedPaths })).toEqual([
      { kind: "missing-file", line: 3, sourcePath: "README.md", target: "docs/a.md/" },
    ]);
  });

  it("lets a link but never an @-import land on a directory", () => {
    const links = [
      { ...link({ fragment: undefined, targetPath: "skills/x" }), via: "import" as const },
      link({ fragment: undefined, targetPath: "skills/x" }),
    ];
    expect(docLinkFindings({ anchorsByPath, links, trackedPaths })).toEqual([
      { kind: "missing-file", line: 3, sourcePath: "README.md", target: "skills/x" },
    ]);
  });

  it("names a missing file and a missing anchor", () => {
    const links = [
      link({ fragment: undefined, targetPath: "docs/gone.md" }),
      link({ fragment: "moved", targetPath: "docs/a.md" }),
    ];
    expect(docLinkFindings({ anchorsByPath, links, trackedPaths })).toEqual([
      { kind: "missing-file", line: 3, sourcePath: "README.md", target: "docs/gone.md" },
      { kind: "missing-anchor", line: 3, sourcePath: "README.md", target: "docs/a.md#moved" },
    ]);
  });
});

describe("unreachableDocs", () => {
  const edge = ({
    sourcePath,
    targetPath,
    via = "link",
  }: {
    sourcePath: string;
    targetPath: string;
    via?: "link" | "image" | "template" | "import";
  }) => ({ fragment: undefined, line: 1, sourcePath, targetPath, via });

  it("reaches a page any number of hops from a root, and names one nothing links to", () => {
    const links = [
      edge({ sourcePath: "docs/README.md", targetPath: "docs/a.md" }),
      edge({ sourcePath: "docs/a.md", targetPath: "docs/a/b.md" }),
      edge({ sourcePath: "docs/a/b.md", targetPath: "docs/a/c.md" }),
    ];
    const required = new Set(["docs/a.md", "docs/a/b.md", "docs/a/c.md", "docs/orphan.md"]);
    expect(unreachableDocs({ links, required, roots: ["docs/README.md"] })).toEqual(["docs/orphan.md"]);
  });

  it("follows an @-import but never an image or a template's link, which nobody navigates through", () => {
    const links = [
      edge({ sourcePath: "README.md", targetPath: "docs/imported.md", via: "import" }),
      edge({ sourcePath: "README.md", targetPath: "docs/pictured.md", via: "image" }),
      edge({ sourcePath: "README.md", targetPath: "docs/templated.md", via: "template" }),
    ];
    const required = new Set(["docs/imported.md", "docs/pictured.md", "docs/templated.md"]);
    expect(unreachableDocs({ links, required, roots: ["README.md"] })).toEqual([
      "docs/pictured.md",
      "docs/templated.md",
    ]);
  });
});

describe("docTreeOf", () => {
  it("roots the readmes, instruction files, rules and skill bodies, and requires docs and skill references", () => {
    const tree = docTreeOf({
      markdownPaths: [
        "README.md",
        "docs/README.md",
        "docs/store.md",
        ".claude/rules/testing.md",
        "skills/store/SKILL.md",
        "skills/store/reference/cite.md",
        "src/__tests__/fixtures/x/README.md",
      ],
    });
    expect(tree.roots).toEqual(["README.md", "docs/README.md", ".claude/rules/testing.md", "skills/store/SKILL.md"]);
    expect([...tree.required]).toEqual(["docs/README.md", "docs/store.md", "skills/store/reference/cite.md"]);
  });
});
