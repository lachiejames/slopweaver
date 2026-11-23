/**
 * Why one Datadog operation's response boundary could not be generated (`responseCodegen.ts` and the modules it reads).
 * Each refusal names the operation and the census path, so `tools/generateDatadogResponseBoundaries.ts` collects
 * every one before writing anything.
 */

/** Fields every refusal carries. */
interface DatadogCodegenRefusal {
  readonly message: string;
  readonly surface: string;
  readonly path: string;
}

/** A `$ref` the pinned specification does not resolve, or a construct this generator does not read. */
export interface DatadogSpecUnreadableError extends DatadogCodegenRefusal {
  readonly code: "SPEC_UNREADABLE";
}

/** A node that must be left unread where no named field holds it — the root, an array element or a map value. */
export interface DatadogUncuttableError extends DatadogCodegenRefusal {
  readonly code: "UNCUTTABLE";
  readonly reason: string;
}

/** What the census measured cannot be declared: an unsafe key, a non-finite number, or a root of two kinds. */
export interface DatadogUndeclarableError extends DatadogCodegenRefusal {
  readonly code: "UNDECLARABLE";
}

/** Every reason one operation's boundary could not be generated. */
export type DatadogCodegenError = DatadogSpecUnreadableError | DatadogUncuttableError | DatadogUndeclarableError;

/** Where a refusal sits, as every message prints it. */
function at({ surface, path }: { surface: string; path: string }): string {
  return path === "" ? `${surface} (root)` : `${surface} at ${path}`;
}

/** Each refusal's constructor. */
export const DatadogCodegenErrors = {
  specUnreadable: ({
    surface,
    path,
    why,
  }: {
    surface: string;
    path: string;
    why: string;
  }): DatadogSpecUnreadableError => ({
    code: "SPEC_UNREADABLE",
    message: `${at({ path, surface })}: ${why}`,
    path,
    surface,
  }),
  uncuttable: ({
    surface,
    path,
    reason,
  }: {
    surface: string;
    path: string;
    reason: string;
  }): DatadogUncuttableError => ({
    code: "UNCUTTABLE",
    message: `${at({ path, surface })}: a ${reason} node must be left unread, and no named field holds it`,
    path,
    reason,
    surface,
  }),
  undeclarable: ({ surface, path, why }: { surface: string; path: string; why: string }): DatadogUndeclarableError => ({
    code: "UNDECLARABLE",
    message: `${at({ path, surface })}: ${why}`,
    path,
    surface,
  }),
} as const;
