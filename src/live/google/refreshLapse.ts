/**
 * When a Google refresh token stops working, and whether to warn about it yet. Pure: no clock, no file.
 *
 * Google sends `refresh_token_expires_in` only when the OAuth client's consent screen is in Testing status, where a
 * refresh token dies seven days after consent. Once it does, every call through that grant fails with
 * `invalid_grant`, which reaches the caller as a raw API failure that names no fix. The grant records the instant
 * at consent (`refreshTokenExpiresAtIso`), and this decides what each surface says about it: the Google
 * `connect --status` verbs and `connect gmail --check`. A Production client's grant records nothing, which is
 * `none` here, never a guess.
 *
 * The warning starts 48 hours out: a whole working day of notice on a seven-day lifetime, without a fresh grant
 * warning from the moment it lands. The landing report names the instant regardless, since that is the moment the
 * owner can still move the client to Production.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

/** How far ahead of the lapse the warning starts, inclusive. */
const WARN_WITHIN_MS = 48 * 60 * 60 * 1000;

/** ECMAScript's largest representable time value, either side of the epoch. */
const MAX_TIME_VALUE_MS = 8.64e15;

/** What one grant's recorded refresh-token lapse means right now. */
export type RefreshTokenLapse =
  | { readonly kind: "none" }
  | { readonly kind: "ok"; readonly expiresAtIso: string }
  | { readonly kind: "soon"; readonly expiresAtIso: string; readonly warning: string }
  | { readonly kind: "lapsed"; readonly expiresAtIso: string; readonly warning: string }
  | { readonly kind: "unreadable"; readonly expiresAtIso: string; readonly warning: string };

/**
 * Judge a grant's recorded refresh-token lapse against a clock reading.
 *
 * @param expiresAtIso the instant the grant recorded, absent when Google named no lapse
 * @param nowMs the clock, read by the caller's effectful edge
 * @param reconnectVerb the door's own `connect` command, which the warning names as the fix
 * @returns `none`, `ok`, `soon` (48 hours or less), `lapsed`, or `unreadable` for a value that is no instant
 */
export function refreshTokenLapse({
  expiresAtIso,
  nowMs,
  reconnectVerb,
}: {
  expiresAtIso: string | undefined;
  nowMs: number;
  reconnectVerb: string;
}): RefreshTokenLapse {
  if (expiresAtIso === undefined) {
    return { kind: "none" };
  }
  const expiresAtMs = parseStrictIsoInstantMs({ text: expiresAtIso });
  if (expiresAtMs === undefined) {
    return {
      expiresAtIso,
      kind: "unreadable",
      warning: `refresh token lapse ${expiresAtIso} is no instant, so when it stops working is unknown — re-run \`${reconnectVerb}\` to record it again`,
    };
  }
  if (expiresAtMs <= nowMs) {
    return {
      expiresAtIso,
      kind: "lapsed",
      warning: `refresh token lapsed at ${expiresAtIso} — re-run \`${reconnectVerb}\` to reconnect`,
    };
  }
  if (expiresAtMs - nowMs <= WARN_WITHIN_MS) {
    return {
      expiresAtIso,
      kind: "soon",
      warning: `refresh token lapses at ${expiresAtIso} — re-run \`${reconnectVerb}\` before then to reconnect`,
    };
  }
  return { expiresAtIso, kind: "ok" };
}

/**
 * The instant a refresh token lapses, from the consent instant and Google's lifetime. `undefined` when the sum is
 * past what a `Date` can hold, which a lifetime can be while still a safe integer of milliseconds.
 *
 * @param grantedAtMs the consent instant, the same clock read the grant's other times come from
 * @param lifetimeSeconds Google's `refresh_token_expires_in`
 * @returns the lapse instant, or `undefined` when no `Date` can represent it
 */
export function refreshTokenExpiresAtIso({
  grantedAtMs,
  lifetimeSeconds,
}: {
  grantedAtMs: number;
  lifetimeSeconds: number;
}): string | undefined {
  const expiresAtMs = grantedAtMs + lifetimeSeconds * 1000;
  if (!Number.isSafeInteger(expiresAtMs) || Math.abs(expiresAtMs) > MAX_TIME_VALUE_MS) {
    return undefined;
  }
  return new Date(expiresAtMs).toISOString();
}

/**
 * The grant's `refreshTokenExpiresAtIso`, from the same clock read as its other times: empty when Google named no
 * lifetime, as for a Production client, and `undefined` when the lapse is past what a `Date` can hold.
 *
 * @param grantedAtMs the consent instant
 * @param lifetimeSeconds Google's `refresh_token_expires_in`, when it sent one
 * @returns the field to spread onto the grant, or `undefined` when no instant can record it
 */
export function refreshLapseField({
  grantedAtMs,
  lifetimeSeconds,
}: {
  grantedAtMs: number;
  lifetimeSeconds: number | undefined;
}): { readonly refreshTokenExpiresAtIso?: string } | undefined {
  if (lifetimeSeconds === undefined) {
    return {};
  }
  const expiresAtIso = refreshTokenExpiresAtIso({ grantedAtMs, lifetimeSeconds });
  return expiresAtIso === undefined ? undefined : { refreshTokenExpiresAtIso: expiresAtIso };
}

/**
 * The one line a recorded lapse earns on `--status`, if any. The caller reads the clock only when a lapse is
 * recorded, so a grant without one behaves exactly as it did before lapses were recorded.
 *
 * @param expiresAtIso the grant's recorded lapse, absent when Google named none
 * @param readNowIso the clock seam, called at most once
 * @param reconnectVerb the door's own `connect` command, which the warning names as the fix
 * @returns the warning line, or `undefined` when there is nothing to warn about
 */
export function statusLapseWarning({
  expiresAtIso,
  readNowIso,
  reconnectVerb,
}: {
  expiresAtIso: string | undefined;
  readNowIso: () => string;
  reconnectVerb: string;
}): string | undefined {
  if (expiresAtIso === undefined) {
    return undefined;
  }
  const nowIso = readNowIso();
  const nowMs = parseStrictIsoInstantMs({ text: nowIso });
  if (nowMs === undefined) {
    return `the clock read ${nowIso}, which is no instant, so whether the refresh token has lapsed is unknown`;
  }
  const lapse = refreshTokenLapse({ expiresAtIso, nowMs, reconnectVerb });
  return lapse.kind === "none" || lapse.kind === "ok" ? undefined : lapse.warning;
}

/**
 * The landing report's notice for a grant that recorded a lapse: consent is the moment the owner can still move
 * the client to Production, so it is said regardless of how far away the lapse is.
 *
 * @param expiresAtIso the instant the new grant recorded
 * @param reconnectVerb the door's own `connect` command
 * @returns the notice line
 */
export function landingLapseNotice({
  expiresAtIso,
  reconnectVerb,
}: {
  expiresAtIso: string;
  reconnectVerb: string;
}): string {
  return (
    `Google set this refresh token to lapse at ${expiresAtIso}, which it does for an OAuth client whose consent ` +
    `screen is in Testing — re-run \`${reconnectVerb}\` before then, or publish the client to Production`
  );
}
