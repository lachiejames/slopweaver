/**
 * Which parts of a file the transient-references gate reads: a Markdown, YAML or shell file whole, as prose; a
 * JSON or JSONL file whole, as data; a CSS file's comments, since its syntax is colours and selectors; and in
 * TypeScript, every comment plus every string, template and JSX text. Under a `__tests__` segment a string is a
 * fixture, the data a test feeds in, so only a test's own NAME is a string there and every other literal is a
 * fixture region. Which class reads which kind is `transientReferencePatterns.ts`'s call.
 * A regular-expression literal is never read: a pattern recognises a shape, it does not cite history.
 *
 * Syntax only, parsed LEAN (no parents, no JSDoc nodes): comments are trivia, so every one is found by asking for the
 * comment ranges at each node's start and end, which also reaches a comment before a closing brace, since that
 * comment leads the brace from the last statement's end.
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import type { TextRegion } from "./transientReferencePatterns.js";

/** The extensions read as TypeScript. */
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/**
 * Whether a path is a JSON or JSONL data file, read whole as one `data` region.
 *
 * @param path a repo-relative path
 * @returns true for a `.json` or `.jsonl` file
 */
export function isDataPath({ path }: { path: string }): boolean {
  return path.endsWith(".json") || path.endsWith(".jsonl");
}

/** The test-runner calls whose first argument is a test's NAME: `describe`, `it`, `test`, and their modifiers. */
const TEST_NAMING_CALLS: ReadonlySet<string> = new Set(["describe", "it", "test"]);

/** Whether a node is literal text a program carries: a string, a template's literal parts, or JSX text. */
function isLiteralText({ node }: { node: ts.Node }): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  );
}

/** The table-driven modifiers whose call returns the function that takes a test's name: `it.each(rows)("…")`. */
const TABLE_MODIFIERS: ReadonlySet<string> = new Set(["each", "for"]);

/**
 * The name a test-runner call gives its test — `describe("…")`, `test.skip("…")`, `it.each(rows)("…")` — or none.
 * A call is unwrapped only when it is a table modifier's, so a call chained off a finished test call names nothing.
 */
function testNameOf({ node }: { node: ts.Node }): ts.Node | undefined {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }
  let callee: ts.Expression = node.expression;
  if (
    ts.isCallExpression(callee) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    TABLE_MODIFIERS.has(callee.expression.name.text)
  ) {
    callee = callee.expression;
  }
  while (ts.isPropertyAccessExpression(callee)) {
    callee = callee.expression;
  }
  return ts.isIdentifier(callee) && TEST_NAMING_CALLS.has(callee.text) ? node.arguments[0] : undefined;
}

/**
 * Every region of a parsed TypeScript file the classes read: each comment, and each literal, a string outside a
 * test tree or a test's name inside one, and a fixture for any other literal inside one.
 */
function typeScriptRegions({
  sourceFile,
  inTestTree,
}: {
  sourceFile: ts.SourceFile;
  inTestTree: boolean;
}): readonly TextRegion[] {
  const text = sourceFile.text;
  const comments = new Map<number, TextRegion>();
  const strings: TextRegion[] = [];
  const testNames = new Set<ts.Node>();
  // The compiler API answers `undefined`, not an empty list, where a position has no comment.
  const collect = ({ ranges }: { ranges: readonly ts.CommentRange[] | undefined }): void => {
    ranges?.forEach((range) => comments.set(range.pos, { end: range.end, kind: "comment", start: range.pos }));
  };
  const visit: NodeVisitor = (node) => {
    collect({ ranges: ts.getLeadingCommentRanges(text, node.pos) });
    collect({ ranges: ts.getLeadingCommentRanges(text, node.end) });
    collect({ ranges: ts.getTrailingCommentRanges(text, node.end) });
    // `{/* … */}` in JSX holds a comment and no expression, so no node's edge reaches it.
    if (ts.isJsxExpression(node) && node.expression === undefined) {
      collect({ ranges: ts.getLeadingCommentRanges(text, node.getStart(sourceFile) + 1) });
    }
    const name = testNameOf({ node });
    if (name !== undefined) {
      testNames.add(name);
      // A name written as a template is read through its literal parts, never its substitutions.
      if (ts.isTemplateExpression(name)) {
        testNames.add(name.head);
        name.templateSpans.forEach((span) => testNames.add(span.literal));
      }
    }
    if (isLiteralText({ node })) {
      const kind = !inTestTree || testNames.has(node) ? "string" : "fixture";
      strings.push({ end: node.end, kind, start: node.getStart(sourceFile) });
    }
    forEachChild({ node, visit });
    return undefined;
  };
  visit(sourceFile);
  return [...comments.values(), ...strings].toSorted((a, b) => a.start - b.start);
}

/** Every `/* … *\/` comment in a CSS file. */
function cssCommentRegions({ content }: { content: string }): readonly TextRegion[] {
  return [...content.matchAll(/\/\*[\s\S]*?\*\//gu)].map((match) => ({
    end: match.index + match[0].length,
    kind: "comment",
    start: match.index,
  }));
}

/**
 * The regions of one file the gate reads, in source order. Pure.
 *
 * @param path the repo-relative path, which picks the reading: TypeScript, CSS, whole-file data or whole-file prose
 * @param content the file's text
 * @returns every region the classes may read
 */
export function regionsOf({ path, content }: { path: string; content: string }): readonly TextRegion[] {
  if (isDataPath({ path })) {
    return [{ end: content.length, kind: "data", start: 0 }];
  }
  if (path.endsWith(".css")) {
    return cssCommentRegions({ content });
  }
  if (!TYPESCRIPT_EXTENSIONS.some((ext) => path.endsWith(ext))) {
    return [{ end: content.length, kind: "prose", start: 0 }];
  }
  // A whole `__tests__` SEGMENT, as `scanScope.ts` reads one, so a helper or fake beside the tests is test data too.
  const inTestTree = `/${path}`.includes("/__tests__/");
  return withSourceFile({
    fileName: path,
    scriptKind: path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    text: content,
    use: (sourceFile): readonly TextRegion[] => typeScriptRegions({ inTestTree, sourceFile }),
  });
}
