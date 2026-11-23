/**
 * How a raw token is normalised and matched to a person: the join keys the resolver and its readers share, and
 * the `identity resolve` lookup over a finished resolution. Pure, no deps — the ladder that BUILDS that
 * resolution is {@link ./personResolver.resolvePeople}, which imports these keys and nothing here imports back.
 */
import type { IdentityResolution, IdentitySource, Person, PersonIdentity } from "./identity.js";

/**
 * The `<source>:<nativeId>` index key for a source-native identity. Pure.
 *
 * @param source which system the identity came from
 * @param nativeId the id in that system
 * @returns the index key — source-qualified, so the same id in two systems stays two identities
 */
export function personIdentityKey({ source, nativeId }: { source: IdentitySource; nativeId: string }): string {
  return `${source}:${nativeId}`;
}

/**
 * Lower-case + trim an email for joining. Pure.
 *
 * @param email the raw address
 * @returns the normalised form used as a join key; only case and surrounding space are changed, never the
 *   local part, so two addresses that differ meaningfully never collapse into one person
 */
export function normaliseEmail({ email }: { email: string }): string {
  return email.trim().toLowerCase();
}

/**
 * Strip a leading `@`, then lower-case + trim a handle/native id for joining. Pure.
 *
 * @param handle the raw handle, with or without a leading `@`
 * @returns the normalised form used as a join key
 */
export function normaliseHandle({ handle }: { handle: string }): string {
  return (handle.startsWith("@") ? handle.slice(1) : handle).trim().toLowerCase();
}

/**
 * Lower-case, trim, and collapse internal whitespace in a display name for comparison. Pure.
 *
 * @param name the raw display name
 * @returns the normalised form — used for an EXACT comparison wherever an answer is being DECIDED, since
 *   guessing at who was meant is how the wrong person gets tagged. {@link ./nearMention} measures an edit
 *   distance over this same form, and is allowed to because nothing it returns resolves or addresses
 *   anyone: it suggests spellings to a reader who then re-runs the exact lookup.
 */
export function normaliseName({ name }: { name: string }): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Whether an identity matches a normalised needle by native id, handle, or name. */
function identityMatches({ identity, needle }: { identity: PersonIdentity; needle: string }): boolean {
  return (
    normaliseHandle({ handle: identity.nativeId }) === needle ||
    (identity.handle !== undefined && normaliseHandle({ handle: identity.handle }) === needle) ||
    (identity.name !== undefined && normaliseName({ name: identity.name }) === needle)
  );
}

/**
 * What a raw token resolved to. `ambiguous` is a first-class answer rather than an error, because the
 * question "who is `chris`?" genuinely has more than one answer and the caller must be able to say so —
 * returning one of them is the failure this type exists to make unrepresentable.
 */
export type RawPersonResolution =
  | { readonly kind: "resolved"; readonly person: Person }
  | { readonly kind: "ambiguous"; readonly people: readonly Person[] }
  | { readonly kind: "unknown" };

/**
 * Find the canonical Person a raw handle/id belongs to — the `identity resolve` lookup. Prefers an exact
 * `(source, nativeId)` index hit, which is unambiguous by construction; failing that it scans every identity
 * for a native-id/handle/name match and reports EVERY person it matched. Pure.
 *
 * The scan can match on `name`, which is why it must not pick: a display name is owned by more than one
 * person often enough that first-hit-wins would answer "who is this?" confidently and wrongly. The name tier
 * is HELD by {@link ./personResolver.resolvePeople} for the same reason, and this is where that discipline was missing.
 *
 * @param raw the raw token (with or without a leading `@`)
 * @param source narrow the exact-hit lookup to one source (optional)
 * @returns the single owning person, the several it could be, or `unknown` — never an arbitrary pick
 */
export function resolvePersonForRaw({
  resolution,
  raw,
  source,
}: {
  resolution: IdentityResolution;
  raw: string;
  source?: IdentitySource;
}): RawPersonResolution {
  const bare = raw.startsWith("@") ? raw.slice(1) : raw;
  if (source !== undefined) {
    const id = resolution.index.get(personIdentityKey({ nativeId: bare, source }));
    const hit = id !== undefined ? resolution.people.find((p) => p.id === id) : undefined;
    if (hit !== undefined) {
      return { kind: "resolved", person: hit };
    }
  }
  const needle = normaliseHandle({ handle: bare });
  const matched = resolution.people.filter((p) =>
    p.identities.some((identity) => identityMatches({ identity, needle })),
  );
  const first = matched[0];
  if (first === undefined) {
    return { kind: "unknown" };
  }
  return matched.length === 1 ? { kind: "resolved", person: first } : { kind: "ambiguous", people: matched };
}
