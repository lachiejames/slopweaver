/**
 * What the FILES themselves look like — how long each one is, what it is called, and how many sit in one
 * directory. The three axes the owner wants kept in check: files and folders split appropriately with good
 * naming, and all files under 300 lines of code excluding comments and whitespace.
 *
 * A leaf, deliberately: it imports `./codebaseAtlas.js` for the tree of a path and nothing else, so
 * `./codebaseHealth.ts` can stand on it without a cycle. The division is the one the page itself proposes —
 * this module answers questions a reader could ask of one file in isolation, while `codebaseHealth.ts`
 * answers ones that only make sense across the tree (is it tested, does a rule govern it, what debt stands
 * in it).
 *
 * Pure: every function here is a fold over module rows a caller read off disk.
 */

import { treeOfPath } from "./codebaseAtlas.js";

/**
 * The owner's bar: all files under 300 lines of code excluding comments and whitespace.
 *
 * `file-size-ratchet` adopted this exact number, so the bar and the shipped cap agree today and the
 * two counts coincide. They stay two fields because `gateCap` is read off `MAX_FILE_LINES` live: if either
 * number moves, the page shows the distance rather than a single figure nobody can attribute.
 */
export const OWNER_CODE_LINE_BAR = 300;

/** How many rows each "worst offenders" list carries before it stops being a list and becomes a dump. */
const WORST_SHOWN = 20;

/** Below this many files, a directory's fan-out is not a splitting question. */
const FOLDER_FANOUT_FLOOR = 15;

/** Below this many occurrences, a repeated file name says nothing about naming. */
const REPEATED_NAME_FLOOR = 5;

/** One non-test module under `src/`, with what its own text and imports say about it. */
export interface HealthModule {
  /** The repo-relative path, e.g. `src/cli/commands/catalog/run.ts`. */
  readonly path: string;
  /**
   * Lines surviving comment and blank stripping, counted by `codeLinesOf` — the same function
   * `file-size-ratchet` measures with, so the owner's 300 bar and the shipped cap are read off one number.
   */
  readonly codeLines: number;
  /** How many of its imports reach `src/lib/` through the `#lib/…` subpath import. */
  readonly libAliasImports: number;
  /**
   * How many reach `src/lib/` by a RESOLVED relative specifier — counted after joining the specifier onto
   * the importing file's own directory, never by matching `../` in text. A file inside `src/lib/` importing
   * its own sibling is not counted: the subpath import exists for callers OUTSIDE the floor.
   */
  readonly libRelativeImports: number;
  /**
   * Whether the committed file-size floor holds this path in its EXEMPT half — a generated surface, or a
   * hand-maintained file whose tradeoff the owner signed, standing at a recorded ceiling rather than as debt to work off.
   *
   * Read off the floor, never off the file's own exemption MARKER, and the r3 review is why that
   * distinction is spelled out on the field: adding one marker line to a 400-line file already standing in
   * `offenders` moved it from debt to "frozen at its own exempt ceiling" while the floor's exempt array
   * stayed empty. A marker changes what the gate refuses; only a rebaseline changes what the floor records.
   * Passed in as data by the CLI edge rather than computed here, so this module stays a leaf that imports
   * nothing out of `src/devLint/`.
   */
  readonly exempt: boolean;
  /**
   * Whether the committed file-size floor holds a row for this path, in either half.
   *
   * Separate from {@link HealthModule.exempt} because a marker is not proof of a row: a brand-new generated
   * file the gate would REFUSE carries the marker and has no row at all, and the r2 review broke the first
   * cut of this page for calling such a file frozen.
   */
  readonly recorded: boolean;
}

/**
 * One file measured against the length bar.
 *
 * @internal — reached as a field of {@link LengthReport}, never named by a consumer.
 */
export interface FileLength {
  readonly path: string;
  readonly codeLines: number;
  /** Whether the floor's exempt half holds it — never a refactor this page should propose. */
  readonly exempt: boolean;
  /** Whether the committed floor actually holds a row for it, which is what "frozen" means. */
  readonly recorded: boolean;
}

/**
 * The length axis: the owner's bar, the shipped cap, and how far the tree is from each.
 *
 * @internal — reached as {@link CodebaseHealth.length}.
 */
export interface LengthReport {
  /** {@link OWNER_CODE_LINE_BAR} — the length the owner asked for. */
  readonly ownerBar: number;
  /** `file-size-ratchet`'s `MAX_FILE_LINES` — the same 300 today, read live so a divergence shows. */
  readonly gateCap: number;
  /** How many non-test modules exceed the owner's bar. */
  readonly overOwnerBar: number;
  /** How many exceed the shipped cap — the ones frozen on the ratchet's baseline, which only shrinks. */
  readonly overGateCap: number;
  /**
   * How many of {@link overOwnerBar} the floor records in its EXEMPT half: frozen at their own
   * recorded CEILING rather than held as debt that has to fall under the cap. Reported separately because
   * the page used to call all of them "frozen on its baseline" while eight were frozen by nothing at all,
   * and because a generated surface is never a refactor to propose.
   */
  readonly exemptOverBar: number;
  /**
   * How many of {@link overOwnerBar} the committed floor holds NO row for, exempt or not — files
   * `file-size-ratchet` refuses right now, because nothing has recorded them. In a tree whose CI is green
   * this is zero; a non-zero reading means the working tree is mid-change, and saying so is the difference
   * between a page that reports and a page that asserts. The debt count is
   * `overOwnerBar - exemptOverBar - unrecordedOverBar`.
   */
  readonly unrecordedOverBar: number;
  /** The longest files, longest first, capped for display. */
  readonly longest: readonly FileLength[];
}

/** One file name that recurs across the tree. */
export interface RepeatedName {
  /** The basename, e.g. `run.ts`. */
  readonly name: string;
  /** How many files carry it. */
  readonly files: number;
  /** How many distinct top-level `src/` trees it appears in. */
  readonly trees: number;
}

/** One directory and how many files sit directly in it. */
export interface FolderFanout {
  /** The repo-relative directory. */
  readonly dir: string;
  /** How many `.ts` files sit directly in it, not counting subdirectories. */
  readonly files: number;
}

/**
 * The last segment of a path.
 *
 * @param path a repo-relative path
 * @returns the file name, or `undefined` for an empty path
 */
function fileNameOf({ path }: { path: string }): string | undefined {
  const segments = path.split("/");
  return segments[segments.length - 1];
}

/**
 * Record that one more tree carries this file name.
 *
 * @param byName the accumulator, mutated in place
 * @param name the file name
 * @param path the module's path, whose tree is the value added
 */
function addTreeFor({ byName, name, path }: { byName: Map<string, Set<string>>; name: string; path: string }): void {
  let trees = byName.get(name);
  if (trees === undefined) {
    trees = new Set<string>();
    byName.set(name, trees);
  }
  const tree = treeOfPath({ path });
  if (tree !== undefined) {
    trees.add(tree);
  }
}

/**
 * How many files already carry this name.
 *
 * @param counts the tally so far
 * @param name the file name
 * @returns the count, zero when the name is new
 */
function countFor({ counts, name }: { counts: ReadonlyMap<string, number>; name: string }): number {
  const held = counts.get(name);
  if (held === undefined) {
    return 0;
  }
  return held;
}

/**
 * How many distinct trees carry this name.
 *
 * @param byName the per-name tree sets
 * @param name the file name
 * @returns the spread, zero when nothing recorded a tree for it
 */
function spreadOf({ byName, name }: { byName: ReadonlyMap<string, Set<string>>; name: string }): number {
  const trees = byName.get(name);
  if (trees === undefined) {
    return 0;
  }
  return trees.size;
}

/**
 * Which file names recur across the tree, and how many trees each spans.
 *
 * A name carried by many files in ONE tree is a local convention; the same name across many trees is the
 * naming question the page asks — a file whose name says what layer it is rather than what it holds.
 * This counts; it does not rule on which names are wrong.
 *
 * @param modules every non-test module
 * @returns the repeated names, most files first, capped for display
 */
export function repeatedNamesOf({ modules }: { modules: readonly HealthModule[] }): readonly RepeatedName[] {
  const byName = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const module of modules) {
    const name = fileNameOf({ path: module.path });
    if (name === undefined) {
      continue;
    }
    addTreeFor({ byName, name, path: module.path });
    counts.set(name, countFor({ counts, name }) + 1);
  }
  const out: RepeatedName[] = [];
  for (const [name, files] of counts.entries()) {
    if (files < REPEATED_NAME_FLOOR) {
      continue;
    }
    out.push({ files, name, trees: spreadOf({ byName, name }) });
  }
  return out
    .toSorted((left, right) => right.files - left.files || left.name.localeCompare(right.name))
    .slice(0, WORST_SHOWN);
}

/**
 * Which directories hold the most files directly.
 *
 * Direct children only, never recursive: a tree's total is already the tree row, and the splitting question
 * is about one directory a reader has to scroll through.
 *
 * @param modules every non-test module
 * @returns the widest directories, widest first, capped for display
 */
export function folderFanoutOf({ modules }: { modules: readonly HealthModule[] }): readonly FolderFanout[] {
  const counts = new Map<string, number>();
  for (const module of modules) {
    const segments = module.path.split("/");
    const dir = segments.slice(0, -1).join("/");
    let held = 0;
    const seen = counts.get(dir);
    if (seen !== undefined) {
      held = seen;
    }
    counts.set(dir, held + 1);
  }
  return [...counts.entries()]
    .filter(([, files]) => files >= FOLDER_FANOUT_FLOOR)
    .map(([dir, files]): FolderFanout => ({ dir, files }))
    .toSorted((left, right) => right.files - left.files || left.dir.localeCompare(right.dir))
    .slice(0, WORST_SHOWN);
}

/**
 * Measure the tree against the owner's 300 bar and against the shipped cap, which is the same number today.
 *
 * @param modules every non-test module
 * @param gateCap `file-size-ratchet`'s shipped cap, so the report carries what refuses today beside what the owner asked for
 * @returns the length axis
 */
export function lengthOf({ modules, gateCap }: { modules: readonly HealthModule[]; gateCap: number }): LengthReport {
  let overOwnerBar = 0;
  let overGateCap = 0;
  let exemptOverBar = 0;
  let unrecordedOverBar = 0;
  for (const module of modules) {
    if (module.codeLines > OWNER_CODE_LINE_BAR) {
      overOwnerBar += 1;
      if (!module.recorded) {
        unrecordedOverBar += 1;
      } else if (module.exempt) {
        exemptOverBar += 1;
      }
    }
    if (module.codeLines > gateCap) {
      overGateCap += 1;
    }
  }
  return {
    exemptOverBar,
    gateCap,
    longest: modules
      .map((module): FileLength => ({
        codeLines: module.codeLines,
        exempt: module.exempt,
        path: module.path,
        recorded: module.recorded,
      }))
      .toSorted((left, right) => right.codeLines - left.codeLines || left.path.localeCompare(right.path))
      .slice(0, WORST_SHOWN),
    overGateCap,
    overOwnerBar,
    ownerBar: OWNER_CODE_LINE_BAR,
    unrecordedOverBar,
  };
}
