/**
 * The part of the organisation the console reads — the name the team context wears, and what a row is placed by: its
 * GitHub owner, its Slack hosts, its Linear and Vanta workspaces and this build's own repository — read off
 * `slopweaver org show --json` and validated here.
 *
 * The organisation is one store row, written once by `slopweaver org set` (`src/organisation/core.ts`). The console
 * never reaches `src/` or the store, so it takes the verb's document and keeps only the six fields it reads. One
 * reading carries the label and the placement together, so the two can never come from different writes. Nothing
 * defaults: a document lacking one is refused, and an organisation with no Linear or Vanta says so with a `null` that
 * this keeps as `null`.
 */
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

/** The live allowlist slug the organisation is read under, and the source a report names when that read fails. */
export const ORGANISATION_SLUG = "organisation";

/** What the console reads about the organisation: its name, and what placement reads. */
export interface PlacementOrganisation {
  /** What the console calls the team context, and what a card names the organisation as. */
  readonly displayName: string;
  /** The GitHub owner whose repositories are the team's, lowercased. */
  readonly githubOwner: string;
  /** The Slack workspace hosts whose permalinks are the team's, lowercased; empty when the organisation has no Slack. */
  readonly slackHosts: readonly string[];
  /** The Linear workspace slug, or `null` when the organisation has no Linear. */
  readonly linearWorkspace: string | null;
  /** The Vanta workspace slug, or `null` when the organisation has no Vanta. */
  readonly vantaWorkspace: string | null;
  /** This build's own repository, `owner/repo` lowercased — the one that is `self`. */
  readonly selfRepository: string;
}

/** The organisation verb ran and did not answer with a document: absent, unreadable or timed out. */
export interface OrganisationReadFailedError {
  readonly code: "ORGANISATION_READ_FAILED";
  readonly message: string;
}

/** The verb answered with a document that does not carry what placement reads. */
export interface OrganisationDocumentInvalidError {
  readonly code: "ORGANISATION_DOCUMENT_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Why the console has no organisation to place rows by. */
export type PlacementOrganisationError = OrganisationReadFailedError | OrganisationDocumentInvalidError;

/** The factories every placement-organisation failure is built through. */
export const PlacementOrganisationErrors = {
  documentInvalid: ({ issues }: { issues: readonly string[] }): OrganisationDocumentInvalidError => ({
    code: "ORGANISATION_DOCUMENT_INVALID",
    issues,
    message: `slopweaver org show --json printed no organisation placement can read: ${issues.join("; ")}`,
  }),
  readFailed: ({ notMeasured }: { notMeasured: string }): OrganisationReadFailedError => ({
    code: "ORGANISATION_READ_FAILED",
    message: notMeasured,
  }),
} as const;

/*
 * The store's own grammar for each field, restated because the site cannot import `src/organisation/core.ts`. A
 * looser one here would accept a document the store refuses: `selfRepository: "foo/bar#1"` matches no repository, so
 * this build's own `foo/bar` would fall through to the owner rule and place in team.
 * `placementOrganisation.test.ts` holds each one to the values the store accepts and refuses.
 */

/** A GitHub account or organisation login, lowercased: letters, digits and single hyphens. */
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

/** An exact `owner/repo`, lowercased — never a URL, never a path, so never a dot-only `.` or `..` name. */
const REPOSITORY = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.+$)[a-z0-9._-]+$/;

/** A bare DNS host name, lowercased: no scheme, no path, no port. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A workspace slug as a provider's URL carries it (`linear.app/<slug>`, `app.vanta.com/c/<slug>`). */
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** The six fields the console reads; the verb prints more, and the rest are not this reader's business. */
const placementOrganisationSchema = z.object({
  // The store's own rule (`src/organisation/core.ts`): a name is any nonblank string, case kept.
  displayName: z.string().trim().min(1),
  githubOwner: z.string().regex(GITHUB_LOGIN, "must be a lowercase GitHub login"),
  linearWorkspace: z.string().regex(SLUG, "must be a lowercase slug").nullable(),
  selfRepository: z.string().regex(REPOSITORY, "must be a lowercase owner/repo"),
  // Empty when the organisation has no Slack (`org set --without-slack`): then no permalink is the team's.
  slackHosts: z
    .array(z.string().regex(HOST, "must be a bare lowercase host"))
    .refine((hosts) => new Set(hosts).size === hosts.length, { message: "has a duplicate entry" }),
  vantaWorkspace: z.string().regex(SLUG, "must be a lowercase slug").nullable(),
});

/**
 * Read the console's fields out of `org show --json`'s document.
 *
 * @param value the parsed document
 * @returns the six fields, or every problem named
 */
export function parsePlacementOrganisation({
  value,
}: {
  value: unknown;
}): Result<PlacementOrganisation, PlacementOrganisationError> {
  const parsed = placementOrganisationSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      if (issue.path.length === 0) {
        return `the document: ${issue.message}`;
      }
      return `${issue.path.join(".")}: ${issue.message}`;
    });
    return err(PlacementOrganisationErrors.documentInvalid({ issues }));
  }
  const { displayName, githubOwner, linearWorkspace, selfRepository, slackHosts, vantaWorkspace } = parsed.data;
  return ok({ displayName, githubOwner, linearWorkspace, selfRepository, slackHosts, vantaWorkspace });
}
