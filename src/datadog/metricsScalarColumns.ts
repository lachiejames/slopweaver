/**
 * Narrowing the untrusted `columns` of one metrics scalar-query response: each entry is classified as a group
 * column or the one number column, and every value an error message would otherwise carry is rendered by a
 * bounded, non-recursive describer. The wire shape and why it is read this way: `metricsScalar.ts`'s header.
 */
import { err, ok } from "#lib/result.js";
import { type Read, DatadogMetricsScalarErrors as ScalarErrors } from "./metricsScalarErrors.js";

/** A column as the SDK's own union types it — `type` is not a useful TS discriminant across the real
 * `GroupScalarColumn`/`DataScalarColumn`/`UnparsedObject` members, so this reader narrows by hand below. */
interface RawScalarColumn {
  readonly type?: string;
  readonly name?: string;
  readonly values?: unknown;
}

/** The subset of a `GroupScalarColumn` this reader depends on, named to make the reader's contract explicit. */
export interface GroupScalarColumnLike {
  readonly name?: string;
  readonly values?: readonly (readonly string[])[];
}

/** The subset of a `DataScalarColumn` this reader depends on. */
export interface NumberScalarColumnLike {
  readonly name?: string;
  readonly values?: readonly (number | null)[];
}

/** Narrow a raw column to a group column by its `type` tag, trusting the SDK's own contract for the rest. */
function isGroupColumn(column: RawScalarColumn): column is RawScalarColumn & GroupScalarColumnLike {
  return column.type === "group";
}

/** Narrow a raw column to a number column by its `type` tag, trusting the SDK's own contract for the rest. */
function isNumberColumn(column: RawScalarColumn): column is RawScalarColumn & NumberScalarColumnLike {
  return column.type === "number";
}

export type ScalarColumnLike = RawScalarColumn;

/**
 * A bounded, non-recursive description of an unexpected value for an error message. Never `JSON.stringify`
 * on untrusted network data here: a maliciously or accidentally deep object turns building the ERROR
 * itself into a `RangeError` (stack overflow) before the caller ever sees a Result. This never descends
 * past one level, so its cost cannot depend on the value's depth.
 *
 * @returns `null`, the array's length, or the value's `typeof`
 */
export function describeUnexpectedValue({ value }: { readonly value: unknown }): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `an array of length ${String(value.length)}`;
  }
  return typeof value;
}

/**
 * Render an untrusted value (a tag, a name, a server-reported error field) for an error message. A real
 * string or a safe primitive passes straight through `String`; anything else — most importantly an array
 * or object, which is where a maliciously or accidentally deep structure hides — falls back to
 * {@link describeUnexpectedValue} rather than risking the same recursion in `String`/template-literal
 * coercion that `describeUnexpectedValue` exists to avoid. Every field on `RawScalarColumn` and
 * `response.errors` is typed as a string by the SDK but arrives unverified, so this is the one place that
 * type gets checked before it is trusted enough to concatenate.
 *
 * @returns the primitive as a string, or a bounded description of anything else
 */
export function safeString({ value }: { readonly value: unknown }): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === undefined) {
    return String(value);
  }
  return describeUnexpectedValue({ value });
}

/**
 * A column's `name`, or an empty string when it carries none. Used only as a Set/Record key — where an
 * absent name and an empty-string name key identically — never as a value a caller could mistake for a
 * real, present name.
 *
 * @param name a column's `name` field
 * @returns the name, or an empty string when it is absent
 */
export function columnKey({ name }: { readonly name: string | undefined }): string {
  if (name === undefined) {
    return "";
  }
  return name;
}

/**
 * A column's `values` is a real array, not merely something with a `.length` — an object crafted with a
 * numeric-string-keyed shape and a `length` property can otherwise impersonate an array through every
 * `?.length` check downstream while never being iterable the way `readBuckets` expects. `undefined` is not
 * checked here; that is a legitimately absent field, rejected later by the caller that requires one.
 */
function checkValuesIsArray({
  column,
}: {
  readonly column: { readonly name?: string; readonly values?: unknown };
}): Read<null> {
  if (column.values !== undefined && !Array.isArray(column.values)) {
    return err(
      ScalarErrors.columnValuesNotArray({
        actual: describeUnexpectedValue({ value: column.values }),
        columnName: safeString({ value: column.name }),
      }),
    );
  }
  return ok(null);
}

/**
 * Coerce a column's `name` to a genuine string (or `undefined`) the moment it is accepted, so every
 * downstream reader — including `Array.prototype.join`, which recurses into a non-string element exactly
 * like `String` does — inherits a value that can never be the deeply-nested shape this file guards
 * against. This is the one sanitisation point; nothing past this function needs to call {@link safeString}
 * on a column's `name` again.
 */
function sanitizeColumnName({ column }: { readonly column: ScalarColumnLike }): ScalarColumnLike {
  // Read through an `unknown`-typed local: `column.name`'s DECLARED type is `string | undefined`, but the
  // value arrives off untrusted network data that does not actually have to honour it — this whole function
  // exists for the case where it doesn't, so the check must be a real runtime one rather than something the
  // type checker can prove redundant from the declaration alone.
  const name: unknown = column.name;
  if (typeof name === "string" || name === undefined) {
    return column;
  }
  return { ...column, name: safeString({ value: name }) };
}

/** One column, classified as a group column or the number column, after its shape has been validated. */
type ClassifiedColumn =
  | { readonly kind: "group"; readonly column: GroupScalarColumnLike }
  | { readonly kind: "number"; readonly column: NumberScalarColumnLike };

/**
 * Classify one raw column entry: an object failing shape checks is refused, otherwise it is read as either
 * a group column or a number column.
 *
 * @param untypedColumn one entry from the response's `columns` array, still untrusted
 * @returns the classified column, or why it could not be read
 */
function classifyColumn({ untypedColumn }: { readonly untypedColumn: unknown }): Read<ClassifiedColumn> {
  // Read through an `unknown`-typed local: a column entry is untrusted network data, not a value this
  // reader ever constructed, so `null` or any non-object array member must be caught here — before a
  // predicate dereferences `.type` on it — as a REAL runtime check rather than one the type checker can
  // prove redundant from `ScalarColumnLike`'s declaration (which promises an object but cannot enforce it).
  const rawColumn: unknown = untypedColumn;
  if (rawColumn === null || typeof rawColumn !== "object") {
    return err(ScalarErrors.columnEntryNotObject({ actual: describeUnexpectedValue({ value: rawColumn }) }));
  }
  const column = sanitizeColumnName({ column: rawColumn });
  if (isGroupColumn(column)) {
    const valuesCheck = checkValuesIsArray({ column });
    if (valuesCheck.isErr()) {
      return err(valuesCheck.error);
    }
    return ok({ kind: "group", column });
  }
  if (!isNumberColumn(column)) {
    return err(ScalarErrors.columnTypeUnrecognised({ columnType: safeString({ value: column.type }) }));
  }
  const valuesCheck = checkValuesIsArray({ column });
  if (valuesCheck.isErr()) {
    return err(valuesCheck.error);
  }
  return ok({ kind: "number", column });
}

/**
 * Split the response's columns into its group columns and its one number column.
 *
 * @returns the group columns and the number column, or why a column could not be read
 */
export function partitionColumns({ columns }: { readonly columns: readonly ScalarColumnLike[] }): Read<{
  readonly groupColumns: readonly GroupScalarColumnLike[];
  readonly numberColumn: NumberScalarColumnLike;
}> {
  const groupColumns: GroupScalarColumnLike[] = [];
  let numberColumn: NumberScalarColumnLike | null = null;
  for (const untypedColumn of columns) {
    const classified = classifyColumn({ untypedColumn });
    if (classified.isErr()) {
      return err(classified.error);
    }
    if (classified.value.kind === "group") {
      groupColumns.push(classified.value.column);
      continue;
    }
    if (numberColumn !== null) {
      return err(
        ScalarErrors.numberColumnsMultiple({
          firstName: safeString({ value: numberColumn.name }),
          secondName: safeString({ value: classified.value.column.name }),
        }),
      );
    }
    numberColumn = classified.value.column;
  }
  if (numberColumn === null) {
    return err(ScalarErrors.numberColumnMissing());
  }
  return ok({ groupColumns, numberColumn });
}
