/**
 * The code-owner rules GitHub still holds on a pull request, each as the owners any ONE of whom clears it.
 *
 * ## Why neither input alone is enough
 *
 * {@link blockedOn} is GitHub's own answer and the authoritative one — empty when GitHub would merge anyway —
 * but it is FLAT: `@acme/acme-eng @acme/platform` reads the same whether the pull request owes
 * both teams or either one. `PrReviewState.codeowners.owed` keeps the rule structure (OR within a rule, AND
 * across rules) but is derived from a CODEOWNERS parse, and it keeps a rule GitHub has already let go —
 * a team rule a member cleared reads `unknown` there, because membership is not in that read.
 *
 * So the structure comes from the parse and the authority from GitHub: a derived rule counts only while one of
 * its owners is still in {@link blockedOn}, and a token GitHub holds that no derived rule names stands as its
 * own rule, so GitHub's answer is never dropped for the parse's.
 */
import { blockedOn, identityOf } from "./landingTests.js";
import type { PrReviewState } from "./reviewState.js";

/**
 * Every code-owner rule GitHub still holds, as the `@`-prefixed owner tokens any one of whom clears it.
 *
 * @param state the pull request's answers
 * @returns one entry per owed rule; empty when GitHub holds none
 */
export function owedCodeownerRules({ state }: { state: PrReviewState }): readonly (readonly string[])[] {
  const held = blockedOn({ state });
  if (held.length === 0) {
    return [];
  }
  const heldIdentities = new Set(held.map((token) => ownerIdentity({ token })));
  const structured = state.codeowners.owed
    .map((rule) => rule.clearableBy)
    .filter((owners) => owners.some((token) => heldIdentities.has(ownerIdentity({ token }))));
  const inStructured = new Set(structured.flat().map((token) => ownerIdentity({ token })));
  const unstructured = held.filter((token) => !inStructured.has(ownerIdentity({ token }))).map((token) => [token]);
  return [...structured, ...unstructured];
}

/**
 * {@link identityOf}, kept apart by kind: a user `@platform` and a team `@acme/platform` share a last segment
 * and are different owners, so a held user request must never keep a parsed team rule alive.
 */
function ownerIdentity({ token }: { token: string }): string {
  const kind = token.includes("/") ? "team" : "user";
  return `${kind}:${identityOf({ token })}`;
}
