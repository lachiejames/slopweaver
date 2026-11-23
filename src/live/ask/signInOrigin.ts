/**
 * The one way a page a turn is blocked on is reduced to what the ask log stores: its bare HTTPS origin.
 *
 * A block names the ORIGIN the owner signs in to, never the page a session happened to be reading — a path or query can
 * carry a token, and the sign-in card opens the origin anyway (`../../monitor/turnSignedOut.ts`). One function, read
 * by the verb that writes the field and the decoder that reads it back, so the two cannot disagree on what counts.
 *
 * Pure.
 */

/**
 * The bare HTTPS origin a URL names, or `undefined` when it is not an HTTPS URL at all.
 *
 * @param url a page address, e.g. `https://admin.google.com/ac/home`
 * @returns the origin, e.g. `https://admin.google.com`
 */
export function signInOriginOf({ url }: { url: string }): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") {
    return undefined;
  }
  return parsed.origin;
}

/**
 * Whether a stored value is already a bare HTTPS origin — what the ask log's reader accepts and nothing looser.
 *
 * @param value the stored `signInOrigin`
 * @returns true only for an exact `https://host[:port]`
 */
export function isSignInOrigin({ value }: { value: string }): boolean {
  return signInOriginOf({ url: value }) === value;
}
