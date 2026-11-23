import { describe, expect, it } from "vitest";
import { CODEX_PASS_HATCHES } from "../../../hatch/codexPassHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

/*
 * The same two properties `answerDoorHatches.test.ts` guards, for the third surface cut out of the
 * register: a row dropping out of the one array the `escape-hatch` gate reads, and the register's reading
 * order silently changing. Row CONTENTS stay `registry.test.ts`'s subject for the whole set.
 */
describe("CODEX_PASS_HATCHES", () => {
  it("declares the Codex pass surface's rows, in their register order", () => {
    expect(CODEX_PASS_HATCHES.length).toBeGreaterThan(0);
    expect(CODEX_PASS_HATCHES.map((hatch) => hatch.id)).toEqual([
      "codex-duplicate-pass",
      "fallback-review-uncapped",
      "fallback-plan-uncapped",
      "codex-review-pass-cap",
      "early-codex-reset",
    ]);
  });

  it("is spread into the one register the escape-hatch gate reads, contiguously and in order", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    const at = ids.indexOf("codex-duplicate-pass");
    expect(at).toBeGreaterThan(0);
    expect(ids.slice(at, at + CODEX_PASS_HATCHES.length)).toEqual(CODEX_PASS_HATCHES.map((h) => h.id));
  });

  it("puts the Codex pass rows after `multiple-socket-connections`, exactly where they were typed", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    expect(ids[ids.indexOf("codex-duplicate-pass") - 1]).toBe("multiple-socket-connections");
    expect(ids[ids.indexOf("early-codex-reset") + 1]).toBe("atlas-read-unproven-empty");
  });
});
