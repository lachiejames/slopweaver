/*
 * The console's Not now buttons (`site/lib/actVerbs.ts`) restate the note's snooze answers, because the site
 * cannot import `src/`. They are held equal to `SNOOZE_CHOICES` here: a choice the note gains and the console
 * lacks would leave the owner an answer only one place offers.
 *
 * It lives in the `src` lane, not the site's, because the site build type-checks its own tests and cannot
 * resolve what `snooze.ts` imports.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SNOOZE_CHOICES, snoozeChoiceLabel } from "../../../hand/snooze.js";

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

describe("the snooze answers every surface offers", () => {
  it("the console draws one Not now button per choice the note offers, in its order", async () => {
    const site = await loadSibling({ relative: "../../../../site/lib/actVerbs.ts" });
    const buttons = site["HAND_SNOOZE_BUTTONS"] as readonly { slug: string }[];
    expect(SNOOZE_CHOICES.length).toBeGreaterThan(0);
    expect(buttons.map((button) => button.slug)).toEqual(SNOOZE_CHOICES.map((choice) => `hand-snooze-${choice}`));
  });

  it("each console button reads the note's own label, after the first one's Not now prefix", async () => {
    const site = await loadSibling({ relative: "../../../../site/lib/actVerbs.ts" });
    const buttons = site["HAND_SNOOZE_BUTTONS"] as readonly { label: string }[];
    expect(buttons.map((button) => button.label.replace(/^Not now: /u, ""))).toEqual(
      SNOOZE_CHOICES.map((choice) => snoozeChoiceLabel({ choice })),
    );
  });
});
