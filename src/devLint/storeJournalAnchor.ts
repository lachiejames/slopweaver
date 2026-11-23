/**
 * The store-journal-anchor gate — the committed migration journal is resolved from the tree this build
 * lives in, never from the directory the operator happens to be standing in.
 *
 * ## The defect this closes, measured
 *
 * `supabase/migrations/` is a COMMITTED BUILD ASSET, and for months every reader of it resolved it against
 * `process.cwd()`. In the main checkout that is invisible — cwd IS the tree — so the class survives every
 * test a main-checkout session can think to run. It fires only somewhere else. MEASURED: two
 * spawned seats an hour apart could
 * neither search nor write the knowledge register from inside a worktree, because the first query every
 * store verb makes — `readMigrationState`, `../store/lifecycle.ts` — read the journal under the seat's own
 * cwd and answered ENOENT. The resolution is fixed; this gate is why it cannot come back.
 *
 * ## The criterion, in two arms
 *
 * 1. **No `process.cwd()` anywhere under `src/store/`.** The store is the tree that resolves the journal,
 *    so the operator's cwd has no business in it at all. With this arm standing, a journal root inside the
 *    store can only be the `installedTreeRoot` default or a value a caller handed in — and arm 2 governs
 *    every caller.
 * 2. **Outside `src/store/`, a `cwd` argument to the journal family is `installedTreeRoot(...)` or
 *    nothing.** The family is {@link JOURNAL_FAMILY}: the two connection openers (`connectStore`,
 *    `applyStore`), which DEFAULT to the installed tree and are therefore called with no `cwd`
 *    at all by all 23 of their callers, and the seven `../store/lifecycle.ts` entry points, which still
 *    require one — so the six `store`-verb call sites that pass it must pass the anchor and nothing else.
 *
 * Together they say one thing: the journal root is always the installed tree. Neither arm has an allowlist
 * or an exemption marker, and there is no standing debt list — both were clean on the commit that added
 * them, because the resolution fix landed first. Making the lifecycle seven default as well would delete
 * those six arguments outright; it is a follow-up rather than part of this gate, because `lifecycle.ts`
 * sits on its `file-size-ratchet` floor and the growth needs a real split to absorb.
 *
 * ## What it does not see
 *
 * Stated rather than discovered, because a gate that reads tighter than it is gets trusted past its reach.
 * All three are the same shape — the `cwd` is real but the syntax does not spell it where this walk looks:
 *
 * - **A spread.** `connectStore({ ...opts })` where `opts` carries a `cwd`.
 * - **An argument that is not an object literal.** `connectStore(opts)`, or the conditional spelling this
 *   repo already uses: `connectStore(home === undefined ? {} : { home })`.
 * - **A family member reached through an alias** or a property on an injected dep, since the match is by name.
 *
 * Widening arm 2 to flag either of the first two is not available: `../cli/commands/store/load.ts` and
 * `../cli/commands/knowledge/record.ts` write exactly those shapes correctly today, so the criterion would
 * red real code to reach a hypothetical. What closes them is the runtime witness below, which does not read
 * syntax at all.
 *
 * ## What is deliberately outside it
 *
 * **The test tree.** A test that materialises a fixture tree and points a verb at it has to pass a `cwd`,
 * and that is the correct thing for it to do; the lane that proves this behaviour for real is
 * `src/__tests__/subprocess/cli/commands/store/journalFromTree.test.ts`, which spawns the SHIPPED binary
 * from an empty directory. Static gate and runtime witness are complements here, exactly as `home-safety`
 * and the ambient-home guard are: this one refuses a new call site, that one proves the shipped verbs
 * behave from a foreign cwd.
 *
 * **The wider "committed build asset" class.** The skills catalogue and the committed register have the
 * same hazard, and `../cmux/pluginDir.ts`'s header documents it — but that class
 * has no enumerable set of symbols, so a gate claiming to check it could not say what it checked. This one
 * names the journal and nothing else. `runningCheckoutRoot.ts` is the neighbouring rule: it keeps a
 * MODULE-anchored git lookup out of a runtime verb, where this keeps the OPERATOR's cwd out of one asset.
 *
 * Pure {@link scanStoreJournalAnchor} + an effectful {@link runStoreJournalAnchor} edge, matching the other
 * gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { appendAll } from "../lib/arrays.js";
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

/** The tree that owns the journal, and whose own forwards of an already-resolved root are not arm 2's business. */
const STORE_TREE = "src/store/";

/** The one expression allowed to produce a journal root. */
const ANCHOR = "installedTreeRoot";

/**
 * Every function that resolves the migration journal from the `cwd` it is handed.
 *
 * The two connection openers (`../store/client.ts`, `../store/migrate.ts`) and the seven entry points in
 * `../store/lifecycle.ts`. Matched by NAME, which is one of this gate's three blind spots — see the file
 * header's § "What it does not see".
 */
const JOURNAL_FAMILY: ReadonlySet<string> = new Set([
  "applyStore",
  "baselineStore",
  "connectStore",
  "pushStore",
  "readJournal",
  "readLandedMigrations",
  "readLiveSchemaFacts",
  "readMigrationState",
  "resetStore",
  "verifyStore",
]);

/**
 * One anchor violation: where it is, and what to write instead.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface StoreJournalAnchorHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The node with any wrapping parentheses stripped, so `(installedTreeRoot(…))` reads the same as the call. */
function unwrapParens({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Whether a call expression is a bare `process.cwd()`. */
function isProcessCwd({ node }: { node: ts.CallExpression }): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "process" &&
    callee.name.text === "cwd"
  );
}

/** The called function's own name, for a plain call or a member call; empty when it has neither. */
function calleeName({ node }: { node: ts.CallExpression }): string {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return "";
}

/** Whether an expression IS the one allowed anchor call. */
function isAnchorCall({ node }: { node: ts.Expression }): boolean {
  const bare = unwrapParens({ node });
  return ts.isCallExpression(bare) && calleeName({ node: bare }) === ANCHOR;
}

/**
 * Whether one object-literal member is a `cwd` this gate refuses.
 *
 * A shorthand (`{ cwd }`) always counts, because the value it forwards is whatever the enclosing scope
 * resolved — which is the shape the defect took at the verb boundary. A written-out `cwd` counts unless its
 * value IS the anchor call.
 *
 * @param property the member being judged
 * @returns true when it is a violation
 */
function isOffendingCwdProperty({ property }: { property: ts.ObjectLiteralElementLike }): boolean {
  if (ts.isShorthandPropertyAssignment(property)) {
    return ts.isIdentifier(property.name) && property.name.text === "cwd";
  }
  if (ts.isPropertyAssignment(property)) {
    return property.name.getText() === "cwd" && !isAnchorCall({ node: property.initializer });
  }
  return false;
}

/**
 * The offending `cwd` members of a call's object-literal arguments.
 *
 * @param node the call being inspected
 * @returns each offending property node
 */
function offendingCwdProperties({ node }: { node: ts.CallExpression }): readonly ts.Node[] {
  const out: ts.Node[] = [];
  for (const argument of node.arguments) {
    if (ts.isObjectLiteralExpression(argument)) {
      appendAll({ from: argument.properties.filter((property) => isOffendingCwdProperty({ property })), into: out });
    }
  }
  return out;
}

/**
 * Every anchor violation in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path, which decides which arm applies
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanStoreJournalAnchor({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly StoreJournalAnchorHit[] {
  const inStore = path.startsWith(STORE_TREE);
  const hits: StoreJournalAnchorHit[] = [];
  withSourceFile({
    fileName: path,
    text: content,
    use: (sf): void => {
      const at = ({ node }: { node: ts.Node }): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node)) {
          if (inStore && isProcessCwd({ node })) {
            hits.push({
              line: at({ node }),
              message:
                "`process.cwd()` under src/store/ anchors the committed migration journal on wherever the " +
                "operator is standing, which is invisible in the main checkout and ENOENT in every worktree " +
                "and spawned seat. Take the `cwd` default (`installedTreeRoot`) instead.",
              path,
            });
          }
          if (!inStore && JOURNAL_FAMILY.has(calleeName({ node }))) {
            for (const property of offendingCwdProperties({ node })) {
              hits.push({
                line: at({ node: property }),
                message:
                  `\`${calleeName({ node })}\` resolves the committed migration journal from this \`cwd\`, so it ` +
                  `must be \`${ANCHOR}({ importMetaUrl: import.meta.url })\` — or omitted where the function ` +
                  "defaults to it, which `connectStore` and `applyStore` do.",
                path,
              });
            }
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
    },
  });
  return hits;
}

/**
 * This gate's declared scan predicate: every non-test `.ts` under the source trees, minus its own files.
 *
 * `eval/` and `hooks/` name no member of the family today — the widening is free, and it is what stops a
 * future store read outside `src/` from being clean by accident. `epoch-arithmetic` scans the same three.
 */
const SCOPE: ScanScope = {
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "storeJournalAnchor" }),
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

/**
 * IO edge: scan every source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runStoreJournalAnchor(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("store-journal-anchor: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<StoreJournalAnchorHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanStoreJournalAnchor({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "store-journal-anchor",
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
    process.stdout.write(`store-journal-anchor: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "store-journal-anchor" }),
      detail: `${String(hits.length)} cwd-anchored journal resolution(s)`,
    })}\n`,
  );
  return 1;
}
