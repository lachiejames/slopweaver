/**
 * The debt-list ratchet every counting gate shares — declared once, here.
 *
 * ## Why this is a module rather than a copy per gate
 *
 * `file-size-ratchet` established the shape: a committed baseline naming today's offenders by `{ path, count }`, a
 * gate that REFUSES an entry that is new or grew, and a `--rebaseline` that tightens the committed set while
 * refusing to raise any entry. `error-shape-threshold` and `no-silent-fallback` took it, and each re-typed the
 * parse, the two comparisons, the rebaseline write and the whole IO edge.
 *
 * MEASURED, which is why this exists rather than being a preference: adding the fourth copy
 * (`unnamedFailureAssertion.ts`) tripped **two** gates at once on its first full lap — `duplicate-windows` reported
 * the new file against `noSilentFallback.ts` as a 15-line cross-file clone, and `error-shape-threshold` reported
 * `src/devLint` at 32 distinct plain error shapes against a floor of 30, because the copied parse invented two more
 * of them. The tree refused the copy before a reviewer saw it. A family regenerates through ordinary, careful work,
 * and the remedy is a shared contract rather than a resolution to remember.
 *
 * ## What a gate still owns
 *
 * Everything that makes it that gate: its scan, how it collapses hits into counted entries (a FILE for
 * `unnamed-failure-assertion`, a DIRECTORY for `error-shape-threshold`, a file and a class of reference for
 * `transient-references`, and only the entries past a threshold where it has one), what one finding line says, and
 * its refusal declarations. {@link CountRatchetGate} is that contract and nothing else.
 *
 * ## What is deliberately NOT here
 *
 * An entry is a path, or a path and one `kind` (`./countRatchetCore.ts`), and nothing wider. `no-silent-fallback`
 * keys its debt list on `{ path, operator }`, and `file-size-ratchet` names its count field `codeLines`; both keep
 * their own copy, and this header is where a reader learns that is a decision rather than an oversight.
 *
 * The pure cores — decoding the list, the two comparisons, and which way the edge goes — are
 * `./countRatchetCore.ts`, unit-tested there; the thin {@link runCountRatchet} edge here reads the sources and the
 * debt list, and prints. An unreadable file never reaches `--rebaseline`: what it holds may be the very entry the
 * write would drop.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, type Result } from "../lib/result.js";
import { reportScanIntegrity, scanTextFiles, type TextFileScanResult } from "../lib/textFileScan.js";
import {
  type CountBaselineError,
  CountBaselineErrors,
  type CountEntry,
  type CountRegression,
  countEntryKey,
  countEntryLabel,
  countRatchetAction,
  countRegressionsOf,
  countSlackOf,
  countWorseningsOf,
  parseCountBaseline,
} from "./countRatchetCore.js";
import { type LintGateRefusalId, lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot, type ScanScope, scopedScanFiles } from "./scanScope.js";

export type { CountEntry } from "./countRatchetCore.js";

/** One finding line, as a gate wants it printed: where it is, and what a reader needs to see there. */
export interface CountFinding {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** Everything a gate declares apart from how it reaches its hits — see {@link CountRatchetGate}. */
export interface CountRatchetGateCore<H> {
  /** The gate's name as `dev lint` prints it. */
  readonly gate: string;
  /** The committed debt list, repo-relative. */
  readonly baselineFile: string;
  /** The array key that list's entries sit under. */
  readonly baselineKey: string;
  /** Present when the gate's identity is `(path, kind)`; absent, a debt row's `kind` is stripped as it is read. */
  readonly kinded?: true;
  /** What one counted thing is called in a report — `case(s)`, `distinct shape(s)`. */
  readonly unit: string;
  /** The gate's declared scan predicate. */
  readonly scope: ScanScope;
  /** The refusal declaration a regression prints. */
  readonly refusalId: LintGateRefusalId;
  /** The refusal declaration a refused rebaseline prints. */
  readonly rebaselineRefusalId: LintGateRefusalId;
  /**
   * Present on an EXACT-debt gate: the refusal a debt entry standing above the scan prints, so every decrease is
   * committed in the change that made it and no floor is left as room for new hits. Absent, a lower count passes.
   */
  readonly slackRefusalId?: LintGateRefusalId;
  /** Collapse every hit into the counted paths the debt list holds. Pure. */
  readonly counts: (args: { hits: readonly H[] }) => readonly CountEntry[];
  /**
   * Which counted entry a hit belongs to: its `countEntryKey`, so a path for a path-only gate and the path and kind
   * for a gate whose entries carry one.
   */
  readonly keyOf: (args: { hit: H }) => string;
  /** What a hit's own finding line says. */
  readonly findingOf: (args: { hit: H }) => CountFinding;
  /**
   * A key that makes two hits the same FINDING, so a gate reporting distinct shapes prints each once. Return
   * the hit's own location where every hit is its own finding.
   */
  readonly findingKeyOf: (args: { hit: H }) => string;
  /** The line a clean run prints inside `<gate>: clean (…)`. */
  readonly cleanLine: (args: { hits: readonly H[]; current: readonly CountEntry[] }) => string;
  /** The one-clause detail the refusal's first line ends with. */
  readonly refusalDetail: (args: { regressions: readonly CountRegression[] }) => string;
}

/**
 * One gate's whole declaration — what it scans, how it counts, and how it says what it found. Everything NOT
 * here is the ratchet, which this module owns.
 *
 * Two shapes, told apart by `resolve`. A gate whose every hit is settled by reading one file scans HITS and
 * declares no resolver. A gate that needs the whole tree first (`error-shape-threshold` follows a name across
 * imports) scans FACTS of type `F` and must declare the resolver that turns them into hits — so a gate whose facts
 * are not themselves hits cannot leave out how they become hits and still compile. The check is structural, as
 * every TypeScript check is: a fact type that is assignable to the hit type (`interface Fact extends Hit`) passes
 * the resolver-free arm, because such a fact IS a well-typed hit to every counter that reads it.
 * `error-shape-threshold`'s facts carry no hit's `line` or `shape`, so its resolver cannot be dropped.
 */
export type CountRatchetGate<H, F = H> = CountRatchetGateCore<H> &
  (
    | {
        /** Find every hit in one file's text. Pure. */
        readonly scan: (args: { path: string; content: string }) => readonly H[];
        readonly resolve?: undefined;
      }
    | {
        /** Find every fact in one file's text. Pure. */
        readonly scan: (args: { path: string; content: string }) => readonly F[];
        /** Turn every file's facts into the hits that are counted, once the whole tree has been read. Pure. */
        readonly resolve: (args: { facts: readonly F[] }) => readonly H[];
      }
  );

/**
 * Scan every path for one gate, resolving its facts into hits when it declares a resolver. Pure but for
 * `readText`, which the edge passes as a filesystem read and a test as a map lookup.
 *
 * @param readText reads one path's text, throwing when it cannot — that path is reported unreadable, not scanned
 * @returns the gate's hits — resolved over every file's facts for a resolving gate — and the unreadable paths
 */
export function scanGate<H, F>({
  gate,
  paths,
  readText,
}: {
  gate: CountRatchetGate<H, F>;
  paths: readonly string[];
  readText: (args: { path: string }) => string;
}): TextFileScanResult<H> {
  if (gate.resolve === undefined) {
    return scanTextFiles<H>({ paths, readText, scan: gate.scan });
  }
  const scanned = scanTextFiles<F>({ paths, readText, scan: gate.scan });
  return { ...scanned, hits: gate.resolve({ facts: scanned.hits }) };
}

/** Print each finding behind a regression, once, so an author has line numbers rather than a count. */
function writeRegressionFindings<H>({
  gate,
  hits,
  regressions,
}: {
  gate: CountRatchetGateCore<H>;
  hits: readonly H[];
  regressions: readonly CountRegression[];
}): void {
  const wanted = new Set(regressions.map((one) => countEntryKey({ entry: one })));
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = gate.findingKeyOf({ hit });
    if (wanted.has(gate.keyOf({ hit })) && !seen.has(key)) {
      seen.add(key);
      const finding = gate.findingOf({ hit });
      process.stderr.write(`  ${finding.path}:${String(finding.line)}: ${finding.text}\n`);
    }
  }
}

/** The compare branch: pass, or print every new/worse entry against the committed debt list. */
function reportRegressions<H>({
  current,
  gate,
  hits,
  regressions,
}: {
  current: readonly CountEntry[];
  gate: CountRatchetGateCore<H>;
  hits: readonly H[];
  regressions: readonly CountRegression[];
}): number {
  if (regressions.length === 0) {
    process.stdout.write(`${gate.gate}: clean (${gate.cleanLine({ current, hits })})\n`);
    return 0;
  }
  writeRegressionFindings({ gate, hits, regressions });
  for (const one of regressions) {
    const floor = one.baselineCount === undefined ? "new debt entry" : `floor ${String(one.baselineCount)}`;
    process.stderr.write(`  ${countEntryLabel({ entry: one })}: ${String(one.count)} ${gate.unit} (${floor})\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: gate.refusalId }),
      detail: gate.refusalDetail({ regressions }),
    })}\n`,
  );
  return 1;
}

/** The `--rebaseline` branch: write the current entry set, or refuse an existing entry's growth. */
function applyRebaseline<H>({
  baselinePath,
  current,
  gate,
  regressions,
}: {
  baselinePath: string;
  current: readonly CountEntry[];
  gate: CountRatchetGateCore<H>;
  regressions: readonly CountRegression[];
}): number {
  const worsenings = countWorseningsOf({ regressions });
  if (worsenings.length > 0) {
    for (const one of worsenings) {
      const grew = `${String(one.baselineCount)} -> ${String(one.count)}`;
      process.stderr.write(`  ${countEntryLabel({ entry: one })}: ${grew} ${gate.unit}\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: gate.rebaselineRefusalId }),
        detail: `${String(worsenings.length)} worsened entr(ies)`,
      })}\n`,
    );
    return 1;
  }
  writeFileSync(baselinePath, `${JSON.stringify({ [gate.baselineKey]: current }, null, 2)}\n`);
  process.stdout.write(`${gate.gate}: debt list tightened to ${String(current.length)} entr(ies)\n`);
  return 0;
}

/** Load the committed debt list, or say why it could not be read. */
function loadBaseline<H>({
  baselinePath,
  gate,
}: {
  baselinePath: string;
  gate: CountRatchetGateCore<H>;
}): Result<readonly CountEntry[], CountBaselineError> {
  let text: string;
  try {
    text = readFileSync(baselinePath, "utf8");
  } catch {
    return err(CountBaselineErrors.unreadable({ path: baselinePath }));
  }
  return parseCountBaseline({ gate: gate.gate, key: gate.baselineKey, kinded: gate.kinded === true, text });
}

/**
 * IO edge: scan every file in a gate's scope, judge it against the committed debt list, or
 * (`--rebaseline`) tighten that list to what stands now.
 *
 * @param gate the gate's own declaration — what it scans, how it counts, how it reports
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runCountRatchet<H, F = H>({ gate }: { gate: CountRatchetGate<H, F> }): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: gate.scope });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write(`${gate.gate}: not a git checkout (git ls-files failed)\n`);
    return 1;
  }
  const baselinePath = join(root, gate.baselineFile);
  const baseline = loadBaseline({ baselinePath, gate });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports that failure
    // rather than a verdict about code it never saw
    process.stderr.write(`${gate.gate}: ${baseline.error.message}\n`);
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanGate({
    gate,
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
  });
  const complete = reportScanIntegrity({
    label: gate.gate,
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const current = gate.counts({ hits });
  const regressions = countRegressionsOf({ baseline: baseline.value, current });
  const rebaseline = process.argv.includes("--rebaseline");
  const action = countRatchetAction({ complete, rebaseline, regressions: regressions.length });
  if (action === "rebaseline") {
    return applyRebaseline({ baselinePath, current, gate, regressions });
  }
  if (rebaseline || gate.slackRefusalId === undefined) {
    return action === "refuse-incomplete" ? 1 : reportRegressions({ current, gate, hits, regressions });
  }
  const unread = unreadable.map((one) => one.path);
  const slack = countSlackOf({ baseline: baseline.value, current, unread });
  const incomplete = action === "refuse-incomplete";
  return judgeExactDebt({ current, gate, hits, incomplete, regressions, slack, slackRefusalId: gate.slackRefusalId });
}

/**
 * The exact-debt compare: a stale entry is refused alongside any new one, and beside an unreadable file, so one run
 * names every row to fix. An unreadable path's count is unknown, never zero, so `slack` already leaves it out.
 */
function judgeExactDebt<H>({
  current,
  gate,
  hits,
  incomplete,
  regressions,
  slack,
  slackRefusalId,
}: {
  current: readonly CountEntry[];
  gate: CountRatchetGateCore<H>;
  hits: readonly H[];
  incomplete: boolean;
  regressions: readonly CountRegression[];
  slack: readonly CountRegression[];
  slackRefusalId: LintGateRefusalId;
}): number {
  if (incomplete) {
    return slack.length === 0 ? 1 : reportSlack({ gate, slack, slackRefusalId });
  }
  if (slack.length === 0) {
    return reportRegressions({ current, gate, hits, regressions });
  }
  if (regressions.length > 0) {
    reportRegressions({ current, gate, hits, regressions });
  }
  return reportSlack({ gate, slack, slackRefusalId });
}

/** The exact-debt branch: refuse every debt entry standing above what the scan found. */
function reportSlack<H>({
  gate,
  slack,
  slackRefusalId,
}: {
  gate: CountRatchetGateCore<H>;
  slack: readonly CountRegression[];
  slackRefusalId: LintGateRefusalId;
}): number {
  for (const one of slack) {
    const label = countEntryLabel({ entry: one });
    process.stderr.write(`  ${label}: ${String(one.count)} ${gate.unit} now, floor ${String(one.baselineCount)}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: slackRefusalId }),
      detail: `${String(slack.length)} debt entr(ies) above what stands`,
    })}\n`,
  );
  return 1;
}
