/**
 * Which rows a `handover quote` run reads: the whole scope `./quotePlan.ts` draws, or the named slugs, and which
 * files in that scope could not be judged at all. Split from `./quoteRun.ts` along that seam — the verb decides
 * what to do with a row, this decides which rows there are.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { frontMatterFence, type HandoverDoc } from "../../../handover/doc.js";
import { quoteScope } from "./quotePlan.js";

/**
 * The rows a run reads: the whole scope, or the named slugs — each of which must name exactly one row, unless its
 * file is one the scan could not read, which the run reports and fails on rather than calling it unknown.
 *
 * @param docs the board scan
 * @param slugs the named rows, or none for the whole scope
 * @param unreadable the files in scope that would not read, by file name
 * @returns the rows to read, and each named slug that names no one row
 */
export function rowsToRead({
  docs,
  slugs,
  unreadable,
}: {
  docs: readonly HandoverDoc[];
  slugs: readonly string[];
  unreadable: readonly string[];
}): {
  readonly rows: readonly HandoverDoc[];
  readonly unknown: readonly string[];
} {
  const scope = quoteScope({ docs });
  if (slugs.length === 0) {
    return { rows: scope, unknown: [] };
  }
  const unknown = slugs.filter(
    (slug) => !unreadable.includes(`${slug}.md`) && scope.filter((doc) => doc.slug === slug).length !== 1,
  );
  return { rows: scope.filter((doc) => slugs.includes(doc.slug)), unknown };
}

/**
 * The docs the scan read whose front matter does not open the file — a leading BOM, say — so the parser saw no
 * anchor and no group, and whether the row anchors on the owner's words is unknown. Counted with the unreadable files rather
 * than dropped from scope, so a run cannot pass over one silently.
 *
 * @param docs the board scan
 * @returns each such doc's file name
 */
export function fencelessDocs({ docs }: { docs: readonly HandoverDoc[] }): readonly string[] {
  return docs
    .filter((doc) => {
      try {
        return frontMatterFence({ text: readFileSync(doc.path, "utf8") }) === undefined;
      } catch {
        return true;
      }
    })
    .map((doc) => basename(doc.path));
}
