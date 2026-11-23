/**
 * The opportunity token classifier — the precision gate in front of the cross-cutting detector (PR4.8).
 *
 * The pre-PR4.8 detector cliqued on EVERY `record.refs` token, so the highest-scored "opportunities" were
 * frequency artifacts: `refs` carries `@`-shaped matches mined out of prose, and an email's domain fragment
 * (`@gmail` out of `someone@gmail.com`) or an integration handle appears in hundreds of containers. Breadth
 * alone rewarded exactly those.
 *
 * So a cross-cutting concern now needs a CONCRETE shared reference — an issue/PR number, a ticket key, or a
 * URL with a real path (a doc/PR/issue permalink). A bare `@mention` is a person, not a shared artifact: the
 * directory already surfaces people, and "these 35 containers mention the same person" is not an insight.
 * Generic tokens (email-provider domains, integration handles, JSDoc/npm-scope noise) are rejected outright
 * so they can never be re-admitted by a caller that relaxes the mention rule.
 *
 * Pure + exact — a shape/set test, never a fuzzy match.
 */
import { isCodeNoiseAtToken } from "./codeNoiseAtToken.js";
import { hasMeaningfulUrlPath } from "./graph.js";

/**
 * What a candidate cross-ref token IS:
 *  - `concrete`   — an issue/PR number (`#<number>`), a ticket key (`TEAM-123`), or a URL with a meaningful path.
 *  - `mention`    — a plain `@handle`: a person, not a shared artifact (breadth here is not an insight).
 *  - `generic`    — a known non-entity `@`-token: an email-provider domain, an integration handle, a JSDoc
 *                   tag, or an npm scope. Never a signal.
 *  - `other`      — anything else (a bare word, a root URL): not a usable cross-container signal.
 */
export type OpportunityTokenClass = "concrete" | "mention" | "generic" | "other";

/**
 * `@`-tokens that are never a person, beyond the JSDoc-tag / npm-scope noise `./codeNoiseAtToken.ts` shares
 * with the graph: the email-provider domain fragments the `@mention` pattern mines out of an address
 * (`someone@gmail.com` → `@gmail`), the app/integration handles that post like people, and the provider names
 * and broadcast handles the graph still admits. Bare, lower-case, no leading `@`.
 */
const GENERIC_AT_TOKENS: ReadonlySet<string> = new Set([
  // email-provider domain fragments (the `@gmail is referenced across 35 containers` class)
  "gmail",
  "googlemail",
  "hotmail",
  "outlook",
  "live",
  "icloud",
  "me",
  "yahoo",
  "proton",
  "protonmail",
  "pm",
  "aol",
  "msn",
  "example",
  // integration / app handles that author records but are not teammates
  "integration",
  "oauthapp",
  "bot",
  "webhook",
  "githubcopilot",
  "dependabot",
  "renovate",
  "datadog",
  "slackbot",
  "sentry",
  "zapier",
  // code/doc and provider names the graph still admits as entities
  "example-tag",
  "notion",
  "github",
  // broadcast handles
  "here",
  "channel",
  "everyone",
  "user",
]);

const ISSUE_NUMBER = /^#\d+$/;
const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const HTTP_URL = /^https?:\/\//;

/**
 * Classify a cross-ref token. Generic wins over shape: a `@`-token in {@link GENERIC_AT_TOKENS} is `generic`
 * even though it looks like a mention, so the classification names WHY it was rejected. Pure + exact.
 *
 * @param token the candidate cross-ref token (as it appears in `record.refs`)
 * @returns the token's class
 */
export function classifyOpportunityToken({ token }: { token: string }): OpportunityTokenClass {
  if (token.startsWith("@")) {
    const bare = token.slice(1).toLowerCase();
    if (bare.length === 0 || GENERIC_AT_TOKENS.has(bare) || isCodeNoiseAtToken({ bare })) {
      return "generic";
    }
    return "mention";
  }
  if (ISSUE_NUMBER.test(token) || TICKET_KEY.test(token)) {
    return "concrete";
  }
  if (HTTP_URL.test(token)) {
    return hasMeaningfulUrlPath({ url: token }) ? "concrete" : "generic";
  }
  return "other";
}

/**
 * Whether a token carries a real cross-container signal — the ONLY class the cross-cutting detector admits.
 * Pure.
 *
 * @param token the candidate cross-ref token
 * @returns true when the token is a concrete shared reference
 */
export function isConcreteRefToken({ token }: { token: string }): boolean {
  return classifyOpportunityToken({ token }) === "concrete";
}
