/**
 * The effectful edge that reads the responder whitelist out of `$SLOPWEAVER_HOME`. The decision itself is
 * in `./whitelist.ts` and is pure; this file only turns bytes into one of its states.
 *
 * ## Why the list is not in this repository, and where it is instead
 *
 * It is a list of real Slack user ids, and this is a public repository. So it lives under the home, in
 * `responders.json`, alongside the other files that hold a real identifier (`profile.json`; the identity
 * roster, once a file here, is a row in the store now) — the path is declared once, in `stateHome.ts`, like every other persisted path. Nothing
 * in the repo ever contains one.
 *
 * ## There is no fallback, of any kind
 *
 * An absent file is not seeded, not derived from `profile.json`, and not templated by `stateInit`. It is a
 * closed state that refuses everyone, including the owner, until a real two-entry file is written — an
 * operational step, never something this code does on its own. That is deliberately simpler than an
 * earlier draft of this feature, which tried to fall back to a profile-derived seed: on a machine that has
 * not been fully onboarded, that fallback would silently produce ONE identity where the owner asked for
 * exactly two, which is a worse failure than refusing everyone until the file is written by hand.
 *
 * ## What counts as unreadable
 *
 * Only "the file is not there" is `absent`. A file that exists and cannot be read, is not JSON, or does
 * not validate is `unreadable` — refusing everyone loudly — rather than quietly falling back to anything.
 *
 * This file stays read-only, as above: THIS module never writes. `./whitelistWrite.ts` is the one real,
 * deliberate write path — `slopweaver responders add`/`remove`, never a silent seed or fallback.
 */
import { parseJson } from "../../lib/jsonParse.js";
import { readStrictFileIfPresent } from "../../lib/presentFile.js";
import { stateHomePaths } from "../../stateHome.js";
import { parseResponderWhitelist, RESPONDER_WHITELIST_FILE, type ResponderWhitelist } from "./whitelist.js";

/**
 * Load the responder whitelist for a state home.
 *
 * Never throws and never returns anything resembling "open": the three outcomes are the file's list,
 * `absent` (no file at all — refuses everyone), and `unreadable` (the file exists and is broken — also
 * refuses everyone, loudly). Every caller reads it per use rather than holding a copy: `listen` calls this once
 * per addressed mention, so a `responders add` admits on the very next tag with no listener restart.
 *
 * @param home the Slopweaver home holding `responders.json`
 * @returns the loaded gate, in whichever of its states this machine is in
 */
export function loadResponderWhitelist({ home }: { home: string }): ResponderWhitelist {
  const path = stateHomePaths({ home }).respondersJson;
  // Absent only when genuinely not there: an EACCES on the way, or a dangling link, is unreadable — `existsSync`
  // answered false for both and read a broken install as a fresh one.
  const read = readStrictFileIfPresent({ operation: "readResponderWhitelist", path });
  if (read.isErr()) {
    return {
      kind: "unreadable",
      why: `${RESPONDER_WHITELIST_FILE} could not be read: ${read.error.message}`,
    };
  }
  if (read.value === null) {
    return { kind: "absent" };
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return { kind: "unreadable", why: `${RESPONDER_WHITELIST_FILE} is not valid JSON` };
  }
  const parsed = parseResponderWhitelist({ value: decoded.value });
  if (parsed.isErr()) {
    return { kind: "unreadable", why: parsed.error.join("; ") };
  }
  return { identities: parsed.value, kind: "list" };
}
