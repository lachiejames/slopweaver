/**
 * Every way the private-terms file (`./privateTerms.ts`) fails to parse, and the one factory each failure is built
 * through. A message names the line and the class where it is a known one, never a pattern, a source or a meaning.
 */

/** The file carries neither accepted header. */
interface PrivateTermsHeaderMissingError {
  readonly code: "PRIVATE_TERMS_HEADER_MISSING";
  readonly line: number;
  readonly message: string;
}

/** One row cannot be read: wrong cell count, an unknown class or flag, or a bad expression. */
export interface PrivateTermsRowMalformedError {
  readonly code: "PRIVATE_TERMS_ROW_MALFORMED";
  readonly line: number;
  readonly message: string;
}

/** Every way the private-terms file fails to parse. */
export type PrivateTermsParseError = PrivateTermsHeaderMissingError | PrivateTermsRowMalformedError;

/** The factory every parse failure is built through. */
export const PrivateTermsParseErrors = {
  headerMissing: ({ line }: { line: number }): PrivateTermsHeaderMissingError => ({
    code: "PRIVATE_TERMS_HEADER_MISSING",
    line,
    message:
      `line ${String(line)}: the first non-comment line must be the header class<TAB>flags<TAB>pattern<TAB>source, ` +
      "or id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source",
  }),
  rowMalformed: ({
    line,
    className,
    why,
  }: {
    line: number;
    className: string;
    why: string;
  }): PrivateTermsRowMalformedError => ({
    code: "PRIVATE_TERMS_ROW_MALFORMED",
    line,
    message: `line ${String(line)} (class ${className}): ${why}`,
  }),
} as const;
