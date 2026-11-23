/**
 * The typed failures the `atlas github` verb shells author themselves: an offline API surface that could not
 * be compiled from the installed packages, a scope enumeration that could not be finished, and an artifact
 * directory the walk could not create.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory and distinct from
 * the domain's `GithubAtlasError` (`src/atlas/github/errors.ts`), which is what a provider read answers. The
 * surface parser's own refusals are not re-authored here: they arrive as its string list and ride as
 * `reasons`. Two refusals here have always printed a second line saying what the first one means, and they
 * carry both as `reasons` too, so {@link githubAtlasVerbErrorLines} prints them as they always were.
 */

import type { GithubAtlasError } from "../../../atlas/github/errors.js";

/** `@octokit/openapi-types` is not installed, so there is no API description to compile. */
export interface GithubAtlasDescriptionMissingError {
  readonly code: "DESCRIPTION_MISSING";
  readonly message: string;
}

/** The installed API description could not be read; `reasons` is the failure, then what it means. */
export interface GithubAtlasDescriptionUnreadableError {
  readonly code: "DESCRIPTION_UNREADABLE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The installed API description was read and the surface parser refused it; `reasons` is its own list. */
export interface GithubAtlasSurfaceUnparseableError {
  readonly code: "SURFACE_UNPARSEABLE";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The organisations this token can see could not be read. */
export interface GithubAtlasOrganisationsUnenumeratedError {
  readonly code: "ORGANISATIONS_UNENUMERATED";
  readonly message: string;
  readonly cause: GithubAtlasError;
}

/** The repository listing route could not be built for one organisation. */
export interface GithubAtlasListingRouteUnbuildableError {
  readonly code: "LISTING_ROUTE_UNBUILDABLE";
  readonly message: string;
  readonly org: string;
}

/**
 * One organisation's repositories could not be enumerated to the end of paging; `reasons` is the failure,
 * then why the sync refuses rather than covering a subset.
 */
export interface GithubAtlasRepositoriesUnenumeratedError {
  readonly code: "REPOSITORIES_UNENUMERATED";
  readonly message: string;
  readonly org: string;
  readonly cause: GithubAtlasError;
  readonly reasons: readonly string[];
}

/** The directory a walk screenshot belongs in could not be created. */
export interface GithubAtlasArtifactDirectoryUncreatableError {
  readonly code: "ARTIFACT_DIRECTORY_UNCREATABLE";
  readonly message: string;
  readonly relativePath: string;
}

/** Every failure this verb directory authors. */
export type GithubAtlasVerbError =
  | GithubAtlasDescriptionMissingError
  | GithubAtlasDescriptionUnreadableError
  | GithubAtlasSurfaceUnparseableError
  | GithubAtlasOrganisationsUnenumeratedError
  | GithubAtlasListingRouteUnbuildableError
  | GithubAtlasRepositoriesUnenumeratedError
  | GithubAtlasArtifactDirectoryUncreatableError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const GithubAtlasVerbErrors = {
  artifactDirectoryUncreatable: ({
    relativePath,
  }: {
    relativePath: string;
  }): GithubAtlasArtifactDirectoryUncreatableError => ({
    code: "ARTIFACT_DIRECTORY_UNCREATABLE",
    message: `could not create the artifact directory for ${relativePath}`,
    relativePath,
  }),
  descriptionMissing: (): GithubAtlasDescriptionMissingError => ({
    code: "DESCRIPTION_MISSING",
    message: "@octokit/openapi-types is not installed, so GitHub's published API description is unreadable",
  }),
  descriptionUnreadable: ({ detail }: { detail: string }): GithubAtlasDescriptionUnreadableError => {
    const reasons = [
      `could not read GitHub's published OpenAPI description from @octokit/openapi-types: ${detail}`,
      "the API surface is compiled from the installed package rather than fetched, so this is an install problem rather than a network one",
    ];
    return { code: "DESCRIPTION_UNREADABLE", message: reasons.join("; "), reasons };
  },
  listingRouteUnbuildable: ({ org }: { org: string }): GithubAtlasListingRouteUnbuildableError => ({
    code: "LISTING_ROUTE_UNBUILDABLE",
    message: `could not build the repository listing route for ${org}`,
    org,
  }),
  organisationsUnenumerated: ({ cause }: { cause: GithubAtlasError }): GithubAtlasOrganisationsUnenumeratedError => ({
    cause,
    code: "ORGANISATIONS_UNENUMERATED",
    message: `could not enumerate the organisations this token can see: ${cause.message}`,
  }),
  repositoriesUnenumerated: ({
    org,
    cause,
  }: {
    org: string;
    cause: GithubAtlasError;
  }): GithubAtlasRepositoriesUnenumeratedError => {
    const reasons = [
      `could not enumerate ${org}'s repositories to the end of paging: ${cause.message}`,
      "the sync refuses rather than covering a subset — a generation that silently capped its own enumeration would claim to cover an organisation it had only partly walked",
    ];
    return { cause, code: "REPOSITORIES_UNENUMERATED", message: reasons.join("; "), org, reasons };
  },
  surfaceUnparseable: ({ reasons }: { reasons: readonly string[] }): GithubAtlasSurfaceUnparseableError => ({
    code: "SURFACE_UNPARSEABLE",
    message: reasons.join("; "),
    reasons,
  }),
} as const;

/**
 * The lines a {@link GithubAtlasVerbError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function githubAtlasVerbErrorLines({ error }: { error: GithubAtlasVerbError }): readonly string[] {
  if (
    error.code === "DESCRIPTION_UNREADABLE" ||
    error.code === "SURFACE_UNPARSEABLE" ||
    error.code === "REPOSITORIES_UNENUMERATED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
