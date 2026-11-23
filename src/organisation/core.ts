/**
 * The organisation an install works for, written ONCE and read by the readers that have to know whose work
 * something is — the pure half: its shape, its validation, and the JSON a reader prints.
 *
 * The organisation is written once and used everywhere, so it is one singleton row in the store
 * (`../store/schema/organisation.ts`), not a constant in code and not a file under `$SLOPWEAVER_HOME`. A reader takes the parsed value as a parameter; the one effectful read is `./read.ts`.
 *
 * Nothing here defaults. A field an organisation genuinely does not have — no Linear, no Vanta, no Google domain —
 * is written as `null` by the writer saying so (`--without-linear`), and no Slack as zero hosts
 * (`--without-slack`), each a statement; a field nobody wrote is
 * `ORG_NOT_CONFIGURED`, which is a refusal. The two never read alike.
 */
import { z } from "zod";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type OrganisationError, OrganisationErrors } from "./errors.js";

/** A GitHub account or organisation login, lowercased: letters, digits and single hyphens. */
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

/** An exact `owner/repo`, lowercased — never a URL, never a path, so never a dot-only `.` or `..` name. */
const REPOSITORY = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/(?!\.+$)[a-z0-9._-]+$/;

/**
 * Whether a typed slug names a repository the organisation could list, in any case — the one test a `--repo` flag
 * and a stored organisation share, so neither accepts what the other refuses.
 *
 * @param slug an `owner/repo` as typed, not yet lowercased
 * @returns true when its lowercase form is an exact `owner/repo` with no dot-only name
 */
export function isRepositorySlug({ slug }: { slug: string }): boolean {
  return REPOSITORY.test(slug.toLowerCase());
}

/** A bare DNS host name, lowercased: no scheme, no path, no port. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A workspace slug as a provider's URL carries it (`linear.app/<slug>`, `app.vanta.com/c/<slug>`). */
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** A GitHub App's bare login, as its `<login>[bot]` account carries it. */
const BOT_LOGIN = /^[a-z0-9][a-z0-9-]*$/;

/** One Zod issue as a line, naming the field it is about — or the whole value when it is about no one field. */
function issueLine({ issue, whole }: { issue: z.core.$ZodIssue; whole: string }): string {
  if (issue.path.length === 0) {
    return `${whole}: ${issue.message}`;
  }
  return `${issue.path.join(".")}: ${issue.message}`;
}

/** One list of distinct entries: a duplicate is a writer's mistake, never a second meaning. */
function distinct<T extends z.ZodType<string>>({ item }: { item: T }): z.ZodArray<T> {
  return z.array(item).refine((list) => new Set(list).size === list.length, { message: "has a duplicate entry" });
}

/** What the store holds about the organisation — every field a writer states. */
const organisationRecordSchema = z.strictObject({
  /** What the console calls the team context, and what a card names the organisation as. */
  displayName: z.string().trim().min(1),
  /** The GitHub owner whose repositories are the team's work. */
  githubOwner: z.string().regex(GITHUB_LOGIN, "must be a lowercase GitHub login"),
  /** The Google Workspace domain whose accounts are the team's, or `null` when the organisation has none. */
  googleDomain: z.string().regex(HOST, "must be a bare lowercase domain").nullable(),
  /**
   * The Slack workspace hosts whose permalinks are the team's (`<workspace>.slack.com`), or none when the
   * organisation has no Slack — `org set --without-slack`, a statement like the nullable fields' — in which case no
   * conversation is the team's. Slack is one entry point, never a requirement.
   */
  slackHosts: distinct({ item: z.string().regex(HOST, "must be a bare lowercase host") }),
  /** The Linear workspace slug, or `null` when the organisation has no Linear. */
  linearWorkspace: z.string().regex(SLUG, "must be a lowercase slug").nullable(),
  /** The Vanta workspace slug, or `null` when the organisation has no Vanta. */
  vantaWorkspace: z.string().regex(SLUG, "must be a lowercase slug").nullable(),
  /** The organisation's own repositories, `owner/repo`, the ones the fleet reads and lands in. */
  repositories: distinct({ item: z.string().regex(REPOSITORY, "must be a lowercase owner/repo") }).min(1),
  /** The organisation's own dependency-bot GitHub App logins, bare, beside the generic Renovate and Dependabot. */
  dependencyBots: distinct({ item: z.string().regex(BOT_LOGIN, "must be a bare lowercase GitHub App login") }),
});

/** What the store holds about the organisation. */
export type OrganisationRecord = z.infer<typeof organisationRecordSchema>;

/** The fields a writer states, in the order `org set` and `org show` print them. */
export const ORGANISATION_FIELDS = [
  "displayName",
  "githubOwner",
  "googleDomain",
  "slackHosts",
  "linearWorkspace",
  "vantaWorkspace",
  "repositories",
  "dependencyBots",
] as const satisfies readonly (keyof OrganisationRecord)[];

/** The organisation as a reader takes it: the stored record, the derived self repository, and its revision. */
export interface Organisation extends OrganisationRecord {
  /** This build's own repository, `owner/repo` lowercased, read off its checkout's `origin` — never stored. */
  readonly selfRepository: string;
  readonly revision: number;
  readonly updatedAtIso: string;
}

/**
 * Validate a record offered for storage, or read back from it.
 *
 * A row lacking a field reads as `ORG_NOT_CONFIGURED` naming that field — a writer never stated it — while a field
 * present and wrong is `ORG_INVALID`, every problem named. Neither is repaired into a default.
 *
 * @param value the untrusted record
 * @returns the record, or the typed refusal
 */
export function parseOrganisationRecord({ value }: { value: unknown }): Result<OrganisationRecord, OrganisationError> {
  if (isRecord(value)) {
    const missing = ORGANISATION_FIELDS.find((field) => value[field] === undefined);
    if (missing !== undefined) {
      return err(OrganisationErrors.notConfigured({ missing }));
    }
  }
  const parsed = organisationRecordSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      OrganisationErrors.invalid({
        issues: parsed.error.issues.map((issue) => issueLine({ issue, whole: "record" })),
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * Name a stored value in a refusal without converting it: a number by its value, anything else by its type, so an
 * object with no prototype — which `String()` throws on — still reads as a refusal rather than a crash.
 */
function describeStoredValue({ value }: { value: unknown }): string {
  if (typeof value === "number") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return `a value of type ${typeof value}`;
}

/**
 * Validate the bookkeeping a stored row carries beside its record. A writer only ever stores a revision of 1 or more
 * and a real instant, so anything else — a revision of 0, an `updated_at` of `infinity` or a NULL one a dropped
 * constraint let in — is a row a hand-edit left wrong, refused as `ORG_INVALID` exactly as a wrong field is, rather
 * than thrown later by `getTime` or `toISOString`. Both columns arrive as `unknown` because the schema's types are a
 * claim about the table, and a hand-edit is exactly what makes that claim false.
 *
 * @param revision the revision column as read
 * @param updatedAt the `updated_at` column as the driver parsed it
 * @returns the revision and the instant as ISO, or the typed refusal naming every problem
 */
export function parseStoredMeta({
  revision,
  updatedAt,
}: {
  revision: unknown;
  updatedAt: unknown;
}): Result<{ revision: number; updatedAtIso: string }, OrganisationError> {
  const issues: string[] = [];
  const realRevision = typeof revision === "number" && Number.isInteger(revision) && revision >= 1;
  if (!realRevision) {
    issues.push(`revision: must be a positive integer, got ${describeStoredValue({ value: revision })}`);
  }
  const realInstant = updatedAt instanceof Date && Number.isFinite(updatedAt.getTime());
  if (!realInstant) {
    issues.push("updatedAt: must be a real instant");
  }
  if (!realRevision || !realInstant) {
    return err(OrganisationErrors.invalid({ issues }));
  }
  return ok({ revision, updatedAtIso: updatedAt.toISOString() });
}

/** The JSON `org show --json` prints, for a reader that holds the document rather than the store. */
const organisationSchema = organisationRecordSchema.extend({
  revision: z.number().int().positive(),
  selfRepository: z.string().regex(REPOSITORY),
  updatedAtIso: z.iso.datetime(),
});

/**
 * Read a printed organisation back whole — the inverse of the `org show --json` document, for a reader that has the
 * JSON rather than the store.
 *
 * @param value the untrusted document
 * @returns the organisation, or the typed refusal naming every problem
 */
export function parseOrganisation({ value }: { value: unknown }): Result<Organisation, OrganisationError> {
  const parsed = organisationSchema.strict().safeParse(value);
  if (!parsed.success) {
    return err(
      OrganisationErrors.invalid({
        issues: parsed.error.issues.map((issue) => issueLine({ issue, whole: "document" })),
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * The lines `org show` prints for a person: every field, the absent ones said as absent, and where the self
 * repository came from.
 *
 * @param organisation the organisation read
 * @returns the lines, one field each
 */
export function organisationLines({ organisation }: { organisation: Organisation }): readonly string[] {
  const named = ({ value, provider }: { value: string | null; provider: string }): string => {
    if (value === null) {
      return `(none — the organisation has no ${provider})`;
    }
    return value;
  };
  const listed = ({ values }: { values: readonly string[] }): string =>
    values.length === 0 ? "(none beyond the generic Renovate and Dependabot)" : values.join(", ");
  const slackHosts =
    organisation.slackHosts.length === 0
      ? "(none — the organisation has no Slack)"
      : organisation.slackHosts.join(", ");
  return [
    `organisation ${organisation.displayName} (revision ${String(organisation.revision)}, ${organisation.updatedAtIso})`,
    `  github owner      ${organisation.githubOwner}`,
    `  google domain     ${named({ provider: "Google Workspace", value: organisation.googleDomain })}`,
    `  slack hosts       ${slackHosts}`,
    `  linear workspace  ${named({ provider: "Linear", value: organisation.linearWorkspace })}`,
    `  vanta workspace   ${named({ provider: "Vanta", value: organisation.vantaWorkspace })}`,
    `  repositories      ${organisation.repositories.join(", ")}`,
    `  dependency bots   ${listed({ values: organisation.dependencyBots })}`,
    `  self repository   ${organisation.selfRepository} (derived from this build's checkout origin, never stored)`,
  ];
}
