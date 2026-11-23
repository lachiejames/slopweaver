/**
 * `slopweaver catalog health` — the codebase atlas's second half: what state the code is in.
 *
 * `catalog trees` says where the code lives. This verb says what is tested, what a rule governs, what the
 * committed ratchets carry as standing debt, and where the tree has drifted from a pattern it declared for
 * itself — and it ranks the gaps so the answer is work rather than a wall of numbers.
 *
 * The effectful edge is this file and `./healthDebt.ts`: this one lists the working tree, reads the bytes
 * and resolves each import specifier against the importing file's own directory, that one reads the
 * committed ratchets and the gate plan, and `codebaseHealth` folds both purely. The split is the file-size
 * gate's own doing — teaching this verb to read the file-size FLOOR rather than infer it from an exemption
 * marker pushed the single file past the 300-line cap, along the seam the two halves already had.
 *
 * **Why the import counting resolves rather than greps.** A text match on `from "../../lib/` cannot tell a
 * file inside `src/lib/` importing its own sibling from a real cross-tree reach, and misses `./lib/` from a
 * loose `src/*.ts` entirely. Measured on this tree before the resolution was written: the grep answered
 * 4,348 relative reaches. Reproduce the grep with
 * `grep -rhE 'from "(\.\./)+lib/' src --include='*.ts' | wc -l`, and this verb's own figure with
 * `slopweaver catalog health --json | jq '.totals'`; the difference is the sibling imports the grep counted.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { type AreaRuleFile } from "../../../canon/codebaseAtlas.js";
import { codebaseHealth } from "../../../canon/codebaseHealth.js";
import { type HealthModule } from "../../../canon/codeShape.js";
import { type TestReach } from "../../../canon/treeHealth.js";
import { codeLinesOf } from "../../../devLint/duplicateWindows.js";
import { BASELINE_FILE, type FileSizeBaseline, parseBaselineJson } from "../../../devLint/fileSizeRatchet.js";
import { repoRootFromDirectory, workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { renderCodebaseHealth, renderCodebaseHealthJson } from "../../catalogHealth.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { debtListsOf, gateCensusOf } from "./healthDebt.js";

const USAGE = "usage: slopweaver catalog health [--json]";

/**
 * Every flag this verb accepts, exported so `helpTruth` compares its behaviour rather than its prose.
 *
 * One flag, for `catalog trees`' own reason: the health atlas describes the checkout the process is
 * standing in, so there is no `--home`, no `--repo` and nothing to select.
 */
export const CATALOG_HEALTH_FLAG_NAMES: readonly string[] = ["--json"];

/**
 * Parse the verb tail through the real parser the runner uses.
 *
 * @param rest the verb tail, after `slopweaver catalog health`
 * @returns whether `--json` was asked for, or the parse errors
 */
export function parseCatalogHealthArgs({ rest }: { rest: readonly string[] }): Result<{ json: boolean }> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: { boolean: ["json"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.values["json"] === true });
}

/**
 * Every `.ts` import specifier in a file, comment lines stripped.
 *
 * The same text-level reading `src/canon/codebaseAtlas.ts` does and for the same reason: a path named in a
 * comment must never mint an edge no code creates.
 *
 * @param content the file's text
 * @returns each specifier as written
 */
function specifiersOf({ content }: { content: string }): readonly string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) {
      continue;
    }
    for (const match of line.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
      const spec = match[1];
      if (spec !== undefined) {
        out.push(spec);
      }
    }
  }
  return out;
}

/**
 * Resolve one specifier against the importing file, as a repo-relative `.ts` path.
 *
 * ESM specifiers in this tree carry `.js`, which is the compiled name of the `.ts` beside it, so the
 * extension is rewritten rather than guessed.
 *
 * **`#lib/…` resolves too, and leaving it out is a measurable error rather than a rounding one.** MEASURED
 * on this tree (repro: `slopweaver catalog health --json | jq '[.trees[].reachedByTest] | add'`,
 * against the same build with the alias leg below deleted): counting only relative specifiers answered
 * 3,201 modules reached by a test where resolving the alias as well answers 3,204 — three modules a test
 * imports on the subpath and nothing else, which a relative-only walk reports as untested forever.
 * `package.json` declares the subpath as `src/lib/`.
 *
 * @param from the importing file's repo-relative path
 * @param spec the specifier as written
 * @returns the repo-relative source path, or `undefined` when the specifier reaches outside this repo
 */
export function resolveSpecifier({ from, spec }: { from: string; spec: string }): string | undefined {
  if (spec.startsWith(LIB_ALIAS)) {
    return `src/lib/${spec.slice(LIB_ALIAS.length)}`.replace(/\.js$/, ".ts");
  }
  if (!spec.startsWith(".")) {
    return undefined;
  }
  return posix.normalize(posix.join(posix.dirname(from), spec)).replace(/\.js$/, ".ts");
}

/** The subpath import `package.json` declares for `src/lib/`. */
const LIB_ALIAS = "#lib/";

/**
 * One module's reach into the shared floor.
 *
 * A file already inside `src/lib/` is counted as reaching it zero times however it spells its siblings: the
 * subpath import exists for callers OUTSIDE the floor, so counting a sibling as unconverted debt would put
 * the floor permanently at the top of a list nobody should act on.
 *
 * @param path the module's repo-relative path
 * @param content its text
 * @returns the module row the fold takes
 */
function healthModuleOf({ path, content }: { path: string; content: string }): HealthModule {
  const insideLib = path.startsWith("src/lib/");
  let alias = 0;
  let relative = 0;
  for (const spec of specifiersOf({ content })) {
    if (spec.startsWith("#lib/")) {
      alias += 1;
      continue;
    }
    if (insideLib) {
      continue;
    }
    const resolved = resolveSpecifier({ from: path, spec });
    if (resolved?.startsWith("src/lib/") === true) {
      relative += 1;
    }
  }
  return {
    codeLines: codeLinesOf({ content }).length,
    exempt: false,
    libAliasImports: alias,
    libRelativeImports: relative,
    path,
    recorded: false,
  };
}

/**
 * Split a decoded floor into the two sets the page reads it for. Pure, and exported so the classification
 * this whole branch is about is testable without a filesystem.
 *
 * A path standing in BOTH arrays counts as an exempt ceiling, which is the only reading consistent with the
 * gate: `regressionsOf` already holds such a path to the tightest row in either half, so the page
 * would otherwise call a file debt that the floor is deliberately freezing.
 *
 * @param baseline the decoded floor
 * @returns every recorded path, and the subset the exempt half records
 */
export function floorSetsOf({ baseline }: { baseline: FileSizeBaseline }): {
  readonly recorded: ReadonlySet<string>;
  readonly exemptCeilings: ReadonlySet<string>;
} {
  const exemptCeilings = new Set(baseline.exempt.map((row) => row.path));
  const recorded = new Set([...baseline.offenders.map((row) => row.path), ...exemptCeilings]);
  return { exemptCeilings, recorded };
}

/**
 * Whether a path entry exists at all, following no symlink.
 *
 * `readFileSync` answers `ENOENT` for a DANGLING SYMLINK exactly as it does for a name nothing occupies,
 * and the r3 review is why those are told apart here: a floor symlinked at something that is not there IS a
 * floor the page cannot read, and reporting it as "there is no floor" turned an unreadable file into a
 * confident "every long file in this tree is on no baseline row". `lstatSync` sees the link itself.
 *
 * @param path the absolute path to test
 * @returns true when something occupies the name, link or file
 */
function pathEntryExists({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which paths the file-size floor holds a row for, and which of those rows sit in its EXEMPT half.
 *
 * Every claim this page makes about a long file is a claim about the BASELINE, so both flags are read off
 * the baseline and neither is inferred from the file's own text. Two reviews broke earlier cuts of this on
 * exactly that seam. The r2 pass caught an exemption marker standing in for a recorded ceiling, so a
 * brand-new 2,000-line generated file the gate would REFUSE rendered as "frozen at its own exempt ceiling"
 * before anybody had rebaselined it. The r3 pass caught the other half: membership was read off the floor
 * but the exempt CLASSIFICATION was still read off the marker, so adding one comment line to a 400-line
 * file already standing in `offenders` moved it from debt to "frozen at its own exempt ceiling" while the
 * floor's exempt array stayed empty.
 *
 * The ways to have no rows are NOT the same, and the r3 review is why this distinguishes them. A floor that
 * does NOT EXIST records nothing, so the empty set is simply true. A floor that is there and cannot be read
 * — unparseable, or unreadable for any other reason the filesystem gives — is a fact this reader does not
 * have, and answering the empty set turns it into a confident per-file claim: one malformed row, or one
 * `chmod 000`, printed "no baseline row — the gate refuses this today" under every long file in the tree,
 * including the hundreds a valid row held. Only `ENOENT` means absent; every other errno is reported.
 *
 * @param root the repository root
 * @returns the recorded paths and the exempt-ceiling paths, or the problem when a floor that IS there cannot be read
 */
function floorRowsOf({ root }: { root: string }): Result<{
  readonly recorded: ReadonlySet<string>;
  readonly exemptCeilings: ReadonlySet<string>;
}> {
  const baselinePath = join(root, BASELINE_FILE);
  let text: string;
  try {
    text = readFileSync(baselinePath, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT" && !pathEntryExists({ path: baselinePath })) {
      return ok({ exemptCeilings: new Set(), recorded: new Set() });
    }
    return err([`${BASELINE_FILE}: ${String(cause)}`]);
  }
  const baseline = parseBaselineJson({ text });
  if (baseline.isErr()) {
    return err([`${BASELINE_FILE}: ${baseline.error.message}`]);
  }
  return ok(floorSetsOf({ baseline: baseline.value }));
}

/**
 * Every non-test `.ts` module under `src/`, read off disk.
 *
 * @param root the repository root
 * @param files every tracked and untracked working-tree path
 * @returns one row per module, or the floor's decode problem
 */
function modulesOf({ root, files }: { root: string; files: readonly string[] }): Result<readonly HealthModule[]> {
  const floor = floorRowsOf({ root });
  if (floor.isErr()) {
    return err(floor.error);
  }
  const { exemptCeilings, recorded } = floor.value;
  const out: HealthModule[] = [];
  for (const path of files) {
    if (!path.startsWith("src/") || !path.endsWith(".ts") || path.startsWith("src/__tests__/")) {
      continue;
    }
    const content = readFileSync(join(root, path), "utf8");
    out.push({ ...healthModuleOf({ content, path }), exempt: exemptCeilings.has(path), recorded: recorded.has(path) });
  }
  return ok(out);
}

/**
 * Every file under `src/__tests__/`, with the source paths its relative imports resolve to.
 *
 * The whole test TREE rather than `*.test.ts` only, because a shared fake or a fixture helper importing a
 * module is still a test naming it — and the mirror half of the signal reads the path, not the imports.
 *
 * @param root the repository root
 * @param files every working-tree path
 * @returns one row per test-tree file
 */
function testReachOf({ root, files }: { root: string; files: readonly string[] }): readonly TestReach[] {
  const out: TestReach[] = [];
  for (const path of files) {
    if (!path.startsWith("src/__tests__/") || !path.endsWith(".ts")) {
      continue;
    }
    const content = readFileSync(join(root, path), "utf8");
    const imports: string[] = [];
    for (const spec of specifiersOf({ content })) {
      const resolved = resolveSpecifier({ from: path, spec });
      if (resolved !== undefined) {
        imports.push(resolved);
      }
    }
    out.push({ imports, path });
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
 * Run the codebase-health verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCatalogHealth(argv: readonly string[]): number {
  const rest = argv.slice(3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseCatalogHealthArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: `catalog health: ${problem}` });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  // The same anchor `catalog trees` uses, for the same reason (`running-checkout-root`): the atlas
  // describes the checkout the process is STANDING in, never the one this module was copied into.
  const root = repoRootFromDirectory({ dir: process.cwd() });
  const files = workingTreeFilesOf({ root });
  // A floor that is THERE and unreadable is reported rather than drawn around: every "frozen" and every
  // "no baseline row" claim on this page is read off it, so a page rendered without it would be confidently
  // wrong about hundreds of files rather than short one.
  const modules = modulesOf({ files, root });
  if (modules.isErr()) {
    modules.error.forEach((problem) => {
      logger.error({ msg: `catalog health: ${problem}` });
    });
    return EXIT_ERROR;
  }
  const health = codebaseHealth({
    debtLists: debtListsOf({ root }),
    gates: gateCensusOf({ root }),
    modules: modules.value,
    observedAtIso: new Date().toISOString(),
    rules: areaRulesOf({ files, root }),
    testReach: testReachOf({ files, root }),
  });
  if (parsed.value.json) {
    logger.out({ line: renderCodebaseHealthJson({ health }) });
  } else {
    logger.out({ line: renderCodebaseHealth({ health }) });
  }
  return EXIT_OK;
}

export const catalogHealthCommand = defineCommand({ run: runCatalogHealth });
