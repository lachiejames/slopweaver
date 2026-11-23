/*
 * In the src lane, not the site one, because `machine series`'s parser returns a neverthrow Result, which the site
 * build cannot resolve from `src/`. The Fleet page's live reading sums memory in use from its own copy of that parser
 * (`site/lib/liveMachineParse.ts`); this binds the copy to the verb's, so the page and the supervisor never disagree
 * on how much memory is used. The site module is imported at run time, by address, because `src/`'s `rootDir` may not
 * contain a `site/` file (TS6059).
 */

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseVmStatUsedBytes as verbUsedBytes } from "../../../../live/machine/seriesParse.js";

const LIVE_MACHINE_PARSE = new URL("../../../../../site/lib/liveMachineParse.ts", import.meta.url).href;

/** The site parser's shape, as far as this test calls it. */
type SiteUsedBytes = (args: { text: string }) => {
  _unsafeUnwrap: () => number;
  _unsafeUnwrapErr: () => { code: string; message: string };
};

/**
 * Whether a module exposes the site's `parseVmStatUsedBytes`.
 *
 * @param module what the run-time import returned
 * @returns true when it carries that function
 */
function hasUsedBytes(module: unknown): module is { parseVmStatUsedBytes: SiteUsedBytes } {
  return (
    typeof module === "object" && module !== null && typeof Reflect.get(module, "parseVmStatUsedBytes") === "function"
  );
}

/** A `vm_stat` print in the shape macOS gives, every line the sum reads present. */
const VM_STAT = [
  "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
  "Pages free:                               12345.",
  "Anonymous pages:                        2000000.",
  "Pages purgeable:                          50000.",
  "Pages wired down:                        300000.",
  "Pages occupied by compressor:            400000.",
  "",
].join("\n");

/**
 * The site's parser, loaded by address.
 *
 * @returns the function
 */
async function siteUsedBytes(): Promise<SiteUsedBytes> {
  const site: unknown = await import(LIVE_MACHINE_PARSE);
  expect(hasUsedBytes(site)).toBe(true);
  return (site as { parseVmStatUsedBytes: SiteUsedBytes }).parseVmStatUsedBytes;
}

describe("the live machine's memory sum matches `machine series`", () => {
  it("sums memory in use exactly as the verb does", async () => {
    const site = await siteUsedBytes();
    const verb = unwrap(verbUsedBytes({ text: VM_STAT }));
    expect(site({ text: VM_STAT })._unsafeUnwrap()).toBe(verb);
    expect(verb).toBe((2_000_000 - 50_000 + 300_000 + 400_000) * 16_384);
  });

  it("refuses a print missing a line, as the verb does", async () => {
    const site = await siteUsedBytes();
    const missing = VM_STAT.replace("Pages wired down:                        300000.\n", "");
    const siteError = site({ text: missing })._unsafeUnwrapErr();
    const verbError = unwrapErr(verbUsedBytes({ text: missing }));
    expect(siteError.code).toBe("VM_STAT_INCOMPLETE");
    expect(verbError.code).toBe("VM_STAT_INCOMPLETE");
    expect(siteError.message).toBe('vm_stat printed no "Pages wired down" line');
  });
});
