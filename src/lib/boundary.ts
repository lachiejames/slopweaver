/**
 * The one way a hand-written client reads what a provider answered: a strict Zod schema per endpoint, and a
 * refusal that names the field the provider added, dropped, renamed or retyped.
 *
 * The rule, from the plan-budget reader: every outbound boundary validates what it reads
 * with a runtime schema per endpoint and fails loudly and EARLY on a missing, renamed or new field. The reason
 * is the same one `src/outbound/strictForm.ts` records for what the fleet sends: a plain `z.object` DROPS a key
 * it was not told about, so a provider that renames `resets_left` to `resets_remaining` reads as "no resets
 * left" at exit 0 — a wrong answer that looks exactly like a right one. A refusal naming the rename is fixed in
 * one edit; the silent misread is found, if ever, by whoever acted on it.
 *
 * ## What it enforces, and where
 *
 * {@link defineBoundary} walks the schema ONCE, when the module declaring it loads, and throws if anything
 * reachable from it could read drift as success — a loose object, a `.catch()`, a transform, a leaf that checks
 * nothing. What the walk refuses, and why each, is `./boundaryWalk.ts`. Which arm of a failed union a refusal
 * reads, so it names a field that really drifted, is `./boundaryArms.ts`.
 *
 * `./ingestError.ts` is the precedent for one error at this layer shared by every provider: a domain maps
 * {@link BoundaryError} into its own union at the call, carrying `message` forward.
 */
import type { z } from "zod";

import { isAbsent, meantArmIssues, pathKey } from "./boundaryArms.js";
import { ownProtoPaths } from "./boundaryKeys.js";
import { looseObjectsIn } from "./boundaryWalk.js";
import { parseJson } from "./jsonParse.js";
import { nearestField } from "./nearestField.js";
import { err, ok, type Result } from "./result.js";

/** How one field on the wire differs from what the endpoint's schema declares. */
export interface BoundaryDrift {
  /** `missing`: declared and absent. `new`: present and undeclared. `renamed`: one of each, close in spelling. */
  readonly kind: "missing" | "new" | "renamed" | "changed";
  /** Where, as `a.b[0].c`; `(body)` for the top level. */
  readonly path: string;
  /** The sentence a reader acts on. */
  readonly detail: string;
}

/** The provider answered text that is not JSON at all. */
export interface BoundaryNotJsonError {
  readonly code: "BOUNDARY_NOT_JSON";
  readonly message: string;
  readonly endpoint: string;
}

/** The provider answered JSON whose shape is not the one this version reads. */
export interface BoundaryShapeChangedError {
  readonly code: "BOUNDARY_SHAPE_CHANGED";
  readonly message: string;
  readonly endpoint: string;
  readonly drift: readonly BoundaryDrift[];
}

/**
 * Why a boundary refused what a provider answered. Most readers map a failed read by its `message`;
 * `boundaryWords.ts` branches on `code` to word one without quoting a provider's keys.
 */
export type BoundaryError = BoundaryNotJsonError | BoundaryShapeChangedError;

/** How to raise one — the factory {@link defineBoundary} calls, so a test built the same way catches drift. */
export const BoundaryErrors = {
  notJson: ({ endpoint }: { endpoint: string }): BoundaryNotJsonError => ({
    code: "BOUNDARY_NOT_JSON",
    endpoint,
    message: `${endpoint} answered a body that is not JSON`,
  }),
  shapeChanged: ({
    endpoint,
    drift,
  }: {
    endpoint: string;
    drift: readonly BoundaryDrift[];
  }): BoundaryShapeChangedError => ({
    code: "BOUNDARY_SHAPE_CHANGED",
    drift,
    endpoint,
    message: `${endpoint} answered a shape this version does not read — refused, not guessed: ${drift.map((entry) => entry.detail).join("; ")}`,
  }),
} as const;

/** A path as a reader writes it. */
function pathText({ path }: { path: readonly PropertyKey[] }): string {
  if (path.length === 0) {
    return "(body)";
  }
  return path
    .map((segment, index) => {
      if (typeof segment === "number") {
        return `[${String(segment)}]`;
      }
      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join("");
}

/** A missing or new key, before renames are paired. */
interface KeyDrift {
  /** The parent's raw path, so a dotted key never collides with the nesting its text resembles. */
  readonly parent: string;
  readonly key: string;
  readonly path: string;
}

/** Pair each new key with a missing sibling it is spelled close to; what stays unpaired is new or missing. */
function pairRenames({
  added,
  missing,
}: {
  added: readonly KeyDrift[];
  missing: readonly KeyDrift[];
}): readonly BoundaryDrift[] {
  const paired = new Set<KeyDrift>();
  const drift: BoundaryDrift[] = [];
  for (const entry of added) {
    const siblings = missing.filter((candidate) => candidate.parent === entry.parent && !paired.has(candidate));
    const from = nearestField({ key: entry.key, known: siblings.map((candidate) => candidate.key) });
    const renamed = siblings.find((candidate) => candidate.key === from);
    if (renamed === undefined) {
      drift.push({ detail: `new field "${entry.path}"`, kind: "new", path: entry.path });
    } else {
      paired.add(renamed);
      drift.push({ detail: `field "${renamed.path}" renamed to "${entry.path}"?`, kind: "renamed", path: entry.path });
    }
  }
  for (const entry of missing.filter((candidate) => !paired.has(candidate))) {
    drift.push({ detail: `field "${entry.path}" is missing`, kind: "missing", path: entry.path });
  }
  return drift;
}

/** Classify every issue into drift, pairing a new key with a missing sibling it is spelled close to. */
function classifyDrift({
  issues,
  value,
}: {
  issues: readonly z.core.$ZodIssue[];
  value: unknown;
}): readonly BoundaryDrift[] {
  const missing: KeyDrift[] = [];
  const added: KeyDrift[] = [];
  const changed: BoundaryDrift[] = [];
  for (const issue of meantArmIssues({ issues })) {
    const parent = pathText({ path: issue.path });
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        added.push({ key, parent: pathKey({ path: issue.path }), path: pathText({ path: [...issue.path, key] }) });
      }
    } else if (isAbsent({ path: issue.path, value })) {
      const key = String(issue.path.at(-1));
      missing.push({ key, parent: pathKey({ path: issue.path.slice(0, -1) }), path: parent });
    } else {
      changed.push({ detail: `field "${parent}" changed: ${issue.message}`, kind: "changed", path: parent });
    }
  }
  return [...pairRenames({ added, missing }), ...changed];
}

/** One schema's check of a value: the typed value, or the issues Zod raised. Only {@link Boundary.checkOf} makes one. */
export type SchemaCheck<T> = (value: unknown) => Result<T, readonly z.core.$ZodIssue[]>;

/**
 * One endpoint's declared read: its name, and the two ways to hand it an answer.
 *
 * A CLASS, holding its schema's check in an ES private field, so the type is NOMINAL. A hand-written object with an
 * `endpoint`, a `parse` and a `parseJson` is not one, and neither is a spread of a real one with `parseJson` swapped
 * out: a `#private` field is not a property, so no object literal carries it. That is what lets the boundary-schema
 * gate trust a `Boundary` annotation — two counterexamples in review were exactly those two
 * objects. The constructor is `protected`, so the only way in is {@link Boundary.define}, which builds the check from
 * a schema and refuses one that is not strict all the way down. The field holds a check that only ANSWERS `T`,
 * never the schema itself, so `Boundary` stays covariant: a boundary over a mutable page still reads as one over a
 * `readonly` page. What remains, stated: anything that makes the compiler take a claim it cannot check — a cast, an `any`,
 * a user-defined type predicate, or a subclass that hands `super` a check of its own.
 */
export class Boundary<T> {
  /** The endpoint as a reader would name it, e.g. `GET /api/oauth/usage`. */
  readonly endpoint: string;
  readonly #check: SchemaCheck<T>;

  protected constructor({
    endpoint,
    schema,
    check,
  }: {
    endpoint: string;
    schema: z.core.$ZodType;
    check: SchemaCheck<T>;
  }) {
    const loose = looseObjectsIn({ schema });
    if (loose.length > 0) {
      throw new Error(`defineBoundary(${endpoint}): every object must be z.strictObject — ${loose.join("; ")}`);
    }
    this.endpoint = endpoint;
    this.#check = check;
  }

  /**
   * Declare one endpoint's read from its strict schema — what {@link defineBoundary} calls.
   *
   * @param endpoint the endpoint as a reader would name it — it leads every refusal
   * @param schema the endpoint's whole answer, every object a `z.strictObject`
   * @returns the boundary
   */
  static define<S extends z.ZodType>({ endpoint, schema }: { endpoint: string; schema: S }): Boundary<z.output<S>> {
    return new Boundary({ check: Boundary.checkOf({ schema }), endpoint, schema });
  }

  /**
   * The check a schema answers, typed by the schema itself — the one thing a subclass hands `super`.
   *
   * @returns a check answering the schema's output or the issues it raised
   */
  protected static checkOf<S extends z.ZodType>({ schema }: { schema: S }): SchemaCheck<z.output<S>> {
    return (value) => {
      const parsed = schema.safeParse(value);
      return parsed.success ? ok(parsed.data) : err(parsed.error.issues);
    };
  }

  /**
   * Validate an already-parsed value against the endpoint's schema.
   *
   * @returns the value, or a refusal naming every field that drifted
   */
  readonly parse = ({ value }: { value: unknown }): Result<T, BoundaryError> => {
    const checked = this.#check(value);
    const protoPaths = ownProtoPaths({ path: [], value }).map((path) => pathText({ path }));
    if (checked.isOk() && protoPaths.length === 0) {
      return ok(checked.value);
    }
    const drift = checked.isOk() ? [] : classifyDrift({ issues: checked.error, value });
    const skipped = protoPaths
      .filter((path) => !drift.some((entry) => entry.path === path))
      .map((path): BoundaryDrift => ({ detail: `new field "${path}"`, kind: "new", path }));
    return err(BoundaryErrors.shapeChanged({ drift: [...drift, ...skipped], endpoint: this.endpoint }));
  };

  /**
   * Parse a body's text, then validate it.
   *
   * @returns the value, or a refusal that the text is not JSON or naming every field that drifted
   */
  readonly parseJson = ({ text }: { text: string }): Result<T, BoundaryError> =>
    parseJson({ text })
      .mapErr((): BoundaryError => BoundaryErrors.notJson({ endpoint: this.endpoint }))
      .andThen((value) => this.parse({ value }));
}

/**
 * Declare one endpoint's read. Throws at definition when the schema is not strict all the way down, because
 * that is a mistake in this repository rather than in anything a provider sent.
 *
 * @param endpoint the endpoint as a reader would name it, e.g. `GET /api/oauth/usage` — it leads every refusal
 * @param schema the endpoint's whole answer, every object a `z.strictObject`
 * @returns the boundary, whose `parse` and `parseJson` refuse any drift by name
 */
export function defineBoundary<S extends z.ZodType>({
  endpoint,
  schema,
}: {
  endpoint: string;
  schema: S;
}): Boundary<z.output<S>> {
  return Boundary.define({ endpoint, schema });
}
