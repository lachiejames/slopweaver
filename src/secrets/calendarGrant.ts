/**
 * The Calendar door's bound grant — `$SLOPWEAVER_HOME/secrets/calendar-oauth.json`.
 *
 * A SEPARATE file from the mail and Drive doors', and that is the security property rather than an
 * implementation detail: a Calendar grant carries `calendar.readonly`, which sees every calendar the
 * account subscribes to and every attendee on every event in them. Keeping them apart means revoking one
 * leaves the others working, `connect --status` on any of them reports only what that door can actually
 * reach, and a calendar scope can never ride along on a consent screen the owner opened to read their mail.
 *
 * Everything about how a grant is written, read back and reported without its token material lives in
 * {@link ./googleGrant.googleGrantStore}.
 */
import { type GoogleGrant, type GoogleGrantStatus, googleGrantStore } from "./googleGrant.js";

/**
 * The Calendar door's grant, in the shape every Google door persists.
 *
 * @internal — the declared shape `calendarGrantStore` reads and writes; callers destructure it.
 */
export type CalendarGrant = GoogleGrant;

/**
 * The token-free view of the Calendar door's grant.
 *
 * @internal — the declared shape `calendarGrantStore.status` returns; callers destructure it.
 */
export type CalendarGrantStatus = GoogleGrantStatus;

/** The Calendar door's grant store, bound to `calendar-oauth.json`. */
export const calendarGrantStore = googleGrantStore({
  connectVerb: "slopweaver calendar connect",
  productName: "Google Calendar",
  secretName: "calendar-oauth.json",
});
