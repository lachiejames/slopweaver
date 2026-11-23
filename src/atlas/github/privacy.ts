/**
 * The field-level boundary: which GitHub values this atlas stores, and which it refuses.
 *
 * ## A route allowlist does not protect an atlas
 *
 * `inventory.ts` closes which calls may be made. It says nothing about what comes back, and a GitHub
 * settings payload carries a great deal the atlas has no question for. So admission is decided per FIELD in
 * `projection.ts`, which reads only what it names, and this file holds the two reductions that turn a value
 * into something safe to keep rather than dropping it.
 *
 * ## Why this file is small, and why that is the design rather than a gap
 *
 * The sibling atlases carry a denial LIST because they store provider payloads wholesale and need a filter
 * over them. This one does not store a payload at all: `entities.ts` is a closed set of strict schemas, and
 * `projection.ts` reaches into a response for exactly the fields those schemas declare. A field GitHub adds
 * next month is not dropped by a denial — it is never read. That is a stronger boundary than a list, and it
 * is why the only things here are the two cases where a field must be KEPT and TRANSFORMED.
 *
 * ## The two transformations, and what each is protecting against
 *
 * A **webhook destination** is reduced to an origin and a path shape. This is not tidiness: a webhook URL
 * routinely carries its own credential — several providers authenticate an incoming hook by a token in the
 * path or the query — so storing the URL whole would put a working secret into a local ground truth by
 * accident, in a field nobody would think to look at. The origin answers "where does our activity go", which
 * is the question, and the path shape answers "is this the same destination as that one" without the token.
 *
 * A **deploy key** is reduced to a fingerprint. The public half of a key is not a secret and it is still not
 * kept: the atlas's question is "what non-human write access exists on this repository", which a fingerprint
 * answers exactly and joinably, and holding key material for no question at all is how a store accumulates
 * things it later has to explain.
 */
import { createHash } from "node:crypto";

/**
 * A webhook destination reduced to an origin and a digest of its path.
 *
 * ## Why the path becomes a DIGEST rather than a shape
 *
 * A first version kept the path with value-looking segments replaced, on an allowlist of route words. A
 * review then pointed at the case the allowlist cannot see: a webhook path token that happens to be all
 * lowercase — `/hook/lowercasebearer` — is indistinguishable from a route word, and several providers
 * authenticate an incoming hook by exactly such a token in the path. There is no pattern that separates
 * them, because there is no difference to find.
 *
 * So nothing from the path is kept. The origin answers "where does our activity go", which is the question
 * this atlas has; the digest answers "is this the same destination as that one", which is the only other
 * thing a reader needs, and answers it exactly. What is given up is being able to read the path in the
 * generation — a real loss, taken deliberately, because the alternative is a store that can hold a working
 * credential in a field nobody would think to look at.
 *
 * @param url the destination as GitHub reports it
 * @returns the origin and a 64-character digest of the path and query, or nulls when the destination is not
 *   a URL this can read
 */
export function reduceWebhookDestination({ url }: { url: string | null }): {
  origin: string | null;
  pathDigest: string | null;
} {
  if (url === null || url.length === 0) {
    return { origin: null, pathDigest: null };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { origin: null, pathDigest: null };
  }
  // `origin` drops any user-info the URL carried, which is the other place a credential hides.
  return {
    origin: parsed.origin,
    pathDigest: createHash("sha256").update(`${parsed.pathname}${parsed.search}`).digest("hex"),
  };
}

/**
 * What a credential-shaped string looks like, for the one field this atlas admits that an operator writes
 * free text into.
 *
 * Not a general-purpose secret scanner and not trying to be. It exists because a custom property's
 * ENUMERATED DOMAIN is schema and belongs in the atlas, while the strings in it are whatever somebody
 * typed — and a review found that the sibling field, a property's default VALUE, would publish a token
 * verbatim. That field is gone; this screens the one that had to stay.
 *
 * The prefixes are GitHub's own published token formats, so a hit is a strong signal rather than a guess.
 * The two length rules catch the shape a token has when it is not one of those: a 32-or-more hex run, and
 * any unbroken 24-or-more run of base64url characters. The hex rule exists because a review's counterexample
 * was exactly a 32-character hex bearer, which an earlier 40-character floor let through.
 *
 * **The residue, stated rather than discovered.** This is a heuristic over free text and cannot be complete:
 * a short, word-shaped credential is indistinguishable from a legitimate allowed value, because there is no
 * difference to find. What bounds the harm is that this is the ONLY free-text field the atlas admits — a
 * property's default value was removed entirely rather than screened, and a webhook's path is digested
 * rather than shaped, both because for those the screening could be avoided altogether. Here it could not,
 * since an enumerated domain IS the schema, and the honest thing is to say the screening is partial.
 */
const CREDENTIAL_SHAPED =
  /^(?:gh[pousr]_|github_pat_|xox[abposr]-|sk-|AKIA)|^[0-9a-fA-F]{32,}$|^[A-Za-z0-9+/_-]{24,}={0,2}$/;

/**
 * Whether a string looks like a credential somebody pasted where a value was expected.
 *
 * @param value the candidate string
 * @returns whether to refuse it
 */
export function looksLikeCredential({ value }: { value: string }): boolean {
  return CREDENTIAL_SHAPED.test(value.trim());
}

/**
 * The strings safe to store, with anything credential-shaped dropped.
 *
 * Dropped rather than redacted to a placeholder: a placeholder in an enumerated domain would read as a
 * legitimate allowed value, and a reader comparing a ruleset against it would be comparing against a value
 * that does not exist.
 *
 * @param values the operator-authored strings
 * @returns those that are not credential-shaped, in the order given
 */
export function withoutCredentialShaped({ values }: { values: readonly string[] }): string[] {
  return values.filter((value) => !looksLikeCredential({ value }));
}

/**
 * A deploy key reduced to a stable fingerprint.
 *
 * SHA-256 over the key material as GitHub reports it, so two repositories sharing one key produce the same
 * fingerprint and are joinable — which is the actual question, since a key reused across repositories is
 * the finding worth having.
 *
 * @param key the public key as GitHub reports it
 * @returns a 64-character hex digest, or `null` when there is no key to digest
 */
export function deployKeyFingerprint({ key }: { key: string | null }): string | null {
  if (key === null || key.trim().length === 0) {
    return null;
  }
  return createHash("sha256").update(key.trim()).digest("hex");
}
