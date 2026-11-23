/**
 * The effectful edge that reads the trusted tier out of `$SLOPWEAVER_HOME`. The verdict is in
 * `./trustedTier.ts` and is pure; this file only turns bytes into one of its states, exactly as
 * `./whitelistStore.ts` does for the who-may-tag list.
 *
 * Read-only, with no seed and no fallback: an absent file is nobody on the tier, and the file is written by
 * whoever settles the owner's answer to the membership briefing, never by this code.
 */
import { existsSync, readFileSync } from "node:fs";

import { parseJson } from "../../lib/jsonParse.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stateHomePaths } from "../../stateHome.js";
import { parseTrustedTier, TRUSTED_TIER_FILE, type TrustedTier } from "./trustedTier.js";

/**
 * Load the trusted tier for a state home. Never throws.
 *
 * @param home the Slopweaver home holding the tier's file
 * @returns the loaded tier, in whichever of its states this machine is in
 */
export function loadTrustedTier({ home }: { home: string }): TrustedTier {
  const path = stateHomePaths({ home }).trustedAskersJson;
  if (!existsSync(path)) {
    return { kind: "absent" };
  }
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readTrustedTier", path });
  if (read.isErr()) {
    return { kind: "unreadable", why: `${TRUSTED_TIER_FILE} exists but could not be read: ${read.error.message}` };
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return { kind: "unreadable", why: `${TRUSTED_TIER_FILE} is not valid JSON` };
  }
  const parsed = parseTrustedTier({ value: decoded.value });
  if (parsed.isErr()) {
    return { kind: "unreadable", why: parsed.error.join("; ") };
  }
  return { identities: parsed.value, kind: "list" };
}
