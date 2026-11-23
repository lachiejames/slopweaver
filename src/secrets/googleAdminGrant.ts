/**
 * The Google Admin door's bound grant — `$SLOPWEAVER_HOME/secrets/google-admin-oauth.json`.
 *
 * A SEPARATE file from the mail, Drive and Calendar doors', and here the separation carries more weight
 * than anywhere else it is applied. This grant's scopes read the ORGANISATION — every user, every group,
 * every managed device, the audit log. Keeping it in its own file means revoking it leaves the owner's
 * mailbox and files reachable, `connect --status` reports the administrator scopes and only those, and an
 * organisation-wide scope can never ride along on a consent screen opened to read one person's mail.
 *
 * Everything about how a grant is written, read back and reported without its token material lives in
 * {@link ./googleGrant.googleGrantStore}.
 */
import { type GoogleGrant, type GoogleGrantStatus, googleGrantStore } from "./googleGrant.js";

/**
 * The Google Admin door's grant, in the shape every Google door persists.
 *
 * @internal — the declared shape `googleAdminGrantStore` reads and writes; callers destructure it.
 */
export type GoogleAdminGrant = GoogleGrant;

/**
 * The token-free view of the Google Admin door's grant.
 *
 * @internal — the declared shape `googleAdminGrantStore.status` returns; callers destructure it.
 */
export type GoogleAdminGrantStatus = GoogleGrantStatus;

/** The Google Admin door's grant store, bound to `google-admin-oauth.json`. */
export const googleAdminGrantStore = googleGrantStore({
  connectVerb: "slopweaver atlas google-admin connect",
  productName: "Google Workspace Admin",
  secretName: "google-admin-oauth.json",
});
