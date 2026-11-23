/**
 * Cookie redaction for committed cassettes: the persist hook (`./setup-polly.ts`) blanks every cookie value, and
 * the CI tripwire checks exactly what it promises. Its own module because it is a separate half of a HAR from
 * the per-provider allowlists in `./cassetteRedactConfig.ts`, which never see the `cookies[]` arrays at all.
 */

/**
 * What every cookie VALUE in a committed cassette reads as. A HAR carries `Set-Cookie` TWICE: once as the
 * response header, which `./cassetteRedactConfig.ts`'s header allowlist drops, and again parsed into
 * `response.cookies[]` (Polly's persister runs `set-cookie-parser` over the same header, on the request side
 * too), which the header allowlist never sees. MEASURED once: 66 full-length `__cf_bm`
 * values sat in that array across 30 committed HARs with every response header already stripped to
 * `content-type`. The array is never a match key and nothing replays from it, so the value is blanked rather
 * than the entry dropped — the name and expiry still say which provider set a cookie, which is what a reader
 * of a cassette wants.
 */
export const REDACTED_COOKIE_VALUE = "[REDACTED]";

/**
 * The fields of a HAR cookie this redaction reads. Polly writes more (`expires`, `httpOnly`, `sameSite`,
 * `secure`), all kept verbatim and all incapable of carrying an identifier; `domain` and `path` can, which
 * is why they are named here even though the blanking leaves them alone.
 */
export interface HarCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
}

/**
 * Blank every cookie's value for a committed cassette, keeping every other field. Shared by the persist hook
 * and the CI tripwire, so the gate checks exactly what the redactor promises. Pure.
 *
 * @param cookies the parsed `cookies[]` of one HAR request or response (absent when Polly wrote none)
 * @returns a fresh array with each value replaced by {@link REDACTED_COOKIE_VALUE}
 */
export function redactCassetteCookies<C extends HarCookie>({
  cookies = [],
}: {
  cookies?: readonly C[] | undefined;
}): C[] {
  return cookies.map((cookie) => ({ ...cookie, value: REDACTED_COOKIE_VALUE }));
}

/**
 * Whether a cookie may sit in a committed cassette — its value is the placeholder and nothing else. Shared by
 * the CI tripwire, so the gate checks exactly what {@link redactCassetteCookies} promises. Pure.
 *
 * @returns true iff the value is {@link REDACTED_COOKIE_VALUE}
 */
export function isRedactedCassetteCookie({ cookie }: { cookie: HarCookie }): boolean {
  return cookie.value === REDACTED_COOKIE_VALUE;
}

/**
 * The text a RECORD run's tripwire judges for one recording's cookies, built from what would actually be
 * committed. Pure.
 *
 * Every field is folded in, not just the blanked value, and that is the whole point: blanking covers
 * `value`, so a tripwire reading only `value` could never fire on anything. What blanking deliberately
 * KEEPS is `name`, `domain` and `path` — and a cookie's domain is a real host, which for a workspace
 * subdomain provider is exactly the identifier position the URL redactor collapses everywhere else. Those
 * three are the live catch here; `value` rides along so the text stays a faithful copy of the committed
 * entry rather than a curated subset that a later edit could silently narrow.
 *
 * @param cookies both directions' cookie arrays, already blanked
 * @returns one newline-joined line per cookie; the empty string when there are none
 */
export function cassetteCookieTripwireText({ cookies }: { cookies: readonly HarCookie[] }): string {
  return cookies
    .map((cookie) => {
      const fields = [`name=${cookie.name}`, `value=${cookie.value}`];
      if (cookie.domain !== undefined) {
        fields.push(`domain=${cookie.domain}`);
      }
      if (cookie.path !== undefined) {
        fields.push(`path=${cookie.path}`);
      }
      return fields.join("; ");
    })
    .join("\n");
}
