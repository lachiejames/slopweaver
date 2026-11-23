/**
 * A Trelica boundary that also answers what the method map may see of an admitted answer.
 *
 * The method map records each call's response field NAMES (`sync.ts`'s `fieldNamesByCall`), walked out of the
 * answer itself. A key a boundary declares and never reads is declared precisely because what sits under it is
 * not this atlas's to hold — a connection's `parameters.clientSecret`, a run's `baseScope.variables.<id>_password`,
 * a step's `headers`. Walked raw, every one of those names reached a stored method record: MEASURED,
 * `grep -o '"integrations\[\]\.parameters\.[^"]*"' ~/.slopweaver/atlas/trelica/methods.jsonl` printed
 * `apiToken`, `clientSecret` and `scimToken` before this view existed.
 *
 * So {@link TrelicaBoundary.censusView} walks the boundary's own schema beside the admitted value and keeps a
 * declared-unread key as a `null`: the method map still says the endpoint answers `parameters`, and nothing
 * beneath it. A schema shape the walk does not know is answered `null` too, so a new Zod type fails closed.
 */
import { z } from "zod";

import { Boundary, type SchemaCheck } from "../../lib/boundary.js";
import { defOf } from "../../lib/boundaryUnion.js";
import { isUnreadKey } from "../../lib/boundaryWalk.js";
import { isRecord } from "../../lib/parsers.js";

/**
 * A strict boundary, plus the view of an admitted answer the method map's field census walks. A subclass, because
 * a `Boundary` is nominal: a spread of one is not one.
 */
export class TrelicaBoundary<T> extends Boundary<T> {
  /**
   * The id of the one inventory call this boundary admits, which the client checks against the call it makes, so a
   * page is never admitted by another endpoint's boundary. `null` for a read the client never makes.
   */
  readonly callId: string | null;
  readonly #schema: z.core.$ZodType;

  protected constructor({
    callId,
    endpoint,
    schema,
    check,
  }: {
    callId: string | null;
    endpoint: string;
    schema: z.core.$ZodType;
    check: SchemaCheck<T>;
  }) {
    super({ check, endpoint, schema });
    this.callId = callId;
    this.#schema = schema;
  }

  /**
   * Declare one Trelica endpoint's read from its strict schema — what {@link defineTrelicaBoundary} calls.
   *
   * @param callId the inventory call this boundary admits, or `null` for a read the client never makes
   * @param endpoint the endpoint as a reader would name it
   * @param schema the strict schema every answer is admitted by
   * @returns the boundary and its census view
   */
  static override define<S extends z.ZodType>({
    callId,
    endpoint,
    schema,
  }: {
    callId: string | null;
    endpoint: string;
    schema: S;
  }): TrelicaBoundary<z.output<S>> {
    return new TrelicaBoundary({ callId, check: Boundary.checkOf({ schema }), endpoint, schema });
  }

  /**
   * The admitted answer with every declared-unread key's value replaced by `null`. A method, not an arrow field: `T`
   * sits in its parameter, and a method is checked bivariantly, so the boundary stays covariant in `T`.
   *
   * @returns the census view, safe for the method map to walk
   */
  censusView({ value }: { value: T }): unknown {
    return censusValue({ schema: this.#schema, value });
  }
}

/** One value walked against the schema that admitted it. */
function censusValue({ schema, value }: { schema: z.core.$ZodType; value: unknown }): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const def = defOf({ schema });
  if (
    def.type === "optional" ||
    def.type === "nullable" ||
    def.type === "default" ||
    def.type === "nonoptional" ||
    def.type === "readonly"
  ) {
    return censusValue({ schema: def.innerType, value });
  }
  return censusContainer({ def, value });
}

/**
 * A container value walked against its def. An if-chain rather than a switch: the walk handles a few of Zod's many
 * def types on purpose, and every other one falls through to `null`, failing closed.
 */
function censusContainer({ def, value }: { def: z.core.$ZodTypes["_zod"]["def"]; value: object }): unknown {
  if (def.type === "array") {
    return Array.isArray(value) ? value.map((item) => censusValue({ schema: def.element, value: item })) : null;
  }
  if (def.type === "union") {
    const arm = def.options.find((option) => z.safeParse(option, value).success);
    return arm === undefined ? null : censusValue({ schema: arm, value });
  }
  if (def.type === "object") {
    return isRecord(value) ? censusObject({ shape: def.shape, value }) : null;
  }
  if (def.type === "record") {
    return isRecord(value) ? censusRecord({ valueType: def.valueType, value }) : null;
  }
  return null;
}

/** One object's fields: a declared-unread key kept as `null`, every other field walked. */
function censusObject({
  shape,
  value,
}: {
  shape: Readonly<Record<string, z.core.$ZodType>>;
  value: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      const fieldSchema = shape[key];
      if (fieldSchema === undefined || isUnreadKey({ schema: fieldSchema })) {
        return [key, null];
      }
      return [key, censusValue({ schema: fieldSchema, value: field })];
    }),
  );
}

/** A map keyed by id — the team tree's `teamsById` — with every value walked against the one value schema. */
function censusRecord({
  valueType,
  value,
}: {
  valueType: z.core.$ZodType;
  value: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, censusValue({ schema: valueType, value: field })]),
  );
}

/**
 * Define a strict Trelica boundary that keeps its schema, so an admitted answer can be shown to the method map
 * without what its declared-unread keys carry.
 *
 * @param callId the inventory call this boundary admits, or `null` for a read the client never makes
 * @param endpoint the endpoint as a reader would name it
 * @param schema the strict schema every answer is admitted by
 * @returns the boundary and its census view
 */
export function defineTrelicaBoundary<S extends z.ZodType>({
  callId,
  endpoint,
  schema,
}: {
  callId: string | null;
  endpoint: string;
  schema: S;
}): TrelicaBoundary<z.output<S>> {
  return TrelicaBoundary.define({ callId, endpoint, schema });
}
