/**
 * Pure field readers shared by the member connectors (projecting a raw SDK object into a typed
 * {@link MemberBronzeRow}) and by the store (parsing a persisted row back). Centralising them keeps the
 * curated `identity`/`profile` projection defined in exactly one place — no casts, every field defensive.
 */

import { isRecord } from "../../lib/parsers.js";
import type { IdentitySource } from "../../silver/identity.js";
import { optStr } from "../slack/shape.js";
import type { EmailTrust, MemberIdentityFields, MemberProfileFields } from "./types.js";

/**
 * A boolean off an unknown, else `undefined` (so a missing flag stays absent, not a fake `false`). Pure.
 *
 * @param value the raw field, of unvalidated shape
 * @returns the boolean, or undefined — never coerced, so "not stated" stays distinct from "false"
 */
export function optBool({ value }: { value: unknown }): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * A string list off an unknown (non-strings dropped), else `undefined` when absent/empty. Pure.
 *
 * @param value the raw field, of unvalidated shape
 * @returns the strings, or undefined when the field is absent or yields none — an empty list is reported as
 *   absent so a caller cannot tell them apart, which is deliberate for an optional field
 */
function optStrList({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return list.length > 0 ? list : undefined;
}

/** Whether a value is one of the trust tiers (defensive parse-back). Positional — used as a guard. */
function isEmailTrust(value: unknown): value is EmailTrust {
  return value === "trusted" || value === "weak" || value === "missing";
}

/**
 * Read a persisted/curated {@link MemberIdentityFields} off a raw object (defensive, no cast). Pure.
 *
 * @param value the raw object, which may be a fresh API shape or a row read back off disk
 * @param source the source the member belongs to, supplied rather than inferred from the payload
 * @returns the identity fields, with anything unreadable omitted rather than guessed
 */
export function readMemberIdentity({
  value,
  source,
}: {
  value: unknown;
  source: IdentitySource;
}): MemberIdentityFields {
  const obj = isRecord(value) ? value : {};
  const handle = optStr({ value: obj["handle"] });
  const name = optStr({ value: obj["name"] });
  const email = optStr({ value: obj["email"] });
  const emailNormalised = optStr({ value: obj["emailNormalised"] });
  return {
    emailTrust: isEmailTrust(obj["emailTrust"]) ? obj["emailTrust"] : "missing",
    // A stored row always carries a nativeId (the store validated it on write); a corrupt/absent one
    // degrades to "" honestly (it matches nothing) rather than coalescing a fake — see the fail-loud rule.
    nativeId: typeof obj["nativeId"] === "string" ? obj["nativeId"] : "",
    source,
    ...(handle !== undefined ? { handle } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(emailNormalised !== undefined ? { emailNormalised } : {}),
  };
}

/**
 * Read a persisted/curated {@link MemberProfileFields} off a raw object (defensive, no cast). Pure.
 *
 * @param value the raw object, of unvalidated shape
 * @returns the profile fields, with anything unreadable omitted rather than guessed
 */
export function readMemberProfile({ value }: { value: unknown }): MemberProfileFields {
  const obj = isRecord(value) ? value : {};
  const title = optStr({ value: obj["title"] });
  const timezone = optStr({ value: obj["timezone"] });
  const avatarUrl = optStr({ value: obj["avatarUrl"] });
  const avatar48Url = optStr({ value: obj["avatar48Url"] });
  const avatar72Url = optStr({ value: obj["avatar72Url"] });
  const teams = optStrList({ value: obj["teams"] });
  const active = optBool({ value: obj["active"] });
  const admin = optBool({ value: obj["admin"] });
  const guest = optBool({ value: obj["guest"] });
  const bot = optBool({ value: obj["bot"] });
  return {
    ...(title !== undefined ? { title } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(avatar48Url !== undefined ? { avatar48Url } : {}),
    ...(avatar72Url !== undefined ? { avatar72Url } : {}),
    ...(teams !== undefined ? { teams } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(admin !== undefined ? { admin } : {}),
    ...(guest !== undefined ? { guest } : {}),
    ...(bot !== undefined ? { bot } : {}),
  };
}
