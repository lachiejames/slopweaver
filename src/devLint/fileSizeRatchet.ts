/**
 * The file-size ratchet (code-quality survey item 2) — every function already carries a size cap
 * (`max-function-lines`, 60) and a complexity cap (`cognitive-complexity`, 12), but nothing bounded a
 * MODULE: 32 production files sat over 800 raw lines, and four of them cited a file cap that did not
 * exist. To change ten lines an agent had to open one of them.
 *
 * ## Counts CODE lines, not raw lines — deliberately
 *
 * A raw-line cap taxes the single best thing in this repository: a dense, load-bearing file header (see
 * `src/corpus/github/write.ts:1-41`, `src/corpus/latestRecords.ts:1-35`). Under a raw-line cap the cheapest
 * way under the number is to delete the header — the gate would pay agents to destroy the artifact with the
 * highest measured value to agent performance. Counting code lines (reusing {@link codeLinesOf} from the
 * clone ratchet — blanks and whole-line comments stripped) prices a header at zero and puts the pressure
 * where it belongs: on how many THINGS a file does. It costs printing both numbers on refusal, since a
 * reader can no longer verify the count with `wc -l` alone.
 *
 * ## The cap is 300 code lines per file, with no step-by-step descent
 *
 * The rule is all files under 300 lines of code excluding comments and whitespace. {@link MAX_FILE_LINES}
 * is that number, and the committed baseline names whatever is over it. Read the count off the file rather
 * than from prose here: it moves as `main` grows files and as files are split.
 *
 * A descent by one cap step per pull request would keep the baseline EMPTY at every step — a cap with no
 * debt behind it. The target is named instead of the step, and the house pattern supports a debt list, so
 * the cap is one number with a shrinking baseline. **Nothing is weaker for it**: every file over 300 is
 * frozen at its exact recorded code-line count and cannot grow, and no file under 300 can ever cross it.
 *
 * **The cost, stated rather than discovered.** MEASURED: 388 of 4,052 in-scope files — 9.6%
 * of the tree — cannot grow by a single code line until they are split. That bite is the point, and it is
 * also the most likely reason an unrelated pull request goes red in the weeks after this lands. There is
 * deliberately no slack in the baseline: a ratchet with headroom is a number nobody moves. Reproduce the
 * distribution at any cap: `yarn devlint:file-size-rebaseline` prints the offender count it wrote.
 *
 * ## The cap is every file — every tree, every TypeScript and JavaScript extension
 *
 * The 300 names FILES, not a tree, so the scope is the whole repository (`trees: []`) in every extension its
 * code is written in, so a new top-level directory is measured the day it appears. **This gate is the ONE
 * file-length rule**: oxlint's `max-lines` sat beside it at 1,000 and was
 * weighed and dropped, because it counts blank lines, cannot hold a debt list (at 300 it would fail every
 * offender on the day it landed), and exempts only by config path rather than by a reason in the file. What
 * oxlint alone covered — `tools/`, `config/`, `stubs/` and the root files — is in scope here instead, so no
 * file lost a cap. A `*.test.ts(x)` is measured too, at its own cap — § "A test file's cap is 500" below.
 * MEASURED, the defect that set the console widening: the scope read `.ts` under
 * `src/`, `eval/` and `hooks/` only, so `site/components/live/Workstreams.tsx` reached 1,218 raw lines (858
 * code) with no gate ever measuring it, a mismatch between the enforced maximum the owner believed in and
 * what the code was. Widening took the floor from 248 rows to 338: the 90
 * new ones are every console and Electron-shell file over the cap, frozen as debt at their measured counts.
 * Reproduce: `yarn devlint:file-size-rebaseline` on a clean tree, then `git diff --stat .baselines/`.
 *
 * Two trees are out by NAME, {@link REGISTRY_TREES}: the shadcn/ui and AI Elements components upstream CLIs
 * install, whose shape is upstream's. They are the only exclusion, and one file over the cap sits in them.
 *
 * ## A test file's cap is 500
 *
 * Tests are measured too: a test file
 * (`*.test.ts`, `*.test.tsx`, `isTestFilePath`) is measured at `MAX_TEST_FILE_LINES`, every other file at
 * {@link MAX_FILE_LINES} (`capFor`, `./fileSizeMeasure.ts`). One rule, two numbers, one mechanism: a file that
 * grows past its cap is split. A test file splits by scenario or `describe` block into sibling files, NEVER by
 * moving a flow's steps into helpers — a test reads top to bottom, and a flow spread across helper layers
 * is one a reader has to unravel when it fails. 500 rather than 300 because at 300 the cap caught a coherent
 * 440-line file and pushed toward exactly that helper extraction. A helper or fake under
 * `__tests__/` is not a test file and keeps the 300. Every test file over 500 is frozen
 * as debt at its count. A test file is never exempt: `fileSizeOf` ignores a marker on one, and an exemption
 * marker on one is refused as unrecorded whatever the tradeoff register holds.
 *
 * ## An exemption waives the CAP, never the RATCHET
 *
 * A ratchet that keeps a ceiling must not let files over 1k lines exist unmeasured. Two exempt files
 * once stood at 1,859 and 1,065 code lines because the gate was not measuring either of
 * them. `fileSizeOf` returned `undefined` for an exempt file, so an exemption did not waive the 300-line
 * CAP — it removed the file from the gate's subject entirely, baseline included, and eight files could
 * therefore grow without limit forever.
 *
 * The property now: an exempt file may be long, and may not GROW. {@link FileSizeBaseline.exempt} is its own
 * frozen set, judged by a different rule from `offenders` — an offender is debt that has to fall under the
 * cap one day, an exempt row is a ceiling that never has to — and kept a separate array for exactly that
 * reason, since one array with a flag invites the next reader to fold them together. MEASURED:
 * 391 files over the cap, 383 offenders, 8 exempt and frozen by nothing at all.
 *
 * Two consequences that are the rule rather than a note. Removing a marker from a long file moves it into
 * `offenders` as a NEW offender and is refused, which is correct. Adding one to an offender moves it the
 * other way and leaves a stale row, so dodging the ratchet with a marker shows up in the diff instead of
 * being silent.
 *
 * **A path's floor is the tightest count EVER recorded for it, in either half** — {@link tightestFloorFor},
 * and the reason there is no per-half reading beside it. The r1 Codex review broke the first cut of this on
 * exactly that: half-blind, removing a marker made an existing ceiling read as `undefined`, so the file was
 * a brand-new offender and `--rebaseline` was entitled to record it at whatever it had grown to. Toggling
 * the marker raised the ceiling once per toggle, without limit. The r3 review then broke the half-blind
 * reading from the other side — a path standing in BOTH halves passed against the looser row, so no
 * regression was raised at all and `--rebaseline` deleted the tighter one. There is now ONE criterion, read
 * across both arrays, and no per-half figure anywhere: two numbers is what let each review find a way to
 * read the wrong one.
 *
 * **A marker's REASON is judged, not merely counted** — `hasMarkerReason` (`./fileSizeMeasure.ts`). A
 * second r3 pass exempted a whole file with `/* <the exemption marker>: *\/`, because the `*` of a block
 * comment's own closing delimiter is a non-space character and the test was "one non-space character after
 * the colon". A marker now also needs a signed tradeoff row to exempt anything at all. Both blank
 * cases now read the same way: everything from the first `*\/` is dropped before the remainder is trimmed,
 * so neither a run of spaces nor a terminator can stand in for a reason somebody has to write.
 *
 * ## A row that stopped firing is refused, so the baseline only shrinks
 *
 * `--rebaseline` is a command somebody has to remember, so "only shrinks" was a habit rather than a
 * property: four rows on the committed floor named a file that was gone or had already fallen under the cap
 * (`src/review/landing.ts`, 449 → 288), and nothing said so. {@link staleRowsOf} refuses a row whose path no
 * longer exists, or whose file no longer belongs to the array holding it — the `<gate>-debt` shape
 * `no-python` and `whole-file-json` already use.
 *
 * It deliberately does NOT refuse a row whose count merely dropped while staying over the cap. That is real
 * headroom, and it is printed as {@link slackOf} rather than refused: reddening every pull request that
 * improves a file would make a baseline edit the price of any shrink, across 383 rows and a fleet landing
 * one change every twenty minutes.
 *
 * ## The residue, stated rather than discovered
 *
 * The floor is the CURRENT over-cap set, not an all-time-low ledger, so a file taken UNDER the cap loses its
 * row — that is the shrink half working — and may later re-enter the baseline at any size through a second
 * `--rebaseline`. The r1 review named this sequence and an r3 pass found it again from the
 * exempt side, so it is real and it stays findable; it is also exactly what a
 * rebaseline already does for every non-exempt file, so it is the shape of a
 * rebaseline-able ratchet. `clone-detection`,
 * `coverage-ratchet`, `internal-exports` and `untested-modules` all carry it.
 *
 * Closing it would mean never deleting a row, which contradicts the shrink property directly above and would
 * make a legitimately new 400-line module impossible to add. What bounds it instead is that `--rebaseline`
 * writes a COMMITTED file: the raise is a `+2000` in a diff somebody reads, not a silent drift. The marker
 * toggle the r1 review broke was the genuinely new hole, because it needed no honest intermediate state at
 * all — see {@link tightestFloorFor}.
 *
 * ## Oversized files are always split — an exemption is a tradeoff the owner signed
 *
 * The rule (`./fileSizeTradeoffs.ts` carries it): an oversized file is split, and no
 * case is known where splitting costs more than it buys. Two things exempt a file from the cap. A
 * `GENERATED — do not hand-edit` leading comment, the convention the atlas surfaces carry, since nobody edits
 * one by hand. And the inline exemption marker WITH a row in the committed tradeoff register naming the
 * tradeoff and the anchor of the owner's yes — the marker alone exempts nothing, and one with no row is refused as
 * unrecorded on any file, under the cap or not. The register marker that once let a file raise its own
 * ceiling is retired: a register splits by category like any other file, so the marker raises and exempts
 * nothing and is refused by name. All three findings come from one scan of every measured file, before the
 * over-cap filter, so a marker cannot sit waiting for a file to grow into it.
 *
 * A marker is a comment line that OPENS on it, so this header naming the mechanism exempts nothing; this gate
 * measures its own source, entry and test like every other file.
 *
 * Pure cores ({@link fileSizeOf}, {@link offendersOf}, {@link staleRowsOf}, {@link slackOf},
 * {@link parseBaselineJson}) are unit-tested; the thin {@link runFileSizeRatchet} edge reads the sources, the
 * baseline and the tradeoff register, and prints.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { appendAll } from "../lib/arrays.js";
import { type Result } from "../lib/result.js";
import { decodeDebtList, readCommittedInput } from "./decodeDebtList.js";
import { type DevLintInputError } from "./errors.js";
import {
  capFor,
  type FileSize,
  fileSizeOf,
  MAX_FILE_LINES,
  MAX_TEST_FILE_LINES,
  offendersOf,
} from "./fileSizeMeasure.js";
import {
  type FileSizeTradeoffs,
  fileSizeTradeoffDebtOf,
  parseFileSizeTradeoffsJson,
  printTradeoffFindings,
  TRADEOFF_FILE,
} from "./fileSizeTradeoffs.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { isScannablePath, repoRoot, type ScanScope, scopedScanFiles } from "./scanScope.js";

/** The committed floor, repo-relative. */
export const BASELINE_FILE = ".baselines/file-size-baseline.json";

/**
 * One committed floor row: a path and the code-line count it may not exceed.
 *
 * @internal — reached as a member of {@link FileSizeBaseline}'s two arrays, never named by a consumer.
 */
export interface BaselineRow {
  readonly path: string;
  readonly codeLines: number;
}

/**
 * The committed floor. `offenders` is debt that has to fall under the cap one day; `exempt` is a ceiling
 * that never has to, and the two stay separate arrays because they are judged by different rules.
 */
export interface FileSizeBaseline {
  readonly offenders: readonly BaselineRow[];
  readonly exempt: readonly BaselineRow[];
}

const rowSchema = z.object({ codeLines: z.number().int().nonnegative(), path: z.string().min(1) });

const baselineSchema = z.object({
  exempt: z.array(rowSchema).default([]),
  offenders: z.array(rowSchema),
});

/**
 * Decode a committed baseline file. Pure — `exempt` defaults to empty so a floor written with no exempt
 * half still decodes.
 *
 * @param text the baseline file text
 * @returns the baseline, or an error string
 */
export function parseBaselineJson({ text }: { text: string }): Result<FileSizeBaseline, DevLintInputError> {
  return decodeDebtList({
    label: "file-size baseline",
    schema: baselineSchema,
    shape: "{ offenders: [{ path, codeLines }], exempt: [{ path, codeLines }] }",
    text,
  });
}

/** One offender that regressed or is new against the baseline. */
export interface Regression {
  readonly path: string;
  readonly rawLines: number;
  readonly codeLines: number;
  readonly exempt: boolean;
  /**
   * The tightest count the floor has EVER recorded for this path, in EITHER half — the ONE floor a file is
   * held to, and the number a refusal prints. There is deliberately no per-half figure beside it: carrying
   * both invites a reader, and a later change, to treat the looser one as meaningful.
   */
  readonly tightestFloor: number | undefined;
}

/**
 * Every regression the committed floor has already recorded a tighter count for. Pure — this is what
 * `--rebaseline` refuses, deliberately narrower than {@link regressionsOf}: a path the floor has never held
 * is a legitimate first-time addition to a widening baseline, never a reason to refuse tightening the rest.
 *
 * No file is excepted. The retired register marker once let a file `--rebaseline` past its own ceiling;
 * a register now splits like any other file, so every recorded path is held to its
 * floor whatever it declares, and the marker itself is refused by `./fileSizeTradeoffs.ts`.
 *
 * It reads {@link Regression.tightestFloor} because a half-specific reading was broken twice, from opposite
 * sides: the r1 review on a marker REMOVED, where the surviving row read as brand new so a raise looked
 * like a first recording; the r3 review on a path standing in both halves, where the looser row satisfied
 * the test. The floor a path is held to is the smallest number ever written for it, whichever array held
 * that number — one criterion, and no second one for a later change to pick.
 *
 * @param regressions the full regression list (see {@link regressionsOf})
 * @returns only the entries that grew past a count the floor already held for them
 */
export function worseningsOf({ regressions }: { regressions: readonly Regression[] }): readonly Regression[] {
  return regressions.filter((r) => r.tightestFloor !== undefined && r.codeLines > r.tightestFloor);
}

/**
 * The tightest count the committed floor has EVER recorded for a path, in either half. Pure.
 *
 * Half-blind — reading only the half a file's exemption puts it in — is the shape two reviews broke. On r1,
 * removing a marker made an existing ceiling read as `undefined`, so the file was a brand-new offender and
 * `--rebaseline` could record it at whatever it now measured. On r3, a path held in BOTH halves passed
 * against the looser row and raised no regression at all, so the tighter row was deleted. A path's ratchet
 * is the smallest number the floor ever held for it, whichever array held it, and nothing reads a per-half
 * row any more.
 *
 * @param baseline the committed floor
 * @param path the file's repo-relative path
 * @returns the tightest recorded count, or `undefined` when neither half has ever held this path
 */
function tightestFloorFor({ baseline, path }: { baseline: FileSizeBaseline; path: string }): number | undefined {
  let tightest: number | undefined;
  for (const row of [...baseline.offenders, ...baseline.exempt]) {
    if (row.path !== path) {
      continue;
    }
    if (tightest === undefined || row.codeLines < tightest) {
      tightest = row.codeLines;
    }
  }
  return tightest;
}

/**
 * Every current file over the cap that is NEW (no row in EITHER half) or WORSE (more code lines than the
 * tightest count the floor has ever held for it). Pure — the property the gate actually enforces, for an
 * exempt file exactly as much as for an offender.
 *
 * The criterion is the TIGHTEST floor rather than the current half's row. Both r1 and r3 broke the
 * half-specific version, from opposite sides: r1 on a marker REMOVED, where the surviving row read as
 * `undefined` and a raise looked brand new; r3 on a path standing in both halves, where the looser row
 * satisfied the test and no regression was raised at all, so {@link worseningsOf} never saw it and
 * `--rebaseline` deleted the tighter one. One criterion, read across both arrays, is what closes the class
 * rather than its two instances.
 *
 * @param current every file currently over the cap
 * @param baseline the committed floor
 * @returns each regression, in path order (empty when the ratchet holds)
 */
export function regressionsOf({
  current,
  baseline,
}: {
  current: readonly FileSize[];
  baseline: FileSizeBaseline;
}): readonly Regression[] {
  const regressions: Regression[] = [];
  for (const size of current) {
    const tightestFloor = tightestFloorFor({ baseline, path: size.path });
    if (tightestFloor === undefined || size.codeLines > tightestFloor) {
      regressions.push({
        codeLines: size.codeLines,
        exempt: size.exempt,
        path: size.path,
        rawLines: size.rawLines,
        tightestFloor,
      });
    }
  }
  return regressions;
}

/**
 * Every committed row that no longer fires — its path is gone, its file has fallen to or under the cap, or
 * a marker moved it into the other array. Pure: a floor nobody tightens is a habit, and this makes "only
 * shrinks" a property of the gate.
 *
 * @param current every file currently over the cap
 * @param baseline the committed floor
 * @returns the dead rows, `exempt` naming which array held each, in path order
 */
export function staleRowsOf({
  current,
  baseline,
}: {
  current: readonly FileSize[];
  baseline: FileSizeBaseline;
}): readonly { readonly path: string; readonly exempt: boolean }[] {
  const live = new Set(current.map((size) => `${size.exempt ? "exempt" : "offender"}:${size.path}`));
  const dead: { path: string; exempt: boolean }[] = [];
  for (const row of baseline.offenders) {
    if (!live.has(`offender:${row.path}`)) {
      dead.push({ exempt: false, path: row.path });
    }
  }
  for (const row of baseline.exempt) {
    if (!live.has(`exempt:${row.path}`)) {
      dead.push({ exempt: true, path: row.path });
    }
  }
  return dead.toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * How many code lines of headroom the committed floor holds — every row recording a count above what its
 * file measures today. Pure. Reported, never refused: see this module's header for why.
 *
 * @param current every file currently over the cap
 * @param baseline the committed floor
 * @returns the total slack, in code lines
 */
export function slackOf({ current, baseline }: { current: readonly FileSize[]; baseline: FileSizeBaseline }): number {
  let slack = 0;
  for (const size of current) {
    const recorded = tightestFloorFor({ baseline, path: size.path });
    if (recorded !== undefined && recorded > size.codeLines) {
      slack += recorded - size.codeLines;
    }
  }
  return slack;
}

/**
 * This gate's declared scan predicate: every tracked TypeScript or JavaScript file in the repository, in
 * every tree including the root, `tools/`, `config/` and `stubs/` — tests included, at their own cap. See the
 * module header's § "The cap is every file" and § "A test file's cap is 500".
 */
const SCOPE: ScanScope = {
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"],
  // Empty on purpose: this gate is measured by its own cap like every other file.
  selfFiles: new Set(),
  trees: [],
};

/**
 * The console's two REGISTRY trees, installed by upstream CLIs (shadcn/ui, AI Elements;
 * `docs/console/styling-reads-and-acts.md`) and re-pulled with `--overwrite`, so a file's shape is upstream's.
 * Freezing one would refuse its own re-pull — measured: `ai-elements/code-block.tsx` at 380 code lines
 * here against 470 from `npx ai-elements@latest add code-block --overwrite` — and splitting one forks it from
 * upstream. Named, not inferred: no other tree is out.
 */
const REGISTRY_TREES: readonly string[] = ["site/components/ai-elements/", "site/components/ui/"];

/**
 * Whether this gate measures a repo-relative path — {@link SCOPE} applied, exported so the scope itself is
 * under test rather than only the counting.
 *
 * @param path a repo-relative path such as `site/components/live/Now.tsx`
 * @returns true when the path's size is this gate's subject
 */
export function isFileSizeSubject({ path }: { path: string }): boolean {
  if (REGISTRY_TREES.some((tree) => path.startsWith(tree))) {
    return false;
  }
  return isScannablePath({ path, scope: SCOPE });
}

/**
 * Read every in-scope file's measured size. IO edge — throws if the tree cannot be read.
 *
 * @param root the repository root
 * @param tradeoffs the committed register, whose rows are the only paths a marker may exempt
 * @returns every file's measured size
 */
function readAllSizes({ root, tradeoffs }: { root: string; tradeoffs: FileSizeTradeoffs }): readonly FileSize[] {
  const files = scopedScanFiles({ root, scope: SCOPE }).filter((path) => isFileSizeSubject({ path }));
  const approvedTradeoffPaths = new Set(tradeoffs.tradeoffs.map((row) => row.path));
  const sizes: FileSize[] = [];
  for (const path of files) {
    const content = readFileSync(join(root, path), "utf8");
    appendAll({ from: [fileSizeOf({ approvedTradeoffPaths, content, path })], into: sizes });
  }
  return sizes;
}

/**
 * Split the current over-cap set into the two arrays the baseline file holds.
 *
 * Exported for its unit case rather than for a caller: this is what `--rebaseline` WRITES, so the half a
 * path lands in is the whole difference between the page calling a file frozen and calling it debt, and it
 * was reachable only through a filesystem write before.
 *
 * @param current every file over the cap, already measured
 * @returns the two arrays, exempt files in one and offenders in the other
 */
export function baselineOf({ current }: { current: readonly FileSize[] }): FileSizeBaseline {
  const row = (size: FileSize): BaselineRow => ({ codeLines: size.codeLines, path: size.path });
  return {
    exempt: current.filter((size) => size.exempt).map(row),
    offenders: current.filter((size) => !size.exempt).map(row),
  };
}

/**
 * The `--rebaseline` branch: write the current over-cap set, or refuse a recorded file's regression. A marker
 * finding already printed refuses it too, before anything is written: a floor recorded while an unsigned
 * marker stood would freeze that file as an exempt ceiling it never earned.
 */
function applyRebaseline({
  baselinePath,
  current,
  markerFindings,
  regressions,
}: {
  baselinePath: string;
  current: readonly FileSize[];
  markerFindings: number;
  regressions: readonly Regression[];
}): number {
  const worsenings = worseningsOf({ regressions });
  if (worsenings.length > 0) {
    for (const r of worsenings) {
      process.stderr.write(
        `  ${r.path}: ${String(r.tightestFloor)} -> ${String(r.codeLines)} code lines (cap ${String(capFor({ path: r.path }))})\n`,
      );
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "file-size-ratchet-rebaseline" }),
        detail: `${String(worsenings.length)} regression(s)`,
      })}\n`,
    );
  }
  if (worsenings.length + markerFindings > 0) {
    return 1;
  }
  const written = baselineOf({ current });
  writeFileSync(baselinePath, `${JSON.stringify(written, null, 2)}\n`);
  process.stdout.write(
    `file-size-ratchet: baseline tightened to ${String(written.offenders.length)} offender(s) and ` +
      `${String(written.exempt.length)} exempt ceiling(s)\n`,
  );
  return 0;
}

/**
 * Print every new or grown file, offenders and exempt ceilings alike.
 *
 * The number printed is the TIGHTEST floor, because that is the one that caught the file. Printing the
 * current half's row instead reads as a refusal of something that did not happen — a path held at 400 in
 * `offenders` and 571 in `exempt`, sitting at 571, was refused while the line said "floor 571".
 */
function reportRegressions({ regressions }: { regressions: readonly Regression[] }): void {
  for (const r of regressions) {
    const held = r.tightestFloor === undefined ? "new" : `floor ${String(r.tightestFloor)}`;
    const kind = r.exempt ? "exempt ceiling" : "offender";
    const cap = String(capFor({ path: r.path }));
    process.stderr.write(
      `  ${r.path}: ${String(r.rawLines)} raw lines, ${String(r.codeLines)} code lines (${kind}, ${held}, cap ${cap})\n`,
    );
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "file-size-ratchet" }),
      detail:
        `${String(regressions.length)} file(s) over their cap (${String(MAX_FILE_LINES)} code lines, ` +
        `${String(MAX_TEST_FILE_LINES)} for a test file)`,
    })}\n`,
  );
}

/** Print every committed row nothing matches any more, which must be deleted so the floor keeps shrinking. */
function reportStale({ stale }: { stale: readonly { readonly path: string; readonly exempt: boolean }[] }): void {
  for (const row of stale) {
    process.stderr.write(`  ${row.path}: ${row.exempt ? "exempt ceiling" : "offender"} row no longer fires\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "file-size-ratchet-debt" }),
      detail: `${String(stale.length)} committed row(s) no longer fire`,
    })}\n`,
  );
}

/** The compare branch: pass, or print every regression and every row that stopped firing. */
function report({
  current,
  markerFindings,
  regressions,
  stale,
  slack,
}: {
  current: readonly FileSize[];
  markerFindings: number;
  regressions: readonly Regression[];
  stale: readonly { readonly path: string; readonly exempt: boolean }[];
  slack: number;
}): number {
  if (regressions.length > 0) {
    reportRegressions({ regressions });
  }
  if (stale.length > 0) {
    reportStale({ stale });
  }
  if (regressions.length + stale.length + markerFindings > 0) {
    return 1;
  }
  const exempt = current.filter((size) => size.exempt).length;
  process.stdout.write(
    `file-size-ratchet: clean (${String(current.length - exempt)} offender(s), ${String(exempt)} exempt ` +
      `ceiling(s), cap ${String(MAX_FILE_LINES)} code lines and ${String(MAX_TEST_FILE_LINES)} for a test file, ` +
      `${String(slack)} code line(s) of slack)\n`,
  );
  return 0;
}

/** Load the committed floor and the tradeoff register, or say which one could not be read. */
function loadInputs({
  root,
}: {
  root: string;
}): Result<{ baseline: FileSizeBaseline; tradeoffs: FileSizeTradeoffs }, DevLintInputError> {
  return readCommittedInput({ kind: "floor file", path: join(root, BASELINE_FILE) })
    .andThen((text) => parseBaselineJson({ text }))
    .andThen((baseline) =>
      readCommittedInput({ kind: "tradeoff register", path: join(root, TRADEOFF_FILE) })
        .andThen((text) => parseFileSizeTradeoffsJson({ text }))
        .map((tradeoffs) => ({ baseline, tradeoffs })),
    );
}

/**
 * IO edge: judge every marker against the tradeoff register, then measure every current file over the cap
 * against the committed baseline, or (`--rebaseline`) tighten the baseline to the current set.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a marker finding, a regression, a stale row, a
 *   refused rebaseline, or a hard error)
 */
export function runFileSizeRatchet(): number {
  let root: string;
  try {
    root = repoRoot();
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("file-size-ratchet: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const inputs = loadInputs({ root });
  if (inputs.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`file-size-ratchet: ${inputs.error.message}\n`);
    return 1;
  }
  const { baseline, tradeoffs } = inputs.value;
  const sizes = readAllSizes({ root, tradeoffs });
  // Every measured file, not only the over-cap ones: a marker must not wait for its file to grow into it.
  const markerFindings = printTradeoffFindings({ debt: fileSizeTradeoffDebtOf({ files: sizes, tradeoffs }) });
  const current = offendersOf({ sizes });
  const regressions = regressionsOf({ baseline, current });
  if (process.argv.includes("--rebaseline")) {
    const baselinePath = join(root, BASELINE_FILE);
    return applyRebaseline({ baselinePath, current, markerFindings, regressions });
  }
  return report({
    current,
    markerFindings,
    regressions,
    slack: slackOf({ baseline, current }),
    stale: staleRowsOf({ baseline, current }),
  });
}
