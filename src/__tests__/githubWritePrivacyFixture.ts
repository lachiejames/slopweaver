/**
 * A GitHub write privacy capability (`../outbound/github/writePrivacy.ts`) whose policy declares no private terms
 * and no denylisted word, with the committed identifier rules: what a transport test whose subject is NOT the
 * privacy check hands its write client. A plain seam, never read from a home, so it needs no cleanup. A test of the
 * privacy check itself builds `githubWritePrivacy({ home })` over a throwaway home instead.
 */
import { FORBIDDEN_IDENTIFIER_RULES } from "../hygiene/forbiddenIdentifiers.js";
import { ok } from "../lib/result.js";
import type { GithubWritePrivacy } from "../outbound/github/writePrivacy.js";

/** The capability: the target repository is passed through as the destination, nothing else is forgiven. */
export const NO_TERMS_GITHUB_PRIVACY: GithubWritePrivacy = {
  resolve: async ({ ownRepository }) =>
    ok({
      destination: { identifierAudience: "strict", installationIdentifiers: undefined, ownRepository },
      policy: { denylist: [], identifierRules: FORBIDDEN_IDENTIFIER_RULES, privateTerms: [] },
    }),
};
