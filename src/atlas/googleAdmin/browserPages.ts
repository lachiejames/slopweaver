/**
 * Where the Google Admin console lives, and where Google sends a browser that is not signed in to it.
 *
 * The console signs a browser out after about an hour (the owner's own observation), and a cookie surviving
 * that is no evidence the console renders: `./descriptor.ts` records a cookie-bearing profile landing on Google's
 * step-up password challenge. So the test is where the browser SETTLED — any page on the shared accounts origin,
 * a sign-in, a chooser or a challenge alike, is a sign-in only the owner can do.
 *
 * Pure.
 */

/** The console's own origin — the page a turn reaches for and the one the sign-in card opens. */
export const GOOGLE_ADMIN_ORIGIN = "https://admin.google.com";

/** Google's shared sign-in origin, where a signed-out console visit settles. */
export const GOOGLE_ACCOUNTS_ORIGIN = "https://accounts.google.com";

/**
 * Whether a settled URL is Google's sign-in, account chooser or step-up challenge rather than the console.
 *
 * @param finalUrl where the browser settled
 * @returns true for any page on the accounts origin, `/v3/signin`, `/v2/challenge` and `ServiceLogin` among them
 */
export function isGoogleAdminSignInUrl({ finalUrl }: { finalUrl: string }): boolean {
  try {
    return new URL(finalUrl).origin === GOOGLE_ACCOUNTS_ORIGIN;
  } catch {
    return false;
  }
}
