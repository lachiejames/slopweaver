/**
 * The JumpCloud response fields that hold an authored DOCUMENT rather than a record — a workflow's DSL, a rule's
 * filter expression, a template's JSON Schema — each named with its reason, and declared `z.unknown()` by the
 * generator instead of the strict object its census measured.
 *
 * A record's keys are the provider's contract, so a measured boundary refuses an added or dropped one by name. A
 * document's keys are whatever its author wrote, at any depth: measured from one answer, the next template or rule
 * refused as drift and the whole sync stopped publishing. Measured, a live sync hours after the census
 * refused all three paths below on new keys deep inside them. Repro: take a census
 * (`tools/jumpcloudResponseCensus.ts`), regenerate without this list, run `atlas jumpcloud sync` later.
 *
 * The trade, stated: the document field is still required or optional exactly as measured, and every record holding
 * it stays strict, so a key added or dropped beside it still refuses. Inside it, nothing is checked — not its keys,
 * not even its kind. Projection's secret-field redaction runs after admission and still walks it.
 *
 * Named, never inferred from how much sibling records vary: variance is a property of one tenant's sample, not of
 * what a field means. An ordinary record field a sample never carried (`deviceInformation.meid`) is NOT a document;
 * it is measured by the next census.
 */
import { type JumpcloudCodegenError, JumpcloudCodegenErrors } from "./codegenErrors.js";
import type { JumpcloudResponseCensus, JumpcloudSurfaceCensus } from "./responseCensus.js";

/** One document-valued field: the surface, its census path, and why its keys are content rather than contract. */
export interface JumpcloudResponseDocumentPath {
  readonly surface: string;
  readonly path: string;
  readonly reason: string;
}

/** Every document-valued field the generator declares unread. */
export const JUMPCLOUD_RESPONSE_DOCUMENT_PATHS: readonly JumpcloudResponseDocumentPath[] = [
  {
    path: "templates[].dsl",
    reason: "a workflow's DSL, whose steps and their arguments nest whatever each template author wrote",
    surface: "v2-list-templates",
  },
  {
    path: "rules[].conditions[].filters",
    reason: "a filter expression tree, whose operators and operands nest to any depth",
    surface: "v2-rules-service-list-rules",
  },
  {
    path: "templates[].outputSchema",
    reason: "a JSON Schema, whose property names and keywords are the schema's own content",
    surface: "v2-rule-templates-service-list-rule-templates",
  },
];

/**
 * The document-valued census paths on one surface.
 *
 * @param paths the entries to read, `JUMPCLOUD_RESPONSE_DOCUMENT_PATHS` in production
 * @returns the paths named for that surface, none when it holds no document
 */
export function jumpcloudResponseDocumentPathsFor({
  surface,
  paths,
}: {
  surface: string;
  paths: readonly JumpcloudResponseDocumentPath[];
}): ReadonlySet<string> {
  return new Set(paths.filter((entry) => entry.surface === surface).map((entry) => entry.path));
}

/** Whether `inner` names a path below `outer`, as a field or an array's items. */
function isBelow({ outer, inner }: { outer: string; inner: string }): boolean {
  return inner.startsWith(`${outer}.`) || inner.startsWith(`${outer}[]`);
}

/** Why one entry cannot stand, or `null` when it can. */
function entryProblem({
  census,
  entry,
  generated,
  paths,
}: {
  census: JumpcloudResponseCensus;
  entry: JumpcloudResponseDocumentPath;
  generated: ReadonlySet<string>;
  paths: readonly JumpcloudResponseDocumentPath[];
}): string | null {
  const { surface, path } = entry;
  if (entry.reason.trim().length === 0) {
    return "no reason given";
  }
  if (!generated.has(surface)) {
    return "no generated boundary admits this surface";
  }
  // A list item and a data-keyed map's value (a `<placeholder>` key) are record values, where defineBoundary refuses
  // an unread schema at load.
  const key = path.slice(path.lastIndexOf(".") + 1);
  if (path.length === 0 || path.endsWith("[]") || key.startsWith("<")) {
    return "not an object field, the only place an unread value may stand";
  }
  const same = paths.filter((other) => other.surface === surface);
  if (same.filter((other) => other.path === path).length > 1) {
    return "named twice";
  }
  if (same.some((other) => isBelow({ inner: path, outer: other.path }))) {
    return "below another document path on the same surface";
  }
  const stat = Object.hasOwn(census, surface) ? census[surface] : undefined;
  if (stat === undefined) {
    return null;
  }
  const measured = Object.hasOwn(stat.paths, path) ? stat.paths[path] : undefined;
  if (measured !== undefined) {
    return onlyObject({ kinds: measured.kinds })
      ? null
      : `measured as ${kindsOf({ kinds: measured.kinds })}, not an object`;
  }
  return unmeasuredPathProblem({ path, stat });
}

/**
 * Why a path its surface never measured cannot stand, read off its nearest measured ancestor. Only a record no answer
 * carried — below a list only ever measured empty, or a surface with no record at all — is declared as one refusing
 * every record, so there is nothing to check yet. A record measured, `{}` included, never carried the path; a field
 * measured as anything but a list or an object declares no record the path could sit in.
 */
function unmeasuredPathProblem({ path, stat }: { path: string; stat: JumpcloudSurfaceCensus }): string | null {
  let ancestor = path;
  while (ancestor.length > 0) {
    // Only a step up from a list's item `[]` reaches a list whose items went unmeasured; a field step reaching a list
    // names a path missing its `[]`.
    const viaItem = ancestor.endsWith("[]");
    ancestor = parentPath({ path: ancestor });
    if (Object.hasOwn(stat.objects, ancestor)) {
      return "never measured on a surface whose answers were";
    }
    const above = Object.hasOwn(stat.paths, ancestor) ? stat.paths[ancestor] : undefined;
    if (above !== undefined) {
      const kinds = Object.keys(above.kinds).filter((kind) => kind !== "null");
      const onlyEmptyLists = viaItem && kinds.length === 1 && kinds[0] === "array";
      return onlyEmptyLists ? null : `below a field measured as ${kindsOf({ kinds: above.kinds })}, not an object`;
    }
  }
  return null;
}

/** The path one step up: a list item's list, or a field's record, the root `""` above a top-level one. */
function parentPath({ path }: { path: string }): string {
  if (path.endsWith("[]")) {
    return path.slice(0, -"[]".length);
  }
  return path.slice(0, Math.max(path.lastIndexOf("."), 0));
}

/** Whether a path's measured kinds are an object, nullable or not, and nothing else. */
function onlyObject({ kinds }: { kinds: Readonly<Record<string, number>> }): boolean {
  const present = Object.keys(kinds).filter((kind) => kind !== "null");
  return present.length === 1 && present[0] === "object";
}

/** A path's measured kinds, as a refusal names them. */
function kindsOf({ kinds }: { kinds: Readonly<Record<string, number>> }): string {
  return Object.keys(kinds).toSorted().join(" | ");
}

/**
 * Every document-path entry that cannot stand: no reason, a surface no generated boundary admits (a file response
 * included), a list item or map value rather than a field, a duplicate, one below another, or — wherever a record on
 * its path was measured — a path never measured or measured as something other than an object. Checked before
 * generation writes anything, so a stale or mistyped entry is refused by name rather than silently matching nothing.
 *
 * @param census the census generation reads
 * @param generated every surface generation writes a measured boundary for: paged, and not a file response
 * @param paths the entries to check
 * @returns one refusal per entry that cannot stand, in entry order
 */
export function jumpcloudResponseDocumentPathRefusals({
  census,
  generated,
  paths,
}: {
  census: JumpcloudResponseCensus;
  generated: ReadonlySet<string>;
  paths: readonly JumpcloudResponseDocumentPath[];
}): readonly JumpcloudCodegenError[] {
  return paths.flatMap((entry) => {
    const why = entryProblem({ census, entry, generated, paths });
    if (why === null) {
      return [];
    }
    return [JumpcloudCodegenErrors.responseDocumentPath({ path: entry.path, surface: entry.surface, why })];
  });
}
