/**
 * The one rule for what a bronze record's `author` may hold when a provider names a person by email address:
 * their display name, else the address's local part, and NEVER the address itself.
 *
 * A local part is the same class of identifier as a Slack handle or a GitHub login — it names a person
 * without carrying the route to them — and it is the only name a bare address has. The mail, diary and
 * recorded-call projections all reach for this, so `author` means the same thing under every source whose
 * native id for a person is an email address. {@link ./redactRecord.redactRecord} scrubs an address that
 * reaches `author` anyway; this is what keeps one from reaching it, so a name survives where the scrub
 * would leave only `[email]`.
 *
 * Pure.
 */

/** The text before a value's first `@`, trimmed and stripped of surrounding double quotes; `""` when none. */
function localPart({ value }: { value: string }): string {
  // `String.split` always yields at least one element, so the assertion is honest rather than hopeful.
  const head = value.split("@")[0]!.trim();
  const unquoted = head.length >= 2 && head.startsWith('"') && head.endsWith('"') ? head.slice(1, -1) : head;
  return unquoted.trim();
}

/**
 * The name to store for a person a provider identifies by address.
 *
 * The result NEVER contains an `@`. A display name holding one is not trusted as a name — the writer would
 * scrub an address in it down to `[email]`, a quoted local part (`"boss"@example.test`) included — so the
 * address's local part is used instead, and the display name's own when there is no address.
 *
 * @param displayName the name the provider shows for them, when it carried one
 * @param address their email address, when the provider carried one
 * @returns the trimmed display name, else a local part, else undefined when neither names anyone
 */
export function personName({
  displayName,
  address,
}: {
  displayName: string | undefined;
  address: string | undefined;
}): string | undefined {
  const name = displayName === undefined ? "" : displayName.trim();
  if (name.length > 0 && !name.includes("@")) {
    return name;
  }
  const candidates = [address, name.length > 0 ? name : undefined];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const local = localPart({ value: candidate });
    if (local.length > 0) {
      return local;
    }
  }
  return undefined;
}
