/**
 * The two `ruling` verbs that only read the register: `list`, by category, and `view`, which publishes the one
 * read-only page.
 */
import { RULING_PAGE_SLUG, renderRulingPage } from "../../../ruling/page.js";
import type { RulingProjection, RulingRecord } from "../../../ruling/registry.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { flagValue } from "../../optionParsers.js";
import { loadRegister, printRuling, type RulingArgs, type RulingDeps, reportRefusal } from "./shared.js";

/** `ruling list --json`: one object per line, carrying what replaced it. */
function printListJson({
  shown,
  projection,
  deps,
}: {
  shown: readonly RulingRecord[];
  projection: RulingProjection;
  deps: RulingDeps;
}): void {
  for (const record of shown) {
    const replacedBy = projection.replacedBy.get(record.id);
    deps.logger.out({ line: JSON.stringify({ ...record, ...(replacedBy === undefined ? {} : { replacedBy }) }) });
  }
}

/** `ruling list`: a heading per category, alphabetically, each ruling under it. */
function printListText({
  shown,
  projection,
  deps,
}: {
  shown: readonly RulingRecord[];
  projection: RulingProjection;
  deps: RulingDeps;
}): void {
  for (const each of [...new Set(shown.map((row) => row.category))].toSorted()) {
    deps.logger.out({ line: `## ${each}` });
    for (const record of shown.filter((row) => row.category === each)) {
      printRuling({ deps, projection, record });
    }
  }
}

/**
 * `ruling list`.
 *
 * @param file the register's path
 * @param args the parsed flags
 * @returns the exit code
 */
export function runList({ file, args, deps }: { file: string; args: RulingArgs; deps: RulingDeps }): number {
  const projection = loadRegister({ deps, file });
  if (typeof projection === "number") {
    return projection;
  }
  const category = flagValue({ name: "category", parsed: args.parsed });
  const all = args.parsed.flags.has("all");
  const pool = all ? projection.rows : projection.current;
  const shown = pool.filter((row) => category === null || row.category === category);
  if (args.parsed.flags.has("json")) {
    printListJson({ deps, projection, shown });
    return EXIT_OK;
  }
  if (shown.length === 0) {
    const scope = category === null ? "" : ` in ${category}`;
    const which = all ? "" : "current ";
    deps.logger.out({ line: `ruling: no ${which}rulings${scope} (${file})` });
    return EXIT_OK;
  }
  printListText({ deps, projection, shown });
  return EXIT_OK;
}

/**
 * `ruling view`.
 *
 * @param file the register's path
 * @param home the state home whose local store the page is published into
 * @returns the exit code
 */
export async function runView({ file, home, deps }: { file: string; home: string; deps: RulingDeps }): Promise<number> {
  const projection = loadRegister({ deps, file });
  if (typeof projection === "number") {
    return projection;
  }
  const fragment = renderRulingPage({ projection });
  if (fragment.isErr()) {
    return reportRefusal({ deps, error: fragment.error });
  }
  const published = await deps.publish({
    fragment: fragment.value,
    home,
    nowIso: deps.nowIso(),
    slug: RULING_PAGE_SLUG,
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      deps.logger.error({ msg: `ruling view: ${line}` });
    });
    return EXIT_ERROR;
  }
  deps.logger.out({
    line: `ruling view: ${String(projection.current.length)} current ruling(s) at ${published.value.url}`,
  });
  return EXIT_OK;
}
