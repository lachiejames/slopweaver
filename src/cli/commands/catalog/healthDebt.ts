/**
 * What the committed RATCHETS carry — the debt half of `slopweaver catalog health`'s effectful edge.
 *
 * Split out of `./healthRun.ts` under the gate that is this branch's whole subject: that file grew past the
 * 300-line cap while the page it prints was being taught to read this repository's file-size floor, and the
 * seam was already there. This module answers questions about `.baselines/` and the gate plan; `healthRun.ts`
 * answers ones about the FILES. Neither reads the other's inputs.
 *
 * Effectful by design — it reads baseline files off disk and asks git what each one held before its last
 * change — and every decode inside it is a pure fold over text a caller supplied.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type DebtEntry, type DebtList, type DebtPrevious, type GateCensus } from "../../../canon/treeHealth.js";
import { checksForLane, lintChecks } from "../../../devLint/devLint.js";
import { MAX_FILE_LINES } from "../../../devLint/fileSizeMeasure.js";
import { DECLARED_LINT_GATES } from "../../../devLint/refusal/registry.js";
import { gitEnv } from "../../../lib/gitRepo.js";
import { parseJson } from "../../../lib/jsonParse.js";
import { isRecord } from "../../../lib/parsers.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * Which committed ratchet lists this verb reads, and under which key each holds its entries.
 *
 * Declared rather than discovered by globbing `.baselines/`, because the shape differs per file and a list
 * whose shape this module cannot read must be a visible omission rather than a silently skipped file. A
 * list with `key: undefined` records only a total and carries no paths, so it contributes to the debt
 * headline and to nothing per-tree.
 */
const DEBT_LISTS: readonly { readonly gate: string; readonly file: string; readonly key: string | undefined }[] = [
  { file: ".baselines/no-silent-fallback-baseline.json", gate: "no-silent-fallback", key: "sites" },
  { file: ".baselines/internal-exports-baseline.json", gate: "internal-exports", key: "symbols" },
  { file: ".baselines/naming-vocabulary-baseline.json", gate: "naming-doctrine", key: "identifiers" },
  { file: ".baselines/unnamed-failure-assertion-baseline.json", gate: "unnamed-failure-assertion", key: "sites" },
  { file: ".baselines/error-shape-threshold-baseline.json", gate: "error-shape-threshold", key: "directories" },
  { file: ".baselines/clone-baseline.json", gate: "clone-detection", key: undefined },
  { file: ".baselines/file-size-baseline.json", gate: "file-size-ratchet", key: "offenders" },
  { file: ".baselines/untested-modules-baseline.json", gate: "untested-modules", key: "modules" },
];

/**
 * Sum every numeric field of an envelope, for the baseline shape that records only a total.
 *
 * @param envelope the parsed baseline document
 * @returns the sum; zero when no field carries a number
 */
function sumNumericValues({ envelope }: { envelope: Record<string, unknown> }): number {
  let total = 0;
  for (const value of Object.values(envelope)) {
    if (typeof value === "number") {
      total += value;
    }
  }
  return total;
}

/**
 * Decode a baseline's array of rows, skipping anything that names no path at all.
 *
 * Two row shapes stand in `.baselines/` today. A `{path, count?}` record is the older one; a BARE path
 * string is what `untested-modules` writes, and it weighs one — a module is untested or it is not, so there
 * is no count for it to carry. A string row read as a record would have contributed a total of ZERO, which
 * reads on the page as a gate with no debt rather than as a gate nobody taught this reader.
 *
 * @param held the array read out of the envelope under its own key
 * @returns the per-path entries and their summed weight
 */
function decodeRows({ held }: { held: readonly unknown[] }): {
  readonly entries: readonly DebtEntry[];
  readonly total: number;
} {
  const entries: DebtEntry[] = [];
  let total = 0;
  for (const row of held) {
    if (typeof row === "string") {
      entries.push({ count: 1, path: row });
      total += 1;
      continue;
    }
    if (!isRecord(row)) {
      continue;
    }
    const fields = row;
    const path = fields["path"];
    if (typeof path !== "string") {
      continue;
    }
    const counted = fields["count"];
    let count = 1;
    if (typeof counted === "number") {
      count = counted;
    }
    entries.push({ count, path });
    total += count;
  }
  return { entries, total };
}

/**
 * Decode one baseline's text into entries and a total.
 *
 * Deliberately tolerant of every row shape standing in `.baselines/` — `{path,count}`, `{path,name}`, a
 * bare path STRING (`untested-modules`) and a file carrying only a `{filePairs:n}` total — because the
 * alternative is one reader per file, which is one place per file for a shape to drift. An entry with no
 * `count` weighs one: a named symbol IS one site. See them all: `head -c 200 .baselines/*.json`.
 *
 * @param text the baseline file's text
 * @param key the array key the list uses, absent for a list that records only a total
 * @returns the per-path entries and the list's own size
 */
export function decodeBaseline({ text, key }: { text: string; key: string | undefined }): {
  readonly entries: readonly DebtEntry[];
  readonly total: number;
} {
  const parsed = parseJson({ text });
  if (parsed.isErr() || !isRecord(parsed.value)) {
    return { entries: [], total: 0 };
  }
  const envelope = parsed.value;
  if (key === undefined) {
    return { entries: [], total: sumNumericValues({ envelope }) };
  }
  const held = envelope[key];
  if (!Array.isArray(held)) {
    return { entries: [], total: 0 };
  }
  return decodeRows({ held });
}

/**
 * What a baseline held at its PREVIOUS change, and when that change landed.
 *
 * The anchor is the file's own history rather than a date, because a ratchet list is rewritten only by a
 * rebaseline commit: a "seven days ago" anchor lands mid-plateau and reports a trend of zero on a list that
 * moved last week. A list with exactly one commit in its history has no previous blob, and that is returned
 * as absent — "first recorded" — never as a trend of zero.
 *
 * @param root the repository root
 * @param file the baseline's repo-relative path
 * @param key the array key its entries sit under
 * @returns the previous reading, or `undefined` when there is no earlier commit or git could not answer
 */
function previousOf({
  root,
  file,
  key,
}: {
  root: string;
  file: string;
  key: string | undefined;
}): DebtPrevious | undefined {
  const run = ({ args }: { args: readonly string[] }): string | undefined => {
    try {
      return execFileSync("git", [...args], {
        cwd: root,
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: 1 << 28,
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      });
    } catch {
      return undefined;
    }
  };
  const log = run({ args: ["log", "-n", "2", "--format=%h %cI", "--", file] });
  if (log === undefined) {
    return undefined;
  }
  const commits = log
    .trim()
    .split("\n")
    .filter((line) => line !== "");
  const previousLine = commits[1];
  if (previousLine === undefined) {
    return undefined;
  }
  const [sha, changedAtIso] = previousLine.split(" ");
  if (sha === undefined || changedAtIso === undefined) {
    return undefined;
  }
  const blob = run({ args: ["show", `${sha}:${file}`] });
  if (blob === undefined) {
    return undefined;
  }
  return { changedAtIso, sha, total: decodeBaseline({ key, text: blob }).total };
}

/**
 * Every committed ratchet list, with its size and what it held before its last change.
 *
 * @param root the repository root
 * @returns one row per declared debt list
 */
export function debtListsOf({ root }: { root: string }): readonly DebtList[] {
  const out: DebtList[] = [];
  for (const declared of DEBT_LISTS) {
    let text = "";
    try {
      text = readFileSync(join(root, declared.file), "utf8");
    } catch {
      // A baseline this checkout does not carry is reported as an empty list rather than a crash: the
      // declared set is the contract, and a missing file is a fact the total already states as zero.
      out.push({ entries: [], file: declared.file, gate: declared.gate, previous: undefined, total: 0 });
      continue;
    }
    const decoded = decodeBaseline({ key: declared.key, text });
    out.push({
      entries: decoded.entries,
      file: declared.file,
      gate: declared.gate,
      previous: previousOf({ file: declared.file, key: declared.key, root }),
      total: decoded.total,
    });
  }
  return out;
}

/**
 * How many gates are written, how many carry a refusal row, and how many run on the local `pre-push` lane.
 *
 * Read from `lintChecks` rather than counted by globbing `src/devLint/`, because the plan is what actually
 * runs — `gate-registration` exists precisely because those two can disagree.
 *
 * @param root the repository root
 * @returns the census
 */
export function gateCensusOf({ root }: { root: string }): GateCensus {
  const checks = lintChecks({ cwd: root });
  return {
    declared: DECLARED_LINT_GATES.length,
    fileLineCap: MAX_FILE_LINES,
    localLane: checksForLane({ checks, lane: "local" }).length,
    registered: checks.length,
  };
}
