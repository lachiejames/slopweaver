/**
 * The key the code block's highlighted-token cache files one text under (`components/ai-elements/code-block.tsx`).
 * Pure.
 */

/**
 * The cache key for one text in one language: the whole text, never a sample of it. A key of its length and first and
 * last hundred characters handed one voice tool call's tokens to another that differed only in the middle, drawing
 * arguments the model never wrote. The cached tokens already hold the whole text, so a full
 * key at most doubles what an entry costs.
 *
 * @param code the text being highlighted
 * @param language the grammar it is highlighted with
 * @returns the key
 */
export function codeTokensKeyOf({ code, language }: { code: string; language: string }): string {
  return `${language}:${code}`;
}
