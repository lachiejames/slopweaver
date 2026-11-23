/**
 * Merge the three inputs into one atlas generation, and answer the two questions a caller actually asks of
 * it: "what can I send this method" and "is there a call that returns X".
 *
 * Pure — every function here takes rows and returns rows. The reading of `node_modules` lives in the CLI
 * shell, so the merge, the counts and the search are testable with three literals.
 */
import type { AtlasCounts, BrowserObservedMethod, DocsFacts, SdkMethod, SlackApiAtlas } from "./model.js";

/**
 * Count what each input contributed. `withDocs` is a numerator whose denominator is `methods` on purpose —
 * see `methods.ts` on why a partial docs sweep must not read as a complete one.
 *
 * @param methods the SDK rows
 * @param docs the documentation rows
 * @param browser the browser-observed rows
 * @returns the coverage counts
 */
export function countAtlas({
  methods,
  docs,
  browser,
}: {
  methods: readonly SdkMethod[];
  docs: readonly DocsFacts[];
  browser: readonly BrowserObservedMethod[];
}): AtlasCounts {
  const known = new Set(methods.map((method) => method.name));
  return {
    browserObserved: browser.length,
    browserOnly: browser.filter((row) => !known.has(row.name)).length,
    methods: methods.length,
    params: methods.reduce((total, method) => total + method.params.length, 0),
    responseFields: methods.reduce(
      (total, method) =>
        total +
        method.responseFields.length +
        Object.values(method.responseNested).reduce((inner, names) => inner + names.length, 0),
      0,
    ),
    withDocs: docs.filter((row) => known.has(row.name)).length,
  };
}

/**
 * Assemble one generation.
 *
 * @param sdkVersion the installed `@slack/web-api` version the typings were read from
 * @param builtAtIso when this generation was built
 * @param methods the SDK rows
 * @param docs the documentation rows
 * @param browser the browser-observed rows
 * @returns the atlas
 */
export function buildSlackApiAtlas({
  sdkVersion,
  builtAtIso,
  methods,
  docs,
  browser,
}: {
  sdkVersion: string;
  builtAtIso: string;
  methods: readonly SdkMethod[];
  docs: readonly DocsFacts[];
  browser: readonly BrowserObservedMethod[];
}): SlackApiAtlas {
  return {
    browser: [...browser].toSorted((a, b) => a.name.localeCompare(b.name)),
    builtAtIso,
    counts: countAtlas({ browser, docs, methods }),
    docs: [...docs].toSorted((a, b) => a.name.localeCompare(b.name)),
    methods: [...methods].toSorted((a, b) => a.name.localeCompare(b.name)),
    sdkVersion,
  };
}

/** Everything the atlas knows about one method, from whichever inputs saw it. */
export interface MethodView {
  readonly name: string;
  readonly sdk: SdkMethod | undefined;
  readonly docs: DocsFacts | undefined;
  readonly browser: BrowserObservedMethod | undefined;
}

/**
 * Every method whose NAME contains the term, from any input. Case-insensitive substring rather than an
 * exact match, because the caller usually knows a family (`conversations`) or a word (`replies`) and not a
 * dotted name — and because a lookup that returns nothing on a near miss teaches nothing.
 *
 * @param atlas the generation to read
 * @param term the substring to match against method names; `""` matches everything
 * @returns one view per matching method, sorted by name
 */
export function findMethods({ atlas, term }: { atlas: SlackApiAtlas; term: string }): readonly MethodView[] {
  const needle = term.toLowerCase();
  const names = new Set<string>();
  for (const row of [...atlas.methods, ...atlas.docs, ...atlas.browser]) {
    if (row.name.toLowerCase().includes(needle)) {
      names.add(row.name);
    }
  }
  return [...names].toSorted().map((name) => ({
    browser: atlas.browser.find((row) => row.name === name),
    docs: atlas.docs.find((row) => row.name === name),
    name,
    sdk: atlas.methods.find((row) => row.name === name),
  }));
}

/** One method that mentions a sought field, and where in its response it appeared. */
export interface FieldHit {
  readonly method: string;
  /** The paths that matched — `messages[].reply_count`, or a top-level field name. */
  readonly paths: readonly string[];
  /** `true` when the match came only from the browser capture, so an ordinary token may not reach it. */
  readonly browserOnly: boolean;
}

/** One method's matching paths, accumulated across both inputs. */
interface FieldMatch {
  readonly paths: Set<string>;
  fromSdk: boolean;
}

/** The match a method already holds, or a fresh empty one, not yet from the SDK, the first time it matches. */
function matchFor({ held }: { held: FieldMatch | undefined }): FieldMatch {
  if (held == null) {
    return { fromSdk: false, paths: new Set<string>() };
  }
  return held;
}

/**
 * Record one matching path against its method.
 *
 * @param hits the accumulator
 * @param method the method the path belongs to
 * @param path the matching path
 * @param fromSdk whether the SDK typings declare it, as opposed to only the browser having seen it
 */
function addHit({
  hits,
  method,
  path,
  fromSdk,
}: {
  hits: Map<string, FieldMatch>;
  method: string;
  path: string;
  fromSdk: boolean;
}): void {
  const entry = matchFor({ held: hits.get(method) });
  entry.paths.add(path);
  entry.fromSdk = entry.fromSdk || fromSdk;
  hits.set(method, entry);
}

/**
 * Every path in one SDK method's response, top level and one level down, whose last segment matches.
 *
 * @param method the SDK row
 * @param needle the lower-cased term
 * @returns the matching paths
 */
function sdkPathsMatching({ method, needle }: { method: SdkMethod; needle: string }): readonly string[] {
  const top = method.responseFields
    .filter((field) => field.name.toLowerCase().includes(needle))
    .map((field) => field.name);
  const nested = Object.entries(method.responseNested).flatMap(([parent, names]) =>
    names.filter((name) => name.toLowerCase().includes(needle)).map((name) => `${parent}[].${name}`),
  );
  return [...top, ...nested];
}

/**
 * Which methods can return a field. This is the question the atlas exists for: an investigation that asks
 * "does anything hand me the reply count without opening the thread" gets an answer built from observed
 * response shapes rather than from recollection.
 *
 * The browser capture is searched too, and separately flagged: a field only the web client has seen is a
 * lead to test, never a capability to rely on.
 *
 * @param atlas the generation to read
 * @param field the field-name substring to look for, case-insensitive
 * @returns one hit per method whose response mentions it, most paths first
 */
export function findResponseField({ atlas, field }: { atlas: SlackApiAtlas; field: string }): readonly FieldHit[] {
  const needle = field.toLowerCase();
  const hits = new Map<string, FieldMatch>();
  for (const method of atlas.methods) {
    for (const path of sdkPathsMatching({ method, needle })) {
      addHit({ fromSdk: true, hits, method: method.name, path });
    }
  }
  for (const row of atlas.browser) {
    for (const path of row.responsePaths.filter((entry) => entry.toLowerCase().includes(needle))) {
      addHit({ fromSdk: false, hits, method: row.name, path });
    }
  }
  return [...hits.entries()]
    .map(([method, entry]): FieldHit => ({ browserOnly: !entry.fromSdk, method, paths: [...entry.paths].toSorted() }))
    .toSorted((a, b) => b.paths.length - a.paths.length || a.method.localeCompare(b.method));
}
