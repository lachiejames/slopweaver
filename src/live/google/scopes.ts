/**
 * How a Google door decides whether a stored grant is wide enough for the verb about to run — the machinery
 * only, with no product's vocabulary in it.
 *
 * Each door (`src/live/gmail/scopes.ts`, `src/live/drive/scopes.ts`) declares its own capability names, the
 * scope URI each one maps to, and which OTHER scopes satisfy it by implication. Those three facts are the
 * whole difference between the doors; the four functions that read them are identical, so they live here
 * once. Splitting it the other way — a shared capability union — would force mail vocabulary into the Drive
 * door and vice versa, which is exactly the cross-domain merge `.claude/rules/error-handling.md` refuses for
 * errors and the same argument applies to grants.
 *
 * Pure: no I/O, no clock.
 */

/**
 * One door's scope vocabulary: what each capability is granted as, and what else already covers it.
 *
 * `impliedBy` is not decoration — Google's own scopes nest. `gmail.modify` covers `gmail.readonly`, and
 * `drive.readonly` covers `drive.metadata.readonly`, so a grant carrying the wider one must not be told to
 * re-consent for the narrower. The reverse never holds, which is why the table is one-directional.
 */
export interface GoogleScopeTable<TCapability extends string> {
  /** The scope URI requested for each capability. */
  readonly scopes: Readonly<Record<TCapability, string>>;
  /** The OTHER scope URIs that already satisfy each capability. */
  readonly impliedBy: Readonly<Record<TCapability, readonly string[]>>;
  /**
   * The capability that binds the account — always requested, so `connect` can say which account it bound
   * to. Every Google door needs one, and a door that omitted it would store a grant it could not name.
   */
  readonly identity: TCapability;
}

/**
 * Split a Google `scope` string (space-separated) into a normalised list.
 *
 * @param scope the raw scope string from a token response, or undefined when the response carried none
 * @returns every distinct scope URI, empty when nothing was granted
 */
export function parseGrantedScopes({ scope }: { scope: string | undefined }): readonly string[] {
  if (scope === undefined) {
    return [];
  }
  return [...new Set(scope.split(/\s+/).filter((item) => item.length > 0))];
}

/**
 * Whether a granted scope set satisfies one capability, honouring the table's implications.
 *
 * @param granted the scope URIs the stored grant carries
 * @param capability the capability being checked
 * @param table the door's own scope vocabulary
 * @returns true when the grant covers the capability outright or by implication
 */
export function satisfiesCapability<TCapability extends string>({
  granted,
  capability,
  table,
}: {
  granted: readonly string[];
  capability: TCapability;
  table: GoogleScopeTable<TCapability>;
}): boolean {
  const accepted = [table.scopes[capability], ...table.impliedBy[capability]];
  return accepted.some((scope) => granted.includes(scope));
}

/**
 * The scopes a grant is MISSING for a set of capabilities, named by each capability's own primary scope so
 * the message tells a reader what to approve rather than what would have implied it.
 *
 * @param granted the scope URIs the stored grant carries
 * @param capabilities every capability the verb needs
 * @param table the door's own scope vocabulary
 * @returns the primary scope URI of each unsatisfied capability, in declaration order
 */
export function missingScopes<TCapability extends string>({
  granted,
  capabilities,
  table,
}: {
  granted: readonly string[];
  capabilities: readonly TCapability[];
  table: GoogleScopeTable<TCapability>;
}): readonly string[] {
  return capabilities
    .filter((capability) => !satisfiesCapability({ capability, granted, table }))
    .map((capability) => table.scopes[capability]);
}

/**
 * The scopes that bind an account and reach nothing else — read-only by what they are rather than by a
 * suffix, so {@link notReadOnlyScopes} has to name them.
 */
const IDENTITY_SCOPES: ReadonlySet<string> = new Set([
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Microsoft's: `offline_access` asks for a refresh token and reaches no data of its own.
  "offline_access",
]);

/**
 * Microsoft Graph's own spelling of a read scope — `Mail.Read`, `User.Read`, `Mail.ReadBasic`, bare or under
 * the `https://graph.microsoft.com/` resource. `Mail.ReadWrite` does not match, because the suffix is the
 * whole last segment.
 */
const GRAPH_READ_SCOPE = /^(?:https:\/\/graph\.microsoft\.com\/)?[A-Za-z]+\.(?:Read|ReadBasic)$/;

/**
 * Every scope in a grant that is not PROVABLY read-only — what `secrets status` derives a grant's label
 * from, and what the Google Admin door refuses to store.
 *
 * Provable means an identity scope, a `.readonly`/`.read-only` suffix (Google's spelling of a read scope), or
 * a `.Read`/`.ReadBasic` last segment (Microsoft Graph's). Anything else is counted, including a read scope a
 * provider spelled some other way: an unknown is not-provably-read-only, never assumed safe, which is the
 * direction a false reading should fail in.
 *
 * @param scopes the scope URIs a stored grant carries
 * @returns the scopes that could write, in the order given
 */
export function notReadOnlyScopes({ scopes }: { scopes: readonly string[] }): readonly string[] {
  return scopes.filter(
    (scope) =>
      !IDENTITY_SCOPES.has(scope) &&
      !scope.endsWith(".readonly") &&
      !scope.endsWith(".read-only") &&
      !GRAPH_READ_SCOPE.test(scope),
  );
}

/**
 * The scope URIs to REQUEST for a set of capabilities, with the table's identity capability always first so
 * the consent screen leads with the account being bound.
 *
 * @param capabilities the capabilities the caller wants to be able to use
 * @param table the door's own scope vocabulary
 * @returns the deduplicated scope URIs, identity first
 */
export function scopesToRequest<TCapability extends string>({
  capabilities,
  table,
}: {
  capabilities: readonly TCapability[];
  table: GoogleScopeTable<TCapability>;
}): readonly string[] {
  return [...new Set([table.scopes[table.identity], ...capabilities.map((capability) => table.scopes[capability])])];
}
