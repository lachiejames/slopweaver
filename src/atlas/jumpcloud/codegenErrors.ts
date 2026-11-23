/**
 * Why one JumpCloud surface's response boundary could not be generated (`boundaryCodegen.ts`). Each refusal names
 * the surface, so `tools/generateJumpcloudResponseBoundaries.ts` can collect every one before writing anything.
 */

/** Two or more carriers measured on one surface. */
export interface MixedCarrierError {
  readonly code: "MIXED_CARRIER";
  readonly message: string;
  readonly surface: string;
}

/** A root the boundary layer has no carrier for — a bare string, number or `null`. */
export interface UnsupportedRootError {
  readonly code: "UNSUPPORTED_ROOT";
  readonly message: string;
  readonly surface: string;
}

/** A 2xx answer that was not JSON — measured, so never mistaken for a surface the census did not reach. */
export interface NonJsonAnswerError {
  readonly code: "NON_JSON_ANSWER";
  readonly message: string;
  readonly surface: string;
}

/** A key the census recorded as `<unsafe>`, or an object mixing data-shaped keys and field names. */
export interface UndeclarableKeyError {
  readonly code: "UNDECLARABLE_KEY";
  readonly message: string;
  readonly surface: string;
  readonly path: string;
}

/** A number too large for JSON to read back, which parses to `Infinity` and which no schema of a number admits. */
export interface NonFiniteNumberError {
  readonly code: "NON_FINITE_NUMBER";
  readonly message: string;
  readonly surface: string;
  readonly path: string;
}

/** A document-path entry (`responseDocumentPaths.ts`) that cannot stand, named with the check it failed. */
export interface ResponseDocumentPathError {
  readonly code: "RESPONSE_DOCUMENT_PATH";
  readonly message: string;
  readonly surface: string;
  readonly path: string;
}

/** A wrapped envelope key measured as a kind other than the one the wrapped carrier declares for it. */
export interface EnvelopeKindError {
  readonly code: "ENVELOPE_KIND";
  readonly message: string;
  readonly surface: string;
  readonly key: string;
}

/** Answers the census filed under a name no paged surface carries — a path no row matched, or two rows tied on. */
export interface UnroutedAnswerError {
  readonly code: "UNROUTED_ANSWER";
  readonly message: string;
  readonly surface: string;
}

/** A spec response this module cannot read a carrier from. */
export interface UnreadableSpecError {
  readonly code: "UNREADABLE_SPEC";
  readonly message: string;
  readonly surface: string;
}

/** Why one surface's boundary could not be generated. */
export type JumpcloudCodegenError =
  | EnvelopeKindError
  | MixedCarrierError
  | NonFiniteNumberError
  | NonJsonAnswerError
  | ResponseDocumentPathError
  | UndeclarableKeyError
  | UnreadableSpecError
  | UnroutedAnswerError
  | UnsupportedRootError;

/** Constructors for {@link JumpcloudCodegenError}. */
export const JumpcloudCodegenErrors = {
  envelopeKind: ({
    surface,
    key,
    measured,
    declared,
  }: {
    surface: string;
    key: string;
    measured: readonly string[];
    declared: string;
  }): EnvelopeKindError => ({
    code: "ENVELOPE_KIND",
    key,
    message: `${surface}: the envelope's "${key}" was measured as ${measured.join(" | ")}, where the wrapped carrier declares ${declared}`,
    surface,
  }),
  mixedCarrier: ({ surface, carriers }: { surface: string; carriers: readonly string[] }): MixedCarrierError => ({
    code: "MIXED_CARRIER",
    message: `${surface}: answered in ${String(carriers.length)} carriers (${carriers.join(", ")}); a boundary declares one`,
    surface,
  }),
  nonFiniteNumber: ({ surface, path }: { surface: string; path: string }): NonFiniteNumberError => ({
    code: "NON_FINITE_NUMBER",
    message: `${surface}: a number too large for JSON to read back was measured at "${path}", which no number schema admits`,
    path,
    surface,
  }),
  nonJsonAnswer: ({ surface, count }: { surface: string; count: number }): NonJsonAnswerError => ({
    code: "NON_JSON_ANSWER",
    message: `${surface}: ${String(count)} 2xx answer(s) were not JSON, which no carrier declares`,
    surface,
  }),
  responseDocumentPath: ({
    surface,
    path,
    why,
  }: {
    surface: string;
    path: string;
    why: string;
  }): ResponseDocumentPathError => ({
    code: "RESPONSE_DOCUMENT_PATH",
    message: `${surface}: the document path "${path}" cannot stand — ${why}`,
    path,
    surface,
  }),
  undeclarableKey: ({ surface, path, why }: { surface: string; path: string; why: string }): UndeclarableKeyError => ({
    code: "UNDECLARABLE_KEY",
    message: `${surface}: ${why} at "${path}"`,
    path,
    surface,
  }),
  unreadableSpec: ({ surface, why }: { surface: string; why: string }): UnreadableSpecError => ({
    code: "UNREADABLE_SPEC",
    message: `${surface}: no carrier in the published document — ${why}`,
    surface,
  }),
  unroutedAnswer: ({ surface }: { surface: string }): UnroutedAnswerError => ({
    code: "UNROUTED_ANSWER",
    message: `${surface}: answers filed under no surface a read pages, so no boundary declares what they measured`,
    surface,
  }),
  unsupportedRoot: ({ surface, root }: { surface: string; root: string }): UnsupportedRootError => ({
    code: "UNSUPPORTED_ROOT",
    message: `${surface}: answered a bare ${root}, which no carrier declares`,
    surface,
  }),
} as const;
