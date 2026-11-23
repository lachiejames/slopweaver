/**
 * The Google SecOps door's bound grant — `$SLOPWEAVER_HOME/secrets/google-secops-oauth.json`.
 *
 * A SEPARATE file from every other Google door's, so revoking it leaves the mailbox and the admin atlas
 * reachable, and `connect --status` reports the SecOps scope and only that.
 *
 * Everything about how a grant is written, read back and reported without its token material lives in
 * {@link ./googleGrant.googleGrantStore}.
 */
import { googleGrantStore } from "./googleGrant.js";

/** The Google SecOps door's grant store, bound to `google-secops-oauth.json`. */
export const googleSecopsGrantStore = googleGrantStore({
  connectVerb: "slopweaver atlas google-secops connect",
  productName: "Google Security Operations",
  secretName: "google-secops-oauth.json",
});
