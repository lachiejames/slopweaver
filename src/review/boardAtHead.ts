/**
 * Whether a board row is about one pull request at one head — the pure half of the landing read's board join.
 *
 * Here in the pure review domain rather than beside the register (`../cli/commands/github/landingRegister.ts`)
 * because the bump seat names a row by the same slug. What makes a status TERMINAL lives in
 * `./landingBoard.ts`; this module is string work over the slug and the settlement witness, and nothing more.
 *
 * Pure. No I/O.
 */

import type { LandingRow } from "./landing.js";

/** How much of a head commit a slug carries — enough to separate two heads, short enough to read. */
export const SLUG_HEAD_CHARS = 7;

/** A run of hex long enough to be an abbreviated commit, as a settlement witness writes one. */
const COMMIT_RUN = /[0-9a-f]{7,40}/gi;

/**
 * The slug one pull request's row is filed under, at the head this read judged.
 *
 * The head rides in it on purpose: a settled row must not hold back a pull request that has since moved on,
 * and a re-register at the SAME head must be refused rather than duplicated. `handover register` already
 * refuses an existing file, so that second half needs no register of its own.
 *
 * @param row the pull request — a landing row, or the review state one is built from
 * @returns the kebab-case slug
 */
export function registrationSlug({ row }: { row: Pick<LandingRow, "headOid" | "number" | "repoSlug"> }): string {
  return `${registrationPrefix({ repoSlug: row.repoSlug })}${String(row.number)}-${row.headOid.slice(0, SLUG_HEAD_CHARS)}`;
}

/**
 * What every {@link registrationSlug} for one repository opens with — `land-`, the repository as a kebab run, `-`.
 *
 * Its own function so the reader that maps a slug BACK to its repository (`./landingClosure.ts`) spells the
 * repository exactly as the writer did, rather than keeping a second copy of the kebab rule.
 *
 * @param repoSlug the `owner/name`
 * @returns the prefix, ending in the dash before the pull request number
 */
export function registrationPrefix({ repoSlug }: { repoSlug: string }): string {
  return `land-${repoSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-`;
}

/**
 * Whether a board row is ABOUT this pull request at THIS head — by its slug, or by its settlement's witness.
 *
 * The slug is {@link registrationSlug} itself, or that slug with a suffix: a seat filing a narrower row about
 * the same head by hand keeps the prefix and adds its own word (`land-acme-acme-admin-16339-4d43359-cr`).
 *
 * The witness is the half that carries the measured case. A slug names the head the row was FILED at, and a
 * `rebase-and-fix` seat's own work moves the head, so its settled row never matches the head a later read
 * judges. What the seat settles with usually names the head it left behind
 * (`<pull request URL> @ <short commit sha>…`): MEASURED, 8 of the 11
 * settled rows one read kept dispatchable named their pull request's current head that way. A witness
 * naming no commit, or an older one, leaves the row dispatchable — that head was never judged settled.
 *
 * @param head the pull request at the head being judged
 * @param row the board row's slug and settlement witness
 * @returns whether the row was filed or settled at this head
 */
export function aboutThisHead({
  head,
  row,
}: {
  head: Pick<LandingRow, "headOid" | "number" | "repoSlug">;
  row: { readonly slug: string; readonly settlementWitness?: string };
}): boolean {
  const registered = registrationSlug({ row: head });
  if (row.slug === registered || row.slug.startsWith(`${registered}-`)) {
    return true;
  }
  const named = row.settlementWitness?.match(COMMIT_RUN);
  if (named == null) {
    return false;
  }
  const full = head.headOid.toLowerCase();
  return named.some((run) => full.startsWith(run.toLowerCase()));
}

/** Exactly what {@link registrationSlug} writes: a repository run, a pull request number, a short head. */
const REGISTRATION_SLUG = new RegExp(`^land-[a-z0-9-]+-\\d+-[0-9a-f]{${String(SLUG_HEAD_CHARS)}}$`);

/**
 * Whether a board slug is one {@link registrationSlug} wrote — a row `github landing --register` filed.
 *
 * The exact grammar, not a `land-` prefix: a seat's hand-filed narrower row keeps the prefix and adds its own
 * word (`land-acme-acme-admin-16339-4d43359-cr`), and that row is the seat's work, not the register's.
 *
 * @param slug the board row's slug
 * @returns whether the register wrote it
 */
export function isLandingRegistrationSlug({ slug }: { slug: string }): boolean {
  return REGISTRATION_SLUG.test(slug);
}
