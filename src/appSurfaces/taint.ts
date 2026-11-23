/**
 * Follow one package up a checkout's import graph, export by export, to every module that really uses it.
 *
 * A module is TAINTED when one of its top-level statements references something that leads to the package:
 * a binding imported from the package itself, or a tainted export of another module. What a module passes on
 * is only its tainted EXPORTS, so a barrel re-exporting forty modules forwards the one name that leads to the
 * package and not the other thirty-nine. That is the whole difference between "the one viewer" and
 * "every screen that imports the shared utils index".
 *
 * A statement at module scope that uses a tainted name — a hook installed at load, a registry entry — runs for
 * whoever loads the module, whatever they import from it. That is a SIDE EFFECT, and it passes to every
 * importer. It over-approximates on purpose: under-naming a surface is how a reviewer tests the wrong screen.
 *
 * Monotone — taint only ever grows — so the worklist terminates.
 */
import { DEFAULT_LOCAL, type ModuleFacts } from "./moduleFacts.js";

/** What the walk found out about one tainted module. */
export interface ModuleTaint {
  /** The export names that lead to the package; `*` when a bare `export * from "<package>"` hides which. */
  readonly exports: ReadonlySet<string>;
  /** Whether loading the module runs something that uses the package. */
  readonly sideEffect: boolean;
  /** The imported modules its taint came through — the package itself is not a module and is not listed. */
  readonly from: ReadonlySet<string>;
  /** Whether it imports the package directly — a SEED. */
  readonly seed: boolean;
  /** Whether one of its own statements uses a tainted binding, rather than only passing a name through. */
  readonly used: boolean;
}

/** The resolution of a specifier that names the package under study itself. */
export const PACKAGE = Symbol("the package under study");

/** The graph the walk runs over, supplied by the caller so this stays pure. */
export interface TaintGraph {
  /** Every module that imports the package directly, by the cheap specifier scan. */
  readonly seeds: readonly string[];
  /** The modules that import a module, by the cheap specifier scan — candidates, not yet proven users. */
  readonly importersOf: (path: string) => readonly string[];
  /** One module's facts, parsed on first use. */
  readonly factsOf: (path: string) => ModuleFacts | undefined;
  /** What a specifier in a module resolves to: a tracked file, the package, or outside the walk. */
  readonly target: (args: { fromPath: string; specifier: string }) => string | typeof PACKAGE | undefined;
}

/** Whether a module's taint reaches an importer that binds `imported` from it. */
function bindingTainted({ taint, imported }: { taint: ModuleTaint; imported: string }): boolean {
  if (imported === "*") {
    return taint.exports.size > 0 || taint.sideEffect;
  }
  return taint.exports.has(imported) || taint.exports.has("*");
}

/** The running tally one module's analysis builds up. */
interface Tally {
  readonly from: Set<string>;
  seed: boolean;
  sideEffect: boolean;
}

/** One module's view of its imports while it is being analysed: where each goes, and what that carries. */
interface Reader {
  /** Where a specifier in this module lands. */
  readonly lookup: (specifier: string) => string | typeof PACKAGE | undefined;
  /** Load a target: a side effect it carries lands on the tally; the target's taint comes back. */
  readonly load: (target: string | typeof PACKAGE | undefined) => ModuleTaint | undefined;
  /** Whether binding `imported` from `specifier` binds something tainted; the module is noted as a source. */
  readonly reach: (args: { specifier: string; imported: string }) => boolean;
}

/** The reader for one module, writing what it finds into that module's tally. */
function readerFor({
  path,
  graph,
  state,
  tally,
}: {
  path: string;
  graph: TaintGraph;
  state: ReadonlyMap<string, ModuleTaint>;
  tally: Tally;
}): Reader {
  const lookup: Reader["lookup"] = (specifier) => graph.target({ fromPath: path, specifier });
  // Loading a module whose own module scope uses the package runs that use, whatever is bound from it.
  const load: Reader["load"] = (target) => {
    if (target === PACKAGE) {
      tally.seed = true;
      return undefined;
    }
    const taint = target === undefined ? undefined : state.get(target);
    if (target !== undefined && taint?.sideEffect === true) {
      tally.sideEffect = true;
      tally.from.add(target);
    }
    return taint;
  };
  const reach = ({ specifier, imported }: { specifier: string; imported: string }): boolean => {
    const target = lookup(specifier);
    const taint = load(target);
    if (target === PACKAGE) {
      return true;
    }
    if (target === undefined || taint === undefined || !bindingTainted({ imported, taint })) {
      return false;
    }
    tally.from.add(target);
    return true;
  };
  return { load, lookup, reach };
}

/** The local names bound to something tainted, and the side effect of a bare `import "<package>"`. */
function taintedImports({ facts, reader, tally }: { facts: ModuleFacts; reader: Reader; tally: Tally }): Set<string> {
  const tainted = new Set(
    facts.imports
      .filter((binding) => reader.reach({ imported: binding.imported, specifier: binding.specifier }))
      .map((binding) => binding.local),
  );
  for (const specifier of facts.sideEffectImports) {
    const target = reader.lookup(specifier);
    reader.load(target);
    if (target === PACKAGE) {
      tally.sideEffect = true;
    }
  }
  return tainted;
}

/**
 * Run the module's top-level statements to a fixed point: a statement that uses a tainted name taints the
 * names it binds, and one binding nothing is a side effect. Returns whether any statement used the package.
 */
function settleStatements({
  facts,
  tainted,
  reader,
  tally,
}: {
  facts: ModuleFacts;
  tainted: Set<string>;
  reader: Reader;
  tally: Tally;
}): boolean {
  const dynamicReached = new Map<string, boolean>();
  const loads: (specifier: string) => boolean = (specifier) => {
    if (!dynamicReached.has(specifier)) {
      dynamicReached.set(specifier, reader.reach({ imported: "*", specifier }));
    }
    return dynamicReached.get(specifier) === true;
  };
  const pending = new Set(facts.topLevels);
  let changed = true;
  while (changed) {
    const using = [...pending].filter(
      (statement) => statement.refs.some((ref) => tainted.has(ref)) || statement.dynamicSpecifiers.some(loads),
    );
    changed = using.length > 0;
    for (const statement of using) {
      pending.delete(statement);
      statement.names.forEach((name) => tainted.add(name));
      if (statement.names.length === 0) {
        tally.sideEffect = true;
      }
    }
  }
  return pending.size < facts.topLevels.length;
}

/** The names one `export … from` passes on, given the taint of the module it names. */
function passedOn({ reExport, taint }: { reExport: ModuleFacts["reExports"][number]; taint: ModuleTaint }): string[] {
  if (reExport.exported === "*") {
    return [...taint.exports].filter((name) => name !== "default");
  }
  return bindingTainted({ imported: reExport.imported, taint }) ? [reExport.exported] : [];
}

/** The export names that lead to the package: tainted local bindings, and re-exports of tainted names. */
function taintedExports({
  facts,
  tainted,
  reader,
  tally,
}: {
  facts: ModuleFacts;
  tainted: ReadonlySet<string>;
  reader: Reader;
  tally: Tally;
}): Set<string> {
  const exports = new Set(facts.localExports.filter((pair) => tainted.has(pair.local)).map((pair) => pair.exported));
  for (const reExport of facts.reExports) {
    const target = reader.lookup(reExport.specifier);
    const taint = reader.load(target);
    if (target === PACKAGE) {
      exports.add(reExport.exported);
    } else if (target !== undefined && taint !== undefined) {
      const passed = passedOn({ reExport, taint });
      passed.forEach((name) => exports.add(name));
      if (passed.length > 0) {
        tally.from.add(target);
      }
    }
  }
  exports.delete(DEFAULT_LOCAL);
  return exports;
}

/** One module's taint recomputed from its facts and the current taint of everything it imports. */
function analyse({
  path,
  facts,
  graph,
  state,
}: {
  path: string;
  facts: ModuleFacts;
  graph: TaintGraph;
  state: ReadonlyMap<string, ModuleTaint>;
}): ModuleTaint {
  const tally: Tally = { from: new Set(), seed: false, sideEffect: false };
  const reader = readerFor({ graph, path, state, tally });
  const tainted = taintedImports({ facts, reader, tally });
  const used = settleStatements({ facts, reader, tainted, tally });
  const exports = taintedExports({ facts, reader, tainted, tally });
  return { exports, from: tally.from, seed: tally.seed, sideEffect: tally.sideEffect, used };
}

/** Whether a recomputed taint carries anything the previous one did not — sizes suffice, taint only grows. */
function grew({ before, after }: { before: ModuleTaint | undefined; after: ModuleTaint }): boolean {
  if (before === undefined) {
    return true;
  }
  return (
    after.sideEffect !== before.sideEffect ||
    after.seed !== before.seed ||
    after.used !== before.used ||
    after.exports.size !== before.exports.size ||
    after.from.size !== before.from.size
  );
}

/**
 * Whether a module carries any taint at all — a use of its own, an export that leads on, or a side effect.
 *
 * @param taint one module's taint
 * @returns true when the module uses the package or passes it on
 */
export function isTainted({ taint }: { taint: ModuleTaint }): boolean {
  return taint.used || taint.sideEffect || taint.exports.size > 0;
}

/** A module's taint after one more look, or `undefined` when it has nothing new to record. */
function recompute({
  path,
  graph,
  state,
}: {
  path: string;
  graph: TaintGraph;
  state: ReadonlyMap<string, ModuleTaint>;
}): ModuleTaint | undefined {
  const facts = graph.factsOf(path);
  if (facts === undefined) {
    return undefined;
  }
  const after = analyse({ facts, graph, path, state });
  return isTainted({ taint: after }) && grew({ after, before: state.get(path) }) ? after : undefined;
}

/**
 * Walk the package's taint from its direct importers up to everything that really uses it.
 *
 * @param graph the checkout's cheap import index, a per-module fact reader and a specifier resolver
 * @returns every module that ends up tainted, with what it exports on and where its taint came from
 */
export function propagateTaint({ graph }: { graph: TaintGraph }): ReadonlyMap<string, ModuleTaint> {
  const state = new Map<string, ModuleTaint>();
  const queue: string[] = [...graph.seeds];
  const queued = new Set<string>(queue);
  while (queue.length > 0) {
    const path = queue.shift()!;
    queued.delete(path);
    const after = recompute({ graph, path, state });
    if (after === undefined) {
      continue;
    }
    state.set(path, after);
    // A module that only USES the package passes nothing on: its importers bind nothing tainted from it.
    const passesOn = after.exports.size > 0 || after.sideEffect;
    const fresh = passesOn ? graph.importersOf(path).filter((importer) => !queued.has(importer)) : [];
    fresh.forEach((importer) => queued.add(importer));
    queue.push(...fresh);
  }
  return state;
}
