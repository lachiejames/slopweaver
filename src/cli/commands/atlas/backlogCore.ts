/**
 * Pure argument handling and rendering for `slopweaver atlas backlog`.
 *
 * The judgement is `atlas/kit/backlog.ts`'s and the gather is {@link ./backlogRun}'s; what lives here is
 * the flag spec and the lines. Nothing in this file decides whether a row is refused.
 */

import type { AtlasBacklog, AtlasBacklogEntry } from "../../../atlas/kit/backlog.js";
import type { AtlasDeferredBacklog } from "../../../atlas/kit/deferredBacklog.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/** Every flag this verb accepts. The spec is local; {@link ATLAS_BACKLOG_FLAG_NAMES} is what leaves. */
const ATLAS_BACKLOG_FLAGS: FlagSpec = {
  boolean: ["deferred", "json", "named-only"],
  string: ["ground", "platform"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_BACKLOG_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_BACKLOG_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_BACKLOG_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation.
 * @internal
 */
export interface AtlasBacklogOptions {
  readonly platform: string | undefined;
  readonly ground: string | undefined;
  readonly namedOnly: boolean;
  /** Whether to sweep the deferred half as well, which is the one part that reads the local store. */
  readonly deferred: boolean;
  readonly json: boolean;
}

/** The two grounds the coverage gate refuses, and so the only two `--ground` accepts. */
const REFUSED_GROUNDS: readonly string[] = ["not-fetched", "shape-index"];

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas backlog`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseAtlasBacklogArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AtlasBacklogOptions, AtlasCommandError> {
  const parsed = parseFlags({ args: rest, spec: ATLAS_BACKLOG_FLAGS });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const stringOf = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  const ground = stringOf({ name: "ground" });
  if (ground !== undefined && !REFUSED_GROUNDS.includes(ground)) {
    return err(AtlasCommandErrors.backlogGroundInvalid({ allowed: REFUSED_GROUNDS, ground }));
  }
  return ok({
    deferred: values["deferred"] === true,
    ground,
    json: values["json"] === true,
    namedOnly: values["named-only"] === true,
    platform: stringOf({ name: "platform" }),
  });
}

/**
 * Narrow a register to what the caller asked to see.
 *
 * The COUNTS are recomputed over what survives rather than carried through, so a filtered report never
 * prints a total it did not list — the same property `atlas coverage` gets from re-reading the whole atlas.
 *
 * @param backlog the whole register
 * @param options the caller's filters
 * @returns the register with only the entries and rows the filters admit
 */
export function filterAtlasBacklog({
  backlog,
  options,
}: {
  backlog: AtlasBacklog;
  options: AtlasBacklogOptions;
}): AtlasBacklog {
  const entries: AtlasBacklogEntry[] = [];
  for (const entry of backlog.entries) {
    if (options.platform !== undefined && entry.platform !== options.platform) {
      continue;
    }
    if (options.namedOnly && entry.namedPosition === null) {
      continue;
    }
    const rows = entry.rows.filter((row) => options.ground === undefined || row.ground === options.ground);
    if (rows.length > 0) {
      entries.push({ ...entry, rows });
    }
  }
  const kept = entries.flatMap((entry) => entry.rows);
  return {
    entries,
    namedAndClear: backlog.namedAndClear,
    notFetchedCount: kept.filter((row) => row.ground === "not-fetched").length,
    refusedCount: kept.length,
    unmeasuredCount: kept.filter((row) => row.ground === "shape-index").length,
  };
}

/** How many characters of a row's prose the human rendering shows before the remedy line. */
const BECAUSE_WIDTH = 96;

/**
 * One row's prose, clipped to a width the terminal can hold.
 *
 * @param because the descriptor's own prose
 * @returns the prose, ellipsed when it is longer than {@link BECAUSE_WIDTH}
 */
function clipped({ because }: { because: string }): string {
  return because.length <= BECAUSE_WIDTH ? because : `${because.slice(0, BECAUSE_WIDTH - 1)}…`;
}

/**
 * Render the register for a person.
 *
 * @param backlog the register to print, already filtered
 * @returns the lines to write, in order
 */
export function renderAtlasBacklog({ backlog }: { backlog: AtlasBacklog }): readonly string[] {
  const lines: string[] = [
    `atlas backlog: ${String(backlog.refusedCount)} refused row(s) across ${String(backlog.entries.length)} atlas(es)` +
      ` — ${String(backlog.notFetchedCount)} nobody fetched, ${String(backlog.unmeasuredCount)} unweighed`,
  ];
  for (const entry of backlog.entries) {
    const place = entry.namedPosition === null ? "unnamed" : `#${String(entry.namedPosition)} in the owner's order`;
    lines.push("");
    lines.push(`${entry.platform}  (${String(entry.rows.length)} refused, ${place})`);
    for (const row of entry.rows) {
      const tag = row.ground === "not-fetched" ? "not fetched" : "unweighed  ";
      lines.push(`  ${tag}  ${clipped({ because: row.because })}`);
      lines.push(`                closed by: ${clipped({ because: row.remedy })}`);
    }
  }
  if (backlog.namedAndClear.length > 0) {
    lines.push("");
    lines.push(`clear already, of the nine named: ${backlog.namedAndClear.join(", ")}`);
  }
  lines.push("");
  lines.push("this verb never fails a run — these are a backlog, not a gate");
  return lines;
}

/**
 * Narrow the deferred register to what the caller asked to see.
 *
 * `--ground` is deliberately not applied: a ground is a property of a declared EXCLUSION and a deferred
 * cell has none, so honouring it here would silently empty this half of the page.
 *
 * `unread` survives every filter except `--platform`, because an atlas the sweep could not read is the one
 * row a narrowed report must not lose — dropping it is how a filter buys a page that looks clean.
 *
 * @param deferred the whole deferred register
 * @param options the caller's filters
 * @returns the register with only the entries the filters admit, counted over what survived
 */
export function filterAtlasDeferred({
  deferred,
  options,
}: {
  deferred: AtlasDeferredBacklog;
  options: AtlasBacklogOptions;
}): AtlasDeferredBacklog {
  const entries = deferred.entries.filter((entry) => {
    if (options.platform !== undefined && entry.platform !== options.platform) {
      return false;
    }
    return !(options.namedOnly && entry.namedPosition === null);
  });
  const unread = deferred.unread.filter(
    (atlas) => options.platform === undefined || atlas.platform === options.platform,
  );
  return {
    deferredCount: entries.reduce((total, entry) => total + entry.rows.length, 0),
    entries,
    namedAndClear: deferred.namedAndClear,
    unread,
  };
}

/**
 * How many of one atlas's deferred cells the human rendering spells out before summarising the rest.
 *
 * MEASURED (`slopweaver atlas backlog --deferred --json | jq '.deferred.entries[0].rows|length'`):
 * Datadog alone carries 288 cells, its 144 kinds × two unfilled surfaces, all wearing the same two
 * sentences. Printed whole that is 576 lines for one atlas, and a register nobody scrolls to the end of has
 * the same effect as no register. The JSON document is never clipped — `--json` carries every cell — and
 * the tail line names the verb that prints one atlas's cells in full.
 */
const DEFERRED_CELLS_SHOWN = 6;

/**
 * Render the deferred register for a person.
 *
 * @param deferred the register to print, already filtered
 * @returns the lines to write, in order
 */
export function renderAtlasDeferred({ deferred }: { deferred: AtlasDeferredBacklog }): readonly string[] {
  const lines: string[] = [
    "",
    `deferred kinds: ${String(deferred.deferredCount)} cell(s) across ${String(deferred.entries.length)} atlas(es)` +
      ` — missing coverage wearing a settled word`,
  ];
  for (const entry of deferred.entries) {
    const place = entry.namedPosition === null ? "unnamed" : `#${String(entry.namedPosition)} in the owner's order`;
    lines.push("");
    lines.push(`${entry.platform}  (${String(entry.rows.length)} deferred, ${place})`);
    for (const row of entry.rows.slice(0, DEFERRED_CELLS_SHOWN)) {
      lines.push(`  ${row.kind}  ${row.surface}  ${row.scope}`);
      lines.push(`                ${clipped({ because: row.reason })}`);
    }
    const unshown = entry.rows.length - DEFERRED_CELLS_SHOWN;
    if (unshown > 0) {
      lines.push(
        `  … and ${String(unshown)} more cell(s) here — all of them in \`slopweaver atlas ${entry.platform}` +
          " coverage --state deferred`, and in this verb's own `--json`",
      );
    }
  }
  if (deferred.unread.length > 0) {
    lines.push("");
    lines.push(
      `NOT COUNTED (${String(deferred.unread.length)} atlas(es) the sweep could not read — not the same as clear)`,
    );
    for (const atlas of deferred.unread) {
      lines.push(`  ${atlas.platform}  ${clipped({ because: atlas.because })}`);
    }
  }
  return lines;
}
