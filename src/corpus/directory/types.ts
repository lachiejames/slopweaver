/**
 * The org-directory bronze contract — one row per user Google Workspace Admin holds, the roster every
 * platform's member list is matched TO and the authority `person` is keyed on.
 *
 * The rule: identities are pulled from Google admin and the email address is the key. A row carries the curated fields the reconciler reads and the
 * FULL raw payload, nothing projected away — the same discipline as {@link ../members/types.MemberBronzeRow}.
 */

/** One Google Workspace user as the directory lists them. */
export interface DirectoryUserRow {
  readonly version: 1;
  /** Google's immutable user id — the row key. */
  readonly googleId: string;
  /** The primary address, verbatim. */
  readonly primaryEmail: string;
  /** The primary address normalised — the JOIN key every member row is matched on. */
  readonly emailNormalised: string;
  /** Every alias Google routes to the same mailbox, normalised; a member carrying one joins this person. */
  readonly aliases: readonly string[];
  readonly fullName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly suspended: boolean;
  readonly archived: boolean;
  readonly orgUnitPath?: string;
  /** The job title from the first `organizations` entry, when Google holds one. */
  readonly title?: string;
  readonly isAdmin: boolean;
  readonly creationIso?: string;
  readonly lastLoginIso?: string;
  /** When this row was captured (ISO-8601). */
  readonly fetchedAtIso: string;
  /** The FULL raw user object (secret-scrubbed string leaves, emails PRESERVED). */
  readonly raw: unknown;
}
