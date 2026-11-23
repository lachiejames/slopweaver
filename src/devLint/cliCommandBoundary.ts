/**
 * The cli-command-boundary gate — product code never imports the verb tree.
 *
 * ## The criterion
 *
 * A non-test file under `src/` but outside `src/cli/` fails when one of its static `import`, `import x =
 * require(…)` or `export … from` declarations — a type-only one included — resolves under `src/cli/commands/`. Specifiers are resolved with
 * the same `resolveSpecifier` the untested-modules gate uses, so a relative path and a `#lib/` subpath read the
 * same way and a bare package name is never a hit. No allowlist, no exemption marker, no debt list: the tree
 * was brought to zero in the change that added the gate.
 *
 * ## Why a gate rather than a note
 *
 * Because the edge regenerates through ordinary work. MEASURED on `main`, 14 product files
 * (`live/turn/`, `live/resync/`, `worktree/`, `fleet/`, `cmux/`, `checkouts/`, `devLint/`) held 17 static
 * imports of a verb module, each reaching for a helper a verb happened to define first — the bot's answer path
 * loaded the Slack verb's chat wiring that way. Each import was reasonable where it was written; together they
 * made a verb module a library. The fix moved each shared helper DOWN to the tree that owns its concept, and
 * this gate keeps the direction: `cli/` depends on product code, never the reverse. Reproduce the count with
 * `git grep -cE "from ['\"](\./|(\.\./)+)cli/commands" <sha> -- src ":!src/__tests__" ":!src/cli"`.
 *
 * What it does NOT claim: that the top-level tree graph is acyclic. Product code still statically imports
 * `cli/`'s registry and parsing modules (`nounGroups.ts`, `optionParsers.ts`, `exitCodes.ts` and others), and
 * the product trees import one another in cycles of their own, so the largest strongly connected component of
 * that graph is the same size with and without these 17 edges.
 *
 * ## The blind spot, named
 *
 * A dynamic `import("…")` is outside the criterion on purpose. The atlas registration thunks load a verb's
 * module that way so the verb stays off every unrelated load path, which is a deferred call rather than a
 * library edge. A `typeof import("…")` type query is outside it for the same reason a syntax walk cannot tell
 * the two apart cheaply, and so are a JSDoc `import("…")` type and a `/// <reference path>` directive: only a
 * top-level declaration statement is read.
 *
 * Pure {@link scanCliCommandBoundary} + an effectful {@link runCliCommandBoundary} edge, matching the other
 * gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  isTestFilePath,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";
import { resolveSpecifier } from "./untestedModules.js";

/**
 * One product module importing the verb tree: where the declaration is and what it reaches.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface CliCommandBoundaryHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The tree that may import a verb module, because it is the verb surface. */
const CLI_TREE = "src/cli/";

/** The verb tree no product module may import. */
const COMMANDS_TREE = "src/cli/commands/";

/**
 * The module specifier of a static import, an `import x = require(…)` or a re-export, or `undefined` for a
 * local `export { … }`.
 */
function staticSpecifier({ statement }: { statement: ts.Statement }): string | undefined {
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    return statement.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(statement) &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    ts.isStringLiteral(statement.moduleReference.expression)
  ) {
    return statement.moduleReference.expression.text;
  }
  if (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier.text;
  }
  return undefined;
}

/**
 * Every static import or re-export in `content` that reaches `src/cli/commands/`. Pure — parses in memory.
 *
 * @param path the file's repo-relative path, which resolves each specifier and exempts `src/cli/` and tests
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanCliCommandBoundary({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly CliCommandBoundaryHit[] {
  if (path.startsWith(CLI_TREE) || isTestFilePath({ path }) || path.includes("/__tests__/")) {
    return [];
  }
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly CliCommandBoundaryHit[] =>
      sf.statements.flatMap((statement): CliCommandBoundaryHit[] => {
        const specifier = staticSpecifier({ statement });
        if (specifier === undefined) {
          return [];
        }
        const target = resolveSpecifier({ fromPath: path, specifier });
        if (target === undefined || !target.startsWith(COMMANDS_TREE)) {
          return [];
        }
        return [
          {
            line: sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1,
            message:
              `imports \`${target}\`, a verb module. Product code never depends on the verb tree: move what ` +
              "it needs down to the tree that owns the concept, and let the verb import it from there.",
            path,
          },
        ];
      }),
  });
}

/**
 * This gate's declared scan predicate: every non-test `.ts` under `src/`, its own files INCLUDED. A text gate
 * exempts itself because its own source spells the pattern it hunts; this one reads import declarations, so its
 * own prose cannot trip it, and an exemption would only let its own source and entry point import a verb.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: new Set(),
  trees: ["src/"],
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

/**
 * IO edge: scan every product source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runCliCommandBoundary(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("cli-command-boundary: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<CliCommandBoundaryHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanCliCommandBoundary({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "cli-command-boundary",
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
    process.stdout.write(`cli-command-boundary: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "cli-command-boundary" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
