/**
 * What `./quoteAttach.ts` reads before it plans: the owner's words at the anchor, judged once, and the row's bytes as the
 * rewrite starts from them. Split along that seam — everything here only reads, and the plan and the write stay together.
 */
import { lstatSync, readFileSync } from "node:fs";

import { frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { type HisWords, ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import { hisWordsFromRaw, resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { outsideChairReason } from "../../../profile/supervisorWords.js";
import { rowText } from "./quotePlan.js";

/**
 * The refusals an anchor earns before anything is written, or the owner's words at it.
 *
 * @param home the Slopweaver home the talk records live under
 * @param projectsDir `~/.claude/projects`, where a transcript anchor's session lives
 * @returns the owner's words, or every reason they are not attached
 */
export function wordsToAttach({
  anchor,
  home,
  projectsDir,
}: {
  anchor: string;
  home: string;
  projectsDir: string;
}): HisWords | { readonly refusals: readonly string[] } {
  // ONE read of the record, so the words quoted are the words the checks below judged — two reads could straddle a
  // transcript being replaced.
  const raw = resolveRawWords({ anchor, home, projectsDir });
  if (raw.isErr()) {
    return { refusals: [`${anchor} — ${raw.error.message}`] };
  }
  const words = hisWordsFromRaw({ anchor, raw: raw.value });
  if (words.isErr()) {
    return { refusals: [`${anchor} — ${words.error.message}`] };
  }
  // A line the console typed into the chair is refused by the read itself, naming the record to anchor on instead.
  if (ownerWordsSchemeOf({ anchor }) === "transcript") {
    const outside = outsideChairReason({ anchor, atIso: raw.value.atIso, home });
    if (outside !== undefined) {
      return { refusals: [outside] };
    }
  }
  return words.value;
}

/**
 * The row's text as the rewrite starts from it, or why it is not a row this verb rewrites.
 *
 * @returns the text, or every reason it is not rewritten
 */
export function rowBytesAsText({ path }: { path: string }): string | { readonly refusals: readonly string[] } {
  try {
    // A symlink would be read through and then REPLACED by the atomic rename, rewriting a row that is not physically
    // on the board, so only a regular file is a row this verb writes.
    if (!lstatSync(path).isFile()) {
      return { refusals: [`${path} is not a regular file inside the board directory, so it is not rewritten`] };
    }
    // Decoded as the bulk writer decodes a row: a lossy read would write U+FFFD over a byte outside the group.
    const text = rowText({ bytes: readFileSync(path) });
    if (text.isErr()) {
      return { refusals: frontMatterErrorLines({ error: text.error }) };
    }
    return text.value;
  } catch (cause: unknown) {
    return { refusals: [`cannot read ${path}: ${String(cause)}`] };
  }
}
