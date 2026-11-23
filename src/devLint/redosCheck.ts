/**
 * The ReDoS gate — replaces `eslint-plugin-regexp`'s `no-super-linear-backtracking` (deleted along with
 * ESLint itself; oxlint has no ReDoS rule). Rather than reimplement backtracking analysis by hand, this
 * leans on `scslre` — the exact static-analysis library that rule itself calls, with the exact same options
 * (`reportTypes: { Move: false }`, `assumeRejectingSuffix: false`, both read straight from
 * `no-super-linear-backtracking.ts`'s own source rather than guessed): a naive first attempt with the more
 * popular `redos-detector` library flagged 106 patterns this codebase's real ESLint gate has always passed
 * clean on — its default scoring treats ordinary unanchored-suffix scans (`/\/+$/`, `/<[^>]+>/`, …) as
 * "unsafe", which is exactly the `MoveReport` category `scslre`'s real caller explicitly excludes.
 *
 * Finds every regex literal and every `new RegExp("pattern", flags)` call whose pattern is a string literal
 * (a dynamically-built pattern cannot be checked statically, so it is skipped, not flagged), and asks
 * `scslre` whether it has any `Self`/`Trade` (polynomial or exponential backtracking) report.
 *
 * Pure {@link scanRedos} (unit-tested with inline fixtures) + an effectful {@link runRedosCheck} edge.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyse } from "scslre";
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
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

/** One catastrophic-backtracking regex: where it is and why `redos-detector` flagged it. */
export interface RedosHit {
  readonly path: string;
  readonly line: number;
  readonly pattern: string;
  readonly reason: string;
}

/** A regex literal's flags, split from its full source text (e.g. `/^a+$/gi` → `{ pattern: "^a+$", flags: "gi" }`). */
function splitRegexLiteral({ text }: { text: string }): { pattern: string; flags: string } {
  const flagsMatch = /[a-z]*$/i.exec(text)!;
  const flags = flagsMatch[0];
  const withoutFlags = text.slice(0, text.length - flags.length);
  return { flags, pattern: withoutFlags.slice(1, -1) };
}

/** The pattern + flags a node names, if it is a regex literal or a `new RegExp(stringLiteral, ...)` call. */
function regexOf({ node }: { node: ts.Node }): { pattern: string; flags: string } | undefined {
  if (ts.isRegularExpressionLiteral(node)) {
    return splitRegexLiteral({ text: node.text });
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp") {
    const { arguments: args } = node;
    // `new RegExp` written with no parentheses at all carries no argument list, so it names no pattern.
    if (args === undefined) {
      return undefined;
    }
    const [patternArg, flagsArg] = args;
    if (patternArg === undefined || !isStringLiteralLikeNode(patternArg)) {
      return undefined;
    }
    const flags = flagsArg !== undefined && isStringLiteralLikeNode(flagsArg) ? flagsArg.text : "";
    return { flags, pattern: patternArg.text };
  }
  return undefined;
}

/**
 * Every catastrophic-backtracking regex in `content`. Pure — parses in memory with the TypeScript AST and
 * delegates the actual analysis to `scslre`.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each unsafe regex, in source order
 */
export function scanRedos({ path, content }: { path: string; content: string }): readonly RedosHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly RedosHit[] => {
      const hits: RedosHit[] = [];
      const visit: NodeVisitor = (node) => {
        const found = regexOf({ node });
        if (found !== undefined) {
          let reports: ReturnType<typeof analyse>["reports"];
          try {
            reports = analyse(
              { flags: found.flags, source: found.pattern },
              { assumeRejectingSuffix: false, reportTypes: { Move: false } },
            ).reports;
          } catch {
            forEachChild({ node, visit });
            return;
          }
          if (reports.length > 0) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            const kind = reports.some((r) => r.exponential) ? "exponential backtracking" : "polynomial backtracking";
            hits.push({ line, path, pattern: found.pattern, reason: kind });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * This gate's declared scan predicate: a `.ts` file under `src/`, `eval/` or `hooks/`, not this gate's own
 * source.
 */
const SCOPE: ScanScope = { selfFiles: gateSelfFiles({ stem: "redosCheck" }), trees: ["src/", "eval/", "hooks/"] };

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each unsafe regex, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 an unsafe regex found or not a git checkout)
 */
export function runRedosCheck(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("redos-check: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<RedosHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanRedos({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "redos-check",
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
    process.stdout.write(`redos-check: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: /${hit.pattern}/ (${hit.reason})\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "redos-check" }),
      detail: `${String(hits.length)} catastrophic-backtracking regex(es)`,
    })}\n`,
  );
  return 1;
}
