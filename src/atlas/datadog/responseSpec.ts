/**
 * What the pinned Datadog specification declares at one place in an operation's answer, read the way
 * `responseCodegen.ts` needs it: dereferenced (`responseSpecNode.ts`), each node classified (`responseSpecLeaf.ts`),
 * its `oneOf` arms expanded and merged here, and every node the boundary layer cannot hold named as a CUT rather
 * than guessed at.
 *
 * ## The spec is consulted only where the census measured something
 *
 * The admitted operations reach 3,133 component schemas. Most are never reached by a live answer, and a node no
 * answer reached is never emitted as structure — at most its NAME is declared, unread. So this module answers one
 * question per census path, never a question about the whole document.
 *
 * ## The merge table
 *
 * Every dereferenced arm is classified as primitive, object, array, map, free or mixed. Object arms merge into ONE
 * strict object (names unioned, required only where every object arm requires it), array arms into ONE array
 * whose items merge the same way, map arms into ONE map whose values merge the same way, primitive arms union their
 * kinds. That is the most `defineBoundary` admits in a union — one object arm, one list arm, primitives
 * (`../../lib/boundaryWalk.ts`). A free object and a mixed one (declared properties beside `additionalProperties`
 * that is `true` or a schema) cannot be held strictly, so each is a cut of its own reason, however many arms declare
 * it. The merged map alone is a map; beside an arm of any other kind it, like a free or mixed arm (a free arm beside
 * a mixed one included), is an `oneof-conflict` cut, since a record arm accepts any key. A `$ref` re-entering a component
 * already on the path from the root is a `recursive` cut at its FIRST re-entry, so depth is never bounded by
 * what one tenant happened to nest.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type DatadogSpecError, DatadogSpecErrors } from "./responseSpecErrors.js";
import { type DatadogSpecLeaf, datadogMalformedKeyword, datadogNullOnly, datadogSpecLeaf } from "./responseSpecLeaf.js";
import {
  type DatadogCutReason,
  type DatadogSpecNode,
  type DatadogSpecPrimitive,
  datadogSpecDereferenced,
} from "./responseSpecNode.js";

/** What the specification declares at one place, after every arm meeting there is merged. */
export type DatadogSpecView =
  | { readonly kind: "cut"; readonly reason: DatadogCutReason }
  | {
      readonly kind: "declared";
      readonly primitives: ReadonlySet<DatadogSpecPrimitive>;
      readonly nullable: boolean;
      readonly object: {
        readonly properties: ReadonlyMap<string, readonly DatadogSpecNode[]>;
        readonly required: ReadonlySet<string>;
      } | null;
      /** `free` when an arm declared no `items`, so nothing below is known. */
      readonly array: { readonly items: readonly DatadogSpecNode[]; readonly free: boolean } | null;
      /** `free` when the map's values are declared as anything: `true`, or a schema that is itself free. */
      readonly map: { readonly values: readonly DatadogSpecNode[]; readonly free: boolean } | null;
    };

/** A leaf no strict declaration holds, whatever arms sit beside it. */
type UnholdableLeaf = Extract<DatadogSpecLeaf, { readonly class: "free" | "mixed" }>;

/** A leaf a merged view holds: every class but a cut's. */
type HeldLeaf = Exclude<DatadogSpecLeaf, { readonly class: "recursive" | "free" | "mixed" }>;

/** An object leaf, which {@link mergedObject} merges. */
type ObjectLeaf = Extract<DatadogSpecLeaf, { readonly class: "object" }>;

/** The view of a place no arm forces a cut at. */
type DeclaredSpecView = Extract<DatadogSpecView, { readonly kind: "declared" }>;

/**
 * How many `oneOf`/`anyOf` levels one place's arms may nest before the specification is refused rather than
 * expanded. Chosen, not measured: far above any composition a real schema nests and far inside the call stack.
 */
const MAX_COMPOSITION_DEPTH = 64;

/**
 * How many arms one place's compositions may expand to before the specification is refused rather than merged. A
 * YAML alias can hand two arms one node, so arms sharing nodes double at every level a depth bound still admits.
 * Chosen, not measured: far above any union a real schema declares, and small enough that every expansion ends.
 */
const MAX_ARMS = 1024;

/**
 * How many schemas one place's compositions may visit, null-only arms included, before the specification is refused.
 * Null is no arm, so arms aliased to null alone never reach `MAX_ARMS`, yet they still double the walk. Chosen, not
 * measured: one arm bound per level of composition depth, so every expansion `MAX_ARMS` admits stays well inside it.
 */
const MAX_SCHEMAS = MAX_ARMS * MAX_COMPOSITION_DEPTH;

/** The structural keywords a `oneOf`/`anyOf` node may not carry beside its arms. */
const BESIDE_ARMS = ["properties", "required", "additionalProperties", "items"] as const;

/**
 * The JSON kinds a leaf's arm declares, `null` among them when it is nullable — none for a free or recursive arm's
 * own shape, which a `type` leaves a cut.
 */
function leafKinds({ leaf }: { leaf: DatadogSpecLeaf }): readonly string[] {
  const nulls = leaf.class !== "recursive" && leaf.nullable ? ["null"] : [];
  switch (leaf.class) {
    case "primitive":
      return [...leaf.kinds, ...nulls];
    case "array":
      return ["array", ...nulls];
    case "object":
    case "map":
    case "mixed":
      return ["object", ...nulls];
    case "free":
    case "recursive":
      return nulls;
  }
}

/**
 * The first kind an arm declares that a composition's own `type` excludes, or `null` when every arm sits within
 * it. A `type` agreeing with its arms adds nothing; one excluding an arm would narrow it, which is not read. Null
 * sits within it when the `type` names null or the composition is itself `nullable`.
 */
function kindOutsideType({
  type,
  nullable,
  leaves,
}: {
  type: unknown;
  nullable: boolean;
  leaves: readonly DatadogSpecLeaf[];
}): string | null {
  const listed: readonly unknown[] = Array.isArray(type) ? type : [type];
  const allowed = new Set(listed.map((each) => (each === "integer" ? "number" : each)));
  if (nullable) {
    allowed.add("null");
  }
  for (const leaf of leaves) {
    const outside = leafKinds({ leaf }).find((kind) => !allowed.has(kind));
    if (outside !== undefined) {
      return outside;
    }
  }
  return null;
}

/**
 * Every leaf the given nodes resolve to, `oneOf` and `anyOf` arms expanded, `depth` compositions deep already. Null
 * is no arm, so however many places admit it, it is one null-only leaf at the end and never counts toward the arm
 * bound; `walk` counts every schema visited across the whole expansion, which is what bounds a walk of null alone.
 */
function leavesOf({
  document,
  nodes,
  depth,
  walk,
}: {
  document: Readonly<Record<string, unknown>>;
  nodes: readonly DatadogSpecNode[];
  depth: number;
  walk: { schemas: number };
}): Result<readonly DatadogSpecLeaf[], DatadogSpecError> {
  if (depth > MAX_COMPOSITION_DEPTH) {
    return err(DatadogSpecErrors.bound({ bound: "depth", limit: MAX_COMPOSITION_DEPTH }));
  }
  const leaves: DatadogSpecLeaf[] = [];
  let admitsNull = false;
  for (const located of nodes) {
    walk.schemas += 1;
    if (walk.schemas > MAX_SCHEMAS) {
      return err(DatadogSpecErrors.bound({ bound: "schemas", limit: MAX_SCHEMAS }));
    }
    const visit = visited({ depth, document, located, walk });
    if (visit.isErr()) {
      return err(visit.error);
    }
    leaves.push(...visit.value.leaves);
    if (visit.value.admitsNull) {
      admitsNull = true;
    }
    // Checked as each composition returns, so an expansion stops within one bound of its first excess.
    if (visit.value.composition && leaves.length > MAX_ARMS) {
      return err(DatadogSpecErrors.bound({ bound: "arms", limit: MAX_ARMS }));
    }
  }
  if (admitsNull) {
    leaves.push({ class: "primitive", kinds: [], nullable: true });
  }
  return ok(leaves);
}

/** What one visited schema adds to {@link leavesOf}: its leaves, null-only ones aside, and whether it admits null. */
interface Visit {
  readonly leaves: readonly DatadogSpecLeaf[];
  readonly admitsNull: boolean;
  /** Whether the schema was a composition, after which the arm bound is checked. */
  readonly composition: boolean;
}

/** One schema {@link leavesOf} visits: dereferenced, then classified as a leaf or expanded as a composition. */
function visited({
  document,
  located,
  depth,
  walk,
}: {
  document: Readonly<Record<string, unknown>>;
  located: DatadogSpecNode;
  depth: number;
  walk: { schemas: number };
}): Result<Visit, DatadogSpecError> {
  const resolved = datadogSpecDereferenced({ document, located });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  if (resolved.value === "recursive") {
    return ok({ admitsNull: false, composition: false, leaves: [{ class: "recursive" }] });
  }
  const { node, stack } = resolved.value;
  if (!isRecord(node)) {
    return err(DatadogSpecErrors.notObject());
  }
  const refused = compositionRefusal({ node });
  if (refused !== null) {
    return err(refused);
  }
  const arms = node["oneOf"] === undefined ? node["anyOf"] : node["oneOf"];
  // A composition that is not a list was refused above, so anything but a list here is no composition at all.
  if (!Array.isArray(arms)) {
    const leaf = datadogSpecLeaf({ node, stack });
    const nullOnly = datadogNullOnly({ leaf });
    return ok({ admitsNull: nullOnly, composition: false, leaves: nullOnly ? [] : [leaf] });
  }
  const expanded = leavesOf({
    depth: depth + 1,
    document,
    nodes: arms.map((arm: unknown) => ({ node: arm, stack })),
    walk,
  });
  if (expanded.isErr()) {
    return err(expanded.error);
  }
  return composedVisit({ leaves: expanded.value, node });
}

/**
 * Why a node's composition keywords are not read, or its malformed structure when it carries none; `null` when
 * neither refuses it.
 */
function compositionRefusal({ node }: { node: Readonly<Record<string, unknown>> }): DatadogSpecError | null {
  if (node["allOf"] !== undefined) {
    return DatadogSpecErrors.allOf();
  }
  // Both at once constrain the value twice, the merge an allOf would need, so neither is read.
  if (node["oneOf"] !== undefined && node["anyOf"] !== undefined) {
    return DatadogSpecErrors.oneOfBesideAnyOf();
  }
  const arms = node["oneOf"] === undefined ? node["anyOf"] : node["oneOf"];
  if (arms === undefined) {
    return datadogMalformedKeyword({ node });
  }
  if (!Array.isArray(arms)) {
    return DatadogSpecErrors.compositionNotList();
  }
  // Structure beside the arms applies to every arm, the merge an allOf would need, so it is refused the same way.
  const beside = BESIDE_ARMS.find((keyword) => node[keyword] !== undefined);
  return beside === undefined ? null : DatadogSpecErrors.besideArms({ keyword: beside });
}

/** A composition's visit from the leaves its arms expanded to, refused when its own `type` would narrow one. */
function composedVisit({
  node,
  leaves,
}: {
  node: Readonly<Record<string, unknown>>;
  leaves: readonly DatadogSpecLeaf[];
}): Result<Visit, DatadogSpecError> {
  const nullable = node["nullable"] === true;
  const outside = node["type"] === undefined ? null : kindOutsideType({ leaves, nullable, type: node["type"] });
  if (outside !== null) {
    return err(DatadogSpecErrors.typeExcludesArm({ kind: outside }));
  }
  // A nullable composition, or one whose own type names null, admits null whatever its arms declare.
  const typedNull = Array.isArray(node["type"]) ? node["type"].includes("null") : node["type"] === "null";
  const armNull = leaves.some((leaf) => datadogNullOnly({ leaf }));
  return ok({
    admitsNull: nullable || typedNull || armNull,
    composition: true,
    leaves: leaves.filter((leaf) => !datadogNullOnly({ leaf })),
  });
}

/**
 * The cut, if any, the leaves at one place force. A leaf declaring only null is no arm: the view carries it as
 * `nullable`, which sits beside a map or a free node without a union.
 */
function cutOf({ leaves: all }: { leaves: readonly DatadogSpecLeaf[] }): DatadogCutReason | null {
  const leaves = all.filter((leaf) => !datadogNullOnly({ leaf }));
  const structural = leaves.filter((leaf) => leaf.class !== "primitive");
  const recursive = structural.some((leaf) => leaf.class === "recursive");
  if (recursive) {
    return "recursive";
  }
  const first = structural.find((leaf): leaf is UnholdableLeaf => leaf.class === "free" || leaf.class === "mixed");
  const maps = structural.filter((leaf) => leaf.class === "map");
  if (first !== undefined) {
    // Arms all of one unholdable class are that one shape however many declare it; any other arm beside it conflicts.
    const sameClass = leaves.every((leaf) => leaf.class === first.class);
    return sameClass ? first.class : "oneof-conflict";
  }
  if (maps.length > 0 && maps.length < leaves.length) {
    return "oneof-conflict";
  }
  return null;
}

/**
 * What the specification declares where the given nodes meet — one node, or several when `oneOf` arms or two
 * parents' properties land on one census path.
 *
 * @param document the whole pinned specification, for resolving references
 * @param nodes every specification node at this place
 * @returns the merged view, or a cut; or why the specification could not be read here
 */
export function datadogSpecView({
  document,
  nodes,
}: {
  document: Readonly<Record<string, unknown>>;
  nodes: readonly DatadogSpecNode[];
}): Result<DatadogSpecView, DatadogSpecError> {
  const leaves = leavesOf({ depth: 0, document, nodes, walk: { schemas: 0 } });
  if (leaves.isErr()) {
    return err(leaves.error);
  }
  const cut = cutOf({ leaves: leaves.value });
  if (cut !== null) {
    return ok({ kind: "cut", reason: cut });
  }
  const view = mergedView({ leaves: leaves.value });
  if (view.kind !== "declared" || view.map === null || view.map.free) {
    return ok(view);
  }
  return ok({ ...view, map: { ...view.map, free: valuesFree({ document, values: view.map.values }) } });
}

/**
 * Whether a map's declared values are themselves free — `additionalProperties: {}`, or a schema naming no type —
 * so the map is as unconstrained as `additionalProperties: true`. Values this cannot read are not free: they are
 * read, and refused, only where a census measured them.
 */
function valuesFree({
  document,
  values,
}: {
  document: Readonly<Record<string, unknown>>;
  values: readonly DatadogSpecNode[];
}): boolean {
  const leaves = leavesOf({ depth: 0, document, nodes: values, walk: { schemas: 0 } });
  if (leaves.isErr()) {
    return false;
  }
  return cutOf({ leaves: leaves.value }) === "free";
}

/**
 * Merge the leaves at one place that force no cut: object arms into one object (required only where every
 * object arm requires a key), array arms into one array, map arms into one map, primitive kinds unioned.
 */
function mergedView({ leaves }: { leaves: readonly DatadogSpecLeaf[] }): DatadogSpecView {
  const held = leaves.filter(
    (leaf): leaf is HeldLeaf => leaf.class !== "recursive" && leaf.class !== "free" && leaf.class !== "mixed",
  );
  const primitives = new Set<DatadogSpecPrimitive>(
    held.flatMap((leaf) => (leaf.class === "primitive" ? leaf.kinds : [])),
  );
  const objects = held.filter((leaf): leaf is ObjectLeaf => leaf.class === "object");
  const arrays: readonly (DatadogSpecNode | null)[] = held.flatMap((leaf) =>
    leaf.class === "array" ? [leaf.items] : [],
  );
  const maps: readonly (DatadogSpecNode | null)[] = held.flatMap((leaf) => (leaf.class === "map" ? [leaf.value] : []));
  const nonNull = (node: DatadogSpecNode | null): node is DatadogSpecNode => node !== null;
  return {
    array: arrays.length === 0 ? null : { free: arrays.includes(null), items: arrays.filter(nonNull) },
    kind: "declared",
    map: maps.length === 0 ? null : { free: maps.includes(null), values: maps.filter(nonNull) },
    nullable: held.some((leaf) => leaf.nullable),
    object: objects.length === 0 ? null : mergedObject({ objects }),
    primitives,
  };
}

/** Object arms merged into one: every name any arm declares, required only where every arm requires it. */
function mergedObject({ objects }: { objects: readonly ObjectLeaf[] }): NonNullable<DeclaredSpecView["object"]> {
  const properties = new Map<string, DatadogSpecNode[]>();
  for (const leaf of objects) {
    for (const [key, node] of Object.entries(leaf.properties)) {
      const merged = properties.get(key);
      if (merged === undefined) {
        properties.set(key, [{ node, stack: leaf.stack }]);
      } else {
        merged.push({ node, stack: leaf.stack });
      }
    }
  }
  const [first, ...rest] = objects.map((leaf) => leaf.required);
  const required = new Set(first);
  for (const own of rest) {
    for (const key of [...required].filter((name) => !own.includes(name))) {
      required.delete(key);
    }
  }
  return { properties, required };
}
