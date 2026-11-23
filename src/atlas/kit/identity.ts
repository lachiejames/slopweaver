/**
 * Stable identity for an accumulated entity or gap, independent of any one sync run.
 *
 * An identity must survive every later sync, because accumulate-never-replace is expressed as "the same id
 * merges". So it is derived from the provider's own immutable identifiers and nothing else — never from a
 * mutable label an operator can rename. Object keys are sorted before hashing, so two callers listing the
 * same tuple in a different order cannot produce two identities for one thing.
 *
 * These functions were byte-identical in `atlas/vanta/identity.ts` and `atlas/cloudflare/identity.ts`, each
 * carrying a comment saying it would be shared once a second atlas needed it. Both were right.
 */
import { createHash } from "node:crypto";

/**
 * A stable id for one entity within one namespace.
 *
 * The namespace must include the platform as well as the kind, so two atlases holding a provider id that
 * happens to collide cannot produce one identity between them.
 *
 * @param namespace the platform-and-kind namespace, e.g. `vanta:control`
 * @param components the identifying tuple; `null` is recorded distinctly from an empty string
 * @returns a 32-character hex digest
 */
export function stableEntityId({
  namespace,
  components,
}: {
  namespace: string;
  components: Readonly<Record<string, string | null>>;
}): string {
  const canonical = Object.entries(components)
    // Code-unit order by key, exactly the order `toSorted()` gives the keys alone.
    .toSorted(([left], [right]) => Number(left > right) - Number(left < right))
    .map(([key, value]) => {
      // `null` is a deliberate component, encoded apart from an empty string so the two cannot share an identity.
      if (value === null) {
        return `${key}= null`;
      }
      return `${key}=${value}`;
    })
    .join("");
  return createHash("sha1").update(`${namespace}:${canonical}`).digest("hex").slice(0, 32);
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * A gap closes only when its own condition is rechecked in its own scope, so the identity has to be exactly
 * that pair — see `gaps.ts` on why a gap closed by an unrelated success is a gap that never gets answered.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function stableGapId({ condition, scope }: { condition: string; scope: string }): string {
  return createHash("sha1").update(`gap:${condition}:${scope}`).digest("hex").slice(0, 32);
}
