/**
 * A plain fake for `PagePublished` (`../pages/published.ts`): the store holds exactly the pages named, so a test
 * asking whether a page is published never opens a real store. The real `fileExists` is proven against the stack in
 * `./integration/publishedPagesRead.test.ts`.
 */
import { ok } from "../lib/result.js";
import type { PagePublished } from "../pages/published.js";

/**
 * A store holding exactly these pages.
 *
 * @param slugs the pages the store serves; none when absent
 * @returns the seam, answering true for a named page and false for any other
 */
export function memoryPagesPublished({ slugs = [] }: { slugs?: readonly string[] } = {}): PagePublished {
  const held = new Set(slugs);
  return async ({ slug }) => ok(held.has(slug));
}
