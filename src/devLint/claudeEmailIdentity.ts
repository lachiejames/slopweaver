/**
 * The claude-email-not-identity gate — `accounts.json`'s `email` is a DISPLAY CACHE, and no verb may reason
 * about WHICH ACCOUNT from it.
 *
 * A launch held on a drifted email field shows why: which email belongs to which account must never be
 * confusable, and a hand-typed field makes it so.
 *
 * The rendering half of that is `src/claude/accountBinding.ts`: an address a surface may call the account is
 * one an ENROLLMENT bound to a live token, and the configured string is shown labelled as a cache. This gate
 * is the half that keeps it true of code nobody has written yet — a rendering rule holds until the next verb
 * needs to know which plan an address belongs to, and then somebody writes
 * `accounts.find((a) => a.email === wanted)` and the whole join quietly goes back to a hand-typed file.
 *
 * ## The criterion
 *
 * Under the four directories {@link CLAUDE_DIRECTORIES} names — the two Claude trees and the two register
 * trees, which carry the same `email` cache — a property access whose property name is `email`,
 * appearing in an IDENTITY POSITION:
 *
 * - an operand of `===`, `!==`, `==` or `!=` **whose other operand is not `undefined` or `null`** — a
 *   presence check is a shape question, and `x.email === undefined ? {} : { email: x.email }` is the house
 *   idiom for an `exactOptionalPropertyTypes` spread, not an identity question;
 * - the first argument of `.get(...)`, `.has(...)`, `.set(...)`, `.add(...)`, `.includes(...)` or
 *   `.indexOf(...)` — looking an address up in a collection IS asking which account it is;
 * - a computed member key, `x[something.email]`.
 *
 * No allowlist, no exemption marker. Every legitimate shape is already outside the criterion: passing the
 * address as an argument, spreading it onto an object, rendering it, and pre-populating `claude auth
 * login --email` are all untouched.
 *
 * ## Two blind spots, stated rather than discovered
 *
 * **A string reached through a name is invisible.** `const e = row.email; if (e === other)` compares a local
 * and this gate never sees an `email` access at the comparison. That is the same limit `no-silent-fallback`
 * and `error-shape-threshold` already declare, and it is why this is a tripwire rather than a fence: a block
 * confirms you were wrong, its absence means nothing.
 *
 * **The criterion is keyed on the property NAME, not on the type.** A resolved-type version would have to
 * join the `named-object-params` `ts.Program` rather than stand up a second one, which is a real cost for a
 * theoretical gain: every `.email` in the scoped directories today is the account cache, the sign-in row's
 * copy of it or the register row's, so there is nothing else in range to over-reach onto.
 *
 * Pure {@link scanClaudeEmailIdentity} + an effectful {@link runClaudeEmailIdentity} edge, matching the
 * other gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { gateSelfFiles, repoRoot, type ScanScope, scopedScanFiles } from "./scanScope.js";

/**
 * One identity-position read of the account cache.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface ClaudeEmailIdentityHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The property this gate is about. */
const CACHE_PROPERTY = "email";

/** Collection lookups whose FIRST argument is the thing being identified. */
const LOOKUP_METHODS: ReadonlySet<string> = new Set(["get", "has", "set", "add", "includes", "indexOf"]);

/** The equality operators an identity question is asked with. */
const EQUALITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** The node with any wrapping parentheses and non-null assertions stripped. */
function unwrap({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Whether an expression reads a property literally named `email`. */
function readsCache({ node }: { node: ts.Expression }): boolean {
  const inner = unwrap({ node });
  return ts.isPropertyAccessExpression(inner) && inner.name.text === CACHE_PROPERTY;
}

/**
 * Whether an operand is the absent literal, which makes the comparison a PRESENCE check rather than an
 * identity one.
 *
 * `undefined` is an identifier rather than a keyword in TypeScript's AST, so it is matched by name; `null`
 * is its own literal node.
 */
function isAbsentLiteral({ node }: { node: ts.Expression }): boolean {
  const inner = unwrap({ node });
  if (inner.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  return ts.isIdentifier(inner) && inner.text === "undefined";
}

/** Whether a binary expression asks which account the cache names, rather than whether it is there. */
function isIdentityComparison({ node }: { node: ts.BinaryExpression }): boolean {
  if (!EQUALITY_OPERATORS.has(node.operatorToken.kind)) {
    return false;
  }
  const leftReads = readsCache({ node: node.left });
  const rightReads = readsCache({ node: node.right });
  if (!leftReads && !rightReads) {
    return false;
  }
  const other = leftReads ? node.right : node.left;
  return !isAbsentLiteral({ node: other });
}

/** Whether a call looks the cache up in a collection, which is the same question in another shape. */
function isIdentityLookup({ node }: { node: ts.CallExpression }): boolean {
  if (!ts.isPropertyAccessExpression(node.expression) || !LOOKUP_METHODS.has(node.expression.name.text)) {
    return false;
  }
  const [first] = node.arguments;
  if (first === undefined) {
    return false;
  }
  return readsCache({ node: first });
}

/** The one sentence every hit carries — one wording, so a reader learns it once. */
const MESSAGE =
  "`accounts.json`'s `email` is a DISPLAY CACHE, not identity — it is hand-typed, a `/login` does not " +
  "touch it, and it drifts from the token in the store. Resolve WHICH ACCOUNT from the " +
  "organisation the probe named, against the standing enrollment in `identityAssertions.ts`, and render " +
  "the result through `accountBinding.ts`'s decided cell.";

/**
 * Every identity-position read of the account cache in `content`. Pure — parses in memory with the AST.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanClaudeEmailIdentity({
  content,
  path,
}: {
  content: string;
  path: string;
}): readonly ClaudeEmailIdentityHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly ClaudeEmailIdentityHit[] => {
      const hits: ClaudeEmailIdentityHit[] = [];
      const report = ({ node }: { node: ts.Node }): void => {
        hits.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          message: MESSAGE,
          path,
        });
      };
      const visit: NodeVisitor = (node) => {
        if (ts.isBinaryExpression(node) && isIdentityComparison({ node })) {
          report({ node });
        }
        if (ts.isCallExpression(node) && isIdentityLookup({ node })) {
          report({ node });
        }
        if (ts.isElementAccessExpression(node) && readsCache({ node: node.argumentExpression })) {
          report({ node });
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * The directories the account cache lives in. `ScanScope.trees` is a closed union of TOP-LEVEL trees, so
 * the narrowing to these happens as an explicit filter rather than as a declaration — and the reported
 * scanned count is then the number of files actually judged rather than the whole of `src/`.
 *
 * `src/plans/` and `src/cli/commands/plans/` joined the list when the register became the source: a
 * `RegisteredPlan` carries the same `email` field with the same contract — a DISPLAY CACHE of the address
 * the owner calls a destination's account, never its identity — and it now carries it for Codex rows too,
 * where nothing in this repository can bind an address to a token at all. Leaving the register outside the
 * scope would have let the exact join this gate exists to prevent be written one directory over.
 *
 * @internal — exported only so `claudeEmailIdentity.test.ts` can assert the scope, which is otherwise
 *   invisible to a test: a narrowing back to the Claude trees alone would make every register file pass by
 *   never being read, and a clean run is exactly what that looks like.
 */
export const CLAUDE_DIRECTORIES: readonly string[] = [
  "src/claude/",
  "src/cli/commands/claude/",
  "src/cli/commands/plans/",
  "src/plans/",
];

/** This gate's declared scan predicate: `src/`, narrowed by {@link CLAUDE_DIRECTORIES}, minus its own files. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "claudeEmailIdentity" }),
  trees: ["src/"],
};

/**
 * IO edge: scan both Claude trees, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runClaudeEmailIdentity(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE }).filter((path) =>
      CLAUDE_DIRECTORIES.some((directory) => path.startsWith(directory)),
    );
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("claude-email-not-identity: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<ClaudeEmailIdentityHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanClaudeEmailIdentity({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "claude-email-not-identity",
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
    process.stdout.write(`claude-email-not-identity: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "claude-email-not-identity" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
