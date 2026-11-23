/*
 * The Queue's `?tag=` filter (`site/lib/queueTags.ts`) refuses a selector naming a key outside its own copy of the
 * board registry, `TAG_KEY_ORDER`. `site/` cannot import `src/`, so that copy is held equal to `TAG_KEYS` here: a
 * key the registry gains and the copy lacks would read as a typo in every shared link naming it.
 *
 * It lives in the `src` lane, not the site's, because the site build type-checks its own tests and cannot resolve
 * what `rowTags.ts` imports.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TAG_KEYS } from "../../../handover/rowTags.js";

/** The console's copy of the key list, loaded at run time: `src` cannot import `site/` statically. */
async function consoleKeys(): Promise<readonly string[]> {
  const path = fileURLToPath(new URL("../../../../site/lib/queueTags.ts", import.meta.url));
  const module = (await import(path)) as { TAG_KEY_ORDER: readonly string[] };
  return module.TAG_KEY_ORDER;
}

describe("the Queue tag filter's key list", () => {
  it("holds exactly the board registry's keys", async () => {
    const keys = await consoleKeys();
    expect(TAG_KEYS.length).toBeGreaterThan(0);
    expect([...keys].toSorted()).toEqual(TAG_KEYS.map((spec) => spec.key).toSorted());
  });
});
