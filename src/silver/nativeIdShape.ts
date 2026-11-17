/**
 * Per-source native-id SHAPE — the mechanical form of "a display name is never an identity".
 *
 * The resolver keys a person within a source on `nativeId`, and a join is only as trustworthy as that key.
 * Two of the four connectors hand a projection a display NAME where a native id belongs (Slack's `file`/`pin`
 * records resolve the uploader through the id→name map; Linear's GraphQL selection asks users for
 * `displayName` and never their `id`), and a name-keyed identity is both a duplicate of the real person and,
 * because two humans can share a name, a path by which two humans collapse into one.
 *
 * So the shape is checked rather than assumed. This module answers only "could this string be a native id in
 * that source" — never "who is this", which is the resolver's job.
 *
 * The asymmetry between sources is real and deliberate, not an oversight: Slack, Linear and Notion issue
 * opaque structured ids, so a name is distinguishable from an id by inspection. **GitHub's native id IS its
 * login**, which is name-shaped by design — so the check there can only reject what no login may contain
 * (whitespace above all), and a GitHub login that looks like a person's name is legitimate.
 */
import type { IdentitySource } from "./identity.js";

/**
 * Slack user/bot ids: `U…` (user), `W…` (enterprise user), `B…` (bot). Upper-case alphanumeric throughout.
 * Anchored and bounded, so there is no backtracking to exploit.
 */
const SLACK_NATIVE_ID = /^[UWB][A-Z0-9]{2,}$/;

/** A Linear/Notion UUID, dashed or bare — both forms appear across the two providers' payloads. */
const UUID_NATIVE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/**
 * A GitHub login: alphanumeric with single inner hyphens, 39 chars max, plus the `name[bot]` form GitHub
 * Apps present. Deliberately permissive — a login is name-shaped, so this rejects only what a login cannot
 * be, and the character class carries no overlap for a backtracking engine to explore.
 */
const GITHUB_NATIVE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;

/**
 * The `self` source — this machine's own repository and docs — has exactly one author, and it is the owner.
 * Its records carry the sentinel `me`, the same value `profile.json` uses for `id`, so that ONE string is the
 * whole native-id space. Anything else under `self` is not an identity.
 */
const SELF_NATIVE_ID = "me";

/**
 * Whether a string could be `source`'s own native id for a person.
 *
 * A `false` means the value is something else — almost always a display name — and must therefore never
 * become a `nativeId`. It does NOT mean the person is unknown; it means this string is not the key to find
 * them by.
 *
 * @param source the system the id would belong to
 * @param value the candidate id, exactly as the connector supplied it
 * @returns true when the value has the shape that source issues for a person, false for anything else
 *   (a display name, an empty string, a sentence) — see the module note on why GitHub is the loosest
 */
export function isNativeIdShaped({ source, value }: { source: IdentitySource; value: string }): boolean {
  switch (source) {
    case "slack":
      return SLACK_NATIVE_ID.test(value);
    case "linear":
    case "notion":
      return UUID_NATIVE_ID.test(value);
    case "github":
      return GITHUB_NATIVE_ID.test(value);
    case "self":
      return value === SELF_NATIVE_ID;
    case "gmail":
      // Gmail's native id for a person is their email address, and a mail record deliberately never carries
      // one: the bronze write path scrubs every address, and a mail record's `author` is the sender's
      // display name (see `corpus/gmail/project.ts`). So there is no value under this source that IS a
      // native id, and saying so is the honest answer rather than inventing a shape for a field that has none.
      return false;
    case "calendar":
      // The same answer as Gmail's, for the same reason: a calendar's native id for a person is their email
      // address, and the bronze write path scrubs every address before a record reaches disk. A calendar
      // record's `author` is the organiser's display name, else their address's local part
      // (`corpus/personName.ts`), so no value under this source IS a native id.
      return false;
    case "outlook":
      // Gmail's answer, for Gmail's reason: a sender's native id is their address, which the bronze write path
      // scrubs; the record's `author` is a display name or a local part (`corpus/personName.ts`).
      return false;
    case "outlook-calendar":
      // The Google diary's answer, for the same reason: an Outlook attendee's native id is their address, which
      // the bronze write path scrubs; the record's `author` is the organiser's name (`corpus/personName.ts`).
      return false;
    case "fathom":
      // The same answer as Gmail's and the diary's, and for the same reason: Fathom's native id for a person
      // is their email address, and the bronze write path scrubs every address before a record reaches disk.
      // A recorded call's `author` is the recorder's or host's display name, else their address's local part
      // (`corpus/personName.ts`), never the address.
      return false;
    case "chatgpt":
      // A chat has two parties and neither is a person in the directory's sense: the account's owner and the
      // assistant. A chat record's `author` is the ROLE (`corpus/chatHistory/project.ts`), so no value under
      // this source IS a native id.
      return false;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}
