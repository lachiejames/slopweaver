/**
 * The mail door's bound grant — `$SLOPWEAVER_HOME/secrets/gmail-oauth.json`.
 *
 * Everything about how a Google user-consent grant is written, read back and reported without its token
 * material lives in {@link ./googleGrant.googleGrantStore}; this file is only the three facts that are the
 * mail door's own: which file, what the door calls itself, and which verb re-establishes it. The Drive door
 * declares the same three about its own file, which is why neither can quietly drift into a different
 * on-disk shape or a different failure message.
 */
import { type GoogleGrant, type GoogleGrantStatus, googleGrantStore } from "./googleGrant.js";

/** The mail door's grant, in the shape every Google door persists. */
export type GmailGrant = GoogleGrant;

/**
 * The token-free view of the mail door's grant.
 *
 * @internal — the declared shape `gmailGrantStore.status` returns; callers destructure it.
 */
export type GmailGrantStatus = GoogleGrantStatus;

/** The mail door's grant store, bound to `gmail-oauth.json`. */
export const gmailGrantStore = googleGrantStore({
  connectVerb: "slopweaver gmail connect",
  productName: "Gmail",
  secretName: "gmail-oauth.json",
});
