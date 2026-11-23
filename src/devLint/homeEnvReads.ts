/**
 * The env-home-read half of the `home-safety` gate: a test-tree file that resolves a home from
 * `process.env["SLOPWEAVER_HOME"]` itself, which the runtime ambient-home sandbox cannot see. It also owns
 * the `home-safety-exempt` marker, because both halves of the gate honour the same comment.
 */
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

/**
 * A comment bearing this marker, directly above a flagged call, is the ONE way to keep it — same shape as
 * `named-object-params-exempt` in `.claude/rules/typescript-patterns.md`. Reach for it only when the test is
 * deliberately proving the DEFAULT-RESOLUTION behaviour itself with every I/O edge injected as a fake, the
 * way `hygiene/scan.test.ts` pins the regression where an unset `$SLOPWEAVER_HOME` silently loaded an empty
 * denylist — that test has to omit `home` to exercise the fallback at all, and does so with no real disk
 * touched. A bare marker exempts nothing; the reason is what a reviewer checks.
 */
export const EXEMPT_MARKER = "home-safety-exempt";

/**
 * Whether a node carries an exemption comment above it — looked up on its enclosing STATEMENT rather than on
 * the node itself. A marker is written above a line, and the flagged expression is rarely the whole line:
 * `const original = process.env["SLOPWEAVER_HOME"];` starts the access after the `=`, where no leading
 * comment can ever sit, so a node-anchored lookup silently exempts nothing.
 *
 * @param node the flagged node
 * @param sourceFile the file it sits in
 * @returns true when a leading comment on its statement carries {@link EXEMPT_MARKER}
 */
export function isExempted({ node, sourceFile }: { node: ts.Node; sourceFile: ts.SourceFile }): boolean {
  let anchor: ts.Node = node;
  while (!ts.isStatement(anchor) && !ts.isSourceFile(anchor)) {
    anchor = anchor.parent;
  }
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, anchor.getFullStart());
  // The compiler API answers `undefined`, not an empty list, for a statement with no leading comment — no marker.
  return ranges?.some((range) => sourceFile.text.slice(range.pos, range.end).includes(EXEMPT_MARKER)) === true;
}

/** The environment variable that names the state home — the one `homeDir.ts` alone should be reading. */
const HOME_ENV_NAME = "SLOPWEAVER_HOME";

/** Whether an expression is the `process.env` member access itself. */
function isProcessEnv({ node }: { node: ts.Expression }): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

/** Whether a node reads `$SLOPWEAVER_HOME` off `process.env`, in either spelling. */
function readsHomeEnv({ node }: { node: ts.Node }): boolean {
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    return (
      isProcessEnv({ node: node.expression }) && isStringLiteralLikeNode(argument) && argument.text === HOME_ENV_NAME
    );
  }
  return (
    ts.isPropertyAccessExpression(node) && isProcessEnv({ node: node.expression }) && node.name.text === HOME_ENV_NAME
  );
}

/**
 * Whether an access is a WRITE rather than a read — an assignment target, or a `delete` operand.
 *
 * Writes are the sandbox's own mechanism (`setup-ambient-home.ts` repoints the variable, and a test that
 * moves it restores it afterwards), so flagging them would refuse the guard that closes this class. What
 * this gate is about is RESOLVING a home from the ambient variable, and only a read does that.
 */
function isEnvWrite({ node }: { node: ts.Node }): boolean {
  const { parent } = node;
  if (ts.isDeleteExpression(parent)) {
    return true;
  }
  return (
    ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node
  );
}

/**
 * Every line on which a test-tree file READS `process.env["SLOPWEAVER_HOME"]` without an exemption marker.
 *
 * ## The gap this closes, which is the one the write-side guard cannot see
 *
 * `src/__tests__/setup-ambient-home.ts` repoints the variable at a per-file sandbox in `beforeAll` and fails
 * any test that writes into it. That is a HOOK, so every setup file's and every test file's MODULE SCOPE has
 * already run — a module-scope read gets the operator's real home, and a write aimed at it lands entirely
 * outside the directory the guard watches. `setup-polly.ts` read it exactly that way, and `unsafeHomeCalls`
 * could never see it: that check walks CALLS to home-defaulting EXPORTS, and an environment read is
 * not a call to anything.
 *
 * The pool is the test TREE rather than `*.test.ts`, for the same reason: `setup-polly.ts` is neither a test
 * file nor source, so a `*.test.ts` scan is blind to precisely the file this fell through.
 *
 * The sanctioned replacement is `src/__tests__/realAmbientHome.ts`, which captures the RESOLVED home at
 * module load through `slopweaverHome()` — so nothing in the test tree needs this spelling at all, and the
 * one file that legitimately saves and restores the variable ({@link EXEMPT_MARKER}s it) says so in its diff.
 *
 * @param content the test-tree file's text
 * @returns the 1-based line numbers of the offending reads, in source order
 */
export function envHomeReadLines({ content }: { content: string }): readonly number[] {
  return withSourceFile({
    fileName: "scan.ts",
    text: content,
    use: (sourceFile): readonly number[] => {
      const lines: number[] = [];
      const visit: NodeVisitor = (node) => {
        if (readsHomeEnv({ node }) && !isEnvWrite({ node }) && !isExempted({ node, sourceFile })) {
          lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
        }
        forEachChild({ node, visit });
      };
      visit(sourceFile);
      return lines;
    },
  });
}

/** One test-tree file that resolves a home from the ambient `$SLOPWEAVER_HOME` variable. */
export interface EnvHomeReadHit {
  readonly path: string;
  /** The 1-based lines the offending reads sit on. */
  readonly lines: readonly number[];
}

/**
 * Every test-tree file that reads `$SLOPWEAVER_HOME` off the environment.
 *
 * @param treeFiles every scanned file under `src/__tests__/`, path plus content
 * @returns one hit per offending file, in scan order
 */
export function scanEnvHomeReads({
  treeFiles,
}: {
  treeFiles: readonly { path: string; content: string }[];
}): readonly EnvHomeReadHit[] {
  const hits: EnvHomeReadHit[] = [];
  for (const { path, content } of treeFiles) {
    const lines = envHomeReadLines({ content });
    if (lines.length > 0) {
      hits.push({ lines, path });
    }
  }
  return hits;
}
