/**
 * Stripping the Make API token from text this door does not author.
 *
 * Applied twice, against two tokens. The client strips the token a fill was SENT with from every answered
 * body and failure, before the projection sees it. The read adapter strips the token CONFIGURED NOW from
 * every stored detail before a read, a page or a render sees it — a string Make users typed is stored as
 * typed, so a token rotated in after the fill that stored it would otherwise print. A module of its own so
 * the read path strips without loading the SDK, which only `client.ts` may import.
 */

/** What every occurrence of the token becomes: the secret's own name. */
const MARKER = "[make-api-token]";

/**
 * Strip the token from one string.
 *
 * @param text the string as Make or the store holds it
 * @param token the bearer token to strip
 * @returns the text with every occurrence of the token replaced by its secret's name
 */
export function redactMakeToken({ text, token }: { text: string; token: string }): string {
  return token === "" ? text : text.replaceAll(token, MARKER);
}

/**
 * Strip the token from every string anywhere in a parsed body, keys included. An allowlisted field is still
 * text a Make user typed — a scenario description can hold anything — so the schemas bound which KEYS
 * survive and this bounds what any surviving VALUE can carry.
 *
 * @param value a parsed response body or stored detail
 * @param token the bearer token to strip
 * @returns the same shape with every string passed through {@link redactMakeToken}
 */
export function redactMakeTokenDeep({ value, token }: { value: unknown; token: string }): unknown {
  if (typeof value === "string") {
    return redactMakeToken({ text: value, token });
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactMakeTokenDeep({ token, value: item }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactMakeToken({ text: key, token }),
        redactMakeTokenDeep({ token, value: item }),
      ]),
    );
  }
  return value;
}
