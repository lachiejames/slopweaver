/**
 * Every in-process path from one verb into ANOTHER verb's body, read off the TypeScript AST — the scanner
 * `unit/cli/inProcessRulingGate.test.ts` holds the ruling gate to.
 *
 * `src/cli/main.ts` asks the ruling gate before it dispatches a typed verb. A verb that imports another verb's
 * function and calls it never passes through there, so the inner verb has to ask the gate itself, at the first
 * statement of the function every path into it crosses. This module says which functions those are, without a
 * list of names anyone has to keep:
 *
 * 1. **A verb module** is a module under `src/cli/commands/` that a module OUTSIDE that tree loads by `import()` —
 *    the manifests and the atlas registrations, which is exactly how the dispatcher reaches a verb. A module that
 *    merely contains a `defineCommand(` nobody registers (`github/stackAuditRun.ts`, a sub-command of `github
 *    stack`) is not one.
 * 2. **A verb body** is a function a verb module's `defineCommand(…)` reaches by NAMING functions and top-level
 *    values declared in that same module, transitively, in any shape (`./inProcessVerbBodies.ts` errs IN on reach),
 *    that RUNS the verb: it takes the verb's unparsed words (a parameter, a destructured field at any depth, or an
 *    inline type member, named `argv` or `rest`) and answers an exit code: any return type whose syntax does not
 *    positively show it is none (`./inProcessExitCodeType.ts` holds the OUT list; an imported type, an intersection
 *    or no annotation all count IN). That is how `handover register`'s body reaches `registerAskRow` behind
 *    `runHandoverRegister`, while `cmux/run.ts`'s `openSessionKeyFor` — a read every caller is welcome to — is not
 *    one. Measured before the gate existed: 47 paths into 23 bodies, 22 verbs.
 * 3. **An in-process path** is a module under `src/cli/commands/` other than the verb module importing an
 *    exported verb body — by a named, aliased or default static import, by the destructured `await import()`
 *    `automation/claim.ts` uses, or as a member of a namespace (`import * as ns`, `const ns = await import()`) —
 *    and calling it or passing it on as a value (`./inProcessImports.ts`). The name it imports is resolved to the
 *    body it declares through the module's own export list (`export default f`, `export { f as g }`:
 *    `./inProcessExports.ts`). A module loaded in any shape whose members cannot be named that way — a side-effect
 *    import, a re-export, a namespace handed on whole, a computed key, `(await import()).f`, a `.then` — opens a
 *    path into EVERY verb body it
 *    exports (`./inProcessOpaqueLoads.ts`): the scanner errs IN rather than chasing shapes.
 *
 * A body is **gated** when its first two statements bind the gate's answer to a `const` and return it when it is
 * defined, or when its whole body is one call to a gated
 * function of the same module (`runHandoverRegister` → `registerAskRow`), and its module binds the gate's name only
 * by importing it from `rulingGateDoor.ts` and `undefined` not at all (`./inProcessGateBinding.ts`), so a local fake
 * of the same name gates nothing. Reading inside ONE module — its bodies
 * and the gate each opens with — is `./inProcessVerbBodies.ts`; this file follows the imports between modules.
 *
 * What this does NOT see, stated rather than implied: a helper that takes PARSED values and performs part of a
 * verb's effect for its caller's own verb (`worktree prune --apply` → `runMirrorPass`, `handover settle-residue` →
 * `applyReap`, `desktop update` → `install`) — the caller is running its own verb with shared logic, and a gate
 * on the caller's verb is what constrains it; a verb body reached through a function the verb module imports from
 * a shared core (`atlas/resetRunCore.ts`'s `runAtlasReset`, every caller of which is that verb's own wrapper); and
 * an `import()` of a specifier that is not a literal, which names no module. A path through `main(argv)`, the
 * other sanctioned shape, meets `main.ts`'s gate. A use is counted by NAME, without scope analysis, so a local
 * shadowing an imported body over-reports a path rather than hiding one — the safe direction for a guard.
 *
 * It is a syntactic TRIPWIRE, not a proof. Review ran 26 rounds and each found one more spelling a
 * careful author would have to construct (a nested `typeof ns`, a compound assignment, a parameter default); every
 * one is now covered by a rule that errs IN, and none moved the real tree off 47 paths into 23 bodies. The review
 * was stopped there, on the 28th finding, by the property-chase rule (`skills/codex/reference/when-a-pass-earns-its-cost.md`),
 * and that finding is the first named residue: a verb body is a top-level `function` declaration or a declarator
 * initialised with a function, so a function value bound LATER by assignment (`let run; run = (argv) => 0`) and
 * exported is not seen. A call hidden from a syntax walk on purpose — a name computed at run time, `eval`, `new
 * Function` — is outside it by construction. What still catches either is the gate each body opens with, which runs
 * whatever reached it.
 */

import { dirname, resolve } from "node:path";
import { forEachChild, isStringLiteralLikeNode, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import { exportedFunctions } from "./inProcessExports.js";
import { gateBoundByImport } from "./inProcessGateBinding.js";
import { type ImportedBinding, importsOf } from "./inProcessImports.js";
import { isReference, memberRead, opaqueLoads } from "./inProcessOpaqueLoads.js";
import { verbBodies } from "./inProcessReach.js";
import { declaredFunctions, type OpeningGate, openingGateOf } from "./inProcessVerbBodies.js";

/** One in-process path: an importer reaching another verb module's body. */
interface InProcessPath {
  readonly importer: string;
  /** The name the verb module exports the body under. */
  readonly body: string;
  readonly target: string;
  /** How many times the importer calls it or hands it on. */
  readonly uses: number;
}

/** One verb body an in-process path reaches, and the gate it opens with or `null`. */
interface ReachedBody {
  readonly target: string;
  readonly body: string;
  readonly gate: OpeningGate | null;
}

/** What the scanner read off a set of source files. */
export interface InProcessScan {
  readonly paths: readonly InProcessPath[];
  readonly reached: readonly ReachedBody[];
}

/** One verb module's own functions, which of them its command reaches, and the names it exports them under. */
interface VerbModule {
  readonly functions: ReadonlyMap<string, { readonly runsVerb: boolean }>;
  /** Each declared function's opening gate, read while its tree was alive; empty when the gate is not imported. */
  readonly gates: ReadonlyMap<string, OpeningGate | null>;
  readonly bodies: ReadonlySet<string>;
  /** Export name to declared name, `./inProcessExports.ts`. */
  readonly exports: ReadonlyMap<string, string>;
  /** Whether its gate calls name the real gate (`./inProcessGateBinding.ts`); when not, none of its bodies is gated. */
  readonly gateImported: boolean;
}

/** Every `import("<relative>")` specifier one module names, resolved against it. */
function dynamicImportTargets({ path, source }: { path: string; source: ts.SourceFile }): readonly string[] {
  const targets: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && isStringLiteralLikeNode(argument) && argument.text.startsWith(".")) {
        targets.push(resolve(dirname(path), argument.text.replace(/\.js$/u, ".ts")));
      }
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return targets;
}

/**
 * Whether one node uses the binding: its bare name wherever it REFERS to the binding (a destructuring default
 * `{ go = runTarget }` included; the name a destructure binds, or a property key, is not a use), or
 * `ns.member`/`ns["member"]` for a namespace binding.
 */
function isUse({ binding, node }: { binding: ImportedBinding; node: ts.Node }): boolean {
  if (!binding.namespace) {
    return ts.isIdentifier(node) && node.text === binding.local && isReference({ node });
  }
  return memberRead({ local: binding.local, node }) === binding.exported;
}

/** How many times a module uses one binding other than in its own import — a call, or a value handed on. */
function usesOf({ binding, source }: { binding: ImportedBinding; source: ts.SourceFile }): number {
  let count = 0;
  const visit: NodeVisitor = (node) => {
    if (ts.isImportDeclaration(node)) {
      return;
    }
    if (isUse({ binding, node })) {
      count += 1;
    }
    forEachChild({ node, visit });
  };
  visit(source);
  return count;
}

/** Everything one verb module's tree answers, as plain data, read while the tree is alive. */
function verbModuleOf({ commandsRoot, path, text }: { commandsRoot: string; path: string; text: string }): VerbModule {
  return withSourceFile({
    fileName: path,
    text,
    use: (targetSource) => {
      const declared = declaredFunctions({ source: targetSource });
      const gateImported = gateBoundByImport({ commandsRoot, importer: path, source: targetSource });
      const gates = new Map<string, OpeningGate | null>();
      if (gateImported) {
        for (const name of declared.keys()) {
          gates.set(name, openingGateOf({ functions: declared, name, seen: new Set() }));
        }
      }
      const functions = new Map(
        [...declared].map(([name, fn]): [string, { runsVerb: boolean }] => [name, { runsVerb: fn.runsVerb }]),
      );
      return {
        bodies: verbBodies({ functions: declared, source: targetSource }),
        exports: exportedFunctions({ functions: declared, source: targetSource }),
        functions,
        gateImported,
        gates,
      };
    },
  });
}

/** The verb modules: every module under the commands tree a module outside it loads by `import()`. */
function verbModulesOf({
  commandsRoot,
  files,
}: {
  commandsRoot: string;
  files: ReadonlyMap<string, string>;
}): ReadonlyMap<string, VerbModule> {
  const modules = new Map<string, VerbModule>();
  for (const [path, text] of files) {
    if (path.startsWith(commandsRoot)) {
      continue;
    }
    const loaded = withSourceFile({
      fileName: path,
      text,
      use: (source) => dynamicImportTargets({ path, source }).filter((target) => target.startsWith(commandsRoot)),
    });
    for (const target of loaded) {
      const targetText = files.get(target);
      if (targetText !== undefined) {
        modules.set(target, verbModuleOf({ commandsRoot, path: target, text: targetText }));
      }
    }
  }
  return modules;
}

/** The in-process path one import binding opens, or null when it reaches no exported verb body. */
function pathOf({
  binding,
  importer,
  modules,
  source,
}: {
  binding: ImportedBinding;
  importer: string;
  modules: ReadonlyMap<string, VerbModule>;
  source: ts.SourceFile;
}): InProcessPath | null {
  if (!binding.specifier.startsWith(".")) {
    return null;
  }
  const target = resolve(dirname(importer), binding.specifier.replace(/\.js$/u, ".ts"));
  const verbModule = modules.get(target);
  // An import names an EXPORT: `default`, or an `export { f as g }` alias, resolves to the function it declares.
  const body = verbModule?.exports.get(binding.exported);
  if (target === importer || verbModule === undefined || body === undefined || !verbModule.bodies.has(body)) {
    return null;
  }
  const declared = verbModule.functions.get(body);
  if (declared === undefined || !declared.runsVerb) {
    return null;
  }
  const uses = usesOf({ binding, source });
  return uses > 0 ? { body, importer, target, uses } : null;
}

/** One path per verb body a module exports, for each module the importer loads opaquely (`./inProcessOpaqueLoads.ts`). */
function opaquePaths({
  importer,
  modules,
  source,
}: {
  importer: string;
  modules: ReadonlyMap<string, VerbModule>;
  source: ts.SourceFile;
}): readonly InProcessPath[] {
  return opaqueLoads({ source })
    .filter((specifier) => specifier.startsWith("."))
    .flatMap((specifier) => {
      const target = resolve(dirname(importer), specifier.replace(/\.js$/u, ".ts"));
      const verbModule = modules.get(target);
      if (target === importer || verbModule === undefined) {
        return [];
      }
      const bodies = new Set(
        [...verbModule.exports.values()].filter(
          (body) => verbModule.bodies.has(body) && verbModule.functions.get(body)?.runsVerb === true,
        ),
      );
      return [...bodies].map((body) => ({ body, importer, target, uses: 1 }));
    });
}

/** The opaque paths no precise path already names, each importer, target and body once. */
function addedPaths({
  opaque,
  precise,
}: {
  opaque: readonly InProcessPath[];
  precise: readonly InProcessPath[];
}): readonly InProcessPath[] {
  const keyOf = (path: InProcessPath): string => `${path.importer}#${path.target}#${path.body}`;
  const seen = new Set(precise.map(keyOf));
  return opaque.filter((path) => {
    const fresh = !seen.has(keyOf(path));
    seen.add(keyOf(path));
    return fresh;
  });
}

/**
 * Scan a set of source files for every in-process path into a verb body, and the gate each reached body opens with.
 *
 * @param files every production source file, path to text
 * @param commandsRoot the absolute `src/cli/commands` directory
 * @returns the paths, and every body they reach
 */
export function scanInProcessPaths({
  files,
  commandsRoot,
}: {
  files: ReadonlyMap<string, string>;
  commandsRoot: string;
}): InProcessScan {
  const modules = verbModulesOf({ commandsRoot, files });
  const importers = [...files].filter(([importer]) => importer.startsWith(commandsRoot));
  const read = importers.map(([importer, text]) =>
    withSourceFile({
      fileName: importer,
      text,
      use: (source) => ({
        opaque: opaquePaths({ importer, modules, source }),
        precise: importsOf({ source })
          .map((binding) => pathOf({ binding, importer, modules, source }))
          .filter((path): path is InProcessPath => path !== null),
      }),
    }),
  );
  const precise = read.flatMap((each) => each.precise);
  const opaque = read.flatMap((each) => each.opaque);
  const paths = [...precise, ...addedPaths({ opaque, precise })];
  const reached = new Map<string, ReachedBody>();
  for (const path of paths) {
    const { gateImported, gates } = modules.get(path.target)!;
    const gate = gates.get(path.body);
    reached.set(`${path.target}#${path.body}`, {
      body: path.body,
      gate: gateImported && gate !== undefined ? gate : null,
      target: path.target,
    });
  }
  return { paths, reached: [...reached.values()] };
}
