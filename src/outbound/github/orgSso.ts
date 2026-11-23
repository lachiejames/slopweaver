/**
 * Organisation SAML single sign-on — the grant that is NOT the session, and the reason a perfectly valid
 * login can still fail every upload.
 *
 * ## The distinction this module exists to hold
 *
 * A GitHub web session says who you are. An org SSO grant says that THIS session has been authorised, by
 * the organisation's identity provider, to see that organisation's private repositories. They are separate
 * authorisations with separate clocks, and the second one is invisible to every offline check: the session
 * file parses, its cookies are live, `attach status` reports green, and every upload to a SAML-protected
 * repository fails on a wall.
 *
 * Measured, and it is the measurement that shaped this file: the saved session was signed in as
 * the owner's own account with cookies good for another thirteen days, and a pull request in a
 * SAML-protected organisation answered with the sign-on interstitial. Re-running `attach login` did not fix
 * it and could not have — the profile was ALREADY signed in, so the capture completed the instant it saw
 * the signed-in marker, a second or two after the browser opened, without the grant ever being asked for.
 *
 * ## Why the grant can usually be obtained without a credential
 *
 * `webSession.ts` keeps a persistent browser profile, and the point of that persistence is exactly this
 * case: the profile holds the IDENTITY PROVIDER's session as well as GitHub's, and the identity provider's
 * outlives GitHub's by years. Measured on the same profile: live `accounts.google.com`
 * sign-in cookies expiring 2027 behind a GitHub session expiring in thirteen days. So initiating the grant
 * from that profile is a redirect round trip through an identity provider that already knows the account,
 * not a fresh sign-in — which is why {@link orgSsoInitiateUrl} is worth opening at all, given the standing
 * measurement that Google refuses a FIRST sign-in inside a CDP-controlled browser.
 *
 * When the identity provider does challenge, nothing here types or reads anything: the browser is visible,
 * the operator's own hands complete it, and {@link orgGrantVerdict} is what notices that it landed.
 */

import { GITHUB_ORIGIN, isOrgSsoWall, isSignedInPage } from "./attachment.js";

/**
 * The URL that asks an organisation's identity provider to authorise the current session.
 *
 * @param org the organisation's login slug
 * @returns the absolute sign-on initiation URL
 */
export function orgSsoInitiateUrl({ org }: { org: string }): string {
  return `${GITHUB_ORIGIN}/orgs/${org}/sso`;
}

/**
 * The page whose HTML answers "is this session authorised for that organisation yet".
 *
 * The organisation's own home page rather than a repository, because the caller may be establishing the
 * grant BEFORE it knows which repository it will upload against, and the wall is per-organisation.
 *
 * @param org the organisation's login slug
 * @returns the absolute page URL to read the verdict from
 */
export function orgProbeUrl({ org }: { org: string }): string {
  return `${GITHUB_ORIGIN}/orgs/${org}`;
}

/**
 * The account's own page, read when {@link orgProbeUrl} answered 404 because the owner is a personal account.
 *
 * GitHub serves `/orgs/<login>` only for an organisation, so a user-owned repository's owner has no
 * organisation page to read and no SAML grant to hold. Its profile page exists, and carries the same
 * signed-in `user-login` meta tag every github.com page does, which is all a personal account's session has
 * to show (`slopweaver browser sign-in --provider github` reads it).
 *
 * @param owner the personal account's login
 * @returns the absolute profile page URL
 */
export function accountProbeUrl({ owner }: { owner: string }): string {
  return `${GITHUB_ORIGIN}/${owner}`;
}

/** What one read of an organisation page says about the session behind it. */
export type OrgGrantVerdict = "granted" | "walled" | "signed-out";

/**
 * Read an organisation page's HTML as a verdict on the session that fetched it.
 *
 * Three outcomes rather than a boolean, because the three have three different corrections and collapsing
 * any pair produces the confidently wrong advice this whole area keeps generating: `signed-out` means log
 * in, `walled` means authorise the organisation, and only `granted` means an upload will get as far as the
 * upload region.
 *
 * Order matters. The wall is served to an account that IS signed in, so it passes the signed-in check —
 * testing that first and stopping would report every wall as a success.
 *
 * Reuses {@link isOrgSsoWall}, which was calibrated on a REPOSITORY page, and the reuse is measured rather
 * than assumed: an authorised organisation home page carries no repository id either, so the detector's
 * absence-of-repository-id half is satisfied by both states and only its sign-on markers decide. Measured
 * against a live authorised organisation — 216,921 bytes, signed-in meta tag present, and not
 * one of `single sign-on`, `/sso/sign_in` or `saml/initiate` anywhere in it
 * (`slopweaver github attach status --org <slug>` re-reads the same page).
 *
 * @param html the fetched organisation page
 * @returns which of the three states the fetching session is in
 */
export function orgGrantVerdict({ html }: { html: string }): OrgGrantVerdict {
  if (!isSignedInPage({ html })) {
    return "signed-out";
  }
  return isOrgSsoWall({ html }) ? "walled" : "granted";
}
