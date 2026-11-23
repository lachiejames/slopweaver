/**
 * `slopweaver talk file read --words`: one published page as its words, every credential masked over the WORDS.
 *
 * The order is the whole point. Masking the markup and then decoding it
 * returned a credential the mask never saw — `<p>ghp&#95;AAAA…</p>` matches no token shape as HTML and reads
 * `ghp_AAAA…` once `&#95;` is decoded, and a tag splitting a token (`ghp_<b></b>AAAA…`) is joined the same way. So
 * the page is read whole through {@link readLocalFile} (masked once as markup, which costs nothing), turned into
 * words by `./pageWords.ts`, and only then windowed and masked again, with the same fail-closed survivor check a
 * text window gets. Offsets, `size` and `nextFrom` count bytes of the WORDS, so `--from` continues a words read.
 *
 * Residue, stated: the markup is masked BEFORE it is parsed, because `readLocalFile` never hands back
 * an unmasked byte, and that boundary is worth more than a perfect parse. So a denylist entry that is itself a word of
 * HTML — a tag or attribute name such as `script` — rewrites the markup it matches, and the parse reads what is left:
 * a script's text can then come back as words. Nothing unmasked does, since the words are masked again; the denylist
 * holds literal secrets, never markup.
 */
import { err, ok, type Result } from "../lib/result.js";

import { utf8BoundaryAtOrBefore } from "./codeBounds.js";
import { TalkErrors } from "./errors.js";
import { type RedactedText, redactWindow, survivingSecrets } from "./fileRedaction.js";
import { type LocalRead, type LocalReadPolicy, readLocalFile } from "./localFile.js";
import { type LocalFileError, LocalFileErrors } from "./localFileErrors.js";
import type { LocalImageRead } from "./localImage.js";
import { pageWords } from "./pageWords.js";

/**
 * The most bytes of markup one words read takes in whole. MEASURED: the largest page published in a week was 97 KiB
 * (repro: `find ~/.slopweaver/pages -name index.html -size +64k`, the week's pages), so a
 * page over this is not a briefing, and it is refused rather than read in part as words.
 */
export const PAGE_WORDS_SOURCE_MAX_BYTES = 4 * 1024 * 1024;

/** A page's file name. */
const PAGE_EXTENSION = /\.html?$/iu;

/**
 * Read one page as its words: whole, converted, then one bounded window of the words masked.
 *
 * @param raw the absolute or `~/` path asked for
 * @param from the byte offset into the WORDS to start at, from a previous read's `nextFrom`
 * @param budget the most bytes of words one read carries
 * @param policy what is refused and masked
 * @returns the window of words, or the one reason it could not be read
 */
export function readPageWords({
  raw,
  from,
  budget,
  policy,
}: {
  raw: string;
  from: number;
  budget: number;
  policy: LocalReadPolicy;
}): Result<LocalRead, LocalFileError> {
  const markup = readLocalFile({ budget: PAGE_WORDS_SOURCE_MAX_BYTES, from: 0, policy, raw });
  return pageWordsOf({ budget, denylist: policy.denylist, from, markup });
}

/**
 * One page as its words, from its markup already read whole and masked once as markup: by {@link readPageWords} off
 * disk, or by `./heldPage.ts` out of the store.
 *
 * @param markup the first, markup-masked read of the whole page, or why it failed
 * @param from the byte offset into the WORDS to start at, from a previous read's `nextFrom`
 * @param budget the most bytes of words one read carries
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @returns the window of words, or the one reason it could not be read
 */
export function pageWordsOf({
  markup,
  from,
  budget,
  denylist,
}: {
  markup: Result<LocalRead | LocalImageRead, LocalFileError>;
  from: number;
  budget: number;
  denylist: readonly string[];
}): Result<LocalRead, LocalFileError> {
  if (markup.isErr()) {
    return err(markup.error);
  }
  const page = markup.value;
  if (page.kind !== "text" || !PAGE_EXTENSION.test(page.resolvedPath)) {
    return err(LocalFileErrors.notAPage({ path: page.path, why: "it is not an HTML page" }));
  }
  if (page.window.truncated) {
    return err(
      LocalFileErrors.notAPage({
        path: page.path,
        why: `it is over ${String(PAGE_WORDS_SOURCE_MAX_BYTES)} bytes, more than one read takes whole`,
      }),
    );
  }
  const words = Buffer.from(pageWords({ html: page.text }), "utf8");
  if (from > 0 && from >= words.length) {
    return err(TalkErrors.windowInvalid({ from, size: words.length }));
  }
  const carried = wordsWindow({ budget, from, words });
  const before = words.subarray(0, from).toString("utf8");
  const inside = carried.toString("utf8");
  const after = words.subarray(from + carried.length).toString("utf8");
  const masked = redactWindow({
    context: `${before}${inside}${after}`,
    denylist,
    end: before.length + inside.length,
    source: false,
    start: before.length,
  });
  const survivors = survivingSecrets({ denylist, text: masked.text });
  if (survivors.length > 0) {
    return err(LocalFileErrors.credentialSurvived({ labels: survivors, path: page.path }));
  }
  const end = from + carried.length;
  const truncated = end < words.length;
  return ok({
    kind: "text",
    outline: [],
    outlineCut: false,
    path: page.path,
    redactions: mergedRedactions({ first: page.redactions, second: masked.redactions }),
    resolvedPath: page.resolvedPath,
    size: words.length,
    text: masked.text,
    window: { end, nextFrom: truncated ? end : null, start: from, truncated },
  });
}

/**
 * The words a window carries from `from`: all of the rest when it fits the budget, else up to its last line break,
 * else to a UTF-8 boundary for one line longer than the budget.
 */
function wordsWindow({ words, from, budget }: { words: Buffer; from: number; budget: number }): Buffer {
  const rest = words.subarray(from);
  if (rest.length <= budget) {
    return rest;
  }
  const lastBreak = rest.subarray(0, budget).lastIndexOf(0x0a);
  if (lastBreak >= 0) {
    return rest.subarray(0, lastBreak + 1);
  }
  return rest.subarray(0, utf8BoundaryAtOrBefore({ at: budget, bytes: rest }));
}

/** Two passes' mask counts as one, summed per label, first seen first. */
function mergedRedactions({
  first,
  second,
}: {
  first: RedactedText["redactions"];
  second: RedactedText["redactions"];
}): RedactedText["redactions"] {
  const counts = new Map<string, number>();
  for (const { label, count } of [...first, ...second]) {
    const prior = counts.get(label);
    counts.set(label, prior === undefined ? count : prior + count);
  }
  return [...counts].map(([label, count]) => ({ count, label }));
}
