/**
 * The sync-child-timeout gate — a synchronous child process this tree starts carries its own `timeout`.
 *
 * ## The criterion
 *
 * A call to `execSync`, `execFileSync` or `spawnSync` — resolved LEXICALLY to a static import of
 * `node:child_process` or `child_process` (named, aliased, namespace or default) — fails unless one of its
 * arguments VISIBLY bounds it: its options resolve to a `timeout` whose last word is not the literal `0` or
 * `undefined` (both "no timeout" to Node). Visibly means an object literal, read last member to first so a later
 * `timeout: 0` or an unseen later spread wins, or a same-file `const` initialised with one
 * (`const options = { …, timeout }`), spread or passed whole. Nothing else is followed — an options object
 * arriving as a PARAMETER, an imported constant, a `let` — because the gate reads syntax, and a bound it cannot
 * see at the call is one a reader cannot see either; an injected runner restates the bound it forwards. A local
 * function or an inner binding that merely shares a launcher's name resolves to ITS declaration, not the import,
 * so it is outside the criterion by construction (`./syncChildTimeoutSyntax.ts`).
 *
 * Blind spots, named rather than discovered: CommonJS `require`, a dynamic `import()`,
 * `process.getBuiltinModule`, a wrapper re-exported from another module, and a namespace copied through another
 * variable. None occurs in this tree; a route through one is a reason to widen the criterion, measured. And a
 * `timeout` VALUE decided outside the file — an imported constant, a parameter, a call's return, a property of
 * an object the file does not declare — is trusted. Every value the file decides itself is evaluated
 * (`./syncChildTimeoutValue.ts`): one that comes to `0`, `undefined` or a negative is refused, and so is a
 * same-file shape the evaluator does not read as a number (a string, `null`, a bit operator). Last, a call
 * passing an EXTRA argument past the options Node reads is judged on any argument carrying a bound, so an
 * `execFileSync` given `{ timeout: 0 }` as its options and `{ timeout: 5_000 }` after them passes although Node
 * applies the `0` — a call the compiler itself refuses, kept a named blind spot.
 *
 * One reviewed marker, `sync-child-timeout-exempt: <reason>` in the leading comments of the call's
 * statement, keeps a child that is unbounded ON PURPOSE — a foreground watch that runs until the owner interrupts
 * it. A bare marker exempts nothing; the reason is what a reviewer reads.
 *
 * Scope: production code under `src/`, `eval/`, `hooks/`, `desktop/` and `site/` (`.ts` and `.tsx`), with
 * tests excluded — a test's child is bounded by the lane's job timeout and is not a seat stalling in front
 * of the owner.
 *
 * ## Why a gate rather than a note
 *
 * A synchronous child blocks the whole Node event loop, so no `setTimeout`, signal handler or outer
 * watchdog inside the process can end it: the only bound is the one passed to the call itself. A child
 * that waits on a prompt nobody can see — a keychain dialog behind `security find-generic-password`, a
 * credential helper or ssh passphrase under `git push`, `gh auth token` on an expired login — stalls the
 * seat silently. Audits counted 68 such calls and later 79: the class grew
 * between the two reads, which is what a gate stops and prose does not. This criterion, sharper than the
 * audit's matcher, refuses 74 on main.
 *
 * ## The debt list only shrinks
 *
 * `.baselines/sync-child-timeout-baseline.json` records, per file, how many calls the criterion refuses today
 * and why each is still unbounded. The gate fails on a file whose count is ABOVE its entry and on one BELOW it (a
 * migrated call whose entry was not lowered), and on a malformed list, so the list can only be tightened; a row
 * added or raised is also a loosening against main that only a witnessed bump record lands. It is a NET-GROWTH
 * ratchet, keyed on a count rather than a line: removing one call and adding another in the same file keeps the
 * count, so it proves the debt did not grow, never that no new call was written.
 *
 * A debt list, not an allowlist: every entry is a real unbounded call waiting on a MEASURED ceiling — a build,
 * an archive extraction, a test lane — where a guessed bound would kill a legitimate slow run. A shape the
 * criterion should not match is fixed by sharpening the criterion, never by an entry. Re-measure with
 * `yarn tsx src/devLint/syncChildTimeout.entry.ts` against an emptied list.
 *
 * Pure {@link scanSyncChildTimeout} + {@link judgeAgainstDebt}, effectful {@link runSyncChildTimeout} edge.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Result } from "#lib/result.js";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { decodeDebtList, readCommittedInput } from "./decodeDebtList.js";
import type { DevLintInputError } from "./errors.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";
import { callIsBounded, importsChildProcess, launcherOf, type SyncApi } from "./syncChildTimeoutSyntax.js";

/** One file's standing debt: how many calls the criterion refused there when the entry was last tightened. */
export interface SyncChildTimeoutDebt {
  readonly path: string;
  readonly count: number;
}

/** The committed debt list, repo-relative. */
const BASELINE_FILE = ".baselines/sync-child-timeout-baseline.json";

/**
 * The list's row types only, strict so a field the gate does not read is refused rather than dropped: a
 * non-positive count, a repeated path and path order are {@link judgeAgainstDebt}'s to name, entry by entry.
 * `reason` says why that file's calls are still unbounded.
 */
const BaselineSchema = z.strictObject({
  files: z.array(z.strictObject({ count: z.number(), path: z.string(), reason: z.string().trim().min(1) })),
});

/**
 * Decode the committed debt list's text. Pure.
 *
 * @param text the contents of `.baselines/sync-child-timeout-baseline.json`
 * @returns one row per file, each with why its calls are still unbounded, or which half of the decode failed
 */
export function parseSyncChildTimeoutBaseline({
  text,
}: {
  text: string;
}): Result<readonly (SyncChildTimeoutDebt & { readonly reason: string })[], DevLintInputError> {
  return decodeDebtList({
    label: "sync-child-timeout baseline",
    schema: BaselineSchema,
    shape: "{ files: [{ path, count, reason }, …] }",
    text,
  }).map((baseline) => baseline.files);
}

/**
 * One synchronous child-process call with no visible `timeout`.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface SyncChildTimeoutHit {
  readonly path: string;
  readonly line: number;
  /** The Node API the call reaches — `execFileSync`, say. */
  readonly api: SyncApi;
}

/** The reviewed exemption marker; a bare one, with no reason after the colon, exempts nothing. */
const EXEMPT_MARKER = /sync-child-timeout-exempt:[ \t]*[^\s*/]/u;

/**
 * Whether the call's enclosing statement carries the exemption marker, with a reason, in its leading
 * comments — anchored on the statement because a marker is written above a LINE and the call is rarely the
 * whole line.
 */
function isExempted({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): boolean {
  let anchor: ts.Node = node;
  while (!ts.isStatement(anchor) && !ts.isSourceFile(anchor)) {
    anchor = anchor.parent;
  }
  const ranges = ts.getLeadingCommentRanges(sf.text, anchor.getFullStart());
  if (ranges === undefined) {
    return false;
  }
  return ranges.some((range) => EXEMPT_MARKER.test(sf.text.slice(range.pos, range.end)));
}

/**
 * Every synchronous child-process call in `content` that passes no visible `timeout`. Pure — parses in memory
 * with the TypeScript AST.
 *
 * @param path the file's repo-relative path, for reporting and to pick the TSX parser
 * @param content the file's text
 * @returns each unbounded call, in source order
 */
export function scanSyncChildTimeout({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly SyncChildTimeoutHit[] {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return withSourceFile({
    fileName: path,
    text: content,
    scriptKind: kind,
    use: (sf): readonly SyncChildTimeoutHit[] => {
      if (!importsChildProcess({ sf })) {
        return [];
      }
      const hits: SyncChildTimeoutHit[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node)) {
          const api = launcherOf({ call: node });
          if (api !== undefined && !callIsBounded({ call: node }) && !isExempted({ node, sf })) {
            hits.push({ api, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, path });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/** What a scan judged against the debt list found: new debt, entries to lower, and a malformed list. */
interface SyncChildTimeoutVerdict {
  /** Every hit in a file whose count is over its entry. */
  readonly fresh: readonly SyncChildTimeoutHit[];
  /** One line per entry recording more calls than its file now has. */
  readonly stale: readonly string[];
  /** One line per malformed entry: a count that is not a positive integer, a repeated path, a path out of order. */
  readonly invalid: readonly string[];
}

/**
 * Every way the list itself is malformed. A zero count never goes stale and a repeated path is silently summed,
 * so both would let an entry outlive its debt; path order keeps a diff to the list reviewable.
 */
function malformedDebt({ debt }: { debt: readonly SyncChildTimeoutDebt[] }): readonly string[] {
  const problems: string[] = [];
  debt.forEach((entry, index) => {
    if (!Number.isInteger(entry.count) || entry.count <= 0) {
      problems.push(`${entry.path}: count ${String(entry.count)} is not a positive integer`);
    }
    if (debt.findIndex((other) => other.path === entry.path) !== index) {
      problems.push(`${entry.path}: listed more than once`);
    }
    const previous = debt[index - 1];
    if (previous !== undefined && previous.path.localeCompare(entry.path) > 0) {
      problems.push(`${entry.path}: out of path order (after ${previous.path})`);
    }
  });
  return problems;
}

/**
 * The verdict of a scan against the debt list: files with MORE unbounded calls than recorded (new debt) and
 * files with FEWER (an entry to lower). Keyed on path and count rather than a line, so moving a call inside
 * its file is not a failure while adding one is. Pure.
 *
 * @param hits every unbounded call the scan found
 * @param debt the committed per-file counts
 * @returns the regressed files with their hits, the entries to tighten, and the malformed entries
 */
export function judgeAgainstDebt({
  hits,
  debt,
}: {
  hits: readonly SyncChildTimeoutHit[];
  debt: readonly SyncChildTimeoutDebt[];
}): SyncChildTimeoutVerdict {
  const found = ({ path }: { path: string }): number => hits.filter((hit) => hit.path === path).length;
  const recorded = ({ path }: { path: string }): number =>
    debt.filter((entry) => entry.path === path).reduce((sum, entry) => sum + entry.count, 0);
  const over = new Set(hits.map((hit) => hit.path).filter((path) => found({ path }) > recorded({ path })));
  const stale = debt
    .filter((entry) => found({ path: entry.path }) < entry.count)
    .map((entry) => `${entry.path}: recorded ${String(entry.count)}, found ${String(found({ path: entry.path }))}`);
  return { fresh: hits.filter((hit) => over.has(hit.path)), invalid: malformedDebt({ debt }), stale };
}

/**
 * This gate's declared scan predicate: production `.ts`/`.tsx` under the five source trees, minus tests and
 * this gate's own files, whose text names the launchers it refuses.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  extensions: [".ts", ".tsx"],
  selfFiles: gateSelfFiles({ stem: "syncChildTimeout" }),
  trees: ["src/", "eval/", "hooks/", "desktop/", "site/"],
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

/** Print a non-empty verdict: the new unbounded calls, the entries to lower and the malformed ones. */
function reportVerdict({ fresh, stale, invalid }: SyncChildTimeoutVerdict): void {
  for (const hit of fresh) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: \`${hit.api}\` passes no \`timeout\`\n`);
  }
  if (fresh.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "sync-child-timeout" }),
        detail: `${String(fresh.length)} call(s) in a file over its debt entry`,
      })}\n`,
    );
  }
  const listProblems = [...stale, ...invalid];
  for (const entry of listProblems) {
    process.stderr.write(`  ${entry}\n`);
  }
  if (listProblems.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "sync-child-timeout-debt" }),
        detail: `${String(listProblems.length)} debt entr(ies) to lower or repair`,
      })}\n`,
    );
  }
}

/**
 * IO edge: scan every in-scope file, judge it against the committed debt list, print the verdict.
 *
 * @returns the process exit code (0 clean, 1 a new unbounded call, a stale or malformed entry, or an incomplete scan)
 */
export function runSyncChildTimeout(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("sync-child-timeout: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<SyncChildTimeoutHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanSyncChildTimeout({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "sync-child-timeout",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const debt = readCommittedInput({ kind: "debt list", path: join(root, BASELINE_FILE) }).andThen((text) =>
    parseSyncChildTimeoutBaseline({ text }),
  );
  if (debt.isErr()) {
    // devlint: not-a-refusal -- the committed debt list could not be READ, so the gate has nothing to judge against
    process.stderr.write(`sync-child-timeout: ${debt.error.message}\n`);
    return 1;
  }
  const verdict = judgeAgainstDebt({ debt: debt.value, hits });
  reportVerdict(verdict);
  const failed = verdict.fresh.length > 0 || verdict.stale.length > 0 || verdict.invalid.length > 0;
  if (failed || !complete) {
    return 1;
  }
  process.stdout.write(
    `sync-child-timeout: clean (${String(readCount)} file(s) scanned, ${String(hits.length)} recorded as debt)\n`,
  );
  return 0;
}
