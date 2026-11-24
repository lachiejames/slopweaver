/**
 * The pieces the three Store documents are built from — a field of each kind, a column, a table, a row's cells and a
 * row locator — each decoded strictly from `unknown`. `./storeDocuments.ts` composes them into whole documents and
 * says why strict means no stand-in, ever: a field that is absent or of the wrong type is refused with a sentence
 * naming where it sits.
 */
import { err, ok, type Result } from "neverthrow";

import { type Bag, instant, isBag } from "./bag";
import type {
  StoreCell,
  StoreColumnDefinition,
  StoreDisplayKind,
  StoreRowLocatorStability,
  StoreTableDefinition,
} from "./storeDocuments";
import { isStoreToken } from "./storeReadVerbs";

/** Every display kind, in the order the CLI documents them. */
const DISPLAY_KINDS: readonly StoreDisplayKind[] = ["binary", "boolean", "json", "number", "temporal", "text"];

/** Every locator stability. */
export const STABILITIES: readonly StoreRowLocatorStability[] = ["ctid-xmin"];

/** A row locator: lowercase hex of whole bytes. */
const LOCATOR_SHAPE = /^(?:[0-9a-f]{2})+$/;

/**
 * A field that is not what the document promised, named by where it sits.
 *
 * @returns the sentence the page prints
 */
export function wrong({ at, what }: { at: string; what: string }): string {
  return `${at} is not ${what}`;
}

/**
 * A string at `key`.
 *
 * @returns the string, or the refusal naming it
 */
export function text({ bag, key, at }: { bag: Bag; key: string; at: string }): Result<string, string> {
  const value = bag[key];
  if (typeof value !== "string") {
    return err(wrong({ at: `${at}.${key}`, what: "a string" }));
  }
  return ok(value);
}

/**
 * A boolean at `key`.
 *
 * @returns the boolean, or the refusal naming it
 */
export function flag({ bag, key, at }: { bag: Bag; key: string; at: string }): Result<boolean, string> {
  const value = bag[key];
  if (typeof value !== "boolean") {
    return err(wrong({ at: `${at}.${key}`, what: "a boolean" }));
  }
  return ok(value);
}

/**
 * A whole number at least `min` at `key`.
 *
 * @returns the number, or the refusal naming it
 */
export function whole({
  bag,
  key,
  at,
  min,
}: {
  bag: Bag;
  key: string;
  at: string;
  min: number;
}): Result<number, string> {
  const value = bag[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    return err(wrong({ at: `${at}.${key}`, what: `a whole number from ${String(min)}` }));
  }
  return ok(value);
}

/**
 * One of a closed set of words at `key`.
 *
 * @returns the word, or the refusal naming it
 */
export function oneOf<T extends string>({
  bag,
  key,
  at,
  words,
}: {
  bag: Bag;
  key: string;
  at: string;
  words: readonly T[];
}): Result<T, string> {
  const value = bag[key];
  const known = words.find((word) => word === value);
  if (known === undefined) {
    return err(wrong({ at: `${at}.${key}`, what: `one of ${words.join(", ")}` }));
  }
  return ok(known);
}

/** A catalog token at `key`, or the refusal naming it. */
function token({ bag, key, at }: { bag: Bag; key: string; at: string }): Result<string, string> {
  const value = bag[key];
  if (!isStoreToken(value)) {
    return err(wrong({ at: `${at}.${key}`, what: "a catalog token" }));
  }
  return ok(value);
}

/**
 * An array at `key` whose every element one decoder reads.
 *
 * @param read the decoder each element goes through
 * @returns the elements, or the first refusal
 */
export function list<T>({
  bag,
  key,
  at,
  read,
}: {
  bag: Bag;
  key: string;
  at: string;
  read: (args: { value: unknown; at: string }) => Result<T, string>;
}): Result<readonly T[], string> {
  const value = bag[key];
  if (!Array.isArray(value)) {
    return err(wrong({ at: `${at}.${key}`, what: "a list" }));
  }
  const out: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const element: unknown = value[index];
    const decoded = read({ at: `${at}.${key}[${String(index)}]`, value: element });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    out.push(decoded.value);
  }
  return ok(out);
}

/**
 * A value as an object.
 *
 * @returns the object, or the refusal naming it
 */
export function object({ value, at }: { value: unknown; at: string }): Result<Bag, string> {
  if (!isBag(value)) {
    return err(wrong({ at, what: "an object" }));
  }
  return ok(value);
}

/**
 * The instant a document was observed at, as `toISOString()` prints one.
 *
 * @returns the instant, or the refusal naming it
 */
export function observedAt({ bag, at }: { bag: Bag; at: string }): Result<string, string> {
  const value = instant({ bag, key: "observedAtIso" });
  if (value === undefined) {
    return err(wrong({ at: `${at}.observedAtIso`, what: "an ISO instant" }));
  }
  return ok(value);
}

/**
 * One column definition.
 *
 * @returns the column, or the refusal naming its first wrong field
 */
export function decodeColumn({ value, at }: { value: unknown; at: string }): Result<StoreColumnDefinition, string> {
  return object({ at, value }).andThen((bag) => {
    const position = bag["primaryKeyPosition"];
    if (position !== null && (typeof position !== "number" || !Number.isSafeInteger(position) || position < 1)) {
      return err(wrong({ at: `${at}.primaryKeyPosition`, what: "null or a whole number from 1" }));
    }
    return text({ at, bag, key: "name" }).andThen((name) =>
      token({ at, bag, key: "token" }).andThen((columnToken) =>
        whole({ at, bag, key: "ordinal", min: 1 }).andThen((ordinal) =>
          text({ at, bag, key: "formattedType" }).andThen((formattedType) =>
            flag({ at, bag, key: "nullable" }).andThen((nullable) =>
              flag({ at, bag, key: "generated" }).andThen((generated) =>
                flag({ at, bag, key: "identity" }).andThen((identity) =>
                  oneOf({ at, bag, key: "displayKind", words: DISPLAY_KINDS }).map(
                    (displayKind): StoreColumnDefinition => ({
                      displayKind,
                      formattedType,
                      generated,
                      identity,
                      name,
                      nullable,
                      ordinal,
                      primaryKeyPosition: position,
                      token: columnToken,
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  });
}

/**
 * One table definition.
 *
 * @returns the table, or the refusal naming its first wrong field
 */
export function decodeTable({ value, at }: { value: unknown; at: string }): Result<StoreTableDefinition, string> {
  return object({ at, value }).andThen((bag) => {
    const estimate = bag["estimatedRows"];
    if (estimate !== null && (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0)) {
      return err(wrong({ at: `${at}.estimatedRows`, what: "null or a count from 0" }));
    }
    const key = bag["primaryKey"];
    if (!Array.isArray(key) || !key.every((name) => typeof name === "string")) {
      return err(wrong({ at: `${at}.primaryKey`, what: "a list of column names" }));
    }
    const primaryKey: string[] = key.filter((name): name is string => typeof name === "string");
    return text({ at, bag, key: "name" }).andThen((name) =>
      token({ at, bag, key: "token" }).andThen((tableToken) =>
        list({ at, bag, key: "columns", read: decodeColumn }).map((columns): StoreTableDefinition => ({
          columns,
          estimatedRows: estimate,
          name,
          primaryKey,
          token: tableToken,
        })),
      ),
    );
  });
}

/**
 * One cell.
 *
 * @returns the cell, or the refusal naming its first wrong field
 */
function decodeCell({ value, at }: { value: unknown; at: string }): Result<StoreCell, string> {
  return object({ at, value }).andThen((bag): Result<StoreCell, string> => {
    const kind = bag["kind"];
    if (kind === "null") {
      return ok<StoreCell, string>({ kind: "null" });
    }
    if (kind === "withheld") {
      return text({ at, bag, key: "why" }).map((why): StoreCell => ({ kind: "withheld", why }));
    }
    if (kind === "value") {
      return text({ at, bag, key: "text" }).andThen((cellText) =>
        flag({ at, bag, key: "truncated" }).andThen((truncated) =>
          whole({ at, bag, key: "characters", min: 0 }).map((characters): StoreCell => ({
            characters,
            kind: "value",
            text: cellText,
            truncated,
          })),
        ),
      );
    }
    return err(wrong({ at: `${at}.kind`, what: "one of null, withheld, value" }));
  });
}

/**
 * A row's cells, exactly one per column.
 *
 * @param columns the document's columns, which the cells must match one for one
 * @returns the cells by column name, or the refusal naming the first missing, extra or wrong one
 */
export function decodeCells({
  bag,
  at,
  columns,
}: {
  bag: Bag;
  at: string;
  columns: readonly StoreColumnDefinition[];
}): Result<Readonly<Record<string, StoreCell>>, string> {
  const raw = bag["cells"];
  if (!isBag(raw)) {
    return err(wrong({ at: `${at}.cells`, what: "an object of cells by column name" }));
  }
  const names = new Set(columns.map((column) => column.name));
  const extra = Object.keys(raw).find((name) => !names.has(name));
  if (extra !== undefined) {
    return err(`${at}.cells carries ${extra}, which is not one of the document's columns`);
  }
  const cells: Record<string, StoreCell> = {};
  for (const column of columns) {
    if (!(column.name in raw)) {
      return err(`${at}.cells has no cell for column ${column.name}`);
    }
    const decoded = decodeCell({ at: `${at}.cells[${JSON.stringify(column.name)}]`, value: raw[column.name] });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    cells[column.name] = decoded.value;
  }
  return ok(cells);
}

/**
 * A row locator at `key`.
 *
 * @returns the locator, or the refusal naming it
 */
export function locator({ bag, key, at }: { bag: Bag; key: string; at: string }): Result<string, string> {
  const value = bag[key];
  if (typeof value !== "string" || !LOCATOR_SHAPE.test(value)) {
    return err(wrong({ at: `${at}.${key}`, what: "a row locator" }));
  }
  return ok(value);
}
