import { describe, expect, it } from "vitest";
import { BROWSER_HATCHES } from "../../../hatch/browserHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

/*
 * The same two properties `answerDoorHatches.test.ts` guards, for the second surface cut out of the
 * register: a row dropping out of the one array the `escape-hatch` gate reads, and the register's reading
 * order silently changing. Row CONTENTS stay `registry.test.ts`'s subject for the whole set.
 */
describe("BROWSER_HATCHES", () => {
  it("declares the browser surface's rows, in their register order", () => {
    expect(BROWSER_HATCHES.length).toBeGreaterThan(0);
    expect(BROWSER_HATCHES.map((hatch) => hatch.id)).toEqual([
      "datadog-site",
      "browser-page-read-only",
      "browser-blind-keystroke",
      "browser-raw-selector",
      "browser-offscreen-target",
      "codex-browser-door",
      "browser-launch",
      "codex-electron-guard",
    ]);
  });

  it("is spread into the one register the escape-hatch gate reads, contiguously and in order", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    const at = ids.indexOf("datadog-site");
    expect(at).toBeGreaterThan(0);
    expect(ids.slice(at, at + BROWSER_HATCHES.length)).toEqual(BROWSER_HATCHES.map((h) => h.id));
  });

  it("puts the browser rows after `memory-corpus`, exactly where they were typed", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    expect(ids[ids.indexOf("datadog-site") - 1]).toBe("memory-corpus");
    expect(ids[ids.indexOf("codex-electron-guard") + 1]).toBe("poll");
  });

  it("carries no row for the retired Claude-in-Chrome door, whose refusal has no override", () => {
    expect(ESCAPE_HATCHES.map((hatch): string => hatch.id).includes("browser-doored")).toBe(false);
  });
});
