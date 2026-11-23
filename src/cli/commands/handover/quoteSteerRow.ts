/**
 * Relating one more of the owner's steers to a board row, and refreshing the ones it holds — the effectful half of
 * `./quoteSteer.ts`. The row is re-read and re-judged immediately before every write, exactly as `./quoteRow.ts`
 * writes the row's own quote, so a row another writer changed in between is judged as it is NOW.
 *
 * Three callers: `handover quote --add-steer` (a session relating the owner's words to a row by anchor), `handover quote`
 * refreshing every steer a row holds, and a console landing on an ask's card (`../talk/cardLandApply.ts`), where a
 * steer the owner spoke with the card open is related before it is recorded as their ruling.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { frontMatterErrorLines } from "../../../handover/frontmatter.js";
import type { HisWords } from "../../../handover/hisWords.js";
import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import { resolveHisWords } from "../../../handover/hisWordsResolve.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { withBoardRowLock } from "./boardRowLock.js";
import { rowText } from "./quotePlan.js";
import { type SteerVerdict, steerSlotFor, steerVerdict, steerWrites, textWithSteer } from "./quoteSteer.js";

/**
 * The owner's words at any anchor of them — the row's own or a steer's — read by the one resolver.
 *
 * @param anchor a `talk:`, `call:`, `talk-call:` or `transcript:` anchor
 * @param home the Slopweaver home the talk records live under
 * @returns the words, or why they would not read
 */
export function readWordsAtAnchor({ anchor, home }: { anchor: string; home: string }): Result<HisWords, HisWordsError> {
  return resolveHisWords({ anchor, home, projectsDir: join(claudeHomeDir(), "projects") });
}

/** What one steer write came to:its verdict as the row stood at the write, whether it wrote, and what stopped it. */
export interface SteerWrite {
  /** `undefined` when the row would not read, so no verdict could be reached. */
  readonly verdict: SteerVerdict | undefined;
  readonly wrote: boolean;
  readonly problems: readonly string[];
}

/**
 * Judge and — when `apply` — write one anchor's steer on the row at `path`, read fresh. A write holds the row's one
 * lock from the read to the write (`./boardRowLock.ts`), so a steer related at the same moment numbers past this one
 * rather than over it, and a `set-priority` or `pause` landing at the same moment is kept rather than written over.
 *
 * @param path the row's file
 * @param anchor the anchor of the owner's words
 * @param read the words read off it
 * @param apply write; without it, only judge
 * @returns the write's outcome
 */
export function writeSteerOnRow({
  path,
  anchor,
  read,
  apply,
}: {
  path: string;
  anchor: string;
  read: Result<HisWords, HisWordsError>;
  apply: boolean;
}): SteerWrite {
  if (!apply) {
    return judgeAndWriteSteer({ anchor, apply, path, read, target: path });
  }
  const locked = withBoardRowLock({
    path,
    write: ({ target }) => judgeAndWriteSteer({ anchor, apply, path, read, target }),
  });
  if (locked.isErr()) {
    return { problems: [locked.error.message], verdict: undefined, wrote: false };
  }
  return locked.value;
}

/**
 * {@link writeSteerOnRow}'s read, judgement and write, run under the row's lock whenever it writes. `target` is the
 * file read and replaced — the real one the lock was taken on — and `path` the row as the caller named it.
 */
function judgeAndWriteSteer({
  path,
  anchor,
  read,
  apply,
  target,
}: {
  path: string;
  anchor: string;
  read: Result<HisWords, HisWordsError>;
  apply: boolean;
  target: string;
}): SteerWrite {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(target);
  } catch (cause: unknown) {
    return { problems: [`cannot read ${path}: ${String(cause)}`], verdict: undefined, wrote: false };
  }
  const decoded = rowText({ bytes });
  if (decoded.isErr()) {
    return { problems: frontMatterErrorLines({ error: decoded.error }), verdict: undefined, wrote: false };
  }
  const text = decoded.value;
  const doc = parseHandoverDoc({ path, text });
  if (doc.problems.length > 0) {
    const problems = [`the board reads a problem in ${path}'s front matter: ${doc.problems.join("; ")}`];
    return { problems, verdict: undefined, wrote: false };
  }
  const slot = steerSlotFor({ anchor, doc });
  if (slot.kind === "answered") {
    return { problems: [], verdict: { index: 0, kind: "answered" }, wrote: false };
  }
  const index = slot.kind === "held" ? slot.steer.index : slot.index;
  const stored = slot.kind === "held" ? slot.steer.group : undefined;
  const verdict = steerVerdict({ anchor, index, read, stored });
  if (!apply || !steerWrites({ verdict }) || !("record" in verdict)) {
    return { problems: [], verdict, wrote: false };
  }
  const edited = textWithSteer({ index, path, record: verdict.record, text });
  if (edited.isErr()) {
    return { problems: frontMatterErrorLines({ error: edited.error }), verdict, wrote: false };
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return { problems: [`could not write ${path}: ${String(cause)}`], verdict, wrote: false };
  }
  return { problems: [], verdict, wrote: true };
}

/**
 * Relate one anchor of the owner's words to the row at `path`: read them off their record and write them as a steer — or
 * refresh the steer already holding that anchor. An anchor whose words will not read yet is related all the same, as
 * an unread steer every `handover quote --apply` retries: the relation is the fact, the words its cache.
 *
 * @param path the row's file
 * @param anchor the anchor of the owner's words
 * @param home the Slopweaver home the talk records live under
 * @param apply write; without it, only judge
 * @returns the write's outcome
 */
export function relateSteer({
  path,
  anchor,
  home,
  apply,
}: {
  path: string;
  anchor: string;
  home: string;
  apply: boolean;
}): SteerWrite {
  return writeSteerOnRow({ anchor, apply, path, read: readWordsAtAnchor({ anchor, home }) });
}
