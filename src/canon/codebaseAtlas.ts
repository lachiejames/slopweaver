/**
 * The CODEBASE ATLAS — which code lives where, derived from the tree rather than transcribed from it.
 *
 * ## The rot this exists to stop
 *
 * `AGENTS.md` refuses to carry module lists and counts on purpose: they are wrong within a week, and a
 * module list that is wrong is a confident lie to the next session that reads it. The answer canon gives
 * today is `ls src` — true forever, and useless to a reader who wants to know what `src/silver/` is for.
 *
 * So the split here is the whole design. **The LIST is derived** — every top-level entry under `src/`, every
 * skill under `skills/`, every cross-tree import edge, every CLI noun that reaches a tree, and the
 * `paths:`-scoped area rule that governs it. **The one-line BLURB is declared** (`TREE_BLURBS`, `./treeBlurbs.ts`) and
 * gated against the derived list, so a tree added without a blurb fails, and a blurb naming a tree that has
 * been deleted or renamed fails too. Nothing here can quietly describe a tree that is not there.
 *
 * Everything in this file is pure: the caller reads the working tree and hands the bytes in.
 *
 * ## Why the reach is one hop, and what that means for the numbers
 *
 * An edge is a DIRECT import written in a file of one tree naming a file of another. Transitive reach was
 * deliberately not computed: through `#lib/` every tree reaches every other within three hops, so a
 * transitive map says "everything depends on everything" and draws nothing. One hop is what a reader can
 * check by opening the file, and it is what the map figure on the docs site is drawn from.
 *
 * The same one-hop rule is why `entryNouns` is wide for an infrastructure tree and narrow for a leaf. That
 * is the signal, not noise: `src/hex/` is reached by the `hex` noun alone, and `src/lib/` by nearly every
 * noun there is, which is exactly the difference between a subsystem and a shared floor.
 */

import { posix } from "node:path";

import { splitFrontMatter } from "./alwaysOnDocs.js";
import { areaRuleScope } from "./areaRules.js";
import { ROOT_TREE, TREE_BLURBS } from "./treeBlurbs.js";

/** One module and the top-level `src/` trees its own imports reach. */
export interface ModuleReach {
  /** The repo-relative path, e.g. `src/cli/commands/refresh/run.ts`. */
  readonly path: string;
  /** Every OTHER top-level tree this file imports from, deduped; never its own. */
  readonly reaches: readonly string[];
}

/** One `.claude/rules/area-*.md`, as read off disk. */
export interface AreaRuleFile {
  /** The repo-relative path. */
  readonly path: string;
  /** The file's full text, frontmatter included. */
  readonly content: string;
}

/** One `skills/<name>/SKILL.md`, as read off disk, plus how many reference files sit beside it. */
export interface SkillFile {
  /** The skill's directory name, which is also the `/slopweaver:<name>` trigger. */
  readonly name: string;
  /** The `SKILL.md` text, frontmatter included. */
  readonly content: string;
  /** How many `skills/<name>/reference/*.md` files the skill pushes detail into. */
  readonly referenceFiles: number;
}

/**
 * One top-level entry under `src/`, as the atlas reports it.
 *
 * Exported so the name is reachable, `@internal` because every consumer reaches it through
 * {@link CodebaseAtlas}`.trees` rather than by naming it.
 *
 * @internal
 */
export interface TreeEntry {
  /** The directory name, or {@link ROOT_TREE} for the loose files. */
  readonly tree: string;
  /** The declared one-liner: what lives there. */
  readonly blurb: string;
  /** How many non-test `.ts` modules it holds. */
  readonly modules: number;
  /** The CLI nouns whose commands import it, heaviest first — the verbs a reader enters it through. */
  readonly entryNouns: readonly string[];
  /** The `paths:`-scoped area rule governing it, absent when no rule names it. */
  readonly rulePath: string | undefined;
  /** The other trees it imports from, heaviest edge first. */
  readonly dependsOn: readonly string[];
  /** The other trees that import IT, heaviest edge first. */
  readonly dependedOnBy: readonly string[];
}

/**
 * One skill on the command surface.
 *
 * Exported so the name is reachable, `@internal` because every consumer reaches it through
 * {@link CodebaseAtlas}`.skills` rather than by naming it.
 *
 * @internal
 */
export interface SkillEntry {
  readonly name: string;
  /** The first sentence of the skill's own `description:` — what it is, before the "use when" clauses. */
  readonly blurb: string;
  readonly referenceFiles: number;
}

/** The whole atlas: every tree, every skill, and the edges between the trees. */
export interface CodebaseAtlas {
  readonly trees: readonly TreeEntry[];
  readonly skills: readonly SkillEntry[];
  /** Every one-hop cross-tree import edge, heaviest first. */
  readonly edges: readonly TreeEdge[];
}

/**
 * One directed, weighted, one-hop import edge between two top-level trees.
 *
 * Exported so the name is reachable, `@internal` because every consumer reaches it through
 * {@link CodebaseAtlas}`.edges` rather than by naming it.
 *
 * @internal
 */
export interface TreeEdge {
  readonly from: string;
  readonly to: string;
  /** How many modules of `from` import at least one module of `to`. */
  readonly modules: number;
}

/**
 * Which top-level `src/` entry a repo-relative path belongs to.
 *
 * @param path a repo-relative path, which may name anything at all
 * @returns the tree name, {@link ROOT_TREE} for a loose `src/*.ts`, or `undefined` for a path outside the
 *   scanned source — anything not under `src/`, and the whole `src/__tests__/` lane, which is the four test
 *   lanes rather than a subsystem
 */
export function treeOfPath({ path }: { path: string }): string | undefined {
  if (!path.startsWith("src/") || !path.endsWith(".ts")) {
    return undefined;
  }
  const parts = path.split("/");
  if (parts.length === 2) {
    return ROOT_TREE;
  }
  const tree = parts[1];
  if (tree === undefined || tree === "__tests__") {
    return undefined;
  }
  return tree;
}

/** Matches every module specifier a file names, static and dynamic alike. */
const SPECIFIERS = /(?:\bfrom\s*"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\))/g;

/** A line that is nothing but a comment: `//`, a block opener, or a JSDoc continuation. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * The file's text with its comment-ONLY lines removed, so prose cannot mint an import edge.
 *
 * The r1 review of this module's own diff found the class: {@link SPECIFIERS} reads raw text, so a JSDoc
 * line reading ``the reader imported from "../../corpus/corpusStore.js"`` would weight a `live → corpus`
 * edge that no code creates — and the map figure on the docs site is drawn from those weights. Measured once,
 * four such lines stood in this tree (reproduce with
 * `grep -rnE '^\s*(\*|//).*from "\.' src --include='*.ts'`) and all four happened to resolve to their own
 * file's tree or outside `src/`, so the atlas was one ordinary comment away from asserting a dependency
 * that does not exist.
 *
 * Comment-ONLY lines rather than a full comment strip, and that bound is the whole reason this is safe: a
 * real `import` statement's every line either begins the statement or continues it (`} from "./x.js";`),
 * and none of those can start with `//`, `/*` or `*`. So the filter cannot drop a real specifier, which a
 * regex trying to strip block comments in general could.
 *
 * @param content the module's full text
 * @returns the same text with comment-only lines dropped
 */
function withoutCommentLines({ content }: { content: string }): string {
  return content
    .split("\n")
    .filter((line) => !COMMENT_LINE.test(line))
    .join("\n");
}

/**
 * The specifier one `SPECIFIERS` match carries, from whichever of its two alternates fired.
 *
 * Written as early returns rather than a ternary or a `??`: the first is what `prefer-nullish-coalescing`
 * rewrites into the second, and the second is what `no-silent-fallback` refuses. An `if` naming the absent
 * alternate satisfies both, which is the shape both rules were actually asking for.
 *
 * @param match one `String.matchAll` result, whose groups are the static and the dynamic specifier
 * @returns the specifier, or `undefined` when neither group matched
 */
function specifierOf({ match }: { match: RegExpExecArray }): string | undefined {
  const staticSpec = match[1];
  if (staticSpec !== undefined) {
    return staticSpec;
  }
  return match[2];
}

/**
 * The top-level `src/` trees one module's imports reach, excluding its own.
 *
 * Both spellings this repository uses are resolved: a relative specifier against the importing file's own
 * directory, and the `#lib/…` subpath import `package.json` declares. A bare package specifier names a
 * dependency rather than a tree and is skipped, which is why the result is a subset rather than a total.
 *
 * A **type-only** import counts, deliberately. The edge this reports is IMPORTS-FROM, never CALLS: 5,791 of
 * this tree's 34,280 import statements are `import type`, and a tree that has to know another's shapes is
 * coupled to it whether or not a byte survives to runtime. Every surface drawing these edges says
 * "imports", so the claim and the measurement are the same sentence. Re-take both counts with
 * `grep -rhcE '^import (type )?' src --include='*.ts'`.
 *
 * @param path the importing module's repo-relative path
 * @param content its full text
 * @returns the reached trees, sorted, with the module's own tree removed
 */
export function reachedTreesOf({ path, content }: { path: string; content: string }): readonly string[] {
  const own = treeOfPath({ path });
  const dir = posix.dirname(path);
  const reached = new Set<string>();
  for (const match of withoutCommentLines({ content }).matchAll(SPECIFIERS)) {
    const spec = specifierOf({ match });
    if (spec === undefined) {
      continue;
    }
    const resolved = resolveSpecifier({ dir, spec });
    if (resolved === undefined || resolved === own) {
      continue;
    }
    reached.add(resolved);
  }
  return [...reached].toSorted();
}

/**
 * The tree a single module specifier names.
 *
 * @param dir the importing file's own directory, repo-relative
 * @param spec the specifier exactly as written, `.js` extension included
 * @returns the tree, or `undefined` when the specifier names a package rather than a path in `src/`
 */
function resolveSpecifier({ dir, spec }: { dir: string; spec: string }): string | undefined {
  if (spec.startsWith("#lib/")) {
    return "lib";
  }
  if (!spec.startsWith(".")) {
    return undefined;
  }
  // Every specifier in this repository is written with the runtime's `.js`, so the path is rewritten back
  // to the `.ts` on disk before `treeOfPath` — which only accepts a source extension — is asked about it.
  const joined = posix.normalize(posix.join(dir, spec)).replace(/\.js$/, ".ts");
  return treeOfPath({ path: joined });
}

/**
 * The CLI noun a command module belongs to.
 *
 * @param path a repo-relative path
 * @returns the noun for a `src/cli/commands/<noun>/…` module, `undefined` for anything else
 */
export function nounOfCommandPath({ path }: { path: string }): string | undefined {
  const match = /^src\/cli\/commands\/([^/]+)\//.exec(path);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

/**
 * Orders two rule files by raw UTF-16 code units, never by locale: `localeCompare` calls two spellings of
 * one accented name equal, and a stable sort then hands the tie back to input order.
 *
 * @param left one rule file
 * @param right the other rule file
 * @returns negative, zero only for byte-identical paths, or positive
 */
function byCodeUnitPath(left: AreaRuleFile, right: AreaRuleFile): number {
  if (left.path < right.path) {
    return -1;
  }
  if (left.path > right.path) {
    return 1;
  }
  return 0;
}

/**
 * The area rule governing a tree, by its own `paths:` frontmatter rather than by its filename.
 *
 * Reading the globs rather than the name is what keeps this true through a rename: `area-handover.md`
 * already scopes itself to two trees, and a rule renamed without its globs moving would still govern what
 * it governs.
 *
 * The rule whose own heading names the tree wins over one that merely reaches into it with a supplemental
 * glob, whatever order the files arrive in: `area-handover.md` also scopes `src/cli/commands/handover/**`, and a
 * first-match walk handed that file before `area-cli.md` would have bound `cli` to it. Every tie — two
 * rules naming one tree, or two only reaching it — goes to the lowest path, so input order never decides.
 *
 * @param tree the top-level tree name
 * @param rules every area rule file
 * @returns the rule's repo-relative path, or `undefined` when no rule's globs cover the tree
 */
export function ruleForTree({ tree, rules }: { tree: string; rules: readonly AreaRuleFile[] }): string | undefined {
  const prefix = `src/${tree}/`;
  const scoped = rules
    .filter((rule) => areaRuleScope({ content: rule.content }).globs.some((glob) => glob.startsWith(prefix)))
    .toSorted(byCodeUnitPath);
  const named = scoped.find((rule) => areaRuleScope({ content: rule.content }).heading === prefix);
  if (named !== undefined) {
    return named.path;
  }
  const found = scoped[0];
  if (found === undefined) {
    return undefined;
  }
  return found.path;
}

/**
 * The first sentence of a skill's declared `description:`, as plain prose.
 *
 * A skill description is written for a dispatcher, so it runs on into "Use when…" and "Phrases like…"
 * clauses that are routing instructions rather than a description of the thing. The atlas wants the noun
 * phrase at the front, and nothing after it.
 *
 * The backticks come out here rather than out of the source file, and that is the point of doing it at the
 * fold: a `SKILL.md` frontmatter description is markdown, where a backtick is correct, while every surface
 * that renders THIS string draws it literally — a terminal table and a React table cell both. Stripping the
 * one markup token keeps the words and loses nothing a reader wanted. Measured once, one skill was
 * affected; reproduce the count with `slopweaver catalog trees --json`.
 *
 * @param content the `SKILL.md` text
 * @returns the first sentence with no markup, or the empty string when the file declares no description
 */
export function skillBlurb({ content }: { content: string }): string {
  const line = splitFrontMatter({ content }).frontMatter.find((entry) => entry.startsWith("description:"));
  if (line === undefined) {
    return "";
  }
  const described = line.slice("description:".length).trim().replaceAll("`", "");
  const stop = described.search(/\.\s|\.$/);
  if (stop === -1) {
    return described;
  }
  return described.slice(0, stop + 1);
}

/**
 * Sort a weighted tally into names, heaviest first and alphabetical within a weight.
 *
 * @param tally one entry per name, holding how many modules it was counted from
 * @returns the names in display order
 */
function heaviestFirst({ tally }: { tally: ReadonlyMap<string, number> }): readonly string[] {
  return [...tally.entries()]
    .toSorted((left, right) => {
      const byWeight = right[1] - left[1];
      if (byWeight !== 0) {
        return byWeight;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([name]) => name);
}

/** Add one to a name's running tally, minting the row when it is the first. */
function bump({ tally, name }: { tally: Map<string, number>; name: string }): void {
  const held = tally.get(name);
  if (held === undefined) {
    tally.set(name, 1);
    return;
  }
  tally.set(name, held + 1);
}

/**
 * The four running tallies one pass over the modules fills.
 *
 * Kept as one named shape because the pass that fills them and the two that read them are separate
 * functions now — the fold is a shell over three pure steps rather than one long body.
 *
 * @internal
 */
interface Tallies {
  readonly counts: Map<string, number>;
  readonly nouns: Map<string, Map<string, number>>;
  readonly outgoing: Map<string, Map<string, number>>;
  readonly incoming: Map<string, Map<string, number>>;
}

/** The inner tally for one key, minted on first reach. A missing row and an empty one mean the same thing. */
function nested({ outer, key }: { outer: Map<string, Map<string, number>>; key: string }): Map<string, number> {
  const held = outer.get(key);
  if (held !== undefined) {
    return held;
  }
  const minted = new Map<string, number>();
  outer.set(key, minted);
  return minted;
}

/**
 * One pass over every module, filling the four tallies the atlas is read out of.
 *
 * @param modules every non-test `.ts` module under `src/`, each with the trees it reaches
 * @returns the filled tallies
 */
function tallyModules({ modules }: { modules: readonly ModuleReach[] }): Tallies {
  const tallies: Tallies = {
    counts: new Map<string, number>(),
    incoming: new Map<string, Map<string, number>>(),
    nouns: new Map<string, Map<string, number>>(),
    outgoing: new Map<string, Map<string, number>>(),
  };
  for (const module of modules) {
    const tree = treeOfPath({ path: module.path });
    if (tree === undefined) {
      continue;
    }
    bump({ name: tree, tally: tallies.counts });
    const noun = nounOfCommandPath({ path: module.path });
    for (const reached of module.reaches) {
      bump({ name: reached, tally: nested({ key: tree, outer: tallies.outgoing }) });
      bump({ name: tree, tally: nested({ key: reached, outer: tallies.incoming }) });
      if (noun !== undefined) {
        bump({ name: noun, tally: nested({ key: reached, outer: tallies.nouns }) });
      }
    }
  }
  return tallies;
}

/**
 * Read the tallies out as one row per tree, alphabetically.
 *
 * @param rules every `.claude/rules/area-*.md`, for the `paths:`-glob binding
 * @returns one entry per tree, in display order
 */
function treeEntries({ tallies, rules }: { tallies: Tallies; rules: readonly AreaRuleFile[] }): readonly TreeEntry[] {
  return [...tallies.counts.keys()].toSorted().map((tree): TreeEntry => {
    const blurb = TREE_BLURBS[tree];
    // A tree with no row is a real, gated gap, so it renders empty rather than borrowing another tree's
    // words. Written as an `if` rather than a `??` or a ternary: `no-silent-fallback` refuses one and
    // `prefer-nullish-coalescing` rewrites the other into it.
    let described = "";
    if (blurb !== undefined) {
      described = blurb;
    }
    // Every key of `counts` was minted by the pass above, so the tally is always there. The `if` names that
    // unreachable absence instead of a `??` that would silently render a real tree as holding no modules.
    const counted = tallies.counts.get(tree);
    let modulesHeld = 0;
    if (counted !== undefined) {
      modulesHeld = counted;
    }
    return {
      blurb: described,
      dependedOnBy: heaviestFirst({ tally: nested({ key: tree, outer: tallies.incoming }) }),
      dependsOn: heaviestFirst({ tally: nested({ key: tree, outer: tallies.outgoing }) }),
      entryNouns: heaviestFirst({ tally: nested({ key: tree, outer: tallies.nouns }) }),
      modules: modulesHeld,
      rulePath: ruleForTree({ rules, tree }),
      tree,
    };
  });
}

/**
 * Flatten the outgoing tally into edges, heaviest first and alphabetical within a weight.
 *
 * @param outgoing one inner tally per source tree, keyed by the tree it reaches
 * @returns every one-hop cross-tree edge, in display order
 */
function edgeList({ outgoing }: { outgoing: Map<string, Map<string, number>> }): readonly TreeEdge[] {
  const edges: TreeEdge[] = [];
  for (const [from, targets] of outgoing.entries()) {
    for (const [to, count] of targets.entries()) {
      edges.push({ from, modules: count, to });
    }
  }
  return edges.toSorted((left, right) => {
    const byWeight = right.modules - left.modules;
    if (byWeight !== 0) {
      return byWeight;
    }
    return `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`);
  });
}

/**
 * Fold the working tree into the atlas.
 *
 * A tree with no declared blurb gets the empty string rather than an invented one, so the gate over
 * {@link TREE_BLURBS} is what reports it and this function never papers over the gap.
 *
 * @param modules every non-test `.ts` module under `src/`, each with the trees it reaches
 * @param rules every `.claude/rules/area-*.md`
 * @param skills every `skills/<name>/SKILL.md`
 * @returns the trees, the skills and the cross-tree edges, each in display order
 */
export function codebaseAtlas({
  modules,
  rules,
  skills,
}: {
  modules: readonly ModuleReach[];
  rules: readonly AreaRuleFile[];
  skills: readonly SkillFile[];
}): CodebaseAtlas {
  const tallies = tallyModules({ modules });
  return {
    edges: edgeList({ outgoing: tallies.outgoing }),
    skills: skills
      .map((skill): SkillEntry => ({
        blurb: skillBlurb({ content: skill.content }),
        name: skill.name,
        referenceFiles: skill.referenceFiles,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    trees: treeEntries({ rules, tallies }),
  };
}
