/**
 * The no-silent-fallback gate — machine-enforces the rule that nullish coalescing and its similar operators
 * are banned, motivated by `src/store/ingest.ts`'s `displayName: author.handle ?? author.nativeId`: the
 * operator enables bugs like this one, and it is not explicit about what the author has to do.
 *
 * The bug is not a type error and never was one: both sides are `string`, so the compiler
 * is content while a person's display name silently becomes a raw platform id. What the operator buys is the
 * ability to write a substitution without writing down that a substitution is happening.
 *
 * **The operator was not already banned; only a narrow rule existed.**
 * `house-rules` has refused a coalesce to an empty string, and to an empty template, since ESLint was
 * deleted. Nothing refused the operator itself.
 *
 * ## The criterion — one sentence, no allowlist, no exemption marker
 *
 * A binary expression whose operator is `??`, `??=` or `||=`; or whose operator is `||` and whose right
 * operand is a value LITERAL (string, template, numeric, bigint, array or object) once every wrapper that
 * changes only its TYPE is stripped — parentheses, `as`, `as const`, `satisfies`, `<T>` and `!` — with a
 * leading `-`/`+` on a number read as part of the number; or a CALL to a pass-through fallback helper,
 * counted as `fallback-helper`.
 *
 * That last clause is the rule that the ratchet exists to make a missing value fail loudly
 * and early, and the batches that emptied this list renamed most of its sites into `absentAsNull` and its
 * kin rather than paying them. A helper is recognised by SHAPE, never by name — `fallbackHelpers.ts` states
 * the criterion — so a renamed copy is caught too. Its blind spots are numbered in one place, and only one:
 * `docs/doctrine-rationale/no-silent-fallback.md` § "Its blind spots".
 *
 * State that sentence whenever you quote this class, never a count — a count is only ever this matcher's
 * output on one commit. There is no exemption marker here and no allowlist, on purpose: a false positive is
 * retired by SHARPENING the sentence, the same discipline `whole-file-json` and `epoch-arithmetic` carry.
 *
 * ### Why `||` is not banned outright, and `?.` is out of scope
 *
 * MEASURED by this gate's own matcher over the tree at the base it landed on (repro: empty the
 * debt list to `{ "sites": [] }`, then `yarn tsx src/devLint/noSilentFallback.entry.ts --rebaseline`): `??`
 * 4,379 sites over 1,502 files, `??=` 15 over 9, `||=` 0, and `||-literal` 49 over 38 — against 4,503 `||`
 * tokens over 1,616 files in the same trees. The base is named because a live count moves under any reader:
 * the RATIO is what argues, and it holds. `||`'s right operand is a comparison, a `!`, or a predicate call
 * in about 99 of every 100 of them, so `a === undefined || b === undefined` is a
 * boolean connective, not a fallback, and refusing it would make the gate cry wolf on ordinary conditions.
 * What is unambiguously a fallback is a `||` whose right operand is a value literal: `labelIds.join("+") ||
 * "-"` substitutes exactly the way `??` does, and worse, because it also swallows a legitimate `0` and an
 * intentional empty string. **Its stated blind spot**: a `||` falling back to an identifier or a property
 * access (`name || fallbackName`) is invisible here, because no syntax-only test separates it from the
 * boolean `word === undefined || word.dynamic`. Closing that half needs resolved types, and the
 * `named-object-params` header says what a second whole-repo `ts.Program` costs.
 *
 * `?.` is deliberately NOT in scope. It propagates an absence rather than substituting a value — the reader
 * still receives `undefined` and still has to handle it — and `.claude/rules/testing.md` explicitly permits
 * it inside a predicate. A different class, and merging them would blunt this one.
 *
 * ### Why the two `house-rules` coalesce rules STAY
 *
 * `no-empty-string-coalesce` and `no-empty-template-coalesce` are strict subsets of this criterion, so an
 * empty-string coalesce reports twice. That is deliberate rather than an oversight: those two refuse
 * outright, with a better-targeted message, in a file whose debt entry below would still permit another
 * one. Deleting them to avoid a double report would weaken the tree.
 *
 * ## The debt list is a committed baseline, and it can only tighten
 *
 * No allowlist, and a debt list for standing sites, over four and a half thousand sites is not a
 * hand-written `DEBT` array — `whole-file-json`'s shape works at sixteen entries and not at this many. It is the
 * `file-size-ratchet` shape: {@link BASELINE_FILE} names today's sites by
 * `{ path, operator, count }`, the gate REFUSES a pair that is new or whose count grew, and `--rebaseline`
 * tightens the committed set while refusing to raise any entry. A list that cannot be widened by hand is
 * not an allowlist: nothing an author writes can excuse a new site.
 *
 * **Its residue, stated rather than discovered**: the unit of the ratchet is a count, so a file holding two
 * refused sites can delete one and add another and stay green. Keying on the expression's own text instead
 * would trip on every unrelated rename, which is how a ratchet stops being read. What was bought is that the
 * tree's total can only fall.
 *
 * Pure cores ({@link scanNoSilentFallback}, {@link countsOf}, {@link parseBaselineJson},
 * {@link regressionsOf}, {@link worseningsOf}) are unit-tested; the thin {@link runNoSilentFallback} edge
 * reads the sources and the debt list, and prints.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { NodeVisitor } from "#lib/tsSyntax.js";
import { forEachChild, ts, withSourceFile } from "#lib/tsSyntax.js";
import { type Result } from "../lib/result.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { decodeDebtList, readCommittedInput } from "./decodeDebtList.js";
import { type DevLintInputError } from "./errors.js";
import { fallbackHelperCallHits, fallbackHelperExports, type HelperExports, shortTextOf } from "./fallbackHelpers.js";
import { type FallbackOperator, operatorOf } from "./noSilentFallbackOperators.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/** The committed debt list, repo-relative. */
const BASELINE_FILE = ".baselines/no-silent-fallback-baseline.json";

/** Every operator label, in the order a debt list and a refusal print them. */
const FALLBACK_OPERATORS: readonly FallbackOperator[] = ["??", "??=", "||=", "||-literal", "fallback-helper"];

/** One refused site: where it is, which spelling, and the expression as written. */
export interface FallbackHit {
  readonly path: string;
  readonly line: number;
  readonly operator: FallbackOperator;
  readonly text: string;
}

/** The helper map a one-file scan reads when its caller ran no whole-tree pre-pass. */
const NO_HELPER_EXPORTS: HelperExports = new Map();

/**
 * Every refused site in `content`: the operator sites in source order, then the `fallback-helper` calls.
 * Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path, carried onto each hit for reporting
 * @param content the file's text
 * @param helperExports the tree's exported pass-through fallback helpers, from {@link fallbackHelperExports}
 * @returns each refused site
 */
export function scanNoSilentFallback({
  path,
  content,
  helperExports = NO_HELPER_EXPORTS,
}: {
  path: string;
  content: string;
  helperExports?: HelperExports;
}): readonly FallbackHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly FallbackHit[] => {
      const hits: FallbackHit[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isBinaryExpression(node)) {
          const operator = operatorOf({ node });
          if (operator !== undefined) {
            hits.push({
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              operator,
              path,
              text: shortTextOf({ node }),
            });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return [...hits, ...fallbackHelperCallHits({ helperExports, path, sf })];
    },
  });
}

/** One `{ path, operator }` pair and how many sites of it stand. */
export interface FallbackCount {
  readonly path: string;
  readonly operator: FallbackOperator;
  readonly count: number;
}

/** The key a pair is tallied and compared under — a tab cannot occur in either half. */
function keyOf({ path, operator }: { path: string; operator: FallbackOperator }): string {
  return `${path}\t${operator}`;
}

/**
 * Collapse a scan into one entry per `{ path, operator }` pair, sorted by path then by operator order. Pure.
 *
 * @param hits every refused site
 * @returns the counted pairs, in the debt list's own order
 */
export function countsOf({ hits }: { hits: readonly FallbackHit[] }): readonly FallbackCount[] {
  const tally = new Map<string, FallbackCount>();
  for (const hit of hits) {
    const key = keyOf({ operator: hit.operator, path: hit.path });
    const standing = tally.get(key);
    const count = standing === undefined ? 1 : standing.count + 1;
    tally.set(key, { count, operator: hit.operator, path: hit.path });
  }
  return [...tally.values()].toSorted(
    (a, b) =>
      a.path.localeCompare(b.path) || FALLBACK_OPERATORS.indexOf(a.operator) - FALLBACK_OPERATORS.indexOf(b.operator),
  );
}

/** The committed debt list: every `{ path, operator }` pair standing when it was last tightened. */
export interface FallbackBaseline {
  readonly sites: readonly FallbackCount[];
}

const baselineSchema = z.object({
  sites: z.array(
    z.object({
      count: z.number().int().nonnegative(),
      operator: z.enum(["??", "??=", "||=", "||-literal", "fallback-helper"]),
      path: z.string().min(1),
    }),
  ),
});

/**
 * Decode a committed debt list. Pure.
 *
 * @param text the debt list's file text
 * @returns the decoded list, or an error string
 */
export function parseBaselineJson({ text }: { text: string }): Result<FallbackBaseline, DevLintInputError> {
  return decodeDebtList({
    label: "no-silent-fallback debt list",
    schema: baselineSchema,
    shape: "{ sites: [{ path, operator, count }] }",
    text,
  }).map((decoded) => ({ sites: decoded.sites }));
}

/** One `{ path, operator }` pair that is new against the debt list, or whose count grew. */
export interface FallbackRegression {
  readonly path: string;
  readonly operator: FallbackOperator;
  readonly count: number;
  readonly baselineCount: number | undefined;
}

/**
 * Every current pair that is NEW (absent from the debt list) or WORSE (more sites than its entry). Pure —
 * the property the gate actually enforces.
 *
 * @param current every counted pair standing now
 * @param baseline the committed debt list
 * @returns each regression, in `current`'s order (empty when the ratchet holds)
 */
export function regressionsOf({
  current,
  baseline,
}: {
  current: readonly FallbackCount[];
  baseline: FallbackBaseline;
}): readonly FallbackRegression[] {
  const floor = new Map(
    baseline.sites.map((site) => [keyOf({ operator: site.operator, path: site.path }), site.count]),
  );
  const regressions: FallbackRegression[] = [];
  for (const site of current) {
    const baselineCount = floor.get(keyOf({ operator: site.operator, path: site.path }));
    if (baselineCount === undefined || site.count > baselineCount) {
      regressions.push({ baselineCount, count: site.count, operator: site.operator, path: site.path });
    }
  }
  return regressions;
}

/**
 * Every regression that already had an entry and got WORSE. Pure — what `--rebaseline` refuses, deliberately
 * narrower than {@link regressionsOf}: a brand-new file's first entry is a legitimate addition to a widening
 * list, never a reason to refuse tightening the ones that grew.
 *
 * @param regressions the full regression list
 * @returns only the entries that had a count on the debt list and exceeded it
 */
export function worseningsOf({
  regressions,
}: {
  regressions: readonly FallbackRegression[];
}): readonly FallbackRegression[] {
  return regressions.filter((one) => one.baselineCount !== undefined);
}

/** This gate's declared scan predicate: every `.ts` under the source trees, tests included. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "noSilentFallback" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/** Print each refused site behind a regression, so an author has line numbers rather than a count. */
function writeRegressionSites({
  hits,
  regressions,
}: {
  hits: readonly FallbackHit[];
  regressions: readonly FallbackRegression[];
}): void {
  const wanted = new Set(regressions.map((one) => keyOf({ operator: one.operator, path: one.path })));
  for (const hit of hits) {
    if (wanted.has(keyOf({ operator: hit.operator, path: hit.path }))) {
      process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.text}\n`);
    }
  }
}

/** The compare branch: pass, or print every new/worse pair against the committed debt list. */
function reportRegressions({
  current,
  hits,
  regressions,
}: {
  current: readonly FallbackCount[];
  hits: readonly FallbackHit[];
  regressions: readonly FallbackRegression[];
}): number {
  if (regressions.length === 0) {
    const standing = `${String(hits.length)} standing site(s), ${String(current.length)} debt entr(ies)`;
    process.stdout.write(`no-silent-fallback: clean (${standing})\n`);
    return 0;
  }
  writeRegressionSites({ hits, regressions });
  for (const one of regressions) {
    const floor = one.baselineCount === undefined ? "new debt entry" : `floor ${String(one.baselineCount)}`;
    process.stderr.write(`  ${one.path} [${one.operator}]: ${String(one.count)} site(s) (${floor})\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "no-silent-fallback" }),
      detail: `${String(regressions.length)} new or worsened debt entr(ies)`,
    })}\n`,
  );
  return 1;
}

/** The `--rebaseline` branch: write the current site set, or refuse an existing entry's growth. */
function applyRebaseline({
  baselinePath,
  current,
  regressions,
}: {
  baselinePath: string;
  current: readonly FallbackCount[];
  regressions: readonly FallbackRegression[];
}): number {
  const worsenings = worseningsOf({ regressions });
  if (worsenings.length > 0) {
    for (const one of worsenings) {
      const grew = `${String(one.baselineCount)} -> ${String(one.count)}`;
      process.stderr.write(`  ${one.path} [${one.operator}]: ${grew} site(s)\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "no-silent-fallback-rebaseline" }),
        detail: `${String(worsenings.length)} worsened entr(ies)`,
      })}\n`,
    );
    return 1;
  }
  writeFileSync(baselinePath, `${JSON.stringify({ sites: current }, null, 2)}\n`);
  process.stdout.write(`no-silent-fallback: debt list tightened to ${String(current.length)} entr(ies)\n`);
  return 0;
}

/** Load the committed debt list, or say why it could not be read. */
function loadBaseline({ baselinePath }: { baselinePath: string }): Result<FallbackBaseline, DevLintInputError> {
  return readCommittedInput({ kind: "debt list", path: baselinePath }).andThen((text) => parseBaselineJson({ text }));
}

/**
 * IO edge: scan every source file, judge it against the committed debt list, or (`--rebaseline`)
 * tighten that list to what stands now.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runNoSilentFallback(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("no-silent-fallback: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const baselinePath = join(root, BASELINE_FILE);
  const baseline = loadBaseline({ baselinePath });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports that failure
    // rather than a verdict about code it never saw
    process.stderr.write(`no-silent-fallback: ${baseline.error.message}\n`);
    return 1;
  }
  // Read once, then two passes: the helper map must be whole before a single call is counted.
  const {
    hits: files,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<{ path: string; content: string }>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: (file) => [file],
  });
  const helperExports = fallbackHelperExports({ files });
  const hits = files.flatMap(({ content, path }) => scanNoSilentFallback({ content, helperExports, path }));
  const complete = reportScanIntegrity({
    label: "no-silent-fallback",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const current = countsOf({ hits });
  const regressions = regressionsOf({ baseline: baseline.value, current });
  if (!complete && regressions.length === 0) {
    return 1;
  }
  if (process.argv.includes("--rebaseline")) {
    return applyRebaseline({ baselinePath, current, regressions });
  }
  return reportRegressions({ current, hits, regressions });
}
