/**
 * The Drive door's bound grant — `$SLOPWEAVER_HOME/secrets/drive-oauth.json`.
 *
 * A SEPARATE file from the mail door's, and that is the security property rather than an implementation
 * detail: a Drive grant carries `drive.readonly`, which reaches every file the owner can open, and a mail
 * grant carries scopes that reach a mailbox. Keeping them apart means revoking one leaves the other
 * working, `connect --status` on either reports only what that door can actually reach, and a wide Drive
 * scope can never ride along on a consent screen the owner opened to read their mail.
 *
 * Everything about how a grant is written, read back and reported without its token material lives in
 * {@link ./googleGrant.googleGrantStore}.
 */
import { type GoogleGrant, type GoogleGrantStatus, googleGrantStore } from "./googleGrant.js";

/**
 * The Drive door's grant, in the shape every Google door persists.
 *
 * @internal — the declared shape `driveGrantStore` reads and writes; callers destructure it.
 */
export type DriveGrant = GoogleGrant;

/**
 * The token-free view of the Drive door's grant.
 *
 * @internal — the declared shape `driveGrantStore.status` returns; callers destructure it.
 */
export type DriveGrantStatus = GoogleGrantStatus;

/** The Drive door's grant store, bound to `drive-oauth.json`. */
export const driveGrantStore = googleGrantStore({
  connectVerb: "slopweaver drive connect",
  productName: "Google Drive",
  secretName: "drive-oauth.json",
});
