/**
 * Why the store would not remove an end-to-end fixture page. Every refusal writes nothing, and none prints a digest:
 * a walk names its slug, and a reader acts on which check failed.
 */
import type { StoreError } from "../errors.js";

/** The slug is not one a desktop end-to-end walk could have planned, so nothing was opened. */
export interface FixtureSlugRefusedError {
  readonly code: "PAGES_FIXTURE_SLUG_REFUSED";
  readonly message: string;
  readonly slug: string;
}

/** The digest the caller pinned is not a lower-case hex sha-256, so nothing was opened. */
export interface FixtureDigestMalformedError {
  readonly code: "PAGES_FIXTURE_DIGEST_MALFORMED";
  readonly message: string;
  readonly slug: string;
}

/** The freeze instant the caller pinned is not a parseable ISO instant, so nothing was opened. */
export interface FixtureInstantMalformedError {
  readonly code: "PAGES_FIXTURE_INSTANT_MALFORMED";
  readonly message: string;
  readonly slug: string;
}

/** The store holds no page under the fixture's slug. */
export interface FixtureAbsentError {
  readonly code: "PAGES_FIXTURE_ABSENT";
  readonly message: string;
  readonly slug: string;
}

/** The page under the slug holds something other than exactly the fixture, so it is left whole. */
export interface FixtureMismatchError {
  readonly code: "PAGES_FIXTURE_MISMATCH";
  readonly message: string;
  readonly slug: string;
  readonly detail: string;
}

/** A connection step threw rather than answering. */
export interface FixtureRemovalUnavailableError {
  readonly code: "PAGES_FIXTURE_REMOVAL_UNAVAILABLE";
  readonly message: string;
  readonly cause: unknown;
}

/** Every way removing a fixture page fails. */
export type PublishedPageFixtureRemovalError =
  | FixtureAbsentError
  | FixtureDigestMalformedError
  | FixtureInstantMalformedError
  | FixtureMismatchError
  | FixtureRemovalUnavailableError
  | FixtureSlugRefusedError
  | StoreError;

export const PublishedPageFixtureRemovalErrors = {
  absent: ({ slug }: { slug: string }): FixtureAbsentError => ({
    code: "PAGES_FIXTURE_ABSENT",
    message: `the store holds no page ${slug} to remove, though the walk published one`,
    slug,
  }),
  digestMalformed: ({ slug }: { slug: string }): FixtureDigestMalformedError => ({
    code: "PAGES_FIXTURE_DIGEST_MALFORMED",
    message: `refusing to remove ${slug}: the pinned digest is not a lower-case hex sha-256`,
    slug,
  }),
  instantMalformed: ({ slug }: { slug: string }): FixtureInstantMalformedError => ({
    code: "PAGES_FIXTURE_INSTANT_MALFORMED",
    message: `refusing to remove ${slug}: the pinned freeze instant is not a parseable ISO instant`,
    slug,
  }),
  mismatch: ({ slug, detail }: { slug: string; detail: string }): FixtureMismatchError => ({
    code: "PAGES_FIXTURE_MISMATCH",
    detail,
    message: `refusing to remove ${slug}: ${detail}, so it is not exactly the walk's fixture and is left whole`,
    slug,
  }),
  slugRefused: ({ slug }: { slug: string }): FixtureSlugRefusedError => ({
    code: "PAGES_FIXTURE_SLUG_REFUSED",
    message: `refusing to remove ${slug}: only a desktop end-to-end fixture's page is ever removed this way`,
    slug,
  }),
  unavailable: ({ cause, doing }: { cause: unknown; doing: string }): FixtureRemovalUnavailableError => ({
    cause,
    code: "PAGES_FIXTURE_REMOVAL_UNAVAILABLE",
    message: `the store did not ${doing} while removing a fixture page: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;
