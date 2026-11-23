/**
 * Resolving the Make API token and zone from the secrets store, and saying honestly when there isn't one.
 *
 * Both live under `$SLOPWEAVER_HOME/secrets/`, written `0600` by `slopweaver secrets set`, and nowhere else:
 * no environment route, because the owner provisions this one by hand and a second route is a second place a
 * stale token hides. The seat never mints a token; an absent one is the expected starting state and answers
 * a typed `CREDENTIAL_MISSING` naming where it is minted and which files it goes in.
 *
 * The zone is not a secret — it is the regional host Make serves the organisation from — and is stored like
 * one only because every call is addressed through it. It is held to the zones Make publishes, so a typo can
 * never point the token at some other host.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { type MakeAtlasError, MakeAtlasErrors } from "./errors.js";

/** The secrets-store file the API token is written to. */
export const MAKE_TOKEN_SECRET = "make-api-token";

/** The secrets-store file the zone host is written to. */
export const MAKE_ZONE_SECRET = "make-zone";

/**
 * Every zone host Make documents for its public API (developers.make.com, API structure), and nothing else.
 * A host outside this set is refused before a token is ever sent to it.
 */
const MAKE_ZONES = [
  "eu1.make.com",
  "eu2.make.com",
  "us1.make.com",
  "us2.make.com",
  "eu1.make.celonis.com",
  "us1.make.celonis.com",
] as const;

export type MakeZone = (typeof MAKE_ZONES)[number];

/** A resolved credential: the token, and the zone it is valid on. */
export interface MakeCredential {
  readonly token: string;
  readonly zone: MakeZone;
}

/**
 * Whether a string is one of the published zones. The credential checks the zone file with it, and the
 * client's rail checks every request's host with it again.
 *
 * @param value the zone file's contents, or the host a client is about to address
 * @returns `true` when it names a zone this atlas addresses
 */
export function isMakeZone(value: string): value is MakeZone {
  return MAKE_ZONES.some((zone) => zone === value);
}

/**
 * The configured token alone, for a reader to strip from what it prints. A zone is not needed to know what to
 * strip, so a bad zone file does not stop it.
 *
 * @param home the state home whose `secrets/` directory holds the token file
 * @returns the token, `null` when none is configured, or `CREDENTIAL_UNREADABLE`
 */
export function configuredMakeToken({ home }: { home: string }): Result<string | null, MakeAtlasError> {
  return readSecretLine({ home, name: MAKE_TOKEN_SECRET });
}

/**
 * Resolve the token and zone from the secrets store under `home`.
 *
 * @param home the state home whose `secrets/` directory holds both files
 * @returns the credential, `CREDENTIAL_MISSING` naming every absent file, or `CREDENTIAL_UNREADABLE`
 */
export function resolveMakeCredential({ home }: { home: string }): Result<MakeCredential, MakeAtlasError> {
  const token = readSecretLine({ home, name: MAKE_TOKEN_SECRET });
  if (token.isErr()) {
    return err(token.error);
  }
  const zone = readSecretLine({ home, name: MAKE_ZONE_SECRET });
  if (zone.isErr()) {
    return err(zone.error);
  }
  // A refusal here prints only fixed text and secret NAMES, never what a file held. What that cannot close: a
  // token whose whole value equals some of that fixed text (`make-zone`, say) is printed as that text, and
  // no strip can tell the two apart without mangling the instruction. A token Make mints is a long random string.
  const missing = [
    token.value === null ? MAKE_TOKEN_SECRET : null,
    zone.value === null ? MAKE_ZONE_SECRET : null,
  ].filter((name): name is string => name !== null);
  if (token.value === null || zone.value === null) {
    return err(MakeAtlasErrors.credentialMissing({ missing }));
  }
  if (!isMakeZone(zone.value)) {
    return err(MakeAtlasErrors.zoneNotAllowed({ allowed: MAKE_ZONES }));
  }
  return ok({ token: token.value, zone: zone.value });
}

/**
 * Read one secret file, distinguishing "not there" from "there and unusable". A failure names the fs error
 * code alone, never Node's message: that message quotes the absolute path, and so the state home.
 *
 * @param home the state home whose `secrets/` directory holds the file
 * @param name the secrets-store name, which is all a failure prints
 * @returns the trimmed value, `null` when no file exists, or why the file could not be used
 */
function readSecretLine({ home, name }: { home: string; name: string }): Result<string | null, MakeAtlasError> {
  try {
    const value = readFileSync(secretFilePath({ home, name }), "utf8").trim();
    if (value.length === 0) {
      return err(MakeAtlasErrors.credentialUnreadable({ name, reason: "the file is empty" }));
    }
    return ok(value);
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (code === "ENOENT") {
      return ok(null);
    }
    if (code === null) {
      return err(MakeAtlasErrors.credentialUnreadable({ name, reason: "it could not be read" }));
    }
    return err(MakeAtlasErrors.credentialUnreadable({ name, reason: `it could not be read (${code})` }));
  }
}
