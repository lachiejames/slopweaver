/*
 * The console cuts every running-list sign-off from what it hands the voice (`site/lib/talkPlanHeldRelease.ts`'s
 * `OWN_LIST_SIGN_OFF`), and the continuity read cuts the same one from the voice's own lines the next call quotes
 * (`src/talk/copyToolSchemas.ts`'s `LIST_SIGN_OFF`). `site/lib/` imports nothing from `src/`, so the console restates
 * it, and the two are held equal here: a form one cuts and the other keeps would be taught back to the next call, or
 * said twice.
 *
 * It lives in the `src` lane, not the site's, because the site build type-checks its own tests and cannot resolve
 * what `copyToolSchemas.ts` imports: from a site test, that import failed the site build on zod and most of `src/`.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LIST_SIGN_OFF, withoutListSignOff } from "../../../talk/copyToolSchemas.js";

/** The console's copy of the cut, loaded at run time: `src` cannot import `site/` statically. */
async function consoleCut(): Promise<{
  OWN_LIST_SIGN_OFF: RegExp;
  RUNNING_LIST_LANDED_LINE: string;
  withoutSignOff: (input: { text: string }) => string;
}> {
  const path = fileURLToPath(new URL("../../../../site/lib/talkPlanHeldRelease.ts", import.meta.url));
  return (await import(path)) as {
    OWN_LIST_SIGN_OFF: RegExp;
    RUNNING_LIST_LANDED_LINE: string;
    withoutSignOff: (input: { text: string }) => string;
  };
}

describe("the running-list sign-off the console and the continuity read cut", () => {
  it("is one pattern on both sides", async () => {
    const { OWN_LIST_SIGN_OFF } = await consoleCut();
    expect([OWN_LIST_SIGN_OFF.source, OWN_LIST_SIGN_OFF.flags]).toEqual([LIST_SIGN_OFF.source, LIST_SIGN_OFF.flags]);
  });

  // A cut can join halves into a new sign-off, so both sides cut until none is left.
  it("is cut whole on both sides, nested halves and the console's own line included", async () => {
    const { RUNNING_LIST_LANDED_LINE, withoutSignOff } = await consoleCut();
    const nested =
      "A. It's on your running list, It's on your running list, It's on your running list, what do you think? " +
      "what do you think?what do you think? B.";
    expect(withoutListSignOff({ text: nested })).toBe("A. B.");
    expect(withoutSignOff({ text: nested })).toBe("A. B.");
    expect(withoutListSignOff({ text: `Done. ${RUNNING_LIST_LANDED_LINE}` })).toBe("Done.");
  });

  // Two whole sign-offs side by side mid-text are one run, leaving one space, not two.
  it("leaves one space where two adjacent sign-offs sat mid-text, on both sides", async () => {
    const { withoutSignOff } = await consoleCut();
    const adjacent =
      "A. It's on your running list, what do you think? It's on your running list, what do you think? B.";
    expect(withoutListSignOff({ text: adjacent })).toBe("A. B.");
    expect(withoutSignOff({ text: adjacent })).toBe("A. B.");
  });
});
