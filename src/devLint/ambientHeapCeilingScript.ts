/**
 * The TypeScript/JavaScript reader for the `ambient-heap-ceiling` gate.
 *
 * This bucket exists so that the SHELL bucket can stop filtering. Before it, a file was offered to the shell
 * reader only when it carried a `.sh`/`.bash` extension or opened with a `#!` — a name-shaped test, and the
 * eighteenth hole this gate's review passes found was a tracked `.envrc`, which `direnv` sources into every
 * shell in the checkout and which has neither. Measured: `export NODE_OPTIONS=--max-old-space-size=128` in
 * one gave a real `node` child a 320 MiB ceiling against a 4,288 MiB baseline, and the gate read it clean.
 *
 * Deleting that filter outright is what the class of finding asks for, and on its own it reports SEVEN
 * tracked files that set nothing: a `.ts` file spells the assignment inside a string literal or a JSDoc
 * fence — a refusal message that names the workaround, a test asserting on that message, a measured comment
 * carrying its own repro command. So the failure direction is inverted instead. An unrecognised file kind is
 * walked WHOLE as shell; a file kind this repository has a real parser for is handed to that parser, and the
 * parser decides. There is no third answer, so a name can no longer buy a file its way out of the gate.
 *
 * What the parser looks for here is the shape a `.ts` file really sets a ceiling with — a property or an
 * assignment whose TARGET is literally named `NODE_OPTIONS` and whose value names the heap flag, which is
 * `{ env: { NODE_OPTIONS: "--max-old-space-size=8192" } }` on a spawn and `env.NODE_OPTIONS = …` in place.
 * Prose is not a target, so none of those seven is a hit, and neither is the gate's own source.
 *
 * A DECLARATION is a write and a SHORTHAND property is a write, and so is a CALL — the last without naming
 * a single function it could be. The criterion for a call is that both halves are present in it: some
 * argument is exactly the variable's name, and some argument carries the heap flag, an object literal
 * argument offering its own property values too. `Object.defineProperty(process.env, "NODE_OPTIONS",
 * { value: … })` satisfies that, so does `Reflect.set`, and so does whatever a future Node adds. Listing
 * `defineProperty` by name would have been the interpreter list one level down, which is the class of
 * finding every review pass on this branch turned up.
 *
 * Both halves of any of those resolve ONE hop through a `const` declared in the same file, because a
 * computed key and a value held in a named constant are how a script really writes this rather than exotic.
 * The declared blind spot is a deeper chain: folding an arbitrary expression needs a type checker, and
 * `error-shape-threshold` carries the same residue for the same reason. It is stated here rather than left
 * to be discovered, and it is narrower than the hole it replaced — before this module a `.ts` could set the
 * variable in the plainest possible way and no version of this gate could see it at all.
 */
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { AMBIENT_VAR, type CeilingSite, namesHeapFlag, siteText } from "./ambientHeapCeilingShell.js";

/** Every extension the TypeScript parser reads, which is every kind of script this repository writes. */
const SCRIPT_PATTERN = /\.[cm]?[jt]sx?$/;

/**
 * Whether this path is handed to the TypeScript parser rather than walked as shell.
 *
 * @param path the repo-relative path
 * @returns true when TypeScript can parse it
 */
export function isScript({ path }: { path: string }): boolean {
  return SCRIPT_PATTERN.test(path);
}

/**
 * Every `const x = "…"` in the file, so a value or a key reached through a NAME resolves one hop.
 *
 * One hop, not a fold: `const FLAG = "--max-old-space-size=128"` beside `env.NODE_OPTIONS = FLAG` is how a
 * script really writes this, and a repository-wide constant resolver needs a type checker. A value reached
 * through a deeper chain is the declared blind spot, the same one `error-shape-threshold` carries.
 */
function literalConstants({ source }: { source: ts.SourceFile }): ReadonlyMap<string, string> {
  const byName = new Map<string, string>();
  const visit: NodeVisitor = (node) => {
    const named = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name);
    const initialiser = ts.isVariableDeclaration(node) ? node.initializer : undefined;
    if (named && initialiser !== undefined && isStringLiteralLikeNode(initialiser)) {
      byName.set(node.name.getText(source), initialiser.text);
    }
    forEachChild({ node, visit });
  };
  forEachChild({ node: source, visit });
  return byName;
}

/**
 * What a KEY expression evaluates to — a literal's own text, or a constant's value one hop away.
 *
 * `env["NODE_OPTIONS"]` and `{ [AMBIENT]: … }` both name the variable, and only the second needs the hop.
 */
function keyText({ consts, node }: { consts: ReadonlyMap<string, string>; node: ts.Node }): string {
  if (isStringLiteralLikeNode(node)) {
    return node.text;
  }
  if (ts.isIdentifier(node)) {
    const held = consts.get(node.text);
    if (held !== undefined) {
      return held;
    }
  }
  return "";
}

/** The name an assignment writes to, or `""` when the target has no name this walk can resolve. */
function targetName({ consts, node }: { consts: ReadonlyMap<string, string>; node: ts.Node }): string {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (isStringLiteralLikeNode(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return targetName({ consts, node: node.name });
  }
  if (ts.isElementAccessExpression(node)) {
    return keyText({ consts, node: node.argumentExpression });
  }
  if (ts.isComputedPropertyName(node)) {
    return keyText({ consts, node: node.expression });
  }
  return "";
}

/**
 * One node's `{ target, value }` pair when it writes a value somewhere nameable, else `undefined`.
 *
 * A DECLARATION is a write and a SHORTHAND property is a write, which is the r2 counterexample:
 * `const NODE_OPTIONS = "--max-old-space-size=128"` handed to a child as `{ ...process.env, NODE_OPTIONS }`
 * sets the variable exactly as the long form does, and a shorthand names its target and its value with the
 * same identifier — which is why both sides resolve through the same one-hop constant map.
 */
function writtenPair({ node }: { node: ts.Node }): { readonly target: ts.Node; readonly value: ts.Node } | undefined {
  if (ts.isPropertyAssignment(node)) {
    return { target: node.name, value: node.initializer };
  }
  if (ts.isShorthandPropertyAssignment(node)) {
    return { target: node.name, value: node.name };
  }
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.name)) {
    return { target: node.name, value: node.initializer };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return { target: node.left, value: node.right };
  }
  return undefined;
}

/** What a VALUE expression carries — its own source text, or a constant's value one hop away. */
function valueText({
  consts,
  node,
  source,
}: {
  consts: ReadonlyMap<string, string>;
  node: ts.Node;
  source: ts.SourceFile;
}): string {
  if (ts.isIdentifier(node)) {
    const held = consts.get(node.text);
    if (held !== undefined) {
      return held;
    }
  }
  return node.getText(source);
}

/** Whether one node is a write of a heap-ceiling value to a target literally named `NODE_OPTIONS`. */
function setsCeiling({
  consts,
  node,
  source,
}: {
  consts: ReadonlyMap<string, string>;
  node: ts.Node;
  source: ts.SourceFile;
}): boolean {
  const pair = writtenPair({ node });
  if (pair === undefined) {
    return false;
  }
  if (targetName({ consts, node: pair.target }) !== AMBIENT_VAR) {
    return false;
  }
  return namesHeapFlag({ text: valueText({ consts, node: pair.value, source }) });
}

/**
 * The string one argument carries, looking one level inside an object literal's own property VALUES.
 *
 * A descriptor is the reason: `Object.defineProperty(process.env, "NODE_OPTIONS", { value: "…" })` puts the
 * two halves of the write in two different arguments, and the ceiling in the third one's `value` field.
 */
function callAtoms({ consts, node }: { consts: ReadonlyMap<string, string>; node: ts.Node }): readonly string[] {
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties
      .filter((property) => ts.isPropertyAssignment(property))
      .map((property) => keyText({ consts, node: property.initializer }));
  }
  return [keyText({ consts, node })];
}

/**
 * Whether one CALL writes a ceiling to the variable, without naming a single function it could be.
 *
 * The criterion is that both halves of the write are present in the same call: some argument is exactly the
 * variable's name, and some argument carries the heap flag. `Object.defineProperty`, `Reflect.set` and
 * anything a future Node adds all satisfy it, and none of them is enumerated — enumerating method names is
 * the same defect as enumerating interpreters, one level down, which the r2 and r3 passes each found in turn.
 */
function callSetsCeiling({ consts, node }: { consts: ReadonlyMap<string, string>; node: ts.Node }): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const atoms = node.arguments.flatMap((argument) => callAtoms({ consts, node: argument }));
  if (!atoms.includes(AMBIENT_VAR)) {
    return false;
  }
  return atoms.some((atom) => namesHeapFlag({ text: atom }));
}

/**
 * Every ambient heap ceiling one script sets, by parsing it rather than by reading its text.
 *
 * A syntax error is not a failure here: `withSourceFile` recovers, and a file this repository cannot
 * compile is a defect its own typecheck reports, not one this gate should turn into a parse refusal.
 *
 * @param content the file's text
 * @param file the repo-relative path, reported on each site
 * @returns one site per write, each naming the line it sits on
 */
export function scriptSites({ content, file }: { content: string; file: string }): readonly CeilingSite[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return withSourceFile({
    fileName: file,
    text: content,
    scriptKind: kind,
    use: (source): readonly CeilingSite[] => {
      const consts = literalConstants({ source });
      const sites: CeilingSite[] = [];
      const visit: NodeVisitor = (node) => {
        if (setsCeiling({ consts, node, source }) || callSetsCeiling({ consts, node })) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          sites.push({ file, text: siteText({ raw: node.getText(source) }), where: `line ${String(line + 1)}` });
        }
        forEachChild({ node, visit });
      };
      forEachChild({ node: source, visit });
      return sites;
    },
  });
}
