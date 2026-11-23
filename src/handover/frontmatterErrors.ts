/**
 * The ways `./frontmatter.ts` refuses to touch a handover doc, each one a different reason the splice would
 * have been unsafe.
 *
 * Its own small union per `.claude/rules/error-handling.md`, scoped to the front-matter write path: a doc the
 * reader already calls malformed, a doc with no closed fence to write inside, a value that would write a key
 * nobody passed, a value that would be read from lines it never wrote, a key that is no bare name, a key named both to write and to delete, a key named
 * twice to write, a nested value with a line at column 0, a key the doc already declares, and an edit that would change something it was not asked
 * to. Every variant carries `reasons`, the refusal as the lines a verb prints one per line, because each
 * caller outside this directory reports a list and several of these refusals are genuinely plural.
 *
 * Pure: every factory takes what it names.
 */

/** The doc already fails the flat reader; `reasons` is `parseHandoverDoc`'s own problem list. */
export interface FrontMatterDocMalformedError {
  readonly code: "DOC_MALFORMED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** There is no closed `---` … `---` block to write inside; `purpose` is what the write would have done. */
export interface FrontMatterUnclosedError {
  readonly code: "FRONT_MATTER_UNCLOSED";
  readonly message: string;
  readonly purpose: string;
  readonly reasons: readonly string[];
}

/** A value holds a line break, which the line-by-line reader would read as a key nobody passed. */
export interface FrontMatterValueHasLineBreakError {
  readonly code: "VALUE_HAS_LINE_BREAK";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * A value is a lone `>`/`|` block indicator, which announces lines below the key that the write never writes — so
 * the reader would take its value from whatever line sits there instead, a kept comment included.
 */
export interface FrontMatterValueIsBlockIndicatorError {
  readonly code: "VALUE_IS_BLOCK_INDICATOR";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/** An in-place edit named a key that is not a bare key name, so it could match a line spelled differently. */
export interface FrontMatterKeyNotANameError {
  readonly code: "KEY_NOT_A_NAME";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/** An in-place edit named a key both to write and to delete, which has no one meaning. */
export interface FrontMatterSetAndRemoveError {
  readonly code: "SET_AND_REMOVE";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/** A nested value carries a line at column 0, which the reader reads as a key, a comment or a fence of its own. */
export interface FrontMatterNestedLineUnindentedError {
  readonly code: "NESTED_LINE_UNINDENTED";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/** An in-place edit named one key to write twice, so no one value is the one asked for. */
export interface FrontMatterSetTwiceError {
  readonly code: "SET_TWICE";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/** An add-only write named a key the doc already declares. */
export interface FrontMatterKeyAlreadyDeclaredError {
  readonly code: "KEY_ALREADY_DECLARED";
  readonly message: string;
  readonly keys: readonly string[];
  readonly reasons: readonly string[];
}

/** An in-place edit would change what it was not asked to change; `reasons` names each collateral change. */
export interface FrontMatterEditWouldDamageError {
  readonly code: "EDIT_WOULD_DAMAGE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every way the front-matter write path refuses a doc. */
export type FrontMatterError =
  | FrontMatterDocMalformedError
  | FrontMatterUnclosedError
  | FrontMatterValueHasLineBreakError
  | FrontMatterValueIsBlockIndicatorError
  | FrontMatterKeyNotANameError
  | FrontMatterSetAndRemoveError
  | FrontMatterSetTwiceError
  | FrontMatterNestedLineUnindentedError
  | FrontMatterKeyAlreadyDeclaredError
  | FrontMatterEditWouldDamageError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const FrontMatterErrors = {
  alreadyDeclared: ({ keys }: { keys: readonly string[] }): FrontMatterKeyAlreadyDeclaredError => {
    const reasons = keys.map((key) => `front-matter already declares "${key}" — edit it by hand instead`);
    return { code: "KEY_ALREADY_DECLARED", keys, message: reasons.join("; "), reasons };
  },
  docMalformed: ({ problems }: { problems: readonly string[] }): FrontMatterDocMalformedError => ({
    code: "DOC_MALFORMED",
    message: problems.join("; "),
    reasons: problems,
  }),
  editWouldDamage: ({ damage }: { damage: readonly string[] }): FrontMatterEditWouldDamageError => ({
    code: "EDIT_WOULD_DAMAGE",
    message: damage.join("; "),
    reasons: damage,
  }),
  keyNotAName: ({ keys }: { keys: readonly string[] }): FrontMatterKeyNotANameError => {
    const reasons = keys.map((key) => `${JSON.stringify(key)} is not a bare front-matter key name`);
    return { code: "KEY_NOT_A_NAME", keys, message: reasons.join("; "), reasons };
  },
  lineBreak: ({ keys }: { keys: readonly string[] }): FrontMatterValueHasLineBreakError => {
    const reasons = keys.map((key) => `"${key}" carries a line break, and front-matter is read line by line`);
    return { code: "VALUE_HAS_LINE_BREAK", keys, message: reasons.join("; "), reasons };
  },
  blockIndicator: ({ keys }: { keys: readonly string[] }): FrontMatterValueIsBlockIndicatorError => {
    const reasons = keys.map(
      (key) => `"${key}" is a lone block indicator, so its value would be read from lines this write never writes`,
    );
    return { code: "VALUE_IS_BLOCK_INDICATOR", keys, message: reasons.join("; "), reasons };
  },
  nestedLineUnindented: ({ keys }: { keys: readonly string[] }): FrontMatterNestedLineUnindentedError => {
    const reasons = keys.map(
      (key) => `"${key}" carries a line at column 0, which would be read as a key or a fence rather than its value`,
    );
    return { code: "NESTED_LINE_UNINDENTED", keys, message: reasons.join("; "), reasons };
  },
  setAndRemove: ({ keys }: { keys: readonly string[] }): FrontMatterSetAndRemoveError => {
    const reasons = keys.map((key) => `"${key}" is named both to write and to delete — name it once`);
    return { code: "SET_AND_REMOVE", keys, message: reasons.join("; "), reasons };
  },
  setTwice: ({ keys }: { keys: readonly string[] }): FrontMatterSetTwiceError => {
    const reasons = keys.map((key) => `"${key}" is named twice to write — name it once, with the one value meant`);
    return { code: "SET_TWICE", keys, message: reasons.join("; "), reasons };
  },
  unclosed: ({ purpose }: { purpose: string }): FrontMatterUnclosedError => {
    const message = `no closed front-matter block (\`---\` … \`---\`) to ${purpose}`;
    return { code: "FRONT_MATTER_UNCLOSED", message, purpose, reasons: [message] };
  },
} as const;
