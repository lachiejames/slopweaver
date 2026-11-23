/**
 * The whole-tree half of the error-shape-threshold gate (`./errorShapeThreshold.ts` carries the criterion): every
 * file's facts (`./errorShapeThresholdFacts.ts`) in, every resolved plain error shape out, each charged to the
 * file and line where it ENTERS an `err` call — never to the module that declared the string.
 *
 * A module-level name is followed to a fixed point through this tree's own bindings: a top-level `const`, a named
 * or default import from a relative or `#lib/…` specifier, and a named re-export. It stops — producing no shape —
 * at a package import, an import whose target is outside the scanned pool, a name the target does not export by
 * name (`export *` is not followed), and any binding already visited on the same path, so a cycle ends.
 *
 * Pure: no filesystem read, no `ts.Program`, no checker — the whole tree arrives as data.
 */

import { posix } from "node:path";
import { resolveSubpathImport } from "#lib/subpathImports.js";
import type { ErrorShapeFileFacts, ShapeExpressionFact } from "./errorShapeThresholdFacts.js";

/** One resolved shape: where it entered an `err` call, and its normalised text. */
export interface ShapeSite {
  readonly path: string;
  readonly line: number;
  readonly shape: string;
}

/**
 * The repo-relative `.ts` path an in-repo `.js` specifier names, or `undefined` for a package, a specifier with no
 * `.js` suffix, or one that climbs out of the repository.
 */
function targetPathOf({ importer, specifier }: { importer: string; specifier: string }): string | undefined {
  if (!specifier.endsWith(".js")) {
    return undefined;
  }
  const subpath = resolveSubpathImport({ specifier });
  if (subpath !== undefined) {
    return `${subpath.slice(0, -".js".length)}.ts`;
  }
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const joined = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (joined.startsWith("..")) {
    return undefined;
  }
  return `${joined.slice(0, -".js".length)}.ts`;
}

/** The scanned pool, by path, and the walk's own memory of what it has already followed on this path. */
interface Walk {
  readonly index: ReadonlyMap<string, ErrorShapeFileFacts>;
  readonly visited: ReadonlySet<string>;
}

/** The same walk, having now followed `key` — a fresh set, so a sibling conditional arm is not blinded by it. */
function stepped({ walk, key }: { walk: Walk; key: string }): Walk {
  return { index: walk.index, visited: new Set([...walk.visited, key]) };
}

/** Every shape `name`, as a module-level binding of `path`, resolves to. */
function shapesOfName({ walk, path, name }: { walk: Walk; path: string; name: string }): readonly string[] {
  const key = `${path}\0local\0${name}`;
  const file = walk.index.get(path);
  if (file === undefined || walk.visited.has(key)) {
    return [];
  }
  const next = stepped({ key, walk });
  const constant = file.consts.find((one) => one.name === name);
  if (constant !== undefined) {
    return shapesOfExpression({ expression: constant.expression, path, walk: next });
  }
  const binding = file.imports.find((one) => one.local === name);
  if (binding === undefined) {
    return [];
  }
  const target = targetPathOf({ importer: path, specifier: binding.specifier });
  if (target === undefined) {
    return [];
  }
  return shapesOfExport({ exported: binding.imported, path: target, walk: next });
}

/** Every shape the module at `path` exports under the public name `exported`. */
function shapesOfExport({ walk, path, exported }: { walk: Walk; path: string; exported: string }): readonly string[] {
  const key = `${path}\0export\0${exported}`;
  const file = walk.index.get(path);
  if (file === undefined || walk.visited.has(key)) {
    return [];
  }
  const next = stepped({ key, walk });
  const binding = file.exports.find((one) => one.exported === exported);
  if (binding === undefined) {
    return [];
  }
  if (binding.kind === "local") {
    return shapesOfName({ name: binding.local, path, walk: next });
  }
  const target = targetPathOf({ importer: path, specifier: binding.specifier });
  if (target === undefined) {
    return [];
  }
  return shapesOfExport({ exported: binding.imported, path: target, walk: next });
}

/** Every shape one expression fact resolves to, conditional arms and list items in source order. */
function shapesOfExpression({
  walk,
  path,
  expression,
}: {
  walk: Walk;
  path: string;
  expression: ShapeExpressionFact;
}): readonly string[] {
  switch (expression.kind) {
    case "shape":
      return [expression.shape];
    case "name":
      return shapesOfName({ name: expression.name, path, walk });
    case "conditional":
      return [
        ...shapesOfExpression({ expression: expression.whenTrue, path, walk }),
        ...shapesOfExpression({ expression: expression.whenFalse, path, walk }),
      ];
    case "list":
      return expression.items.flatMap((item) => shapesOfExpression({ expression: item, path, walk }));
    case "unresolved":
      return [];
    default: {
      const unreachable: never = expression;
      return unreachable;
    }
  }
}

/**
 * Resolve every file's `err` uses against the whole scanned pool. Pure.
 *
 * @param facts one record per scanned file, as `scanErrorShapeFacts` read it
 * @returns one site per resolved shape, at the path and line of the `err` use that supplied it, in pool order
 */
export function resolveErrorShapeFacts({ facts }: { facts: readonly ErrorShapeFileFacts[] }): readonly ShapeSite[] {
  const walk: Walk = { index: new Map(facts.map((file) => [file.path, file])), visited: new Set() };
  const sites: ShapeSite[] = [];
  for (const file of facts) {
    for (const use of file.uses) {
      for (const shape of shapesOfExpression({ expression: use.expression, path: file.path, walk })) {
        sites.push({ line: use.line, path: file.path, shape });
      }
    }
  }
  return sites;
}
