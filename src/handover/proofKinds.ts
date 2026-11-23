/**
 * The kinds of proof the owner can ask a pull request's body to carry, and how a gap names each — a leaf with no imports,
 * because `site/__tests__/unit/prProofMirror.test.ts` binds the console's copy to it and the site build typechecks
 * everything that test reaches.
 */

/** A kind of proof the owner can ask a pull request's body to carry. */
export type ProofKind = "image" | "run-link" | "datadog";

/** Every {@link ProofKind}, in the order a gap names them. */
export const PROOF_KINDS: readonly ProofKind[] = ["image", "run-link", "datadog"];

/** How each missing kind is named in a gap — the console restates it (`site/lib/prProof.ts`). */
export const PROOF_KIND_WORDS: Readonly<Record<ProofKind, string>> = {
  datadog: "Datadog link",
  image: "screenshot",
  "run-link": "Actions run link",
};
