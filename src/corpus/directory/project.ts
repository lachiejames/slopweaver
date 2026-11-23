/**
 * The pure projection from one Google Admin `users.list` payload to a {@link DirectoryUserRow}.
 *
 * Tolerant of shape rather than typed against the SDK: the row keeps the whole payload as `raw`, so a field
 * this projection does not know about is retained rather than lost, and a field it does know about is
 * read defensively so one odd user never sinks the pull.
 */
import { isRecord } from "../../lib/parsers.js";
import { normalizeEmail } from "../../store/identity/matching.js";
import { redactMemberRawValue } from "../members/redact.js";

import type { DirectoryUserRow } from "./types.js";

/**
 * A string field off an untyped bag, or `undefined` when absent or empty.
 *
 * @param bag the object to read
 * @param key the field name
 * @returns the non-empty string, or `undefined`
 */
function str({ bag, key }: { bag: unknown; key: string }): string | undefined {
  if (!isRecord(bag)) {
    return undefined;
  }
  const value = bag[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A boolean field off an untyped bag, defaulting when absent.
 *
 * @param bag the object to read
 * @param key the field name
 * @param fallback the value when the field is not a boolean
 * @returns the field, or the fallback
 */
function bool({ bag, key, fallback }: { bag: unknown; key: string; fallback: boolean }): boolean {
  if (!isRecord(bag)) {
    return fallback;
  }
  const value = bag[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * An array field off an untyped bag, or an empty one when absent or not an array.
 *
 * @param bag the object to read
 * @param key the field name
 * @returns the array
 */
function list({ bag, key }: { bag: unknown; key: string }): readonly unknown[] {
  if (!isRecord(bag)) {
    return [];
  }
  const value = bag[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Every alias Google routes to this user's mailbox, normalised and sorted.
 *
 * @param user the user object as Google returned it
 * @returns the normalised aliases
 */
function normalisedAliases({ user }: { user: unknown }): readonly string[] {
  return list({ bag: user, key: "aliases" })
    .filter((alias): alias is string => typeof alias === "string" && alias.length > 0)
    .map((alias) => normalizeEmail({ email: alias }))
    .toSorted();
}

/**
 * Project one Google Workspace user into a directory row, or say why it cannot be one.
 *
 * A user with no `id` or no `primaryEmail` is refused rather than stored: the first is the row key and the
 * second is the person key, and a row carrying neither can never be matched to anything.
 *
 * @param user the user object as Google returned it
 * @param fetchedAtIso when this pull ran
 * @returns the row, or the reason the user was skipped
 */
export function projectDirectoryUser({
  user,
  fetchedAtIso,
}: {
  user: unknown;
  fetchedAtIso: string;
}): { row: DirectoryUserRow } | { skipped: string } {
  const googleId = str({ bag: user, key: "id" });
  const primaryEmail = str({ bag: user, key: "primaryEmail" });
  if (googleId === undefined) {
    return { skipped: "no id" };
  }
  if (primaryEmail === undefined) {
    return { skipped: `user ${googleId} has no primaryEmail` };
  }
  const name = isRecord(user) ? user["name"] : undefined;
  const givenName = str({ bag: name, key: "givenName" });
  const familyName = str({ bag: name, key: "familyName" });
  const declaredFullName = str({ bag: name, key: "fullName" });
  let fullName = [givenName, familyName].filter(Boolean).join(" ");
  if (declaredFullName !== undefined) {
    fullName = declaredFullName;
  }
  const title = str({ bag: list({ bag: user, key: "organizations" })[0], key: "title" });
  const orgUnitPath = str({ bag: user, key: "orgUnitPath" });
  const creationIso = str({ bag: user, key: "creationTime" });
  const lastLoginIso = str({ bag: user, key: "lastLoginTime" });
  return {
    row: {
      aliases: normalisedAliases({ user }),
      archived: bool({ bag: user, fallback: false, key: "archived" }),
      emailNormalised: normalizeEmail({ email: primaryEmail }),
      fetchedAtIso,
      ...(familyName === undefined ? {} : { familyName }),
      fullName: fullName.length > 0 ? fullName : primaryEmail,
      ...(givenName === undefined ? {} : { givenName }),
      googleId,
      isAdmin: bool({ bag: user, fallback: false, key: "isAdmin" }),
      ...(creationIso === undefined ? {} : { creationIso }),
      ...(lastLoginIso === undefined ? {} : { lastLoginIso }),
      ...(orgUnitPath === undefined ? {} : { orgUnitPath }),
      primaryEmail,
      raw: redactMemberRawValue({ value: user }),
      suspended: bool({ bag: user, fallback: false, key: "suspended" }),
      ...(title === undefined ? {} : { title }),
      version: 1,
    },
  };
}
