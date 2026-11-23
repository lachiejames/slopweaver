/**
 * One node of the pinned Datadog specification, and the two reads every other part of the response generator stands
 * on: whether a parsed value contains itself, and what a `$ref` resolves to. `responseSpec.ts` merges what these
 * resolve; `responseDeclaration.ts` finds an operation's own schema with them.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type DatadogSpecError, DatadogSpecErrors } from "./responseSpecErrors.js";

/** A primitive kind as a boundary declares it; the specification's `integer` is a `number`. */
export type DatadogSpecPrimitive = "boolean" | "number" | "string";

/**
 * Why a node is left unread. Every reason is derived from the pinned specification and the one census the
 * boundaries are generated from, so none is a list a person keeps and none can go stale. `unspecified` is a
 * lag of `object` or `array` (`responseCodegen.ts`): the census measured structure the specification declares
 * nothing under.
 */
export type DatadogCutReason = "free" | "mixed" | "recursive" | "unbuildable-map" | "oneof-conflict" | "unspecified";

/** One specification node, with the components on its path from the response root. */
export interface DatadogSpecNode {
  readonly node: unknown;
  readonly stack: readonly string[];
}

/**
 * Whether a node reaches itself, walked with its own stack rather than the call stack, so a value nested however
 * deep is answered rather than overflowing. `open` holds the current path's nodes, `done` every node cleared.
 */
function reachesItself({ root }: { root: object }): boolean {
  const open = new Set<object>([root]);
  const done = new WeakSet<object>();
  const path: { node: object; children: Iterator<unknown> }[] = [
    { children: Object.values(root).values(), node: root },
  ];
  while (path.length > 0) {
    const top = path.at(-1)!;
    const next = top.children.next();
    if (next.done === true) {
      path.pop();
      open.delete(top.node);
      done.add(top.node);
      continue;
    }
    const child = next.value;
    if (typeof child !== "object" || child === null || done.has(child)) {
      continue;
    }
    if (open.has(child)) {
      return true;
    }
    open.add(child);
    path.push({ children: Object.values(child).values(), node: child });
  }
  return false;
}

/**
 * Whether a parsed specification value contains itself. YAML aliases can build one, and every `$ref` cycle is a
 * `recursive` cut, but a node reaching itself by identity would be walked forever, so it is refused instead. Walked
 * afresh on every call, never cached, so a value changed since an earlier call is answered as it now stands.
 *
 * @returns `true` when some node in the value is its own descendant
 */
export function datadogSpecCyclic({ value }: { value: unknown }): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return reachesItself({ root: value });
}

/**
 * A specification object's own member by a name the document or a registry row chose. Never an inherited one:
 * `__proto__` or `constructor` names nothing here.
 *
 * @returns the member, or `undefined` when the value is not an object or holds no such member of its own
 */
export function datadogSpecMember({ value, key }: { value: unknown; key: string }): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/**
 * The keywords a `$ref` may carry beside it, all annotation. OpenAPI 3.0, which both pinned specifications declare,
 * ignores every sibling of a reference, `nullable` and any `x-` extension included; any other keyword there would
 * constrain the value under a later OpenAPI, so a reference carrying one is refused rather than read as the
 * component alone. Generating over both pins is the check that neither carries one where it is read.
 */
const REF_ANNOTATIONS: ReadonlySet<string> = new Set([
  "default",
  "deprecated",
  "description",
  "example",
  "examples",
  "externalDocs",
  "nullable",
  "readOnly",
  "title",
  "writeOnly",
  "xml",
]);

/**
 * A `$ref` resolved to its component, followed through every reference it lands on. Only a whole component
 * (`#/components/<kind>/<name>`) resolves: a pointer into one is refused, since a cycle is tracked by component and
 * one reaching inside another would escape that tracking.
 *
 * @param document the whole pinned specification, for resolving references
 * @param located the node to resolve, with the components already on its path
 * @returns the resolved node and its path, `recursive` when a component is already on that path; or why the
 *   reference could not be resolved
 */
export function datadogSpecDereferenced({
  document,
  located,
}: {
  document: Readonly<Record<string, unknown>>;
  located: DatadogSpecNode;
}): Result<DatadogSpecNode | "recursive", DatadogSpecError> {
  let { node } = located;
  const stack = [...located.stack];
  while (isRecord(node) && typeof node["$ref"] === "string") {
    const ref = node["$ref"];
    const beside = Object.keys(node).find(
      (key) => key !== "$ref" && !key.startsWith("x-") && !REF_ANNOTATIONS.has(key),
    );
    if (beside !== undefined) {
      return err(DatadogSpecErrors.referenceAnnotated({ beside, ref }));
    }
    const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);
    if (match === null) {
      return err(DatadogSpecErrors.referenceNotLocal({ ref }));
    }
    const key = `${match[1]!}/${match[2]!}`;
    if (stack.includes(key)) {
      return ok("recursive");
    }
    const section = datadogSpecMember({ key: match[1]!, value: document["components"] });
    const target = datadogSpecMember({ key: match[2]!, value: section });
    if (!isRecord(target)) {
      return err(DatadogSpecErrors.referenceUnresolved({ ref }));
    }
    node = target;
    stack.push(key);
  }
  return ok({ node, stack });
}
