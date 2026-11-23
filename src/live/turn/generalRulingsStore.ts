/**
 * The effectful edge that reads the owner's general rulings out of `$SLOPWEAVER_HOME`. The shape is in
 * `./generalRulings.ts` and is pure; this file only turns bytes into one of its states, exactly as
 * `../listen/trustedTierStore.ts` does for the trusted tier.
 *
 * Read-only, with no seed and no fallback: an absent file is no rulings, and the file is written by whoever
 * records a ruling the owner made, never by this code.
 */
import { readFileSync } from "node:fs";

import { isAbsentError } from "#lib/presentFile.js";

import { parseJson } from "../../lib/jsonParse.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stateHomePaths } from "../../stateHome.js";
import { GENERAL_RULINGS_FILE, type GeneralRulings, parseGeneralRulings } from "./generalRulings.js";

/**
 * Load the general rulings for a state home. Never throws.
 *
 * @param home the Slopweaver home holding the rulings' file
 * @returns the loaded rulings, in whichever of their states this machine is in
 */
export function loadGeneralRulings({ home }: { home: string }): GeneralRulings {
  const path = stateHomePaths({ home }).generalRulingsJson;
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readGeneralRulings", path });
  // Absent only when the read itself says so: `existsSync` answers false on a permission error too, which would draw
  // a file the owner holds rulings in as one with none.
  if (read.isErr() && isAbsentError({ error: read.error.cause, path })) {
    return { kind: "absent" };
  }
  if (read.isErr()) {
    return { kind: "unreadable", why: `${GENERAL_RULINGS_FILE} exists but could not be read: ${read.error.message}` };
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return { kind: "unreadable", why: `${GENERAL_RULINGS_FILE} is not valid JSON` };
  }
  const parsed = parseGeneralRulings({ value: decoded.value });
  if (parsed.isErr()) {
    return { kind: "unreadable", why: parsed.error.join("; ") };
  }
  return { kind: "list", rulings: parsed.value };
}
