/**
 * The `cycle` domain's typed failures.
 *
 * Seven genuinely distinct kinds, each of which a caller branches on rather than merely displays: a home with
 * no Linear bronze at all is a setup problem, a home whose structures lane has never been built is a
 * `derive`/`refresh` problem, an unresolvable owner is an identity problem, a roster the store could not
 * answer for is a store problem rather than an empty roster, a workspace where no team has a live cycle is a
 * legitimate empty answer, a bronze directory that exists and will not list is a read that could not see —
 * never an empty corpus, because a report built over it would publish as complete — and a bronze directory the
 * owner's protect list refuses is the owner's own rule, fixed on that list rather than on disk. Per the
 * error-handling rule this union is scoped to this one module and shares no base type with any other domain.
 */

/** No Linear bronze under the home — nothing to reconcile. */
export interface NoLinearCorpusError {
  readonly code: "NO_LINEAR_CORPUS";
  readonly message: string;
  readonly home: string;
}

/** The structures lane has no Linear cycle rows, so "which cycle is current" cannot be answered. */
export interface NoCycleStructureError {
  readonly code: "NO_CYCLE_STRUCTURE";
  readonly message: string;
  readonly path: string;
}

/** The store's identity roster names no canonical person with a Linear id. */
export interface NoLinearIdentityError {
  readonly code: "NO_LINEAR_IDENTITY";
  readonly message: string;
}

/** The store's identity roster could not be read, so who the pass is about is unknowable — never "nobody". */
export interface IdentityRosterUnreadableError {
  readonly code: "IDENTITY_ROSTER_UNREADABLE";
  readonly message: string;
  readonly cause: unknown;
}

/** Cycle rows exist, but none spans the instant asked about. */
export interface NoCurrentCycleError {
  readonly code: "NO_CURRENT_CYCLE";
  readonly message: string;
  readonly nowIso: string;
}

/** A bronze directory exists and could not be listed, so reading it as empty would pass a partial read as whole. */
export interface CorpusUnreadableError {
  readonly code: "CORPUS_UNREADABLE";
  readonly message: string;
  readonly source: string;
}

/** The owner's protect list refuses a bronze directory the pass reads, or cannot be read, so nothing was read. */
export interface CorpusProtectedError {
  readonly code: "CORPUS_PROTECTED";
  readonly message: string;
  readonly source: string;
}

/** Every way a cycle reconcile can fail. */
export type CycleError =
  | NoLinearCorpusError
  | NoCycleStructureError
  | NoLinearIdentityError
  | IdentityRosterUnreadableError
  | NoCurrentCycleError
  | CorpusUnreadableError
  | CorpusProtectedError;

/** The one place a {@link CycleError} is constructed, so a test builds fixtures the way the real code does. */
export const CycleErrors = {
  corpusProtected: ({ source, message }: { source: string; message: string }): CorpusProtectedError => ({
    code: "CORPUS_PROTECTED",
    message,
    source,
  }),
  corpusUnreadable: ({ source, cause }: { source: string; cause: unknown }): CorpusUnreadableError => ({
    code: "CORPUS_UNREADABLE",
    message: `the ${source} bronze directory exists and could not be listed (${cause instanceof Error ? cause.message : String(cause)}) — nothing was read as empty`,
    source,
  }),
  noCurrentCycle: ({ nowIso }: { nowIso: string }): NoCurrentCycleError => ({
    code: "NO_CURRENT_CYCLE",
    message: `no Linear cycle spans ${nowIso} — every cycle on record had already ended or had not started`,
    nowIso,
  }),
  noCycleStructure: ({ path }: { path: string }): NoCycleStructureError => ({
    code: "NO_CYCLE_STRUCTURE",
    message: `${path} carries no Linear cycle rows — run \`slopweaver refresh\` so the structures lane is built`,
    path,
  }),
  noLinearCorpus: ({ home }: { home: string }): NoLinearCorpusError => ({
    code: "NO_LINEAR_CORPUS",
    home,
    message: `no Linear bronze under ${home} — run \`slopweaver refresh --source linear\` first`,
  }),
  identityRosterUnreadable: ({ cause }: { cause: { readonly message: string } }): IdentityRosterUnreadableError => ({
    cause,
    code: "IDENTITY_ROSTER_UNREADABLE",
    message: `the identity roster could not be read (${cause.message}) — nothing was scoped to an owner`,
  }),
  noLinearIdentity: (): NoLinearIdentityError => ({
    code: "NO_LINEAR_IDENTITY",
    message:
      "no person in the identity roster carries a Linear identity — nothing can be scoped to an owner " +
      "(`slopweaver identity roster show`)",
  }),
} as const;
