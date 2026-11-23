/**
 * Readers for the three verbs the codebase-health half of the atlas page runs.
 *
 * A sibling of `./read.ts` rather than more of it, and that split is the page's own subject applied to the
 * page: `read.ts` stood at 1,118 lines before this, which is past the length bar,
 * and three more readers would have taken it further from the thing it is about to render. Every rule
 * `read.ts`'s module doc states governs these too — refuse rather than substitute, never DROP a row, a
 * selection must carry its own denominator — so read that file first; this one states only what is
 * different.
 *
 * **What is different is that two of these payloads carry ABSENCE as a value.** `store share` reports a
 * register it deliberately did not measure, and `memory passes` reports a home no pass has ever run on.
 * Neither is a malformed reading, and a reader that refused them would turn the most interesting row on the
 * page into an error. So `homeBytes`, `daysSinceLastPass` and their neighbours are typed `| undefined` and
 * rendered as the absence they are, while the fields a tile's claim actually rests on still refuse.
 */

import { type Bag, bags, bool, isBag, num, str, sub } from "../../lib/bag";

/** One ranked gap, with the command that recomputes it. */
export interface HealthOpportunity {
  readonly kind: string;
  readonly subject: string;
  readonly headline: string;
  readonly measure: number;
  readonly command: string;
}

/** One tree's state: how much of it a test reaches, what a rule governs, what the ratchets hold against it. */
export interface HealthTree {
  readonly tree: string;
  readonly modules: number;
  readonly codeLines: number;
  readonly overOwnerBar: number;
  readonly mirrored: number;
  readonly reachedByTest: number;
  readonly rulePath: string | undefined;
  readonly libAliasImports: number;
  readonly libRelativeImports: number;
}

/** One committed ratchet list, and what it held at its own previous change. */
export interface HealthDebtList {
  readonly gate: string;
  readonly file: string;
  readonly total: number;
  /** The previous recorded total, absent when the list has only ever been written once. */
  readonly previousTotal: number | undefined;
  readonly previousSha: string | undefined;
}

/** One file name carried by enough modules to be a naming signal. */
export interface HealthRepeatedName {
  readonly name: string;
  readonly files: number;
  readonly trees: number;
}

/** One directory holding enough files to be a splitting signal. */
export interface HealthFolder {
  readonly dir: string;
  readonly files: number;
}

/** One file over the bar, longest first. */
export interface HealthLongFile {
  readonly path: string;
  readonly codeLines: number;
  /** Whether a marker excuses it the cap — never a refactor to propose. */
  readonly exempt: boolean;
  /** Whether the committed floor actually holds a row for it, which is what "frozen" means. */
  readonly recorded: boolean;
}

/** What `catalog health` reports. */
export interface CodebaseHealth {
  readonly modules: number;
  readonly trees: number;
  readonly codeLines: number;
  readonly reachedByTest: number;
  readonly mirrored: number;
  readonly treesWithRule: number;
  readonly debtEntries: number;
  readonly libAliasImports: number;
  readonly libRelativeImports: number;
  readonly ownerBar: number;
  readonly gateCap: number;
  readonly overOwnerBar: number;
  readonly overGateCap: number;
  readonly exemptOverBar: number;
  readonly unrecordedOverBar: number;
  readonly longest: readonly HealthLongFile[];
  readonly gatesRegistered: number;
  readonly gatesDeclared: number;
  readonly treeRows: readonly HealthTree[];
  readonly debtLists: readonly HealthDebtList[];
  readonly repeatedNames: readonly HealthRepeatedName[];
  readonly folders: readonly HealthFolder[];
  readonly opportunities: readonly HealthOpportunity[];
}

/**
 * Read `catalog health --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the health reading, or `undefined` when the verb's shape moved
 */
export function readHealth(payload: unknown): CodebaseHealth | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const totals = sub({ bag: payload, key: "totals" });
  const length = sub({ bag: payload, key: "length" });
  const gates = sub({ bag: payload, key: "gates" });
  if (totals === undefined || length === undefined || gates === undefined) {
    return undefined;
  }
  const treeRows = readTrees({ rows: bags({ bag: payload, key: "trees" }) });
  const debtLists = readDebtLists({ rows: bags({ bag: payload, key: "debtLists" }) });
  const opportunities = readOpportunities({ rows: bags({ bag: payload, key: "opportunities" }) });
  const repeatedNames = readRepeatedNames({ rows: bags({ bag: payload, key: "repeatedNames" }) });
  const folders = readFolders({ rows: bags({ bag: payload, key: "folders" }) });
  const longest = readLongest({ rows: bags({ bag: length, key: "longest" }) });
  const counted = {
    codeLines: num({ bag: totals, key: "codeLines" }),
    debtEntries: num({ bag: totals, key: "debtEntries" }),
    gateCap: num({ bag: length, key: "gateCap" }),
    gatesDeclared: num({ bag: gates, key: "declared" }),
    gatesRegistered: num({ bag: gates, key: "registered" }),
    libAliasImports: num({ bag: totals, key: "libAliasImports" }),
    libRelativeImports: num({ bag: totals, key: "libRelativeImports" }),
    mirrored: num({ bag: totals, key: "mirrored" }),
    modules: num({ bag: totals, key: "modules" }),
    exemptOverBar: num({ bag: length, key: "exemptOverBar" }),
    unrecordedOverBar: num({ bag: length, key: "unrecordedOverBar" }),
    overGateCap: num({ bag: length, key: "overGateCap" }),
    overOwnerBar: num({ bag: length, key: "overOwnerBar" }),
    ownerBar: num({ bag: length, key: "ownerBar" }),
    reachedByTest: num({ bag: totals, key: "reachedByTest" }),
    trees: num({ bag: totals, key: "trees" }),
    treesWithRule: num({ bag: totals, key: "treesWithRule" }),
  };
  if (Object.values(counted).some((value) => value === undefined)) {
    return undefined;
  }
  if (
    treeRows === undefined ||
    debtLists === undefined ||
    opportunities === undefined ||
    repeatedNames === undefined ||
    folders === undefined ||
    longest === undefined
  ) {
    return undefined;
  }
  return {
    codeLines: Number(counted.codeLines),
    debtEntries: Number(counted.debtEntries),
    debtLists,
    exemptOverBar: Number(counted.exemptOverBar),
    folders,
    gateCap: Number(counted.gateCap),
    gatesDeclared: Number(counted.gatesDeclared),
    gatesRegistered: Number(counted.gatesRegistered),
    libAliasImports: Number(counted.libAliasImports),
    libRelativeImports: Number(counted.libRelativeImports),
    longest,
    mirrored: Number(counted.mirrored),
    modules: Number(counted.modules),
    opportunities,
    overGateCap: Number(counted.overGateCap),
    overOwnerBar: Number(counted.overOwnerBar),
    ownerBar: Number(counted.ownerBar),
    reachedByTest: Number(counted.reachedByTest),
    repeatedNames,
    treeRows,
    trees: Number(counted.trees),
    treesWithRule: Number(counted.treesWithRule),
    unrecordedOverBar: Number(counted.unrecordedOverBar),
  };
}

/**
 * Read every tree row, refusing the whole list if one is malformed.
 *
 * @param rows the verb's `trees` array
 * @returns the rows, or `undefined`
 */
function readTrees({ rows }: { rows: readonly Bag[] | undefined }): readonly HealthTree[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: HealthTree[] = [];
  for (const row of rows) {
    const tree = str({ bag: row, key: "tree" });
    const modules = num({ bag: row, key: "modules" });
    const codeLines = num({ bag: row, key: "codeLines" });
    const overOwnerBar = num({ bag: row, key: "overOwnerBar" });
    const mirrored = num({ bag: row, key: "mirrored" });
    const reachedByTest = num({ bag: row, key: "reachedByTest" });
    const libAliasImports = num({ bag: row, key: "libAliasImports" });
    const libRelativeImports = num({ bag: row, key: "libRelativeImports" });
    if (
      tree === undefined ||
      modules === undefined ||
      codeLines === undefined ||
      overOwnerBar === undefined ||
      mirrored === undefined ||
      reachedByTest === undefined ||
      libAliasImports === undefined ||
      libRelativeImports === undefined
    ) {
      return undefined;
    }
    out.push({
      codeLines,
      libAliasImports,
      libRelativeImports,
      mirrored,
      modules,
      overOwnerBar,
      reachedByTest,
      rulePath: str({ bag: row, key: "rulePath" }),
      tree,
    });
  }
  return out;
}

/**
 * Read every debt list. `previous` is genuinely optional — a list written once has no earlier total, and
 * reporting that as a zero would read as a ratchet that has never moved.
 *
 * @param rows the verb's `debtLists` array
 * @returns the rows, or `undefined`
 */
function readDebtLists({ rows }: { rows: readonly Bag[] | undefined }): readonly HealthDebtList[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: HealthDebtList[] = [];
  for (const row of rows) {
    const gate = str({ bag: row, key: "gate" });
    const file = str({ bag: row, key: "file" });
    const total = num({ bag: row, key: "total" });
    if (gate === undefined || file === undefined || total === undefined) {
      return undefined;
    }
    const previous = sub({ bag: row, key: "previous" });
    let previousTotal: number | undefined;
    let previousSha: string | undefined;
    if (previous !== undefined) {
      previousTotal = num({ bag: previous, key: "total" });
      previousSha = str({ bag: previous, key: "sha" });
    }
    out.push({ file, gate, previousSha, previousTotal, total });
  }
  return out;
}

/**
 * Read every ranked opportunity. `command` is required, not optional: every
 * number name the command that recomputes it, so a row without one is a shape change rather than a row.
 *
 * @param rows the verb's `opportunities` array
 * @returns the rows, or `undefined`
 */
function readOpportunities({ rows }: { rows: readonly Bag[] | undefined }): readonly HealthOpportunity[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: HealthOpportunity[] = [];
  for (const row of rows) {
    const kind = str({ bag: row, key: "kind" });
    const subject = str({ bag: row, key: "subject" });
    const headline = str({ bag: row, key: "headline" });
    const command = str({ bag: row, key: "command" });
    const measure = num({ bag: row, key: "measure" });
    if (
      kind === undefined ||
      subject === undefined ||
      headline === undefined ||
      command === undefined ||
      measure === undefined
    ) {
      return undefined;
    }
    out.push({ command, headline, kind, measure, subject });
  }
  return out;
}

/**
 * Read the repeated-name rows.
 *
 * @param rows the verb's `repeatedNames` array
 * @returns the rows, or `undefined`
 */
function readRepeatedNames({ rows }: { rows: readonly Bag[] | undefined }): readonly HealthRepeatedName[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: HealthRepeatedName[] = [];
  for (const row of rows) {
    const name = str({ bag: row, key: "name" });
    const files = num({ bag: row, key: "files" });
    const trees = num({ bag: row, key: "trees" });
    if (name === undefined || files === undefined || trees === undefined) {
      return undefined;
    }
    out.push({ files, name, trees });
  }
  return out;
}

/**
 * Read the folder-fanout rows.
 *
 * @param rows the verb's `folders` array
 * @returns the rows, or `undefined`
 */
function readFolders({ rows }: { rows: readonly Bag[] | undefined }): readonly HealthFolder[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: HealthFolder[] = [];
  for (const row of rows) {
    const dir = str({ bag: row, key: "dir" });
    const files = num({ bag: row, key: "files" });
    if (dir === undefined || files === undefined) {
      return undefined;
    }
    out.push({ dir, files });
  }
  return out;
}

/**
 * Read the longest-file rows.
 *
 * @param rows the `length.longest` array
 * @returns the rows, or `undefined`
 */
function readLongest({ rows }: { rows: readonly Bag[] | undefined }): readonly HealthLongFile[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: HealthLongFile[] = [];
  for (const row of rows) {
    const path = str({ bag: row, key: "path" });
    const codeLines = num({ bag: row, key: "codeLines" });
    const exempt = bool({ bag: row, key: "exempt" });
    const recorded = bool({ bag: row, key: "recorded" });
    if (path === undefined || codeLines === undefined || exempt === undefined || recorded === undefined) {
      return undefined;
    }
    out.push({ codeLines, exempt, path, recorded });
  }
  return out;
}
