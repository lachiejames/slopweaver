/**
 * `slopweaver catalog trees` — the CODEBASE ATLAS: which code lives where.
 *
 * `slopweaver catalog` answers "what can this system do". This verb answers the other question a reader
 * arrives with — "where does the code that does it live" — and it answers it by WALKING the tree rather
 * than by reading a list somebody wrote down. Every tree, every module count, every cross-tree import edge
 * and every CLI noun reaching a tree is derived here and now; only the one-line blurbs are declared, and a
 * unit test fails when they stop matching the tree.
 *
 * The effectful edge is this file and nothing else: it lists the working tree, reads the bytes, and hands
 * them to the pure `codebaseAtlas` fold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type AreaRuleFile,
  codebaseAtlas,
  type ModuleReach,
  reachedTreesOf,
  type SkillFile,
  treeOfPath,
} from "../../../canon/codebaseAtlas.js";
import { repoRootFromDirectory, workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { renderTreeAtlas, renderTreeAtlasJson } from "../../catalog.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

const USAGE = "usage: slopweaver catalog trees [--json]";

/**
 * Every flag this verb accepts, exported so `helpTruth` compares its behaviour rather than its prose.
 *
 * One flag, and that is the whole surface: the atlas describes the checkout the code is in, so there is no
 * `--home`, no `--repo` and nothing to select. A reader either wants the table or the document.
 */
export const CATALOG_TREES_FLAG_NAMES: readonly string[] = ["--json"];

/**
 * Parse the verb tail through the real parser the runner uses.
 *
 * Positionals are allowed (and ignored) because the router hands the whole tail down, `trees` included —
 * the same reason `catalog`'s own verb does it for its bare-noun alias. An unknown FLAG is still refused.
 *
 * @param rest the verb tail, after `slopweaver catalog trees`
 * @returns whether `--json` was asked for, or the parse errors
 */
export function parseCatalogTreesArgs({ rest }: { rest: readonly string[] }): Result<{ json: boolean }> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: { boolean: ["json"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.values["json"] === true });
}

/**
 * Every non-test `.ts` module under `src/`, with the trees each one's imports reach.
 *
 * @param root the repository root
 * @param files every tracked and untracked working-tree path
 * @returns one entry per scanned module
 */
function modulesOf({ root, files }: { root: string; files: readonly string[] }): readonly ModuleReach[] {
  const out: ModuleReach[] = [];
  for (const path of files) {
    if (treeOfPath({ path }) === undefined) {
      continue;
    }
    const content = readFileSync(join(root, path), "utf8");
    out.push({ path, reaches: reachedTreesOf({ content, path }) });
  }
  return out;
}

/**
 * Every `.claude/rules/area-*.md`, read off disk.
 *
 * @param root the repository root
 * @param files every working-tree path
 * @returns one entry per area rule
 */
function areaRulesOf({ root, files }: { root: string; files: readonly string[] }): readonly AreaRuleFile[] {
  return files
    .filter((path) => /^\.claude\/rules\/area-[^/]+\.md$/.test(path))
    .map((path) => ({ content: readFileSync(join(root, path), "utf8"), path }));
}

/**
 * Every `skills/<name>/SKILL.md`, with how many reference files sit beside it.
 *
 * @param root the repository root
 * @param files every working-tree path
 * @returns one entry per skill, in whatever order the listing gave — the fold sorts them
 */
function skillsOf({ root, files }: { root: string; files: readonly string[] }): readonly SkillFile[] {
  const out: SkillFile[] = [];
  for (const path of files) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    if (match === null) {
      continue;
    }
    const name = match[1];
    if (name === undefined) {
      continue;
    }
    const prefix = `skills/${name}/reference/`;
    out.push({
      content: readFileSync(join(root, path), "utf8"),
      name,
      referenceFiles: files.filter((other) => other.startsWith(prefix) && other.endsWith(".md")).length,
    });
  }
  return out;
}

/**
 * Run the codebase-atlas verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCatalogTrees(argv: readonly string[]): number {
  const rest = argv.slice(3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseCatalogTreesArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: `catalog trees: ${problem}` });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  // The atlas describes the checkout the process is STANDING in, not the one this module was copied into.
  // `running-checkout-root` is why: a module-anchored lookup makes a worktree silently resolve another
  // tree, and a plugin mirror carries no `.git` at all. Run the verb from the repository you want described.
  const root = repoRootFromDirectory({ dir: process.cwd() });
  const files = workingTreeFilesOf({ root });
  const atlas = codebaseAtlas({
    modules: modulesOf({ files, root }),
    rules: areaRulesOf({ files, root }),
    skills: skillsOf({ files, root }),
  });
  if (parsed.value.json) {
    logger.out({ line: renderTreeAtlasJson({ atlas }) });
  } else {
    logger.out({ line: renderTreeAtlas({ atlas }) });
  }
  return EXIT_OK;
}

export const catalogTreesCommand = defineCommand({ run: runCatalogTrees });
