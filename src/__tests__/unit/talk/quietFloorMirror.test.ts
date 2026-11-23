/*
 * The console's wake and the chair wake agree on how long the owner must be quiet before the chair is typed one turn.
 *
 * `site/lib/talkCallAppend.ts` restates `src/talk/chairWake.ts`'s `QUIET_BEFORE_DELIVERY_MS` because `site/` never
 * imports `src/`; this file is what binds the copy — a floor changed in one alone would have the console ask before the owner
 * is quiet, so its wake would hold and only the courier would type. It lives in the `src` lane, not the site's,
 * because the site build type-checks its own tests and cannot resolve what `chairWake.ts` imports.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { QUIET_BEFORE_DELIVERY_MS } from "../../../talk/chairWake.js";

/**
 * Load one sibling tree's module at run time: `src` cannot import `site/` statically.
 *
 * @param relative the module's path from this file
 * @returns the module's exports
 */
async function loadSibling({ relative }: { relative: string }): Promise<Record<string, unknown>> {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return (await import(path)) as Record<string, unknown>;
}

describe("the console's quiet floor and the chair wake's agree", () => {
  it("on the number, two minutes", async () => {
    const site = await loadSibling({ relative: "../../../../site/lib/talkCallAppend.ts" });
    expect([site["QUIET_BEFORE_DELIVERY_MS"], QUIET_BEFORE_DELIVERY_MS]).toStrictEqual([120_000, 120_000]);
  });
});
