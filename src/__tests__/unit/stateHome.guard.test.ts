/**
 * The single-contract guard. It fails the build if any module derives a `$SLOPWEAVER_HOME` sub-path on
 * its own instead of importing it from `stateHome.ts` — the invariant that keeps every belief, ledger,
 * corpus, and seed file agreeing on one layout — or builds a path to a rebuildable cache entry anywhere but
 * `cacheHome.ts`. Scans the working-tree source of `src/`, `site/` and `desktop/` (not just tracked files) so a
 * brand-new offender is caught before it is ever committed; the console and the shell cannot import `src/`, so
 * each keeps ONE owner of its own reading of the home, named in the rules below.
 *
 * The CLI's owner is one module TREE rather than one file: the entry `src/stateHome.ts` and the per-area
 * modules under `src/stateHome/` it composes. Two cases keep that tree exactly as closed as a single file: every
 * module in it is composed by the entry, and nothing outside it names one of its modules in a relative path —
 * a static import, a dynamic one, or a string held for one — so a consumer reaches the layout only through
 * `stateHomePaths`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

// This test lives under `src/__tests__/unit/`; the repository root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The trees scanned: the CLI, the console it serves, and the desktop shell that starts both. */
const SCANNED_TREES = ["src", "site", "desktop"] as const;

/** Directories holding installed or generated code, never a module written here. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".next", "dist", "out"]);

/** Every non-test `.ts`, `.tsx` or `.mjs` under one directory. */
function sourceFiles({ dir }: { dir: string }): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        out.push(...sourceFiles({ dir: full }));
      }
    } else if (/\.(ts|tsx|mjs)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The CLI's state-home contract: the entry, and the directory of per-area modules it composes. */
const CONTRACT_ENTRY = "src/stateHome.ts";
const CONTRACT_TREE = "src/stateHome/";

/**
 * A JSX attribute value with its numeric character references decoded, which the parser leaves raw. HTML4's
 * named entities spell no ASCII letter, `.` or `/`, so a numeric one is the only way to disguise a path.
 */
function decodeNumericEntities({ text }: { text: string }): string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/giu, (_entity, code: string) => {
    const isHex = code.toLowerCase().startsWith("x");
    return String.fromCodePoint(isHex ? parseInt(code.slice(1), 16) : Number(code));
  });
}

/**
 * A regex source matching one literal backslash. Built from its code point so no escape sits in this file for
 * an editor or a transport to decode on the way in, which is how an earlier witness here was silently changed.
 */
const BACKSLASH = String.fromCharCode(92).repeat(2);

/** A regex source matching one whitespace character, built the same way as {@link BACKSLASH}. */
const WHITESPACE = `${String.fromCharCode(92)}s`;

/**
 * One character as the alternation of every way a string literal or JSX attribute can spell it: itself, an
 * identity escape, a legacy octal escape (which the parser still decodes, error and all), a hex escape, either
 * unicode escape, or a decimal or hex character reference. Matched case-insensitively, which over-matches and
 * so only ever costs a parse.
 */
function spellingsOf({ char }: { char: string }): string {
  const code = char.codePointAt(0)!;
  const hex = code.toString(16).padStart(2, "0");
  return [
    char,
    `${BACKSLASH}${char}`,
    `${BACKSLASH}0*${code.toString(8)}`,
    `${BACKSLASH}x${hex}`,
    `${BACKSLASH}u00${hex}`,
    `${BACKSLASH}u[{]0*${hex}[}]`,
    `&#0*${String(code)};`,
    `&#x0*${hex};`,
  ].join("|");
}

/**
 * The cheap superset test that picks which files are parsed: `stateHome` followed by `/`, a closing quote or a
 * template hole, each character in any spelling {@link spellingsOf} names, with a line continuation allowed
 * between any two. A relative path reaching the tree from outside it holds `stateHome/` or ends in `stateHome`,
 * and a literal's value differs from its spelling only through those escapes, so a file this misses holds no
 * such literal and its parse is skipped. Parsing every file instead measured 76s on a loaded CI runner.
 */
const CANDIDATE = new RegExp(
  [
    ...Array.from("stateHome", (char) => `(?:${spellingsOf({ char })})`),
    `(?:${spellingsOf({ char: "/" })}|["'\`$])`,
  ].join(`(?:${BACKSLASH}${WHITESPACE}+)*`),
  "iu",
);

/**
 * Every relative path one source file holds as a string literal, or as the fixed head of a template, that
 * resolves into the contract tree. Every literal, not only an import specifier: a path held in a variable and
 * passed to `import(area)` reaches the tree as surely as a static import does. A {@link CANDIDATE} file is read
 * through the TypeScript parser, so a value is the DECODED one the runtime sees, and a JSX attribute's numeric
 * entity is decoded too. A path assembled at run time from several pieces is beyond any syntactic scan, the
 * same limit the `join(home, …)` rule has.
 */
function treeReferencesIn({ path, source }: { path: string; source: string }): readonly string[] {
  if (!CANDIDATE.test(source)) {
    return [];
  }
  let kind = ts.ScriptKind.TS;
  if (path.endsWith(".tsx")) {
    kind = ts.ScriptKind.TSX;
  } else if (path.endsWith(".mjs")) {
    kind = ts.ScriptKind.JS;
  }
  const values: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (isStringLiteralLikeNode(node) && ts.isJsxAttribute(node.parent)) {
      values.push(decodeNumericEntities({ text: node.text }));
    } else if (isStringLiteralLikeNode(node) || ts.isTemplateHead(node)) {
      values.push(node.text);
    }
    forEachChild({ node, visit });
  };
  withSourceFile({ fileName: path, text: source, scriptKind: kind, use: (tree) => visit(tree) });
  return values.filter(
    (value) => /^\.{1,2}\//u.test(value) && `${join(dirname(path), value)}/`.startsWith(CONTRACT_TREE),
  );
}

/**
 * A forbidden derivation, and the only repo-relative places allowed to contain it: a file path, or a directory
 * path ending in `/` that allows every file beneath it.
 */
interface Rule {
  readonly label: string;
  readonly re: RegExp;
  readonly allow: readonly string[];
}

/** Whether one repo-relative path is an allowed owner of a rule: an exact file, or under an allowed directory. */
function isAllowed({ allow, path }: { allow: readonly string[]; path: string }): boolean {
  return allow.some((owner) => (owner.endsWith("/") ? path.startsWith(owner) : path === owner));
}

/**
 * The `(?<![.\w])` on the path-join rules is load-bearing, not decoration: without it the pattern also
 * matched `Array.prototype.join`, so `parts.join(home)` — a string concatenation with no path in it —
 * was reported as a home-layout violation. Narrowing to a bare `join(` call can only remove false
 * positives; a real `import { join } from "node:path"` call is never preceded by a dot or a word character.
 */
const RULES: readonly Rule[] = [
  {
    allow: [CONTRACT_ENTRY, CONTRACT_TREE, "site/lib/consoleHome.ts"],
    label:
      "join(home, …) — build home paths only in stateHome.ts and src/stateHome/ (the console's in site/lib/consoleHome.ts)",
    re: /(?<![.\w])join\(\s*home\b/u,
  },
  {
    allow: [],
    label: "join(slopweaverHome(), …) — resolve the home, then take its path from stateHome.ts",
    re: /(?<![.\w])join\(\s*slopweaverHome\(\)/u,
  },
  {
    allow: [],
    label: "join(consoleHome(), …) — the console takes its home paths from consoleHomePaths()",
    re: /(?<![.\w])join\(\s*consoleHome\(\)/u,
  },
  {
    // A quoted string, never a backticked one: prose in a comment names the directory in backticks.
    allow: ["src/homeDir.ts", "site/lib/consoleHome.ts", "desktop/src/pageReveal.ts"],
    label: "'.slopweaver' default-home literal — one owner per tree",
    re: /["']\.slopweaver["']/u,
  },
  {
    allow: ["src/cacheHome.ts", "src/stateHome.ts"],
    label:
      "a cache entry joined into a path — build cache paths only in cacheHome.ts (stateHome.ts names the legacy one)",
    re: /(?<![.\w])join\([^)]*["'`](exec-store|codex-plugin|docs-site|saved-readings|last-update\.json)["'`]/u,
  },
];

/**
 * This guard reads every source, so it costs seconds rather than milliseconds and sat just under
 * vitest's default 5s budget — measured at 4.46s alone, which tips over under the full parallel suite. The
 * budget is stated so the gate fails for a finding rather than for the machine being busy. It covers the one
 * `beforeAll` that walks and reads the trees as well as each case.
 */
const READS_EVERY_TRACKED_SOURCE_MS = 60_000;

/** How many reads are in flight at once — bounded so the open file descriptors stay far under any ulimit. */
const READ_BATCH = 64;

/** One scanned source file: the tree it sits in, its repo-relative path, and its text. */
interface ScannedSource {
  readonly tree: (typeof SCANNED_TREES)[number];
  readonly path: string;
  readonly text: string;
}

/**
 * Every source of every scanned tree, walked and read ONCE, {@link READ_BATCH} reads at a time. Reading the ~11k
 * files is nearly all of this guard's time — measured 2.5s of a 3.6s pass on a loaded machine one synchronous read
 * at a time, against ~0.4s for the walk and ~0.3s for every rule over every line — and three cases each re-walked
 * and re-read the trees before (tests 9.56s, now 1.56s). Re-measure:
 * `yarn vitest run --config config/vitest/unit.ts --coverage=false --reporter=verbose src/__tests__/unit/stateHome.guard.test.ts`.
 *
 * @returns each file with its tree and repo-relative path, in walk order
 */
async function scanTrees(): Promise<readonly ScannedSource[]> {
  const files = SCANNED_TREES.flatMap((tree) =>
    sourceFiles({ dir: join(repoRoot, tree) }).map((file) => ({ file, tree })),
  );
  const scanned: ScannedSource[] = [];
  for (let start = 0; start < files.length; start += READ_BATCH) {
    const batch = files.slice(start, start + READ_BATCH);
    const texts = await Promise.all(batch.map(({ file }) => readFile(file, "utf8")));
    batch.forEach(({ file, tree }, index) => {
      scanned.push({ path: relative(repoRoot, file), text: texts[index]!, tree });
    });
  }
  return scanned;
}

/**
 * Every violation in the scanned sources, as `path:line — label`. A rule is tried on a file's lines only when it
 * matches the whole text, which loses no line: each rule is unanchored with no flag but `u`, and a line's
 * neighbours in the whole text are a newline or nothing, which `(?<![.\w])` and `\b` read the same as the line's
 * own edges — so any line it matches is a substring it matches in the text.
 */
function violationsIn({
  rules,
  sources,
}: {
  rules: readonly Rule[];
  sources: readonly ScannedSource[];
}): readonly string[] {
  const violations: string[] = [];
  for (const { path, text } of sources) {
    const matching = rules.filter((rule) => rule.re.test(text));
    if (matching.length === 0) {
      continue;
    }
    const lines = text.split("\n");
    for (const rule of matching) {
      lines.forEach((line, index) => {
        if (rule.re.test(line) && !isAllowed({ allow: rule.allow, path })) {
          violations.push(`${path}:${String(index + 1)} — ${rule.label}`);
        }
      });
    }
  }
  return violations;
}

describe("state-home single-contract guard", { timeout: READS_EVERY_TRACKED_SOURCE_MS }, () => {
  let scanned: readonly ScannedSource[] = [];

  beforeAll(async () => {
    scanned = await scanTrees();
  }, READS_EVERY_TRACKED_SOURCE_MS);

  it("derives no $SLOPWEAVER_HOME sub-path or cache path outside its one owner", () => {
    expect(RULES.length).toBeGreaterThan(0);
    expect(violationsIn({ rules: RULES, sources: scanned })).toEqual([]);
  });

  it("names only owners that exist and that each still carry what they own", () => {
    const carries = ({ owner, re }: { owner: string; re: RegExp }): boolean => {
      const files = owner.endsWith("/") ? sourceFiles({ dir: join(repoRoot, owner) }) : [join(repoRoot, owner)];
      return files.some((file) => re.test(readFileSync(file, "utf8")));
    };
    const stale = RULES.flatMap((rule) =>
      rule.allow.filter((owner) => !carries({ owner, re: rule.re })).map((owner) => `${owner} — ${rule.label}`),
    );
    expect(stale).toEqual([]);
  });

  it("allows a home-path join in the contract tree and nowhere beside it", () => {
    const homeJoin = RULES[0]!;
    const verdicts = [
      CONTRACT_ENTRY,
      `${CONTRACT_TREE}corpus.ts`,
      "src/stateHomeExtra.ts",
      "src/stateHomeX/corpus.ts",
      "src/other/stateHome/corpus.ts",
      "site/stateHome/corpus.ts",
      "src/stateHome.test.ts",
    ].map((path) => [path, isAllowed({ allow: homeJoin.allow, path })]);
    expect(verdicts).toEqual([
      [CONTRACT_ENTRY, true],
      [`${CONTRACT_TREE}corpus.ts`, true],
      ["src/stateHomeExtra.ts", false],
      ["src/stateHomeX/corpus.ts", false],
      ["src/other/stateHome/corpus.ts", false],
      ["site/stateHome/corpus.ts", false],
      ["src/stateHome.test.ts", false],
    ]);
  });

  it("composes every module of the contract tree in the entry", () => {
    const tree = sourceFiles({ dir: join(repoRoot, CONTRACT_TREE) }).map((file) => relative(repoRoot, file));
    const entry = readFileSync(join(repoRoot, CONTRACT_ENTRY), "utf8");
    expect(tree.length).toBeGreaterThan(0);
    const orphans = tree.filter((path) => {
      const specifier = `./${path.slice("src/".length).replace(/\.ts$/u, ".js")}`;
      return !entry.includes(`from "${specifier}"`);
    });
    expect(orphans).toEqual([]);
  });

  it("finds a tree module named by a static import, a dynamic import or a variable", () => {
    const viaVariable = 'const area = "./stateHome/corpus.js";\nconst { corpusStateHomePaths } = await import(area);';
    expect(treeReferencesIn({ path: "src/consumer.ts", source: viaVariable })).toEqual(["./stateHome/corpus.js"]);
    const staticAndDynamic = 'import { x } from "../stateHome/live.js";\nawait import(`../stateHome/ledgers.js`);';
    expect(treeReferencesIn({ path: "src/talk/consumer.ts", source: staticAndDynamic })).toEqual([
      "../stateHome/live.js",
      "../stateHome/ledgers.js",
    ]);
    const entryAndLookAlikes = 'import { s } from "./stateHome.js";\nimport { t } from "./stateHomeX/corpus.js";';
    expect(treeReferencesIn({ path: "src/consumer.ts", source: entryAndLookAlikes })).toEqual([]);
  });

  it("decodes an escaped spelling before it judges the path", () => {
    const backslash = String.fromCharCode(92);
    // Each spelling is its own source, so the prefilter has no other line to match on.
    const spellings = [
      `import { a } from "./state${backslash}u0048ome/corpus.js";`,
      `import { b } from './${backslash}x73tateHome/corpus.js';`,
      `import { c } from "./st${backslash}ateHome/corpus.js";`,
      `import { d } from "./stateHom${backslash}u{00065}/corpus.js";`,
      `import { e } from "./state${backslash}\nHome/corpus.js";`,
      `const f = "./${backslash}163tateHome${backslash}57corpus.js";`,
    ];
    expect(spellings.filter((source) => source.includes("stateHome"))).toEqual([]);
    expect(spellings.map((source) => treeReferencesIn({ path: "src/consumer.ts", source }))).toEqual(
      spellings.map(() => ["./stateHome/corpus.js"]),
    );
    const entity = 'export const ref = <div data-path="./stateH&#111;me/corpus.js" />;';
    expect(treeReferencesIn({ path: "src/consumer.tsx", source: entity })).toEqual(["./stateHome/corpus.js"]);
  });

  it("finds a tree module named by the fixed head of a template", () => {
    const slashed = "const m = await import(`../stateHome/${name}.js`);";
    expect(treeReferencesIn({ path: "src/talk/consumer.ts", source: slashed })).toEqual(["../stateHome/"]);
    const bare = "const n = await import(`../stateHome${rest}`);";
    expect(treeReferencesIn({ path: "src/talk/consumer.ts", source: bare })).toEqual(["../stateHome"]);
  });

  it("is reached from outside the tree only through the entry", () => {
    const bypasses: string[] = [];
    for (const { path, text } of scanned) {
      if (path === CONTRACT_ENTRY || path.startsWith(CONTRACT_TREE)) {
        continue;
      }
      for (const spelled of treeReferencesIn({ path, source: text })) {
        bypasses.push(`${path} names ${spelled}`);
      }
    }
    expect(bypasses).toEqual([]);
  });

  it("actually scans a meaningful number of source files in every tree (no walk is silently empty)", () => {
    const counts = SCANNED_TREES.map((tree) => scanned.filter((source) => source.tree === tree).length);
    expect(counts.every((count) => count > 20)).toBe(true);
  });
});
