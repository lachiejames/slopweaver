/**
 * Where ON THE APP a dependency is reached, derived from a checkout rather than typed by whoever opens the PR.
 *
 * The need: for a dependency such as dompurify or the pdf stuff, say WHERE ON THE APP it is reached rather than
 * where in the code, so a reviewer testing it knows where to go — and for lodash, the answer is "everywhere". The
 * vulnerability-fix
 * form already had a place for that answer (`AppBlastRadius`, `src/outbound/github/vulnerabilityForm.ts`);
 * what it lacked was a way to GET it other than a session reading code and writing prose, which is how a
 * surface list ends up plausible rather than true.
 *
 * So: every module that imports the package seeds a taint walk (`./taint.ts`) up the import graph; the walk
 * stops at a file ROUTE, a place a reviewer can open; a tainted module nothing imports is a ROOT — an app
 * entry, a job the runtime discovers by directory, or dead code, and the report says it cannot tell which.
 * `./classify.ts` groups the surfaces by the FEATURE that pulls the package in, and once the direct importers or
 * the features reach `./threshold.ts`'s fan-in the answer is `everywhere`, with the counts as its reason.
 */
import { posix } from "node:path";

import { moduleSpecifiers } from "#lib/tsSyntax.js";

import {
  type ClassifyInput,
  classifySurfaces,
  type DeadEnd,
  type DerivedFeature,
  type DerivedSurface,
} from "./classify.js";
import { type ModuleFacts, moduleFactsOf } from "./moduleFacts.js";
import { buildResolveIndex, isSourceModule, type ResolveIndex, resolveSpecifier } from "./resolve.js";
import { PACKAGE, propagateTaint } from "./taint.js";

/** The blast radius as the vulnerability-fix form wants it, minus the `check` only a person can write. */
export type BlastRadiusDraft =
  | { readonly kind: "surfaces"; readonly surfaces: readonly { where: string; regressionCover: string }[] }
  | { readonly kind: "everywhere"; readonly why: string }
  | { readonly kind: "unreached"; readonly why: string };

/** One specifier stem that resolved to nothing tracked, and how often. */
export interface UnresolvedStem {
  readonly specifier: string;
  readonly count: number;
}

/** Everything the derivation found, for the verb to print. */
export interface SurfaceReport {
  readonly packageName: string;
  readonly modulesScanned: number;
  /** The modules that import the package directly — the "where it is used in the code" sites. */
  readonly seeds: readonly string[];
  readonly features: readonly DerivedFeature[];
  readonly surfaces: readonly DerivedSurface[];
  readonly deadEnds: readonly DeadEnd[];
  /** Local-looking code specifiers that named nothing tracked — edges the walk could not follow. */
  readonly unresolved: { readonly total: number; readonly top: readonly UnresolvedStem[] };
  readonly everywhereAt: number;
  readonly blastRadius: BlastRadiusDraft;
}

/** A specifier naming an asset, which is loaded by a bundler plugin and can import nothing. */
const ASSET =
  /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|mp4|webm|mp3|wav|woff2?|ttf|otf|json|html|md|txt|graphql|gql)(?:\?.*)?$/i;

/** `new URL("./x", import.meta.url)` — a worker or asset a bundler loads by URL, which no import names. */
const URL_LOAD = /new\s+URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;

/** The relative paths a module loads by URL — edges no import statement names, so `moduleSpecifiers` does not. */
function urlLoads({ text }: { text: string | undefined }): readonly string[] {
  if (text === undefined) {
    return [];
  }
  return [...new Set([...text.matchAll(URL_LOAD)].map((match) => match[1]!))];
}

/** One outgoing edge: a specifier as written, and where it lands. */
interface Edge {
  readonly specifier: string;
  readonly resolved: string | typeof PACKAGE | undefined;
}

/** One module's outgoing edges: every specifier it imports or loads, with where each lands. */
function edgesOf({
  path,
  text,
  target,
}: {
  path: string;
  text: string | undefined;
  target: ImportIndex["target"];
}): readonly Edge[] {
  const imported = text === undefined ? [] : moduleSpecifiers({ fileName: path, text });
  const statics = [...new Set(imported)].map((specifier): Edge => ({
    resolved: target({ fromPath: path, specifier }),
    specifier,
  }));
  // A URL load names data as often as code, so one that resolves to no module is no miss worth reporting.
  const urls = urlLoads({ text })
    .map((specifier): Edge => ({ resolved: target({ fromPath: path, specifier }), specifier }))
    .filter((edge) => edge.resolved !== undefined);
  return [...statics, ...urls];
}

/** A file route's declaration, matched on text in the pass that already reads every module. */
const ROUTE_CALL = /\bcreate(?:Lazy)?FileRoute\s*\(/;

/** Whether a specifier names the package or one of its subpaths. */
function namesPackage({ specifier, packageName }: { specifier: string; packageName: string }): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

/** Whether an unresolved specifier looked like code inside the checkout, rather than a third-party package. */
function looksLocal({ specifier }: { specifier: string }): boolean {
  const local = ["./", "../", "~/", "@/", "#"].some((prefix) => specifier.startsWith(prefix));
  return local && !ASSET.test(specifier);
}

/** Every tracked module's direct imports, resolved — the cheap pass the taint walk's candidates come from. */
interface ImportIndex {
  readonly importers: ReadonlyMap<string, readonly string[]>;
  readonly seeds: readonly string[];
  readonly unresolved: ReadonlyMap<string, number>;
  /** The modules whose text declares a TanStack file route. */
  readonly routeModules: readonly string[];
  readonly target: (args: { fromPath: string; specifier: string }) => string | typeof PACKAGE | undefined;
}

/** A specifier's target — the package, a tracked file or nothing — memoised per importing directory. */
function memoisedTarget({ index, packageName }: { index: ResolveIndex; packageName: string }): ImportIndex["target"] {
  const memo = new Map<string, string | typeof PACKAGE | undefined>();
  return ({ fromPath, specifier }) => {
    if (namesPackage({ packageName, specifier })) {
      return PACKAGE;
    }
    const key = `${posix.dirname(fromPath)}\u0000${specifier}`;
    if (!memo.has(key)) {
      memo.set(key, resolveSpecifier({ fromPath, index, specifier }));
    }
    return memo.get(key);
  };
}

/** One import edge into the index: a seed, an importer of a tracked file, or a local-looking miss. */
function record({
  path,
  specifier,
  resolved,
  importers,
  seeds,
  unresolved,
}: {
  path: string;
  specifier: string;
  resolved: string | typeof PACKAGE | undefined;
  importers: Map<string, string[]>;
  seeds: Set<string>;
  unresolved: Map<string, number>;
}): void {
  if (resolved === PACKAGE) {
    seeds.add(path);
    return;
  }
  if (resolved !== undefined) {
    const list = importers.get(resolved);
    if (list === undefined) {
      importers.set(resolved, [path]);
    } else {
      list.push(path);
    }
    return;
  }
  if (looksLocal({ specifier })) {
    const stem = specifier.replace(/^(?:\.\.?\/)+/, "");
    const seen = unresolved.get(stem);
    unresolved.set(stem, seen === undefined ? 1 : seen + 1);
  }
}

/** Build the reverse import index over every module, with a memoised resolver. */
function indexImports({
  modules,
  index,
  packageName,
}: {
  modules: readonly string[];
  index: ResolveIndex;
  packageName: string;
}): ImportIndex {
  const target = memoisedTarget({ index, packageName });
  const importers = new Map<string, string[]>();
  const seeds = new Set<string>();
  const unresolved = new Map<string, number>();
  const routeModules: string[] = [];
  for (const path of modules) {
    const text = index.read(path);
    if (text !== undefined && ROUTE_CALL.test(text)) {
      routeModules.push(path);
    }
    for (const edge of edgesOf({ path, target, text })) {
      record({ importers, path, resolved: edge.resolved, seeds, specifier: edge.specifier, unresolved });
    }
  }
  return { importers, routeModules, seeds: [...seeds].toSorted(), target, unresolved };
}

/** The regression-cover sentence the form's `regressionCover` carries, from the tests found. */
function coverSentence({ cover }: { cover: readonly string[] }): string {
  if (cover.length === 0) {
    return "no unit or component test imports this path";
  }
  const named = cover
    .slice(0, 2)
    .map((path) => posix.basename(path))
    .join(", ");
  return cover.length > 2 ? `covered by ${named} and ${String(cover.length - 2)} more` : `covered by ${named}`;
}

/** One feature as the form's `where`: its name, how many screens, and the quickest one to open. */
function featureWhere({ feature }: { feature: DerivedFeature }): string {
  const count = feature.surfaces.length;
  const first = feature.surfaces[0]!;
  const name = feature.through.length === 0 ? feature.name : `${feature.name} via ${feature.through.join(", ")}`;
  return count === 1 ? `${name}, on ${first}` : `${name}, in ${String(count)} places, e.g. ${first}`;
}

/** The draft blast radius: the features, `everywhere` past the threshold, or `unreached` with no importer. */
function draftOf({
  packageName,
  report,
  everywhereAt,
}: {
  packageName: string;
  report: { seeds: readonly string[]; features: readonly DerivedFeature[]; surfaces: readonly DerivedSurface[] };
  everywhereAt: number;
}): BlastRadiusDraft {
  if (report.seeds.length === 0) {
    return {
      kind: "unreached",
      why: `no tracked module imports ${packageName}; it arrives through a parent — run this on the parent`,
    };
  }
  if (report.seeds.length >= everywhereAt || report.features.length >= everywhereAt) {
    const apps = new Set(report.surfaces.map((surface) => surface.app));
    return {
      kind: "everywhere",
      why: `${packageName} is imported directly by ${String(report.seeds.length)} modules and pulled in by ${String(report.features.length)} components, in ${String(report.surfaces.length)} places across ${String(apps.size)} apps; there is no one place to open.`,
    };
  }
  return {
    kind: "surfaces",
    surfaces: report.features.map((feature) => ({
      regressionCover: coverSentence({ cover: feature.cover }),
      where: featureWhere({ feature }),
    })),
  };
}

/**
 * Derive where on the app one package is reached, from a checkout's tracked files.
 *
 * @param packageName the package as a manifest names it, e.g. `dompurify` or `@pdfme/ui`
 * @param tracked every tracked path in the checkout, repo-relative, posix separators
 * @param read the text of one tracked path, or `undefined` when unreadable
 * @param everywhereAt the fan-in — direct importers or features — at which the answer becomes `everywhere`
 * @returns the features, surfaces, dead ends, residue and the draft blast radius
 */
export function deriveSurfaces({
  packageName,
  tracked,
  read,
  everywhereAt,
}: {
  packageName: string;
  tracked: readonly string[];
  read: (path: string) => string | undefined;
  everywhereAt: number;
}): SurfaceReport {
  const index = buildResolveIndex({ read, tracked });
  const modules = tracked.filter((path) => isSourceModule({ path }));
  const importIndex = indexImports({ index, modules, packageName });
  const factsCache = new Map<string, ModuleFacts | undefined>();
  const factsOf: ClassifyInput["factsOf"] = (path) => {
    if (!factsCache.has(path)) {
      const text = read(path);
      factsCache.set(path, text === undefined ? undefined : moduleFactsOf({ path, text }));
    }
    return factsCache.get(path);
  };
  const importersOf: ClassifyInput["importersOf"] = (path) => {
    const importers = importIndex.importers.get(path);
    if (importers === undefined) {
      return [];
    }
    return importers;
  };
  const state = propagateTaint({
    graph: {
      factsOf,
      // A route is where the walk stops: past it is the router, and past the router is every page at once.
      importersOf: (path) => (factsOf(path)?.routePath === undefined ? importersOf(path) : []),
      seeds: importIndex.seeds,
      target: importIndex.target,
    },
  });
  const { surfaces, features, deadEnds } = classifySurfaces({
    input: { factsOf, importersOf, routeModules: importIndex.routeModules, state, tracked: index.tracked },
  });
  const top = [...importIndex.unresolved]
    .map(([specifier, count]) => ({ count, specifier }))
    .toSorted((left, right) => right.count - left.count || left.specifier.localeCompare(right.specifier))
    .slice(0, 5);
  const total = [...importIndex.unresolved.values()].reduce((sum, count) => sum + count, 0);
  return {
    blastRadius: draftOf({ everywhereAt, packageName, report: { features, seeds: importIndex.seeds, surfaces } }),
    deadEnds,
    everywhereAt,
    features,
    modulesScanned: modules.length,
    packageName,
    seeds: importIndex.seeds,
    surfaces,
    unresolved: { top, total },
  };
}
