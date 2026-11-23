/**
 * Pure argument handling for `slopweaver atlas <platform> page` — the visual representation of an atlas.
 *
 * The verb exists so the owner can see what is in an atlas with their own eyes, which surfaces a problem a lot
 * sooner, and so the visual representation is regenerated on a re-sync rather than hand-made. A verb is what makes that true; a page
 * somebody wrote once would be stale by the next sync and would carry no honesty anybody could check.
 *
 * Every flag here bounds SIZE and nothing else. None of them can change what the page CLAIMS: the counts
 * are always the whole figure and a cap only decides how many rows are printed beneath one, which the page
 * states in the same breath. That is deliberate — a flag that could quietly shrink a defect count would put
 * the dishonesty back in the one place this verb exists to remove it from.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";

import { atlasCommandErrorLines } from "./errors.js";
import { integerFlagAtLeast } from "./integerFlag.js";

/** Every flag this verb accepts. The spec is local; {@link ATLAS_RENDER_FLAG_NAMES} is what leaves. */
const ATLAS_RENDER_FLAGS: FlagSpec = {
  boolean: ["json", "fragment", "no-screenshots"],
  string: ["out", "home", "max-rows", "never-hit-cap", "screenshot-budget-mib", "max-page-mib"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_RENDER_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_RENDER_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_RENDER_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** How many entity rows one kind prints when `--max-rows` is not given. */
export const ATLAS_RENDER_DEFAULT_MAX_ROWS = 250;

/** How many never-hit rows the page prints when `--never-hit-cap` is not given. */
export const ATLAS_RENDER_DEFAULT_NEVER_HIT_CAP = 2000;

/**
 * How many mebibytes of screenshots may be embedded before the rest are listed rather than shown.
 *
 * MEASURED: one generation's page screenshots totalled about 5 MB, which base64-encodes to roughly
 * 7 MiB — inside the 16 MiB an artifact may be, but not by much, and another platform's generation on the
 * same machine ran to hundreds of megabytes. So a budget is the difference between a page that
 * renders and one that cannot be published at all. Re-derive with
 * `slopweaver atlas <platform> page --json | jq '[.screenshots[].byteLength] | add'`.
 */
export const ATLAS_RENDER_DEFAULT_SCREENSHOT_BUDGET_MIB = 6;

/**
 * The hard ceiling on the whole rendered page.
 *
 * A Claude Artifact may be at most 16 MB, and a page that renders successfully at 20 MB is a page that
 * cannot be published — a failure the reader discovers at the publish step rather than at the render step.
 * Fifteen leaves room for the wrapper an artifact adds. A pre-mortem named the absence
 * of this bound: the screenshot budget alone is not an output budget, and one platform's generation can
 * run to hundreds of megabytes across dozens of kinds. Re-derive the pressure with
 * `du -sh $SLOPWEAVER_HOME/atlas/* | sort -h`.
 */
export const ATLAS_RENDER_DEFAULT_MAX_PAGE_MIB = 15;

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_RENDER_USAGE =
  "usage: slopweaver atlas <platform> page [--out <path>] [--fragment] [--json]\n" +
  "                                       [--max-rows <n>] [--never-hit-cap <n>]\n" +
  "                                       [--screenshot-budget-mib <n>] [--no-screenshots]\n" +
  "                                       [--max-page-mib <n>] [--home <dir>]\n" +
  "  <platform>                 the atlas to render — run `slopweaver atlas` to list them\n" +
  "  --out                      write the page here; omitted writes it to stdout\n" +
  "  --fragment                 emit title, style and content with no document wrapper, which is the\n" +
  "                             form a Claude Artifact takes; omitted emits a standalone HTML document\n" +
  "  --json                     emit the model the page is rendered from, instead of the page\n" +
  `  --max-rows                 entity rows printed per kind (default ${String(ATLAS_RENDER_DEFAULT_MAX_ROWS)}); the counts are always whole\n` +
  `  --never-hit-cap            rows printed for endpoints that exist and were never hit (default ${String(ATLAS_RENDER_DEFAULT_NEVER_HIT_CAP)})\n` +
  `  --screenshot-budget-mib    how many MiB of screenshots to embed (default ${String(ATLAS_RENDER_DEFAULT_SCREENSHOT_BUDGET_MIB)})\n` +
  "  --no-screenshots           list every screenshot by digest and embed none\n" +
  `  --max-page-mib             the hard ceiling on the whole page (default ${String(ATLAS_RENDER_DEFAULT_MAX_PAGE_MIB)}); rows are shed until it fits\n` +
  "  reads only what a sync already stored; it makes no network call";

/** The resolved invocation.
 * @internal
 */
export interface AtlasRenderOptions {
  readonly out: string | undefined;
  readonly fragment: boolean;
  readonly json: boolean;
  readonly maxRows: number;
  readonly neverHitCap: number;
  readonly screenshotBudgetBytes: number;
  readonly maxPageBytes: number;
  readonly home: string | undefined;
}

/** How many bytes one mebibyte is, so the flag's unit is stated once. */
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas <platform> page`
 * @returns the resolved options, or every usage problem found
 */
export function parseAtlasRenderArgs({ rest }: { rest: readonly string[] }): Result<AtlasRenderOptions> {
  const parsed = parseFlags({ args: rest, spec: ATLAS_RENDER_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const maxRows = integerFlagAtLeast({
    fallback: ATLAS_RENDER_DEFAULT_MAX_ROWS,
    min: 0,
    name: "max-rows",
    raw: values["max-rows"],
  });
  const neverHitCap = integerFlagAtLeast({
    fallback: ATLAS_RENDER_DEFAULT_NEVER_HIT_CAP,
    min: 0,
    name: "never-hit-cap",
    raw: values["never-hit-cap"],
  });
  const budgetMib = integerFlagAtLeast({
    fallback: ATLAS_RENDER_DEFAULT_SCREENSHOT_BUDGET_MIB,
    min: 0,
    name: "screenshot-budget-mib",
    raw: values["screenshot-budget-mib"],
  });
  const pageMib = integerFlagAtLeast({
    fallback: ATLAS_RENDER_DEFAULT_MAX_PAGE_MIB,
    min: 0,
    name: "max-page-mib",
    raw: values["max-page-mib"],
  });
  const problems = [maxRows, neverHitCap, budgetMib, pageMib].flatMap((result) =>
    result.isErr() ? atlasCommandErrorLines({ error: result.error }) : [],
  );
  if (problems.length > 0) {
    return err(problems);
  }
  const noShots = values["no-screenshots"] === true;
  const stringOf = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  return ok({
    fragment: values["fragment"] === true,
    home: stringOf({ name: "home" }),
    json: values["json"] === true,
    maxPageBytes: pageMib.unwrapOr(ATLAS_RENDER_DEFAULT_MAX_PAGE_MIB) * BYTES_PER_MIB,
    maxRows: maxRows.unwrapOr(ATLAS_RENDER_DEFAULT_MAX_ROWS),
    neverHitCap: neverHitCap.unwrapOr(ATLAS_RENDER_DEFAULT_NEVER_HIT_CAP),
    out: stringOf({ name: "out" }),
    screenshotBudgetBytes: noShots ? 0 : budgetMib.unwrapOr(ATLAS_RENDER_DEFAULT_SCREENSHOT_BUDGET_MIB) * BYTES_PER_MIB,
  });
}
