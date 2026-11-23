/**
 * The no-python gate's TypeScript-file scanner: a literal command handed to a launcher binding the file imports,
 * and an instruction inside any comment. Syntax only; `noPython.ts` dispatches a `.ts` file here.
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { isPythonInterpreter, pythonCommandColumns } from "./noPythonCommands.js";
import { hitAt, type PythonHit } from "./noPythonHit.js";
import { type ArgumentReading, callReading, processBindingsOf } from "./noPythonProcessBindings.js";

/** What a scan of one file needs to report a hit at an offset. */
interface HitContext {
  readonly path: string;
  readonly lines: readonly string[];
  readonly sourceFile: ts.SourceFile;
}

/**
 * The hits a launcher call carries in its first argument, when that argument is a literal.
 *
 * @param context the file being scanned
 * @param call the call
 * @param reading how the call reads its first argument
 * @returns zero or more `process-call` hits
 */
function processCallHits({
  context,
  call,
  reading,
}: {
  context: HitContext;
  call: ts.CallExpression;
  reading: ArgumentReading;
}): readonly PythonHit[] {
  const argument = call.arguments[0];
  if (argument === undefined || !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
    return [];
  }
  const start = context.sourceFile.getLineAndCharacterOfPosition(argument.getStart(context.sourceFile));
  if (reading === "program") {
    const named = isPythonInterpreter({ word: argument.text.trim() });
    return named ? [hitAt({ column: start.character, context, kind: "process-call", line: start.line })] : [];
  }
  return argument.text
    .split("\n")
    .flatMap((commandLine, offset) =>
      pythonCommandColumns({ line: commandLine, mode: "shell" }).map(() =>
        hitAt({ column: start.character, context, kind: "process-call", line: start.line + offset }),
      ),
    );
}

/**
 * Every comment range in a parsed file, deduplicated by offset. Walks tokens as well as nodes, because a
 * comment before a closing brace is trivia of that brace and belongs to no statement.
 *
 * @param sourceFile the parsed file
 * @returns each comment's `[pos, end)`, in source order
 */
function commentRangesOf({ sourceFile }: { sourceFile: ts.SourceFile }): readonly ts.CommentRange[] {
  const text = sourceFile.text;
  const seen = new Map<number, ts.CommentRange>();
  // The compiler API answers `undefined`, not an empty list, where a node has no comment on that side.
  const collect = ({ ranges }: { ranges: readonly ts.CommentRange[] | undefined }): void => {
    ranges?.forEach((range) => seen.set(range.pos, range));
  };
  const visit = ({ node }: { node: ts.Node }): void => {
    collect({ ranges: ts.getLeadingCommentRanges(text, node.getFullStart()) });
    collect({ ranges: ts.getTrailingCommentRanges(text, node.getEnd()) });
    for (const child of node.getChildren(sourceFile)) {
      visit({ node: child });
    }
  };
  visit({ node: sourceFile });
  return [...seen.values()].toSorted((left, right) => left.pos - right.pos);
}

/**
 * The instruction hits inside one comment range.
 *
 * @param context the file being scanned
 * @param range the comment's offsets
 * @returns zero or more `instruction` hits
 */
function commentHits({ context, range }: { context: HitContext; range: ts.CommentRange }): readonly PythonHit[] {
  const start = context.sourceFile.getLineAndCharacterOfPosition(range.pos);
  const commentLines = context.sourceFile.text.slice(range.pos, range.end).split("\n");
  return commentLines.flatMap((commentLine, offset) => {
    const lineStart = offset === 0 ? start.character : 0;
    return pythonCommandColumns({ line: commentLine, mode: "instruction" }).map((column) =>
      hitAt({ column: lineStart + column, context, kind: "instruction", line: start.line + offset }),
    );
  });
}

/**
 * Every hit in a TypeScript file: launcher literals and comment instructions.
 *
 * @param path the repo-relative path
 * @param content the file's text
 * @returns the hits, launchers first then comments
 */
export function scanTypeScript({ path, content }: { path: string; content: string }): readonly PythonHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    scriptKind: ts.ScriptKind.TS,
    use: (sourceFile): readonly PythonHit[] => {
      const context: HitContext = { lines: content.split("\n"), path, sourceFile };
      const bindings = processBindingsOf({ sourceFile });
      const hits: PythonHit[] = [];
      if (bindings.functions.size > 0 || bindings.namespaces.size > 0) {
        const visit: NodeVisitor = (node) => {
          if (ts.isCallExpression(node)) {
            const reading = callReading({ bindings, call: node });
            for (const found of reading === undefined ? [] : processCallHits({ call: node, context, reading })) {
              hits.push(found);
            }
          }
          forEachChild({ node, visit });
        };
        visit(sourceFile);
      }
      for (const range of commentRangesOf({ sourceFile })) {
        for (const found of commentHits({ context, range })) {
          hits.push(found);
        }
      }
      return hits;
    },
  });
}
