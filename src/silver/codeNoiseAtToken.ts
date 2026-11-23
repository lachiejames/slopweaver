/**
 * The `@`-tokens that are code, never a person — the JSDoc tags and npm scopes the `@mention` pattern mines out
 * of ingested code and doc snippets (`@param`, `@octokit`).
 *
 * Two silver readers reject this exact set and each adds its own on top: `./graph.ts` keeps every other handle
 * as a graph entity, while `./opportunityToken.ts` also rejects email-provider domains, integration handles and
 * broadcast names. Only the shared code-noise half lives here; neither reader's full set is the other's.
 *
 * Pure + exact — a set lookup, never a fuzzy match.
 */

/** JSDoc tags and npm scopes, bare and lower-case, with no leading `@`. */
const CODE_NOISE_AT_TOKENS: ReadonlySet<string> = new Set([
  "param",
  "returns",
  "return",
  "throws",
  "throw",
  "example",
  "link",
  "links",
  "see",
  "default",
  "deprecated",
  "since",
  "type",
  "types",
  "todo",
  "fixme",
  "note",
  "override",
  "packagemanager",
  "babel",
  "octokit",
  "slack",
  "linear",
  "notionhq",
  "xenova",
  "eslint",
  "biome",
  "ts",
  "tsx",
]);

/**
 * Whether an `@`-token's handle is a JSDoc tag or npm scope rather than a person. The lookup is exact, so the
 * caller strips the `@` and lower-cases the handle first — both readers already do.
 *
 * @param bare the handle with its leading `@` removed, already lower-cased
 * @returns true when the handle is code noise
 */
export function isCodeNoiseAtToken({ bare }: { bare: string }): boolean {
  return CODE_NOISE_AT_TOKENS.has(bare);
}
