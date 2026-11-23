/**
 * The hatch-release gate — an escape hatch that a caller can silently switch off is not an escape hatch.
 *
 * ## The measurement this exists for
 *
 * MEASURED, from a handoff seat:
 * `SLOPWEAVER_ALLOW_SPENT_PLAN=1 slopweaver cmux spawn <slug> --model fable` was refused with the IDENTICAL
 * text it had already printed without the variable — *"To override, run the same command again with
 * SLOPWEAVER_ALLOW_SPENT_PLAN=1"* — so the block instructed the operator to do the thing the operator had
 * just done. With the rule that a supervisor runs on Fable and no other model, that left the
 * supervisor chain unable to seat any successor at all.
 *
 * The cause was one line. `cmux/spawn.ts`'s `productionSpawnDeps` read the variable as a PARAMETER DEFAULT
 * (`allowSpentPlan = process.env[ALLOW_SPENT_PLAN_ENV] === "1"`), and a default initialiser is skipped
 * whenever a caller passes that argument at all. `cmux spawn` always passed one — its own `--force` flag,
 * `false` when the flag was absent — so on the ONE verb whose refusal named the variable, the variable was
 * inert. The methodology: there is always an escape hatch, and heavy-handed hard blocks are avoided because
 * they strand the operator exactly like this.
 *
 * ## The criterion
 *
 * An escape-hatch environment read that sits inside a PARAMETER DEFAULT. Both halves are syntax:
 *
 * - **an escape-hatch read** is `process.env[…]` or `process.env.…` where the key is an override-variable
 *   string literal (`./overrideVariable.ts`: an `ALLOW` or `OVERRIDE` component, matched on the name's
 *   SHAPE rather than against the register, so an undeclared hatch is still watched here), or an identifier
 *   this repository binds to one (the real defect went through `ALLOW_SPENT_PLAN_ENV`, so a literal-only criterion would have missed it);
 * - **a parameter default** is anything reachable from a `ParameterDeclaration`'s own initialiser or from a
 *   default inside its binding pattern.
 *
 * The correction is always the same and never weakens anything: read the variable into a local and OR it
 * with the caller's argument, so a caller can only ever ADD to the hatch. That is why this gate ships no
 * exemption marker — there is no shape where the defaulted spelling is the right one.
 *
 * Syntax-only on purpose: no resolved types, no whole-repo `ts.Program`, so this joins the cheap AST gates
 * (`noNestedTernaries.ts`, `epochArithmetic.ts`) rather than the measured-heap one.
 *
 * ## Why it is not a fourth criterion inside `escapeHatch.ts`
 *
 * That gate is deliberately text-and-line based — every one of its three criteria is about a LITERAL a gate
 * author writes. This one is about a POSITION in the syntax tree, and the defect reached production written
 * as an identifier rather than a literal. Bolting an AST walk onto a line scanner would have made both
 * harder to read than two gates that each do one thing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, isParameterDeclaration, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { isOverrideVariableName } from "./overrideVariable.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfPaths,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/**
 * One violation: where the read is, and which key it was reading.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface HatchReleaseHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/**
 * Every identifier one file binds to a hatch variable's NAME — `const ALLOW_SPENT_PLAN_ENV = "SLOPWEAVER_…"`.
 *
 * Collected across the whole tree and applied everywhere, because the read and the constant sit in different
 * modules in the case that produced this gate: `claude/spawnStoreRefusals.ts` declares the name and `cmux/spawnDeps.ts`
 * reads it. Matching by identifier NAME rather than by import edge is deliberate — an import renamed at the
 * call site is rare, a second unrelated constant of the same name is rarer still, and over-reporting a
 * `process.env[SOMETHING]` written as a parameter default is the safe direction.
 *
 * @param content the file's text
 * @param path the file's repo-relative path, for the in-memory parse
 * @returns the identifier names this file binds to a hatch variable name
 */
export function hatchEnvAliases({ content, path }: { content: string; path: string }): readonly string[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly string[] => {
      const names: string[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
          const initialiser = node.initializer;
          if (ts.isStringLiteral(initialiser) && isOverrideVariableName({ name: initialiser.text })) {
            names.push(node.name.text);
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return names;
    },
  });
}

/**
 * The hatch variable a `process.env` access is reading, or undefined when it is reading something else.
 *
 * @param node the access to classify
 * @param sf the parsed file the node came from
 * @param aliases every identifier the tree binds to a hatch variable name
 * @returns the key exactly as it is written at the read — the literal, or the identifier — else undefined
 */
function hatchKeyRead({
  node,
  sf,
  aliases,
}: {
  node: ts.Node;
  sf: ts.SourceFile;
  aliases: ReadonlySet<string>;
}): string | undefined {
  if (ts.isElementAccessExpression(node) && node.expression.getText(sf) === "process.env") {
    const argument = node.argumentExpression;
    if (ts.isStringLiteral(argument) && isOverrideVariableName({ name: argument.text })) {
      return argument.text;
    }
    if (ts.isIdentifier(argument) && aliases.has(argument.text)) {
      return argument.text;
    }
    return undefined;
  }
  if (ts.isPropertyAccessExpression(node) && node.expression.getText(sf) === "process.env") {
    return isOverrideVariableName({ name: node.name.text }) ? node.name.text : undefined;
  }
  return undefined;
}

/**
 * Every hatch read written as a parameter default in `content`. Pure — parses in memory with the TypeScript
 * AST, and takes the alias set rather than going and reading the tree for itself.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @param aliases every identifier the tree binds to a hatch variable name
 * @returns each violation, in source order
 */
export function scanHatchRelease({
  path,
  content,
  aliases,
}: {
  path: string;
  content: string;
  aliases: ReadonlySet<string>;
}): readonly HatchReleaseHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly HatchReleaseHit[] => {
      const hits: HatchReleaseHit[] = [];
      const visit = ({ node, inDefault }: { node: ts.Node; inDefault: boolean }): void => {
        if (isParameterDeclaration(node)) {
          // A parameter's TYPE cannot hold a read; its initialiser and its binding pattern's own defaults can.
          visit({ inDefault: true, node: node.name });
          if (node.initializer !== undefined) {
            visit({ inDefault: true, node: node.initializer });
          }
          return;
        }
        const key = inDefault ? hatchKeyRead({ aliases, node, sf }) : undefined;
        if (key !== undefined) {
          hits.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            message:
              `the escape hatch ${key} is read as a PARAMETER DEFAULT, so any caller that passes the argument ` +
              "at all silently switches the hatch off — which is how `cmux spawn` came to refuse with the very " +
              "variable it told the operator to set. Read it into a local and OR it with the argument instead, " +
              "so a caller can only ever ADD to the hatch (see `spentPlanHatchOpen` in src/claude/spawnStore.ts).",
            path,
          });
        }
        forEachChild({
          node,
          visit: (child) => {
            visit({ inDefault, node: child });
          },
        });
      };
      visit({ inDefault: false, node: sf });
      return hits;
    },
  });
}

/** This gate's declared scan predicate: every `.ts` and `.tsx` under the source trees, minus its own files. */
const SCOPE: ScanScope = {
  extensions: [".ts", ".tsx"],
  selfFiles: gateSelfPaths({ stem: "hatchRelease" }),
  trees: ["src/", "eval/", "hooks/", "desktop/"],
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
 * IO edge: collect the tree's hatch aliases, then scan every source file for a defaulted read.
 *
 * Two passes over the same file list rather than one, because the read and the constant it reads live in
 * different modules — a single pass would judge `cmux/spawnDeps.ts` before it had seen `claude/spawnStore.ts`.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runHatchRelease(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("hatch-release: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const aliases = new Set<string>(
    scanTextFiles<string>({
      paths: scanned,
      readText: ({ path }) => readFileSync(join(root, path), "utf8"),
      scan: ({ content, path }) => hatchEnvAliases({ content, path }),
    }).hits,
  );
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<HatchReleaseHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanHatchRelease({ aliases, content, path }),
  });
  const complete = reportScanIntegrity({
    label: "hatch-release",
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
    process.stdout.write(
      `hatch-release: clean (${String(readCount)} file(s) scanned, ${String(aliases.size)} hatch alias(es) known)\n`,
    );
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "hatch-release" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
