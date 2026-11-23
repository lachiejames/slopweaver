/**
 * One board row quoted: the owner's words read off its anchor and written into its front matter, re-read and re-judged
 * immediately before the write. `./quoteRun.ts` runs it over the board; a card landing runs it over the one row it
 * just landed on (`../talk/cardLandApply.ts`), because a `call:` row is registered before its landing is appended
 * and so is born with nothing to quote.
 */
import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { isRecord } from "#lib/parsers.js";
import type { Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { type HisWords, ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import { steerAnchor } from "../../../handover/hisWordsSteers.js";
import { withBoardRowLock } from "./boardRowLock.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { type QuoteVerdict, quoteVerdict, rowText, textWithHisWords } from "./quotePlan.js";
import { readWordsAtAnchor, relateSteer } from "./quoteSteerRow.js";

/**
 * The owner's words at a row's anchor.
 *
 * @param doc the row as the board read it
 * @param home the Slopweaver home the talk records live under
 * @returns the words or why they would not read, or `undefined` when the anchor names none and nothing is read
 */
export function readRowAnchor({
  doc,
  home,
}: {
  doc: HandoverDoc;
  home: string;
}): Result<HisWords, HisWordsError> | undefined {
  const anchor = doc.anchor;
  if (anchor === undefined || ownerWordsSchemeOf({ anchor }) === undefined) {
    return undefined;
  }
  return readWordsAtAnchor({ anchor, home });
}

/**
 * Whether a verdict writes the row.
 *
 * @returns false for a row already current, still unread, or malformed
 */
export function quoteWrites({ verdict }: { verdict: QuoteVerdict }): boolean {
  return verdict.kind !== "current" && verdict.kind !== "still-unread" && verdict.kind !== "malformed";
}

/** What one quote write came to: every reason nothing was written, and whether the re-read found it already current. */
interface QuotedRowWrite {
  readonly problems: readonly string[];
  readonly current: boolean;
}

/**
 * Write one row, re-read and re-judged as it stands now, under the row's one lock (`./boardRowLock.ts`) so a steer
 * related, or any other row edit made, at the same moment is never written over.
 *
 * @param read the words read off the anchor the scan saw, reused rather than read a second time
 * @returns every reason nothing was written, and whether the re-read found it already current
 */
export function writeQuotedRow({
  doc,
  read,
}: {
  doc: HandoverDoc;
  read: Result<HisWords, HisWordsError> | undefined;
}): QuotedRowWrite {
  const locked = withBoardRowLock({
    path: doc.path,
    write: ({ target }) => judgeAndWriteQuote({ doc, read, target }),
  });
  if (locked.isErr()) {
    return { current: false, problems: [locked.error.message] };
  }
  return locked.value;
}

/**
 * {@link writeQuotedRow}'s read, judgement and write, run under the row's lock. `target` is the file read and
 * replaced — the real one the lock was taken on — and `doc.path` the row as the board named it.
 */
function judgeAndWriteQuote({
  doc,
  read,
  target,
}: {
  doc: HandoverDoc;
  read: Result<HisWords, HisWordsError> | undefined;
  target: string;
}): QuotedRowWrite {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(target);
  } catch (cause: unknown) {
    return { current: false, problems: [`cannot read ${doc.path}: ${String(cause)}`] };
  }
  const decoded = rowText({ bytes });
  if (decoded.isErr()) {
    return { current: false, problems: frontMatterErrorLines({ error: decoded.error }) };
  }
  const text = decoded.value;
  const now = parseHandoverDoc({ path: doc.path, text });
  // The words were read off the anchor the scan saw; a row re-anchored since is judged by the next run.
  if (now.slug !== doc.slug || now.problems.length > 0 || now.anchor !== doc.anchor) {
    return { current: false, problems: [`${doc.path} changed under the run and no longer reads as ${doc.slug}`] };
  }
  const verdict = quoteVerdict({ doc: now, read });
  if (!quoteWrites({ verdict })) {
    return { current: true, problems: [] };
  }
  const record = "record" in verdict ? verdict.record : undefined;
  const edited = textWithHisWords({ path: doc.path, record, text });
  if (edited.isErr()) {
    return { current: false, problems: frontMatterErrorLines({ error: edited.error }) };
  }
  if (edited.value === text) {
    return { current: true, problems: [] };
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return { current: false, problems: [`could not write ${doc.path}: ${String(cause)}`] };
  }
  return { current: false, problems: [] };
}

/**
 * Whether the row has left a board that is still there: its board directory resolves to a directory, and no entry —
 * a dangling symlink included — stands at `path` inside it.
 */
function rowLeftBoard({ path }: { path: string }): boolean {
  try {
    if (!statSync(dirname(path)).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    lstatSync(path);
    return false;
  } catch {
    return true;
  }
}

/**
 * The text of the row a landing points at. An archived or absent row is not on the queue, so there is no card to lead
 * with the words and nothing to report. Any OTHER failure is a live row this writer cannot read, and a landing that
 * reported it quoted would be a silent success. ENOENT alone does not say the row left: a dangling
 * symlink at the path reads the same, and so does a board reached through a directory symlink that now points nowhere
 * — each a row that cannot be reached rather than one that left the board.
 */
function readLandedRow({
  path,
}: {
  path: string;
}): { readonly kind: "read"; readonly text: string } | { readonly kind: "skip"; readonly problems: readonly string[] } {
  try {
    return { kind: "read", text: readFileSync(path, "utf8") };
  } catch (cause: unknown) {
    if (isRecord(cause) && cause["code"] === "ENOENT" && rowLeftBoard({ path })) {
      return { kind: "skip", problems: [] };
    }
    return { kind: "skip", problems: [`cannot read ${path} to quote it: ${String(cause)}`] };
  }
}

/**
 * Quote the live row a card landing points at, once the landing it reads is on the ledger. Only `call:` anchors among
 * the landing's own are touched — the one kind whose words come off this ledger: the row's own quote when it is
 * anchored on one, and each further steer holding one (an ask a ruling landed on relates the utterance as a steer
 * before the ledger row exists, `../talk/cardLandApply.ts`). A relay's `talk:` words were quoted when it was made.
 *
 * @param path the row's file on the live board
 * @param anchors the anchors the landing carries
 * @param home the Slopweaver home the ledger lives under
 * @returns every reason the row was not quoted — empty when it was, or when it was not the landing's row
 */
export async function quoteLandedRow({
  path,
  anchors,
  home,
}: {
  path: string;
  anchors: readonly string[];
  home: string;
}): Promise<readonly string[]> {
  const read = readLandedRow({ path });
  if (read.kind !== "read") {
    return read.problems;
  }
  const doc = parseHandoverDoc({ path, text: read.text });
  const landed = new Set(anchors.filter((one) => ownerWordsSchemeOf({ anchor: one }) === "call"));
  const problems: string[] = [];
  let wrote = false;
  const anchor = doc.anchor;
  if (anchor !== undefined && landed.has(anchor)) {
    const written = writeQuotedRow({ doc, read: readRowAnchor({ doc, home }) });
    for (const problem of written.problems) {
      problems.push(problem);
    }
    wrote = written.problems.length === 0 && !written.current;
  }
  const steers = doc.hisWordsSteers.map((steer) => steerAnchor({ steer })).filter((one) => one !== undefined);
  for (const one of steers.filter((steer) => landed.has(steer))) {
    const written = relateSteer({ anchor: one, apply: true, home, path });
    for (const problem of written.problems) {
      problems.push(problem);
    }
    wrote = wrote || written.wrote;
  }
  if (wrote && (await mirrorAfterWrite({ home, path, verb: "quote" }))) {
    problems.push(`the quote on ${doc.slug} was written, but its mirror failed`);
  }
  return problems;
}
