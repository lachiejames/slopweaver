/**
 * `slopweaver page find [<words>...]` — their published pages, newest first or ranked against what they said, each with
 * its title, so the console voice can turn "the page with the twenty icons" into the slug `browser present --page`
 * opens (`../../../pages/find.ts` carries the measured call this exists for).
 *
 * The list is read from the store (`../../../store/publishedPages/read.ts`), never the `pages/` folder: one query and
 * one download per distinct current document, the title parsed from its head. A store that cannot be read fails the
 * verb; it never answers from the folder instead. Everything it decides is the pure core's. It writes nothing.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { type FoundPage, findPages, type PublishedPageForFind } from "../../../pages/find.js";
import { withPublishedPagesReader } from "../../../store/publishedPages/read.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { pageFindOptions, VERB_ARG_OFFSET } from "./core.js";
import { PAGE_FIND_USAGE } from "./usage.js";

/** The seams `page find` performs its effects through. */
export interface PageFindDeps {
  /** Every published page in the store this home selects, or why the store could not be read. */
  readonly listPublishedPages: (args: { home: string }) => Promise<Result<readonly PublishedPageForFind[]>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Every current page in the store this home selects, as `page find` ranks it.
 *
 * @param home the home whose selected store is read
 * @returns each page's slug, title and publication instant, or why the store could not be read
 */
export async function listStoredPages({ home }: { home: string }): Promise<Result<readonly PublishedPageForFind[]>> {
  const listed = await withPublishedPagesReader({ home, read: (reader) => reader.listCurrent() });
  return listed
    .map((pages) =>
      pages.map((page) => ({ publishedMs: page.publishedAt.getTime(), slug: page.pageKey, title: page.title })),
    )
    .mapErr((error) => [`page find: ${error.message}`]);
}

/**
 * What one find prints.
 *
 * @param found the pages to offer, best first
 * @param matching how many pages matched before the limit
 * @param searched the words that were scored, after dropping short ones
 * @param closeAtTop how many matching pages score near enough the best that their words did not choose between them
 * @param unsearchable their words when none of them could be searched on, else empty
 * @param json whether the caller asked for one object instead
 * @returns the lines to write, in order
 */
export function foundLines({
  found,
  matching,
  searched,
  closeAtTop,
  unsearchable,
  json,
}: {
  found: readonly FoundPage[];
  matching: number;
  searched: readonly string[];
  closeAtTop: number;
  unsearchable: readonly string[];
  json: boolean;
}): readonly string[] {
  if (json) {
    return [JSON.stringify({ matching, pages: found, searched, shown: found.length, closeAtTop, unsearchable })];
  }
  if (unsearchable.length > 0) {
    return [`no page searched: "${unsearchable.join(" ")}" names nothing to search on — give a word its title carries`];
  }
  let heading = `${String(matching)} published page(s), newest first`;
  if (searched.length > 0) {
    heading = `${String(matching)} published page(s) matching ${searched.join(", ")}, best first`;
  }
  if (closeAtTop > 1) {
    heading = `${heading}, ${String(closeAtTop)} close at the top so ask them which`;
  }
  const lines = [`${heading} — showing ${String(found.length)}`];
  for (const page of found) {
    let title = "(no title)";
    if (page.title !== undefined) {
      title = page.title;
    }
    lines.push(`  ${page.slug}  ${title}  (${page.modifiedIso})`);
  }
  if (found.length > 0) {
    lines.push("  open one as a new tab in their desktop app with: slopweaver browser present --page <slug>");
  }
  return lines;
}

/**
 * Run `page find` against injected seams.
 *
 * @param rest the argv tail after `page find`
 * @param deps the store list and the two sinks
 * @returns the process exit code
 */
export async function runPageFind({ rest, deps }: { rest: readonly string[]; deps: PageFindDeps }): Promise<number> {
  const options = pageFindOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, PAGE_FIND_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { json, limit, words } = options.value;
  const listed = await deps.listPublishedPages({ home: resolveHome({ named: options.value.home }) });
  if (listed.isErr()) {
    for (const line of listed.error) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  const { found, matching, searched, closeAtTop, unsearchable } = findPages({ limit, pages: listed.value, words });
  for (const line of foundLines({ found, json, matching, searched, closeAtTop, unsearchable })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * The production seams: the store's page list and the two output channels.
 *
 * @returns the dependencies `page find` runs on
 */
export function productionPageFindDeps(): PageFindDeps {
  return {
    listPublishedPages: listStoredPages,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver page find`. */
export const pageFindCommand = defineCommand({
  run: (argv) => runPageFind({ deps: productionPageFindDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
