/**
 * The effectful half of the write gate's canon nomination: find the repository a session is working in, and
 * read the always-on canon that loads beside its memory, split into sections.
 *
 * ## Which repository
 *
 * Claude Code keys auto-memory to the git repository and loads that repository's instructions into every
 * session that loads the memory, so the canon a memory can contradict is the canon of the repository the
 * writing session stands in — the hook payload's `cwd`. The root is the nearest ancestor holding `.git`, a
 * directory in a checkout and a FILE in a worktree, found by walking up rather than by spawning `git`: this
 * runs inside a `PreToolUse` hook, where a spawn is the cost the `session-subagent` register row measured.
 *
 * ## Which documents
 *
 * {@link alwaysOnPaths} decides, never a list here: the entry the host loads first, everything it `@`-imports,
 * and every rule that carries no `paths:`. A second opinion about what "always-on" means would be the copy
 * nobody runs the budget tests against.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { alwaysOnEntry, alwaysOnPaths, isPathScoped, splitFrontMatter } from "../canon/alwaysOnDocs.js";
import { type CanonSection, canonSections } from "./overlapNomination.js";

/** Where the rule files live, relative to the repository root. */
const RULES_DIR = join(".claude", "rules");

/**
 * The repository root holding `cwd`, or `null` when no ancestor holds a `.git`.
 *
 * @param cwd the directory the writing session stands in
 * @returns the nearest ancestor (or `cwd` itself) holding `.git`, or `null`
 */
export function repositoryRootOf({ cwd }: { cwd: string }): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** One repo-relative document's text, or `undefined` when it is absent or unreadable. */
function readRelative({ repo, path }: { repo: string; path: string }): string | undefined {
  try {
    return readFileSync(join(repo, path), "utf8");
  } catch {
    return undefined;
  }
}

/** Every `.claude/rules/*.md` carrying no `paths:`, repo-relative and sorted. */
function unscopedRulesIn({ repo }: { repo: string }): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(join(repo, RULES_DIR)).toSorted();
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(RULES_DIR, name))
    .filter((path) => {
      const content = readRelative({ path, repo });
      return content !== undefined && !isPathScoped({ content });
    });
}

/**
 * Every section of the always-on canon for the repository holding `cwd`.
 *
 * Empty when `cwd` sits in no repository: a memory written from outside one has no canon beside it, and the
 * memory half of the nomination still runs.
 *
 * @param cwd the directory the writing session stands in
 * @returns the sections, document by document in load order
 */
export function readCanonSections({ cwd }: { cwd: string }): readonly CanonSection[] {
  const repo = repositoryRootOf({ cwd });
  if (repo === null) {
    return [];
  }
  const paths = alwaysOnPaths({
    entry: alwaysOnEntry({ exists: ({ path }) => existsSync(join(repo, path)) }),
    readDoc: ({ path }) => readRelative({ path, repo }),
    unscopedRules: unscopedRulesIn({ repo }),
  });
  return paths.flatMap((path): readonly CanonSection[] => {
    const content = readRelative({ path, repo });
    if (content === undefined) {
      return [];
    }
    // A rule's frontmatter is loader configuration, not canon a memory could contradict.
    return canonSections({ content: splitFrontMatter({ content }).body, path });
  });
}
