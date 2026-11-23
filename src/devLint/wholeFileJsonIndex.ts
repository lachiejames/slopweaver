/**
 * Pass 1 of the `whole-file-json` gate: the tree-wide index of path-helper names that unambiguously resolve
 * to a `.jsonl`, run to a fixpoint. What a single expression must be to resolve lives in
 * `jsonlPathResolution.ts`; the criterion, its measurements and the scan that consumes this index are in
 * `wholeFileJson.ts`'s header.
 */
import type { NodeVisitor } from "#lib/tsSyntax.js";
import { forEachChild, ts, withSourceFile } from "#lib/tsSyntax.js";
import {
  indexLocalJsonlPaths,
  type JsonlNameIndex,
  type NameTally,
  resolvesToJsonl,
  tally,
  unambiguous,
} from "./jsonlPathResolution.js";

/**
 * Every expression a function declaration hands back, or undefined when it has a body with no return
 * expression at all — a writer, not a path helper.
 *
 * @param node the function-like declaration
 * @returns the returned expressions, or undefined
 */
function returnedExpressions({ node }: { node: ts.Node }): readonly ts.Expression[] | undefined {
  if (!ts.isFunctionDeclaration(node) || node.body === undefined) {
    return undefined;
  }
  const returns: ts.Expression[] = [];
  const visit: NodeVisitor = (child) => {
    if (ts.isReturnStatement(child) && child.expression !== undefined) {
      returns.push(child.expression);
    }
    forEachChild({ node: child, visit });
  };
  forEachChild({ node: node.body, visit });
  return returns;
}

/**
 * Tally one file's function and property declarations against the index as it stands. A declaration names a
 * `.jsonl` by any of the routes the argument pass accepts — a literal, an indexed property's last segment,
 * a call to an indexed function, or one of this file's own unambiguous path locals — so a helper that only
 * REACHES a `.jsonl` through another name is tallied exactly as one that spells it. An object-literal
 * initializer is skipped rather than tallied: a bag of paths mentions every `.jsonl` under it while naming
 * none itself, which is what made a coarser first version report `path` as a helper.
 *
 * @param source the parsed file
 * @param index the index from the previous round, which decides what a name can reach
 * @param functions the function-name tallies to mutate
 * @param properties the property-name tallies to mutate
 */
function tallyDeclarations({
  source,
  index,
  functions,
  properties,
}: {
  source: ts.SourceFile;
  index: JsonlNameIndex;
  functions: Map<string, NameTally>;
  properties: Map<string, NameTally>;
}): void {
  const locals = indexLocalJsonlPaths({ index, source });
  const namesJsonl = ({ expression }: { expression: ts.Expression }): boolean =>
    resolvesToJsonl({ expression, index, locals, source });
  const visit: NodeVisitor = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const returns = returnedExpressions({ node });
      if (returns !== undefined) {
        const reaches = returns.some((expression) => namesJsonl({ expression }));
        tally({ into: functions, name: node.name.text, namesJsonl: reaches });
      }
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (!ts.isObjectLiteralExpression(node.initializer)) {
        tally({ into: properties, name: node.name.text, namesJsonl: namesJsonl({ expression: node.initializer }) });
      }
    }
    forEachChild({ node, visit });
  };
  visit(source);
}

/**
 * Pure pass 1: index the path-helper names that unambiguously resolve to a `.jsonl`, across the whole tree.
 *
 * The pass runs to a FIXPOINT rather than once, because a helper rarely spells its `.jsonl` — it returns
 * `stateHomePaths(…).live.slack.asksJsonl`, or `join(dir, QUEUE_FILE)`, and only the name it reaches through
 * carries the literal. Round one indexes what is spelled; each later round re-tallies every declaration
 * against the names the round before it proved, and the pass stops when a round adds none. The index can
 * only grow between rounds — every declaration's total is fixed and its `.jsonl` count can only rise as more
 * names become reachable — so the unambiguity criterion holds at every round and the loop terminates within
 * as many rounds as the longest helper chain in the tree, plus one. MEASURED: this tree settles
 * in three rounds, and the second round is the one that first sees `askLifecyclePath`.
 *
 * @param sources every in-scope file's repo-relative path and text
 * @returns the unambiguous function and property names
 */
export function indexJsonlNames({
  sources,
}: {
  sources: readonly { readonly path: string; readonly content: string }[];
}): JsonlNameIndex {
  let index: JsonlNameIndex = { functions: new Set<string>(), properties: new Set<string>() };
  for (;;) {
    const functions = new Map<string, NameTally>();
    const properties = new Map<string, NameTally>();
    for (const { path, content } of sources) {
      withSourceFile({
        fileName: path,
        text: content,
        use: (source): void => {
          tallyDeclarations({ functions, index, properties, source });
        },
      });
    }
    const next: JsonlNameIndex = {
      functions: unambiguous({ tallies: functions }),
      properties: unambiguous({ tallies: properties }),
    };
    const grew = next.functions.size > index.functions.size || next.properties.size > index.properties.size;
    if (!grew) {
      return next;
    }
    index = next;
  }
}
