/**
 * `slopweaver store pages-import`'s arguments, and the lines its report prints. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { PublishedPagesWriteCounts } from "../../../store/publishedPages/importStore.js";
import type { PublishedPagesCounts } from "../../../store/publishedPages/project.js";

/** What the verb was asked to do. */
export interface PagesImportArgs {
  readonly home: string | undefined;
  /** Read and check both folders, write nothing and open no connection. */
  readonly dryRun: boolean;
  readonly json: boolean;
}

/** What one run did, as the report prints it. */
export interface PagesImportReport {
  readonly dryRun: boolean;
  /** What the folders hold; absent when the folders were refused before they could be counted. */
  readonly counts: PublishedPagesCounts | undefined;
  /** What the store write changed; absent on a dry run and on any refusal. */
  readonly writes: PublishedPagesWriteCounts | undefined;
  /** Every refusal's message. Non-empty means nothing was written. */
  readonly refusals: readonly string[];
}

/** How many refusals, and store-only keys, are spelled before the rest are summarised. */
const SPELLED_CAP = 20;

/**
 * Parse the verb's arguments.
 *
 * @param argv the argument list after the verb itself
 * @returns the arguments, or the refusal lines to print — display-only, so the default error list
 */
export function parsePagesImportArgs({ argv }: { argv: readonly string[] }): Result<PagesImportArgs> {
  const problems: string[] = [];
  let home: string | undefined;
  let dryRun = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--dry-run") {
      dryRun = true;
    } else if (token === "--json") {
      json = true;
    } else if (token === "--home") {
      index += 1;
      home = argv[index];
      if (home === undefined) {
        problems.push("--home needs a directory");
      }
    } else {
      problems.push(`unexpected argument: ${token}`);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ dryRun, home, json });
}

/**
 * The report as the lines a human reads.
 *
 * @param report what the run did
 * @returns the lines
 */
export function pagesImportLines({ report }: { report: PagesImportReport }): readonly string[] {
  const lines = report.counts === undefined ? [] : countLines({ counts: report.counts });
  if (report.refusals.length > 0) {
    lines.push(`${String(report.refusals.length)} refusal(s), so nothing was uploaded or written:`);
    lines.push(...spelled({ items: report.refusals }));
    return lines;
  }
  if (report.writes === undefined) {
    lines.push("DRY RUN — nothing was written and no connection was opened, so store-only pages were not counted");
    return lines;
  }
  const { writes } = report;
  lines.push(
    `written: ${String(writes.objects)} object(s), ${String(writes.blobs)} body row(s), ${String(writes.pages)} page ` +
      `row(s), ${String(writes.versions)} version(s), ${String(writes.filesWritten)} file row(s); ` +
      `${String(writes.filesRemoved)} file row(s) removed`,
  );
  lines.push(`store-only pages, left untouched: ${String(writes.storeOnlyPages.length)}`);
  lines.push(...spelled({ items: writes.storeOnlyPages }));
  return lines;
}

/**
 * The folder counts as lines.
 *
 * @param counts what the folders hold
 * @returns three lines
 */
function countLines({ counts }: { counts: PublishedPagesCounts }): string[] {
  return [
    `store pages-import: ${String(counts.localPages)} page(s) and ${String(counts.historiesWithoutPage)} history(ies) with ` +
      `no page; ${String(counts.files)} file(s), ${String(counts.versions)} version(s), ` +
      `${String(counts.distinctBodies)} distinct body(ies), ${String(counts.bytes)} bytes`,
    `published at: ${String(counts.publishedAtFromFreeze)} from the freeze matching the page, ` +
      `${String(counts.publishedAtFromModified)} from the page file's modification time`,
    `${String(counts.unservedFiles)} file(s) no reader serves carried as opaque bytes; ` +
      `${String(counts.finderMetadataSkipped)} Finder .DS_Store file(s) passed over`,
  ];
}

/**
 * A list as indented lines, the first few spelled and the rest summarised.
 *
 * @param items what to list
 * @returns the lines
 */
function spelled({ items }: { items: readonly string[] }): readonly string[] {
  const lines = items.slice(0, SPELLED_CAP).map((item) => `  ${item}`);
  const hidden = items.length - SPELLED_CAP;
  if (hidden > 0) {
    lines.push(`  … and ${String(hidden)} more`);
  }
  return lines;
}
