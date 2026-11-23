/**
 * The authored-separator gate — a card's TL;DR may not carry a separator somebody typed.
 *
 * ## Why this is a gate rather than a runtime refusal
 *
 * Two rules pull in opposite directions unless they are split across two mechanisms. First, a runtime HARD
 * BLOCK on an em dash is wrong, and every such refusal carries an escape hatch. Second, the mistake should be
 * impossible to AUTHOR: structurally impossible to repeat, rather than caught after the fact or avoided by
 * following a massive skill file.
 *
 * A LINT gate is the one refusal `.claude/rules/error-handling.md` allows no hatch, precisely because it
 * refuses at AUTHORING time and never at send time. So the send-time voice rules keep their break-glass
 * unchanged (the journalled `voice-rules` hatch), and this is the half that cannot be overridden — which is what
 * makes it a structural answer rather than a fourth restatement of a convention.
 *
 * ## The criterion, not a count
 *
 * Two shapes, both syntax-only, walked on the TypeScript AST rather than matched as text:
 *
 *  1. A property named `tldr` whose initialiser — after stripping parentheses — is a string literal, a
 *     template, or a `+` chain of them, where any literal part contains a {@link SEPARATOR} character.
 *  2. Any string literal or template part carrying one, inside a function whose own name contains `tldr`
 *     case-insensitively. That is the shape the two real instances took: `failureTldr` and `blockedTldr`, now
 *     in `src/live/turn/failureForm.ts` and `src/live/turn/blockedForm.ts`, each built their frame into a
 *     local and returned it, so the separator never appeared beside the word `tldr` at all.
 *
 * `src/outbound/artifact/headline.ts` is the form that makes the mistake unrepresentable where a composer
 * owns every word: take the two ideas as two fields and the joiner is the renderer's. This gate covers the
 * rest — the headline that legitimately cannot take that form because it quotes somebody else's words, and
 * every `tldr` a future composer writes before it has read any of this.
 *
 * ## Blind spots, stated rather than discovered
 *
 * A separator reached through a NAMED CONSTANT is invisible here, and that is deliberate rather than a
 * limitation: `src/outbound/artifact/alertSummary.ts`'s derived TL;DR joins on a constant, and it is the
 * pattern this gate exists to generalise, not a violation of it. A headline assembled across several
 * statements in a function whose name does not mention a TL;DR is invisible too, as is a separator arriving
 * inside an interpolation hole. The runtime above-fold door (`src/cli/aboveFoldDoor.ts`) still reads every
 * `tldr` as authored prose, so those shapes are caught later and with a hatch, which is the division of
 * labour ruling (e) asked for.
 *
 * A hyphen is not a separator character here. It is a word's own punctuation far more often than it joins
 * two ideas, and refusing `re-run` to catch `a - b` is the over-reach `headline.ts`'s header rejects.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
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

/**
 * The characters a TL;DR may not carry from an author's own keyboard.
 *
 * The em dash is the measured case; the en dash is the same idea on a different layout; the middot is the
 * separator `src/outbound/artifact/headline.ts` renders, so an authored one is a composer doing the
 * renderer's job by hand; a pipe is what somebody reaches for when the other three are refused. Kept here
 * rather than imported from `headline.ts` on purpose: a gate that imported the module it polices would fail
 * silently the day that module moved, and a devLint scanner has no business loading outbound code.
 */
const SEPARATOR = /[—–·|]/u;

/** One authored separator: where it is, and which of the two shapes found it. */
export interface AuthoredSeparatorHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The node with any wrapping parentheses stripped, so `("a" + "b")` reads the same as `"a" + "b"`. */
function unwrapParens({ node }: { node: ts.Expression }): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Whether a node is a string literal, a template, or a `+` chain built from them. */
function isAuthoredText({ node }: { node: ts.Expression }): boolean {
  const inner = unwrapParens({ node });
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner)) {
    return true;
  }
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isAuthoredText({ node: inner.left }) || isAuthoredText({ node: inner.right });
  }
  return false;
}

/** The authored text a node contributes, with every interpolation hole left out — a hole is not authored. */
function authoredTextOf({ node }: { node: ts.Node }): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
  }
  return "";
}

/** The name a function-ish node declares, or the empty string when it declares none. */
function functionNameOf({ node }: { node: ts.Node }): string {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name === undefined ? "" : node.name.getText();
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return "";
}

/** The refusal a `tldr` property carrying an authored separator reads. */
const PROPERTY_MESSAGE =
  "a `tldr` is built from a string carrying a separator character. A separator is punctuation BETWEEN two " +
  "ideas, so take the ideas as fields and let `src/outbound/artifact/headline.ts` join them — `headlineOf({ " +
  "clauses })` renders the separator itself. Where the line quotes somebody else's words and cannot take " +
  "that form, write two sentences.";

/** The refusal a TL;DR-building function carrying an authored separator reads. */
const FUNCTION_MESSAGE =
  "this function builds a TL;DR and its text carries a separator character. Building the line into a local " +
  "does not make the separator any less authored — it only moves it away from the word `tldr`, which is how " +
  "two of these went unnoticed. Use `headlineOf({ clauses })` from `src/outbound/artifact/headline.ts`, or " +
  "write two sentences.";

/**
 * Every authored separator in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * A node inside a TL;DR-building function that is ALSO a `tldr` property reports once, not twice: the
 * property check runs first and the walk does not double-count, because one authored separator is one thing
 * to fix and two lines pointing at it would read as two defects.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanAuthoredSeparators({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly AuthoredSeparatorHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly AuthoredSeparatorHit[] => {
      const hits: AuthoredSeparatorHit[] = [];
      const lineOf = ({ node }: { node: ts.Node }): number =>
        sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const reported = new Set<number>();
      const push = ({ node, message }: { node: ts.Node; message: string }): void => {
        const start = node.getStart(sf);
        if (reported.has(start)) {
          return;
        }
        reported.add(start);
        hits.push({ line: lineOf({ node }), message, path });
      };
      const visit = ({ node, inTldrFunction }: { node: ts.Node; inTldrFunction: boolean }): void => {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText() === "tldr" &&
          isAuthoredText({ node: node.initializer })
        ) {
          const walk: NodeVisitor = (child) => {
            if (SEPARATOR.test(authoredTextOf({ node: child }))) {
              push({ message: PROPERTY_MESSAGE, node: child });
            }
            forEachChild({ node: child, visit: walk });
          };
          walk(node.initializer);
        }
        if (inTldrFunction && SEPARATOR.test(authoredTextOf({ node }))) {
          push({ message: FUNCTION_MESSAGE, node });
        }
        const name = functionNameOf({ node });
        const inside = inTldrFunction || (name.length > 0 && name.toLowerCase().includes("tldr"));
        forEachChild({
          node,
          visit: (child) => {
            visit({ inTldrFunction: inside, node: child });
          },
        });
      };
      visit({ inTldrFunction: false, node: sf });
      return hits;
    },
  });
}

/** This gate's declared scan predicate: every `.ts` under `src/`, minus its own files and the test tree. */
const SCOPE: ScanScope = {
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "authoredSeparator" }),
  trees: ["src/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * The whole test TREE is excluded rather than just `*.test.ts`, because a test proving this gate fires has
 * to be able to write the very shape it refuses, and so does any fixture it builds one from.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every tracked source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runAuthoredSeparator(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its tracked files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("authored-separator: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<AuthoredSeparatorHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanAuthoredSeparators({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "authored-separator",
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
    process.stdout.write(`authored-separator: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "authored-separator" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
