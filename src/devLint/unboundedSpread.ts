/**
 * The unbounded-spread gate — a ratchet against the defect class that took the whole bronze reader down:
 * `into.push(...from)` where `from` is sized by DATA rather than by a fixed page or batch.
 *
 * ## Why the rule is scoped to files that read from disk, rather than banning the spread everywhere
 *
 * The unsafe and the safe shape are syntactically identical — both are `x.push(...y)` — and which one you
 * have depends entirely on the runtime size of `y`. No purely syntactic rule can tell them apart, and the
 * repo has ~50 legitimately-bounded per-page spreads that a blanket ban would bury in suppressions.
 *
 * So the gate uses the one signal that DOES separate them: a `readFileSync` / `readdirSync` / `statSync` in
 * the same module means its array sizes come from the filesystem — a whole file's rows, a whole subtree's
 * files, one warning per corrupt record — none of which has a ceiling. Network paging code, which is where
 * almost every safe spread lives, is bounded by its page limit and is not in scope.
 *
 * That makes this a precise, zero-false-positive ratchet rather than a style preference: at the time of
 * writing, every disk-reading module in `src/` uses {@link appendAll} and this gate reports clean. The cost
 * is that adding a disk read to a module forces its existing spreads through `appendAll` too — which is the
 * correct prompt to review them, not a nuisance.
 *
 * Mirrors the other gates' shape: a PURE {@link scanUnboundedSpread} (unit-tested on inline fixtures, so
 * this file never scans itself) plus an effectful {@link runUnboundedSpread} edge over the working tree.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/** One unbounded-spread hit. */
export interface SpreadHit {
  readonly path: string;
  readonly line: number;
  readonly excerpt: string;
}

/**
 * A spread-append: `<anything>.push(...<anything>)`. Deliberately NOT matching `Math.max(...)` /
 * `Math.min(...)`, which have the same argument-limit hazard but are used here only over provably tiny
 * fixed sets (a per-source mtime list, a 200-candidate score pool) and would be pure noise.
 */
const SPREAD_PUSH = /\.push\(\s*\.\.\./;

/** The filesystem reads that mark a module's array sizes as data-driven rather than page-driven. */
const DISK_READ = /\b(?:readFileSync|readdirSync|statSync|readdir|readFile)\s*\(/;

/**
 * Whether this module's array sizes are driven by the filesystem, which is what puts it in scope.
 *
 * @param content the file's text
 * @returns true when the module reads from disk
 */
export function readsFromDisk({ content }: { content: string }): boolean {
  return DISK_READ.test(content);
}

/**
 * Pure: every spread-append in a disk-reading file, with line numbers. A file that does no disk read
 * yields nothing, however many spreads it contains.
 *
 * Lines that are comments are skipped, so prose describing the forbidden shape (as this repo's own
 * explanatory comments must) never trips the gate.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each hit (empty when clean or out of scope)
 */
export function scanUnboundedSpread({ path, content }: { path: string; content: string }): readonly SpreadHit[] {
  if (!readsFromDisk({ content })) {
    return [];
  }
  const hits: SpreadHit[] = [];
  content.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }
    if (SPREAD_PUSH.test(line)) {
      hits.push({ excerpt: trimmed, line: index + 1, path });
    }
  });
  return hits;
}

/**
 * This gate's declared scan predicate: a `.ts` file under `src/`, `eval/` or `hooks/`, excluding tests
 * (fixtures deliberately build large arrays) and this gate's own files (its text necessarily contains the
 * forbidden shape as a pattern).
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "unboundedSpread" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the file should be scanned
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code (0 clean, 1 a hit was found or not a git checkout)
 */
export function runUnboundedSpread(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("unbounded-spread: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<SpreadHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanUnboundedSpread({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "unbounded-spread",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(`unbounded-spread: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.excerpt}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "unbounded-spread" }),
      detail: `${String(hits.length)} data-scale spread-append(s)`,
    })}\n`,
  );
  return 1;
}
