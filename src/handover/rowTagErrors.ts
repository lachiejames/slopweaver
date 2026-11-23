/**
 * The typed failures of reading or writing one board-row TAG — its own union, per `.claude/rules/error-handling.md`.
 *
 * Each variant is a different fix for the writer: a misspelt key wants the nearest real one, a derived key wants
 * the field it is derived from, a value outside the key's rule wants one of the values that rule names. That is
 * the test that earns a union here rather than a `readonly string[]`.
 *
 * None of them is a policy refusal, so none carries an escape hatch: a tag the registry does not define is not a
 * rule saying no to something that would otherwise work, it is a spelling the board could not filter on.
 *
 * Pure: every factory builds a value. No filesystem, no clock.
 */

/** The text was not `key=value` at all. */
export interface TagMalformedError {
  readonly code: "TAG_MALFORMED";
  readonly message: string;
  readonly text: string;
}

/** The key is not one {@link ./rowTags.ts} defines. */
export interface TagUnknownKeyError {
  readonly code: "TAG_UNKNOWN_KEY";
  readonly message: string;
  readonly key: string;
  /** The closest defined key, when one is close enough to be the likely intent. */
  readonly nearest: string | undefined;
}

/** The key is DERIVED from a field the row already carries, so writing it would be a second copy. */
export interface TagDerivedKeyError {
  readonly code: "TAG_DERIVED_KEY";
  readonly message: string;
  readonly key: string;
}

/** The value is outside what the key allows. */
export interface TagBadValueError {
  readonly code: "TAG_BAD_VALUE";
  readonly message: string;
  readonly key: string;
  readonly value: string;
}

/** One write set a one-valued key twice, so which value it meant is not knowable. */
export interface TagSetTwiceError {
  readonly code: "TAG_SET_TWICE";
  readonly message: string;
  readonly key: string;
}

/** One write both sets and drops a key, so what the row holds after it is not knowable from the line. */
export interface TagSetAndDroppedError {
  readonly code: "TAG_SET_AND_DROPPED";
  readonly message: string;
  readonly key: string;
}

/** A drop named one value of a key that only ever holds one, where the grammar drops such a key whole. */
export interface TagValueDropOnOneError {
  readonly code: "TAG_VALUE_DROP_ON_ONE";
  readonly message: string;
  readonly key: string;
}

/** A key, value or drop carries surrounding whitespace, which the journal would keep and no filter would match. */
export interface TagPaddedError {
  readonly code: "TAG_PADDED";
  readonly message: string;
  readonly text: string;
}

/** A value carries the character the CLI separates a list of tags with, so no flag could name it. */
export interface TagSeparatorInValueError {
  readonly code: "TAG_SEPARATOR_IN_VALUE";
  readonly message: string;
  readonly key: string;
}

/** One write carries the same entry twice, so the journal line would say more than the write did. */
export interface TagRepeatedError {
  readonly code: "TAG_REPEATED";
  readonly message: string;
  readonly text: string;
}

/** A filter term negated a key AND named a value, a shape the filter grammar does not have. */
export interface TagNegatedValueError {
  readonly code: "TAG_NEGATED_VALUE";
  readonly message: string;
  readonly text: string;
}

/** A filter term was empty: a bare `--tag`, `--tag=`, or an empty member of a comma list. */
export interface TagEmptyTermError {
  readonly code: "TAG_EMPTY_TERM";
  readonly message: string;
}

/** A `--tag` flag arrived with no value — last on the line, or followed by another flag. */
export interface TagValuelessFlagError {
  readonly code: "TAG_VALUELESS_FLAG";
  readonly message: string;
}

/** Every way one tag can fail to be read or written. */
export type RowTagError =
  | TagMalformedError
  | TagUnknownKeyError
  | TagDerivedKeyError
  | TagBadValueError
  | TagSetTwiceError
  | TagSetAndDroppedError
  | TagValueDropOnOneError
  | TagPaddedError
  | TagSeparatorInValueError
  | TagRepeatedError
  | TagNegatedValueError
  | TagEmptyTermError
  | TagValuelessFlagError;

export const RowTagErrors = {
  badValue: ({ key, value, allowed }: { key: string; value: string; allowed: string }): TagBadValueError => ({
    code: "TAG_BAD_VALUE",
    key,
    message: `"${value}" is not a value ${key} takes — it takes ${allowed}`,
    value,
  }),
  derivedKey: ({ key, from }: { key: string; from: string }): TagDerivedKeyError => ({
    code: "TAG_DERIVED_KEY",
    key,
    message: `${key} is derived from ${from}, so it is never written as a tag — change ${from} instead`,
  }),
  emptyTerm: (): TagEmptyTermError => ({
    code: "TAG_EMPTY_TERM",
    message: "a --tag filter term is empty — write key=value, key, or !key",
  }),
  malformed: ({ text }: { text: string }): TagMalformedError => ({
    code: "TAG_MALFORMED",
    message: `"${text}" is not a tag — write it as key=value, e.g. platform=slack`,
    text,
  }),
  negatedValue: ({ text }: { text: string }): TagNegatedValueError => ({
    code: "TAG_NEGATED_VALUE",
    message: `"${text}" negates a value, which a filter cannot — write !key for rows missing the key`,
    text,
  }),
  padded: ({ text }: { text: string }): TagPaddedError => ({
    code: "TAG_PADDED",
    message: `${JSON.stringify(text)} carries surrounding whitespace, which the journal would keep and no filter would match`,
    text,
  }),
  repeated: ({ text }: { text: string }): TagRepeatedError => ({
    code: "TAG_REPEATED",
    message: `${text} appears more than once in one write — name it once`,
    text,
  }),
  separatorInValue: ({ key, separator }: { key: string; separator: string }): TagSeparatorInValueError => ({
    code: "TAG_SEPARATOR_IN_VALUE",
    key,
    message: `a ${key} value may not contain "${separator}" — a flag lists tags separated by it`,
  }),
  setAndDropped: ({ key }: { key: string }): TagSetAndDroppedError => ({
    code: "TAG_SET_AND_DROPPED",
    key,
    message: `one write both sets and drops ${key} — drop it and set it in two writes`,
  }),
  setTwice: ({ key }: { key: string }): TagSetTwiceError => ({
    code: "TAG_SET_TWICE",
    key,
    message: `${key} holds one value, and this write sets it more than once`,
  }),
  valuelessFlag: (): TagValuelessFlagError => ({
    code: "TAG_VALUELESS_FLAG",
    message: "--tag requires a value — key=value, key, or '!key'",
  }),
  valueDropOnOne: ({ key }: { key: string }): TagValueDropOnOneError => ({
    code: "TAG_VALUE_DROP_ON_ONE",
    key,
    message: `${key} holds one value, so it is dropped whole — write the drop as ${key}`,
  }),
  unknownKey: ({
    key,
    nearest,
    known,
  }: {
    key: string;
    nearest: string | undefined;
    known: string;
  }): TagUnknownKeyError => {
    const hint = nearest === undefined ? `the keys are ${known}` : `did you mean ${nearest}?`;
    return { code: "TAG_UNKNOWN_KEY", key, message: `"${key}" is not a tag key — ${hint}`, nearest };
  },
} as const;
