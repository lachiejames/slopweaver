/**
 * The codebase atlas, checked against itself — the two-describe shape `areaRules.test.ts` and
 * `staleReferences.test.ts` established: the first block drives the pure functions on inline fixtures, the
 * second reads THIS repository off disk.
 *
 * The second block is the gate the whole design rests on. Everything the atlas prints is derived from the
 * tree EXCEPT the one-line blurbs, and a declared blurb is exactly the kind of prose that goes quietly
 * wrong: a tree added with no row here would render as an empty description, and a row left behind by a
 * rename would describe a tree that no longer exists while reading perfectly. Both fail below.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codebaseAtlas,
  nounOfCommandPath,
  reachedTreesOf,
  skillBlurb,
  treeOfPath,
} from "../../../canon/codebaseAtlas.js";
import { ROOT_TREE, TREE_BLURBS } from "../../../canon/treeBlurbs.js";
import { repoRootOf, workingTreeFilesOf } from "../../../lib/gitRepo.js";

describe("treeOfPath", () => {
  it("names the top-level directory of a nested module", () => {
    expect(treeOfPath({ path: "src/cli/commands/catalog/treesRun.ts" })).toBe("cli");
  });

  it("buckets a loose file at the top of src/ into the root bucket", () => {
    expect(treeOfPath({ path: "src/config.ts" })).toBe(ROOT_TREE);
  });

  it("excludes the test tree, which is four lanes rather than a subsystem", () => {
    expect(treeOfPath({ path: "src/__tests__/unit/canon/codebaseAtlas.test.ts" })).toBeUndefined();
  });

  it("excludes a path outside src/", () => {
    expect(treeOfPath({ path: "eval/cases/answer.ts" })).toBeUndefined();
  });

  it("excludes a non-TypeScript file inside src/", () => {
    expect(treeOfPath({ path: "src/corpus/schema.sql" })).toBeUndefined();
  });
});

describe("reachedTreesOf", () => {
  it("resolves a relative specifier into the tree it names", () => {
    const content = 'import { corpusRead } from "../../../corpus/read.js";\n';
    expect(reachedTreesOf({ content, path: "src/cli/commands/refresh/run.ts" })).toEqual(["corpus"]);
  });

  it("counts the `../` hops, so a specifier one level short names the importer's own tree and not the target", () => {
    const content = 'import { corpusRead } from "../../corpus/read.js";\n';
    expect(reachedTreesOf({ content, path: "src/cli/commands/refresh/run.ts" })).toEqual([]);
  });

  it("resolves the #lib/ subpath import to the shared floor", () => {
    const content = 'import { ok } from "#lib/result.js";\n';
    expect(reachedTreesOf({ content, path: "src/live/slack/read.ts" })).toEqual(["lib"]);
  });

  it("drops the module's own tree, so an edge is always a crossing", () => {
    const content = 'import { a } from "./sibling.js";\nimport { b } from "../deep/nested.js";\n';
    expect(reachedTreesOf({ content, path: "src/live/slack/read.ts" })).toEqual([]);
  });

  it("ignores a specifier written in a comment, which mints an edge no code creates", () => {
    const content =
      ' * Superseded by the reader imported from "../../corpus/corpusStore.js".\n' +
      '// and by the one from "../../corpus/read.js"\n' +
      '/* and from "../../corpus/write.js" */\n';
    expect(reachedTreesOf({ content, path: "src/live/listen/stranded.ts" })).toEqual([]);
  });

  it("still reads a real import whose specifier sits on the closing line of a multi-line statement", () => {
    const content = 'import {\n  readJsonlLines,\n  writeRecord,\n} from "../../corpus/corpusStore.js";\n';
    expect(reachedTreesOf({ content, path: "src/live/listen/stranded.ts" })).toEqual(["corpus"]);
  });

  it("counts a type-only import, because the edge reported is imports-from and never calls", () => {
    const content = 'import type { CorpusRecord } from "../../corpus/types.js";\n';
    expect(reachedTreesOf({ content, path: "src/live/listen/stranded.ts" })).toEqual(["corpus"]);
  });

  it("skips a bare package specifier, which names a dependency rather than a tree", () => {
    const content = 'import { z } from "zod";\nimport { join } from "node:path";\n';
    expect(reachedTreesOf({ content, path: "src/cli/router.ts" })).toEqual([]);
  });

  it("reads a dynamic import, which is how every manifest reaches its command module", () => {
    const content = 'const load = () => import("../commands/catalog/run.js");\n';
    expect(reachedTreesOf({ content, path: "src/cli/manifests/catalog.ts" })).toEqual([]);
  });

  it("reads a dynamic import that crosses a tree", () => {
    const content = 'const load = () => import("../../outbound/slack/send.js");\n';
    expect(reachedTreesOf({ content, path: "src/cli/manifests/slack.ts" })).toEqual(["outbound"]);
  });

  it("reaches the root bucket when a specifier names a loose file", () => {
    const content = 'import { config } from "../../config.js";\n';
    expect(reachedTreesOf({ content, path: "src/cli/commands/run.ts" })).toEqual([ROOT_TREE]);
  });

  it("dedupes and sorts the trees one module reaches", () => {
    const content =
      'import { a } from "../../outbound/form.js";\n' +
      'import { b } from "../../outbound/send.js";\n' +
      'import { c } from "../../corpus/read.js";\n';
    expect(reachedTreesOf({ content, path: "src/cli/commands/run.ts" })).toEqual(["corpus", "outbound"]);
  });
});

describe("nounOfCommandPath", () => {
  it("names the noun a command module belongs to", () => {
    expect(nounOfCommandPath({ path: "src/cli/commands/github/mergeCore.ts" })).toBe("github");
  });

  it("names no noun for a module outside the command tree", () => {
    expect(nounOfCommandPath({ path: "src/cli/router.ts" })).toBeUndefined();
  });
});

describe("skillBlurb", () => {
  it("takes the first sentence, dropping the dispatcher's use-when clauses", () => {
    const content = "---\nname: page\ndescription: Publish the ONE page a session ends in. Use when a run ends.\n---\n";
    expect(skillBlurb({ content })).toBe("Publish the ONE page a session ends in.");
  });

  it("takes the whole description when it is a single unterminated sentence", () => {
    expect(skillBlurb({ content: "---\nname: x\ndescription: Do one thing\n---\n" })).toBe("Do one thing");
  });

  it("returns the empty string when the skill declares no description", () => {
    expect(skillBlurb({ content: "---\nname: x\n---\n" })).toBe("");
  });

  // The input CARRIES the backticks, so this reddens if the strip is ever removed — a `not.toContain` over a
  // description that never had one would pass on an empty function.
  it("strips the markdown a SKILL.md description is legitimately written in", () => {
    const content =
      "---\nname: alias\ndescription: Provision `<identity>-claude-<n>` mailboxes. Use when asked.\n---\n";

    expect(content).toContain("`<identity>-claude-<n>`");
    expect(skillBlurb({ content })).toBe("Provision <identity>-claude-<n> mailboxes.");
  });
});

const RULE = '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n';

describe("codebaseAtlas", () => {
  it("counts each tree's modules and carries its declared blurb", () => {
    const atlas = codebaseAtlas({
      modules: [
        { path: "src/cli/router.ts", reaches: [] },
        { path: "src/cli/index.ts", reaches: [] },
      ],
      rules: [],
      skills: [],
    });
    expect(atlas.trees).toEqual([
      {
        blurb: TREE_BLURBS["cli"],
        dependedOnBy: [],
        dependsOn: [],
        entryNouns: [],
        modules: 2,
        rulePath: undefined,
        tree: "cli",
      },
    ]);
  });

  it("orders entry nouns heaviest first, so a tree's real front door leads", () => {
    const atlas = codebaseAtlas({
      modules: [
        { path: "src/cli/commands/refresh/run.ts", reaches: ["corpus"] },
        { path: "src/cli/commands/refresh/core.ts", reaches: ["corpus"] },
        { path: "src/cli/commands/audit/run.ts", reaches: ["corpus"] },
        { path: "src/corpus/read.ts", reaches: [] },
      ],
      rules: [],
      skills: [],
    });
    expect(atlas.trees.find((tree) => tree.tree === "corpus")!.entryNouns).toEqual(["refresh", "audit"]);
  });

  it("records both directions of a crossing, so a tree says who reaches it too", () => {
    const atlas = codebaseAtlas({
      modules: [
        { path: "src/cli/router.ts", reaches: ["corpus"] },
        { path: "src/corpus/read.ts", reaches: [] },
      ],
      rules: [],
      skills: [],
    });
    expect(atlas.trees.find((tree) => tree.tree === "cli")!.dependsOn).toEqual(["corpus"]);
    expect(atlas.trees.find((tree) => tree.tree === "corpus")!.dependedOnBy).toEqual(["cli"]);
  });

  it("weights an edge by how many modules cross it", () => {
    const atlas = codebaseAtlas({
      modules: [
        { path: "src/cli/a.ts", reaches: ["corpus", "lib"] },
        { path: "src/cli/b.ts", reaches: ["lib"] },
      ],
      rules: [],
      skills: [],
    });
    expect(atlas.edges).toEqual([
      { from: "cli", modules: 2, to: "lib" },
      { from: "cli", modules: 1, to: "corpus" },
    ]);
  });

  it("binds a tree to its area rule by the rule's globs, never by the rule's filename", () => {
    const atlas = codebaseAtlas({
      modules: [{ path: "src/cli/router.ts", reaches: [] }],
      rules: [{ content: RULE, path: ".claude/rules/area-renamed-by-somebody.md" }],
      skills: [],
    });
    expect(atlas.trees[0]!.rulePath).toBe(".claude/rules/area-renamed-by-somebody.md");
  });

  it("carries no rule for a tree no rule's globs cover", () => {
    const atlas = codebaseAtlas({
      modules: [{ path: "src/corpus/read.ts", reaches: [] }],
      rules: [{ content: RULE, path: ".claude/rules/area-cli.md" }],
      skills: [],
    });
    expect(atlas.trees[0]!.rulePath).toBeUndefined();
  });

  it("reports skills alphabetically with their reference-file counts", () => {
    const atlas = codebaseAtlas({
      modules: [{ path: "src/cli/router.ts", reaches: [] }],
      rules: [],
      skills: [
        {
          content: "---\nname: page\ndescription: Publish one page. Use when.\n---\n",
          name: "page",
          referenceFiles: 0,
        },
        {
          content: "---\nname: ask\ndescription: Answer from history. Use when.\n---\n",
          name: "ask",
          referenceFiles: 3,
        },
      ],
    });
    expect(atlas.skills).toEqual([
      { blurb: "Answer from history.", name: "ask", referenceFiles: 3 },
      { blurb: "Publish one page.", name: "page", referenceFiles: 0 },
    ]);
  });

  it("leaves a tree with no declared blurb empty rather than inventing one", () => {
    const atlas = codebaseAtlas({
      modules: [{ path: "src/notAtreeAnybodyDeclared/x.ts", reaches: [] }],
      rules: [],
      skills: [],
    });
    expect(atlas.trees[0]!.blurb).toBe("");
  });
});

describe("this repository's own trees", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const files = workingTreeFilesOf({ root });
  const trees = [
    ...new Set(files.map((path) => treeOfPath({ path })).filter((tree): tree is string => tree !== undefined)),
  ].toSorted();

  it("has trees to check, so every assertion below is about something", () => {
    expect(trees.length).toBeGreaterThan(0);
  });

  it("declares a blurb for every top-level tree, so no tree renders undescribed", () => {
    expect(trees.filter((tree) => TREE_BLURBS[tree] === undefined)).toEqual([]);
  });

  it("declares no blurb for a tree that is not there, so a rename cannot leave prose behind", () => {
    expect(Object.keys(TREE_BLURBS).filter((tree) => !trees.includes(tree))).toEqual([]);
  });

  it("gives every blurb real content rather than a placeholder", () => {
    expect(Object.entries(TREE_BLURBS).filter(([, blurb]) => blurb.trim().length < 20)).toEqual([]);
  });

  // A blurb is rendered into a terminal table and into a React table cell, and NEITHER reads markdown: a
  // backtick is drawn as a backtick in both. Measured on the docs site — eleven blurbs printed
  // "The loose files at the top of `src/`" verbatim in the browser. Plain prose is the one spelling that is
  // right on every surface the atlas is read through.
  it("uses no markdown in a blurb, because no surface that renders one reads markdown", () => {
    expect(Object.entries(TREE_BLURBS).filter(([, blurb]) => blurb.includes("`"))).toEqual([]);
  });

  // The SKILL.md half of the same rule. A tree blurb is DECLARED, so the test above reads the registry; a
  // skill blurb is DERIVED from another file's front matter, so this repository's own skills are the only
  // place to check one — after the strip the reader applies. `skillBlurb` removes backticks, which is the
  // class that actually reached the browser; nothing removes the rest of the markdown a description may
  // legitimately be written in, and no description carries any today. This is what keeps that true.
  const skillBlurbs = files
    .filter((path) => path.startsWith("skills/") && path.endsWith("/SKILL.md"))
    .map((path) => skillBlurb({ content: readFileSync(join(root, path), "utf8") }));

  it("has skill blurbs to check, so the assertion below is about something", () => {
    expect(skillBlurbs.length).toBeGreaterThan(0);
  });

  it("renders no markdown in a skill blurb either, on the rule the declared blurbs keep", () => {
    expect(skillBlurbs.filter((blurb) => /`|\*\*|__|~~|\[[^\]]+\]\(/.test(blurb))).toEqual([]);
  });

  it("binds each area rule to the tree its own heading names", () => {
    const atlas = codebaseAtlas({
      modules: files
        .filter((path) => treeOfPath({ path }) !== undefined)
        .map((path) => ({ path, reaches: reachedTreesOf({ content: readFileSync(join(root, path), "utf8"), path }) })),
      rules: files
        .filter((path) => /^\.claude\/rules\/area-[^/]+\.md$/.test(path))
        .map((path) => ({ content: readFileSync(join(root, path), "utf8"), path })),
      skills: [],
    });
    const bound = atlas.trees
      .filter((tree) => tree.rulePath !== undefined)
      .map((tree) => `${tree.tree}=${String(tree.rulePath)}`);
    expect(bound.toSorted()).toEqual([
      "admit=.claude/rules/area-admit.md",
      "atlas=.claude/rules/area-atlas.md",
      "cli=.claude/rules/area-cli.md",
      "corpus=.claude/rules/area-corpus.md",
      "devLint=.claude/rules/area-devLint.md",
      "handover=.claude/rules/area-handover.md",
      "live=.claude/rules/area-live.md",
      "outbound=.claude/rules/area-outbound.md",
    ]);
  });

  it("binds a tree to the rule whose heading names it whatever order the rules arrive in", () => {
    const atlas = codebaseAtlas({
      modules: [
        { path: "src/cli/main.ts", reaches: [] },
        { path: "src/handover/store.ts", reaches: [] },
      ],
      rules: [
        {
          content:
            '---\npaths:\n  - "src/handover/**"\n  - "src/cli/commands/handover/**"\n---\n\n# Working in `src/handover/`\n',
          path: ".claude/rules/area-handover.md",
        },
        {
          content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n',
          path: ".claude/rules/area-cli.md",
        },
      ],
      skills: [],
    });
    const bound = atlas.trees.map((tree) => `${tree.tree}=${String(tree.rulePath)}`);
    expect(bound.toSorted()).toEqual(["cli=.claude/rules/area-cli.md", "handover=.claude/rules/area-handover.md"]);
  });
});
