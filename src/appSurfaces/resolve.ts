/**
 * Resolve an import specifier in a foreign checkout to the TRACKED source file it names.
 *
 * Why not `ts.resolveModuleName`: a monorepo links its workspace packages through `node_modules`, and a
 * package's `exports` map often sends the default condition to `dist/` — which is not in the checkout. The
 * TypeScript resolver would land there and the graph would break at every package boundary. So this resolves
 * against the set of files `git ls-files` reports, choosing whichever condition of an `exports` entry
 * points at a file that is actually tracked. Measured on acme/acme-admin: `@acme/shared-utils`
 * sends `default` to `./dist/*.js` and `development` to `./src/*.ts`, and only the second exists.
 *
 * Three routes, in order: a relative path; a workspace package, by its `package.json` name and `exports`;
 * a `compilerOptions.paths` alias from the nearest `tsconfig.json`. Anything else is outside the checkout.
 */
import { posix } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { readConfigText } from "#lib/tsProject.js";

/** One workspace package: where it lives and what its manifest says it exports. */
interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  /** The manifest's `exports` field, verbatim — a string, a subpath map, or a condition map. */
  readonly exports: unknown;
  /** `main`, `module` and `source`, whichever are strings, in that order. */
  readonly entries: readonly string[];
}

/** One `tsconfig.json`'s path aliases, with the directory they are relative to. */
interface PathAliases {
  readonly baseDir: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

/** Everything resolution needs, built once per checkout. */
export interface ResolveIndex {
  readonly tracked: ReadonlySet<string>;
  readonly packages: ReadonlyMap<string, WorkspacePackage>;
  /** Directory → the aliases of the nearest `tsconfig.json` at or above it, filled lazily. */
  readonly aliasesByDir: Map<string, PathAliases | undefined>;
  readonly read: (path: string) => string | undefined;
}

/** The extensions a source module may carry, in the order a bundler tries them. */
const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Whether a tracked path is a source module this walk reads — `.d.ts` declares, it does not run.
 *
 * @param path a repo-relative path
 * @returns true for a TypeScript or JavaScript module that is not a declaration file
 */
export function isSourceModule({ path }: { path: string }): boolean {
  return !path.endsWith(".d.ts") && SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** A value as a plain record, or `undefined`. */
function asRecord({ value }: { value: unknown }): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

/** Parse JSON that may carry comments and trailing commas, as `tsconfig.json` and some manifests do. */
function parseJsonc({ path, text }: { path: string; text: string }): Readonly<Record<string, unknown>> | undefined {
  const parsed = readConfigText({ configFileName: path, text });
  return parsed.isOk() ? asRecord({ value: parsed.value }) : undefined;
}

/** Every workspace package in a checkout, keyed by name — a manifest with no `name` is not one. */
function workspacePackages({
  tracked,
  read,
}: {
  tracked: readonly string[];
  read: (path: string) => string | undefined;
}): ReadonlyMap<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const path of tracked) {
    if (posix.basename(path) !== "package.json") {
      continue;
    }
    const text = read(path);
    const manifest = text === undefined ? undefined : parseJsonc({ path, text });
    const name = manifest?.["name"];
    if (manifest === undefined || typeof name !== "string") {
      continue;
    }
    const entries = ["main", "module", "source"]
      .map((key) => manifest[key])
      .filter((value): value is string => typeof value === "string");
    packages.set(name, { dir: posix.dirname(path), entries, exports: manifest["exports"], name });
  }
  return packages;
}

/** The tracked source file a path names, trying the extensions and `index` a bundler would. */
function trackedModule({ base, tracked }: { base: string; tracked: ReadonlySet<string> }): string | undefined {
  const normal = posix.normalize(base);
  const candidates: string[] = [normal];
  const swapped = normal.replace(/\.(m|c)?jsx?$/, "");
  if (swapped !== normal) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${swapped}${extension}`));
  }
  candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${normal}${extension}`));
  candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${normal}/index${extension}`));
  return candidates.find((candidate) => isSourceModule({ path: candidate }) && tracked.has(candidate));
}

/** Every string leaf of an `exports` target, conditions in declaration order. */
function targetLeaves({ target }: { target: unknown }): readonly string[] {
  if (typeof target === "string") {
    return [target];
  }
  if (Array.isArray(target)) {
    return target.flatMap((entry: unknown) => targetLeaves({ target: entry }));
  }
  const record = asRecord({ value: target });
  return record === undefined ? [] : Object.values(record).flatMap((entry) => targetLeaves({ target: entry }));
}

/** The subpath map of an `exports` field — a bare string or condition map is the `.` entry. */
function subpathMap({ exports }: { exports: unknown }): Readonly<Record<string, unknown>> {
  const record = asRecord({ value: exports });
  if (record === undefined) {
    return typeof exports === "string" || Array.isArray(exports) ? { ".": exports } : {};
  }
  return Object.keys(record).some((key) => key.startsWith(".")) ? record : { ".": record };
}

/** The target of the `exports` key matching a subpath, with its one `*` already substituted. */
function matchSubpath({ exports, subpath }: { exports: unknown; subpath: string }): readonly string[] {
  const map = subpathMap({ exports });
  const exact = map[subpath];
  if (exact !== undefined) {
    return targetLeaves({ target: exact });
  }
  for (const [key, target] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star < 0) {
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= key.length - 1) {
      const middle = subpath.slice(prefix.length, subpath.length - suffix.length);
      return targetLeaves({ target }).map((leaf) => leaf.replaceAll("*", middle));
    }
  }
  return [];
}

/**
 * A bare specifier split into its package name and `./subpath` — scoped names take two segments.
 *
 * @param specifier a bare specifier such as `@pdfme/ui/dist/x` or `lodash`
 * @returns the package name, and the subpath as an `exports` key spells it
 */
export function splitBare({ specifier }: { specifier: string }): { name: string; subpath: string } {
  const segments = specifier.split("/");
  const take = specifier.startsWith("@") ? 2 : 1;
  const rest = segments.slice(take).join("/");
  return { name: segments.slice(0, take).join("/"), subpath: rest.length === 0 ? "." : `./${rest}` };
}

/** A workspace-package specifier's tracked source file. */
function resolveWorkspace({
  pkg,
  subpath,
  tracked,
}: {
  pkg: WorkspacePackage;
  subpath: string;
  tracked: ReadonlySet<string>;
}): string | undefined {
  const leaves = pkg.exports === undefined ? [] : matchSubpath({ exports: pkg.exports, subpath });
  const fallbacks =
    subpath === "." ? [...pkg.entries, "./src/index", "./index"] : [subpath, `./src/${subpath.slice(2)}`];
  for (const leaf of [...leaves, ...(pkg.exports === undefined ? fallbacks : [])]) {
    const found = trackedModule({ base: posix.join(pkg.dir, leaf), tracked });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** The directory's own `tsconfig.json` aliases, following `extends` through relative paths and packages. */
function readAliases({
  index,
  configPath,
  depth,
}: {
  index: ResolveIndex;
  configPath: string;
  depth: number;
}): PathAliases | undefined {
  const text = index.read(configPath);
  const config = text === undefined ? undefined : parseJsonc({ path: configPath, text });
  if (config === undefined || depth > 8) {
    return undefined;
  }
  const configDir = posix.dirname(configPath);
  const own = ownAliases({ config, configDir });
  if (own !== undefined) {
    return own;
  }
  const parent = config["extends"];
  if (typeof parent !== "string") {
    return undefined;
  }
  const parentPath = parent.startsWith(".")
    ? posix.normalize(posix.join(configDir, parent))
    : extendsPackagePath({ index, specifier: parent });
  return parentPath === undefined ? undefined : readAliases({ configPath: parentPath, depth: depth + 1, index });
}

/** A config's own `compilerOptions.paths`, relative to its `baseUrl`, or `undefined` when it declares none. */
function ownAliases({
  config,
  configDir,
}: {
  config: Readonly<Record<string, unknown>>;
  configDir: string;
}): PathAliases | undefined {
  const options = asRecord({ value: config["compilerOptions"] });
  const paths = asRecord({ value: options?.["paths"] });
  if (paths === undefined) {
    return undefined;
  }
  const own: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(paths)) {
    own[key] = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }
  const baseUrl = options?.["baseUrl"];
  return { baseDir: typeof baseUrl === "string" ? posix.join(configDir, baseUrl) : configDir, paths: own };
}

/** An `extends` naming a workspace package's file, as a tracked path. */
function extendsPackagePath({ index, specifier }: { index: ResolveIndex; specifier: string }): string | undefined {
  const { name, subpath } = splitBare({ specifier });
  const pkg = index.packages.get(name);
  if (pkg === undefined) {
    return undefined;
  }
  const path = posix.join(pkg.dir, subpath === "." ? "tsconfig.json" : subpath);
  return index.tracked.has(path) ? path : undefined;
}

/** The aliases in force for a directory — its nearest `tsconfig.json`, memoised per directory. */
function aliasesFor({ index, dir }: { index: ResolveIndex; dir: string }): PathAliases | undefined {
  if (index.aliasesByDir.has(dir)) {
    return index.aliasesByDir.get(dir);
  }
  const configPath = dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`;
  let found: PathAliases | undefined;
  if (index.tracked.has(configPath)) {
    found = readAliases({ configPath, depth: 0, index });
  } else if (dir !== ".") {
    found = aliasesFor({ dir: posix.dirname(dir), index });
  }
  index.aliasesByDir.set(dir, found);
  return found;
}

/** What an alias pattern's `*` stands for in a specifier — `""` for an exact pattern — or `undefined` on no match. */
function aliasMatch({ pattern, specifier }: { pattern: string; specifier: string }): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0) {
    return specifier === pattern ? "" : undefined;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  const fits =
    specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length;
  return fits ? specifier.slice(prefix.length, specifier.length - suffix.length) : undefined;
}

/** A specifier through the `paths` aliases in force for the importing file. */
function resolveAlias({
  index,
  fromPath,
  specifier,
}: {
  index: ResolveIndex;
  fromPath: string;
  specifier: string;
}): string | undefined {
  const aliases = aliasesFor({ dir: posix.dirname(fromPath), index });
  if (aliases === undefined) {
    return undefined;
  }
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const middle = aliasMatch({ pattern, specifier });
    const found =
      middle === undefined
        ? undefined
        : targets
            .map((target) =>
              trackedModule({
                base: posix.join(aliases.baseDir, target.replaceAll("*", middle)),
                tracked: index.tracked,
              }),
            )
            .find((candidate) => candidate !== undefined);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Build the resolution index for one checkout.
 *
 * @param tracked every tracked path, repo-relative, posix separators
 * @param read the text of one tracked path, or `undefined` when unreadable
 * @returns the index {@link resolveSpecifier} reads
 */
export function buildResolveIndex({
  tracked,
  read,
}: {
  tracked: readonly string[];
  read: (path: string) => string | undefined;
}): ResolveIndex {
  return { aliasesByDir: new Map(), packages: workspacePackages({ read, tracked }), read, tracked: new Set(tracked) };
}

/**
 * The tracked source file one specifier names, or `undefined` when it leaves the checkout.
 *
 * @param index the checkout's resolution index
 * @param fromPath the importing file, repo-relative
 * @param specifier the specifier exactly as written
 * @returns the repo-relative file, or `undefined` for a third-party package, a builtin or an unresolvable path
 */
export function resolveSpecifier({
  index,
  fromPath,
  specifier,
}: {
  index: ResolveIndex;
  fromPath: string;
  specifier: string;
}): string | undefined {
  if (specifier.startsWith(".")) {
    return trackedModule({ base: posix.join(posix.dirname(fromPath), specifier), tracked: index.tracked });
  }
  const { name, subpath } = splitBare({ specifier });
  const pkg = index.packages.get(name);
  if (pkg !== undefined) {
    return resolveWorkspace({ pkg, subpath, tracked: index.tracked });
  }
  return resolveAlias({ fromPath, index, specifier });
}
