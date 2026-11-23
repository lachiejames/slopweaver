/**
 * Turn a finished taint walk into the answer a reviewer reads: the SCREENS the package is reached from, and
 * the FEATURES — the components that pull it in — each with the screens it sits on.
 *
 * Why features and not just screens: measured on acme/acme-admin, dompurify is reached from 60-odd routes,
 * almost all of them through one shared result viewer. Sixty screens is not a place to go; "the HL7 result
 * viewer, on 40 screens, e.g. the customer app's /reports/$reportId" is. The feature is the module that
 * imports a direct importer of the package, so its name is the component a reviewer would look for, and the
 * screens are where to find it.
 */
import { posix } from "node:path";

import { type ModuleFacts } from "./moduleFacts.js";
import { appLabel, ENTRY, moduleName, publicRoutePath, TEST_PATH, workspaceOf } from "./placeNames.js";
import { isTainted, type ModuleTaint } from "./taint.js";

/** One place on the app the package is reached from. */
export interface DerivedSurface {
  /** `route`: a file route a reviewer can open. `root`: a module nothing imports — an entry, a job, or dead. */
  readonly kind: "route" | "root";
  /** The place in plain words: the app, then the route path or the module. */
  readonly where: string;
  /** The app it belongs to, as the workspace's own directory spells it. */
  readonly app: string;
  /** The module that IS the surface. */
  readonly module: string;
  /** The shortest chain of modules from the surface down to one that imports the package. */
  readonly chain: readonly string[];
  /** The features this surface reaches the package through. */
  readonly features: readonly string[];
}

/** One component that pulls the package in, and every surface it sits on. */
export interface DerivedFeature {
  /** The component's name — its file's, or its directory's for an `index` file. */
  readonly name: string;
  readonly module: string;
  /**
   * The names of the direct importers it reaches the package through, when it is not one itself: the component
   * a tester looks for is sometimes the feature (`OruViewer`, through a shared `HTMLViewer`) and sometimes the
   * direct importer (`HealthCareServiceTemplateBuilder`, used by the one `ModelViewPage`), and naming both
   * answers either way without a heuristic guessing which.
   */
  readonly through: readonly string[];
  /** Where each surface is, routes first and shortest chain first, so the first is the quickest place to go. */
  readonly surfaces: readonly string[];
  readonly apps: readonly string[];
  /** The unit and component tests that import this feature, or what it reaches the package through. */
  readonly cover: readonly string[];
}

/** One tainted module that reaches no surface, and why. */
export interface DeadEnd {
  readonly module: string;
  readonly why: string;
}

/** The modules a module's taint came through — none for one the walk never reached. */
function fromOf({ state, path }: { state: ReadonlyMap<string, ModuleTaint>; path: string }): readonly string[] {
  const taint = state.get(path);
  if (taint === undefined) {
    return [];
  }
  return [...taint.from];
}

/** Whether a module imports the package directly. */
function isSeed({ state, path }: { state: ReadonlyMap<string, ModuleTaint>; path: string }): boolean {
  return state.get(path)?.seed === true;
}

/** The chain a breadth-first search found, read back from where it ended to where it started. */
function unwind({ previous, end }: { previous: ReadonlyMap<string, string | undefined>; end: string }): string[] {
  const chain: string[] = [];
  for (let at: string | undefined = end; at !== undefined; at = previous.get(at)) {
    chain.unshift(at);
  }
  return chain;
}

/** The shortest chain from a surface back down to a module that imports the package. */
function chainOf({ start, state }: { start: string; state: ReadonlyMap<string, ModuleTaint> }): readonly string[] {
  const previous = new Map<string, string | undefined>([[start, undefined]]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (isSeed({ path: current, state })) {
      return unwind({ end: current, previous });
    }
    const unseen = fromOf({ path: current, state }).filter((next) => !previous.has(next));
    unseen.forEach((next) => previous.set(next, current));
    queue.push(...unseen);
  }
  return [start];
}

/**
 * The modules between a module and the package that only PASS its taint on — barrels, re-exports — down to and
 * including the direct importers, or `undefined` when every route down crosses a module that uses it itself.
 */
function passThroughBeneath({
  path,
  state,
  memo,
}: {
  path: string;
  state: ReadonlyMap<string, ModuleTaint>;
  memo: Map<string, ReadonlySet<string> | undefined>;
}): ReadonlySet<string> | undefined {
  if (memo.has(path)) {
    return memo.get(path);
  }
  memo.set(path, undefined);
  const beneath = new Set<string>();
  for (const next of fromOf({ path, state })) {
    const nextTaint = state.get(next);
    if (nextTaint?.seed === true) {
      beneath.add(next);
      continue;
    }
    const further = nextTaint?.used === true ? undefined : passThroughBeneath({ memo, path: next, state });
    if (further !== undefined) {
      beneath.add(next);
      further.forEach((module) => beneath.add(module));
    }
  }
  const found = beneath.size === 0 ? undefined : beneath;
  memo.set(path, found);
  return found;
}

/**
 * The features a surface reaches the package through: every module on its chains that USES a direct importer
 * — reached directly or through barrels that only pass it on — or the surface itself when it imports the
 * package. A barrel is never a feature: nobody opens `index.ts`.
 */
function featuresOf({
  start,
  state,
  memo,
}: {
  start: string;
  state: ReadonlyMap<string, ModuleTaint>;
  memo: Map<string, ReadonlySet<string> | undefined>;
}): readonly string[] {
  if (isSeed({ path: start, state })) {
    return [start];
  }
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  const features = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (state.get(current)?.used === true && passThroughBeneath({ memo, path: current, state }) !== undefined) {
      features.add(current);
    }
    const unseen = fromOf({ path: current, state }).filter((next) => !isSeed({ path: next, state }) && !seen.has(next));
    unseen.forEach((next) => seen.add(next));
    queue.push(...unseen);
  }
  return [...features].toSorted();
}

/** What {@link classifySurfaces} needs from the walk and the checkout. */
export interface ClassifyInput {
  readonly state: ReadonlyMap<string, ModuleTaint>;
  readonly factsOf: (path: string) => ModuleFacts | undefined;
  readonly importersOf: (path: string) => readonly string[];
  readonly tracked: ReadonlySet<string>;
  /** Every module that declares a file route — what makes its app ROUTED. */
  readonly routeModules: readonly string[];
}

/**
 * What a tainted module nothing imports IS. In a ROUTED app — one declaring file routes — every page is
 * reached through the router, so an unimported module is an entry or dead code; in a library under `packages/`
 * it is dead code, nothing in the checkout loading it; anywhere else — a job runner, a scripts folder — the
 * runtime may load it by directory, and the walk cannot tell, so it says so.
 */
function rootKind({
  path,
  workspace,
  routed,
}: {
  path: string;
  workspace: string;
  routed: ReadonlySet<string>;
}): "entry" | "dead" | "unknown" {
  if (ENTRY.test(posix.relative(workspace, path))) {
    return "entry";
  }
  if (routed.has(workspace) || workspace.startsWith("packages/")) {
    return "dead";
  }
  return "unknown";
}

/** Why a tainted module that is no route is not a root either, or `undefined` when it is one. */
function whyNotARoot({
  importers,
  path,
  taint,
}: {
  importers: readonly string[];
  path: string;
  taint: ModuleTaint;
}): DeadEnd | undefined {
  if (importers.length > 0) {
    return { module: path, why: "its importers use none of the exports that lead to the package" };
  }
  if (!taint.used && !taint.sideEffect) {
    return { module: path, why: "it only re-exports the package's path, and nothing imports it" };
  }
  return undefined;
}

/** Where a surface is in plain words, or the dead end an unimported module turns out to be. */
function placeOf({
  app,
  path,
  routePath,
  routed,
  workspace,
}: {
  app: string;
  path: string;
  routePath: string | undefined;
  routed: ReadonlySet<string>;
  workspace: string;
}): string | DeadEnd {
  if (routePath !== undefined) {
    return `${app} ${publicRoutePath({ routePath })}`;
  }
  const relative = posix.relative(workspace, path);
  const kind = rootKind({ path, routed, workspace });
  if (kind === "dead") {
    const why = routed.has(workspace)
      ? "nothing imports it, and its app reaches every page through the router, so it is dead code — unless an import.meta.glob loads it, which the walk cannot read"
      : "nothing in the checkout imports this library module, so no app loads it";
    return { module: path, why };
  }
  if (kind === "entry") {
    return `${app} at start-up (${relative})`;
  }
  return `${app}: ${relative} (nothing imports it — an entry point, a job loaded by directory, or dead code)`;
}

/** The surface a tainted production module is, or the dead end it is instead, or neither when it feeds one. */
function surfaceOrDeadEnd({
  input,
  path,
  feedsProduction,
  memo,
  routed,
}: {
  input: ClassifyInput;
  path: string;
  feedsProduction: ReadonlySet<string>;
  memo: Map<string, ReadonlySet<string> | undefined>;
  routed: ReadonlySet<string>;
}): DerivedSurface | DeadEnd | undefined {
  const taint = input.state.get(path)!;
  const routePath = input.factsOf(path)?.routePath;
  const isRoute = routePath !== undefined && isTainted({ taint });
  if (!isRoute && feedsProduction.has(path)) {
    return undefined;
  }
  const importers = input.importersOf(path).filter((importer) => !TEST_PATH.test(importer));
  const notRoot = isRoute ? undefined : whyNotARoot({ importers, path, taint });
  if (notRoot !== undefined) {
    return notRoot;
  }
  const workspace = workspaceOf({ path, tracked: input.tracked });
  const app = appLabel({ workspace });
  const where = placeOf({ app, path, routePath, routed, workspace });
  if (typeof where !== "string") {
    return where;
  }
  return {
    app,
    chain: chainOf({ start: path, state: input.state }),
    features: featuresOf({ memo, start: path, state: input.state }),
    kind: routePath === undefined ? "root" : "route",
    module: path,
    where,
  };
}

/**
 * Classify every tainted production module as a surface or a dead end, and group the surfaces by feature.
 *
 * @param input the finished walk, per-module facts, the cheap importer index and the tracked set
 * @returns the surfaces, the features they share, and the dead ends
 */
export function classifySurfaces({ input }: { input: ClassifyInput }): {
  surfaces: readonly DerivedSurface[];
  features: readonly DerivedFeature[];
  deadEnds: readonly DeadEnd[];
} {
  const production = [...input.state.keys()].filter((path) => !TEST_PATH.test(path)).toSorted();
  const tests = [...input.state.keys()].filter((path) => TEST_PATH.test(path)).toSorted();
  const feedsProduction = new Set(production.flatMap((path) => fromOf({ path, state: input.state })));
  const surfaces: DerivedSurface[] = [];
  const deadEnds: DeadEnd[] = [];
  const memo = new Map<string, ReadonlySet<string> | undefined>();
  // Not the generated route tree: it is usually gitignored, so a checkout's tracked files never carry it.
  const routed = new Set(input.routeModules.map((path) => workspaceOf({ path, tracked: input.tracked })));
  for (const path of production) {
    const outcome = surfaceOrDeadEnd({ feedsProduction, input, memo, path, routed });
    if (outcome !== undefined && "chain" in outcome) {
      surfaces.push(outcome);
    } else if (outcome !== undefined) {
      deadEnds.push(outcome);
    }
  }
  // A route first, and the shortest chain first among each kind: the first surface is the quickest to open.
  const byChain = surfaces.toSorted(
    (left, right) =>
      Number(left.kind === "root") - Number(right.kind === "root") || left.chain.length - right.chain.length,
  );
  const featureModules = [...new Set(surfaces.flatMap((surface) => surface.features))];
  const features = featureModules.map((module): DerivedFeature => {
    const on = byChain.filter((surface) => surface.features.includes(module));
    // A feature that imports the package itself has nothing beneath it: the set is just the feature.
    const beneath = new Set([module]);
    passThroughBeneath({ memo, path: module, state: input.state })?.forEach((path) => beneath.add(path));
    return {
      apps: [...new Set(on.map((surface) => surface.app))].toSorted(),
      cover: tests.filter((test) => fromOf({ path: test, state: input.state }).some((path) => beneath.has(path))),
      module,
      name: moduleName({ path: module }),
      surfaces: on.map((surface) => surface.where),
      through: [...beneath]
        .filter((path) => path !== module && isSeed({ path, state: input.state }))
        .toSorted()
        .map((path) => moduleName({ path })),
    };
  });
  return {
    deadEnds,
    features: features.toSorted(
      (left, right) => right.surfaces.length - left.surfaces.length || left.name.localeCompare(right.name),
    ),
    surfaces,
  };
}
