/**
 * The typed failures of checking a Datadog console link before it is cited as evidence (`citation.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`: a citation is refused for what the LINK says,
 * never for what a response said, so it shares no caller with the query union. A refused citation keeps
 * every violation as `reasons`, one line each, because the validator accumulates them on purpose — and
 * {@link datadogCitationErrorLines} is how a caller prints them without re-composing the joined `message`.
 *
 * Pure: values in, values out.
 */

/** A failure naming the citation it is about, so validating several says which one failed. */
interface CitationFailure<C extends string> {
  readonly code: C;
  readonly message: string;
  readonly label: string;
}

/** Every way a citation can be refused as evidence. */
export type DatadogCitationError =
  | (CitationFailure<"CITATION_URL_INVALID"> & { readonly url: string })
  | (CitationFailure<"CITATION_REFUSED"> & { readonly reasons: readonly string[] });

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DatadogCitationErrors = {
  /** Every violation found, then the one line saying why an unresolvable citation is refused at all. */
  citationRefused: ({ label, violations }: { label: string; violations: readonly string[] }): DatadogCitationError => {
    const reasons = [
      ...violations,
      `${label}: a citation that does not resolve reads as proof and shows the reader nothing, which is worse than citing nothing`,
    ];
    return { code: "CITATION_REFUSED", label, message: reasons.join("; "), reasons };
  },
  urlInvalid: ({ label, url }: { label: string; url: string }): DatadogCitationError => ({
    code: "CITATION_URL_INVALID",
    label,
    message: `${label}: not a valid URL: ${url}`,
    url,
  }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the verb printed them before it had a type:
 * a refused citation as its violations, and an unparseable one as its one message.
 *
 * @returns the lines, in order
 */
export function datadogCitationErrorLines({ error }: { error: DatadogCitationError }): readonly string[] {
  if (error.code === "CITATION_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
