/**
 * What `talk find-card` reads before it ranks anything: every board doc as the topic search reads it, and the held
 * Slack drafts the owner's Queue draws, each told what its raising row is about. The ranking is `src/talk/cardFind.ts` and
 * `src/talk/queueDraftFind.ts`; the composing and printing is `./findCardRun.ts`.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { readSlackDraftLinesOrError } from "../../../admit/slackDraftStore.js";
import type { JournalEvidence } from "../../../handover/assemble.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { HisWordsGroup } from "../../../handover/hisWords.js";
import { logger } from "../../../lib/logger.js";
import { foldSlackDraftLog, parseSlackDraftLog, skippedDraftNote } from "../../../outbound/slack/draftLog.js";
import type { DraftMediaOf } from "../../../outbound/slack/draftProof.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { boardRowOwnerWords } from "../../../talk/boardRow.js";
import type { CardText, RowWordMemo } from "../../../talk/cardFind.js";
import { draftsFound, type PlacedDraft, queueDraftsOf } from "../../../talk/queueDraftFind.js";

/**
 * Everything one row says it is about, never its slug: its summary, problem, the owner's words as `board_row` reads them
 * (the ruling and every owner-word section), the quote stored under its anchor and every further steer's, and the
 * question its open ask puts to the owner.
 *
 * @param doc the parsed doc
 * @param hisWords the owner's words on the row as `boardRowOwnerWords` reads them off its file
 * @param question the open ask's question, when the row is waiting on the owner's word
 * @returns the texts the topic search reads
 */
export function cardTextsOf({
  doc,
  hisWords,
  question,
}: {
  doc: HandoverDoc;
  hisWords: readonly string[];
  question: string | undefined;
}): readonly string[] {
  const steers = doc.hisWordsSteers.map((steer) => heldWords({ group: steer.group }));
  return [doc.summary, doc.problem, ...hisWords, heldWords({ group: doc.hisWords }), ...steers, question].filter(
    (text): text is string => text !== undefined,
  );
}

/** The quoted words a stored group holds, or undefined when it holds none. */
function heldWords({ group }: { group: HisWordsGroup }): string | undefined {
  if (group.kind !== "held") {
    return undefined;
  }
  return group.hisWords.words;
}

/**
 * Every doc as the topic search reads it, and the docs the scan never read that would not read whole now.
 *
 * @param journals each doc's run journal, keyed by slug; every doc passed must have one
 * @param scannedOwnerWords the owner's words the scan already took off a doc's text, keyed by path; a doc it lacks is read off
 *   its file
 * @returns the searchable rows, and the paths that could only be searched on their front matter
 */
export function cardRowsOf({
  docs,
  journals,
  scannedOwnerWords,
}: {
  docs: readonly HandoverDoc[];
  journals: ReadonlyMap<string, JournalEvidence>;
  scannedOwnerWords: ReadonlyMap<string, readonly string[]>;
}): { rows: readonly CardText[]; unreadable: readonly string[] } {
  const unreadable: string[] = [];
  const rows = docs.map((doc): CardText => {
    const journal = journals.get(doc.slug)!;
    const run = runDisposition({ events: journal.events, unreadableLines: journal.unreadableLines });
    let question: string | undefined;
    if (run.kind === "waiting-on-owner") {
      question = run.question;
    }
    // The owner's words as the scan took them off the text it read: a second open of every file is half the verb's time
    // on a board of ten thousand docs. A row recovered off the archive was never scanned, so it is read
    // here. A scanned doc deleted since is searched on what the scan read — one snapshot, never a race between two
    // reads of the same file.
    let hisWords = scannedOwnerWords.get(doc.path);
    if (hisWords === undefined) {
      try {
        hisWords = boardRowOwnerWords({ doc, text: readFileSync(doc.path, "utf8") });
      } catch {
        // A doc the scan never read, gone or unreadable now: still searched on its front matter, and counted as not
        // read whole.
        unreadable.push(doc.path);
        hisWords = [];
      }
    }
    return { askedIso: doc.askedIso, path: doc.path, slug: doc.slug, texts: cardTextsOf({ doc, hisWords, question }) };
  });
  return { rows, unreadable };
}

/**
 * The held drafts the owner's Queue draws, each told what its raising row is about, and those the owner's words matched.
 *
 * @param held the folded Slack draft register
 * @param rows every searchable row, so a draft is found by what its raising row is about
 * @param counted the memo the board's own ranking filled, so the rows are not counted a second time
 * @returns the matched drafts, and every draft the Queue draws
 */
export function heldDraftsFound({
  counted,
  docs,
  held,
  mediaOf,
  rows,
  words,
}: {
  counted: RowWordMemo;
  docs: readonly HandoverDoc[];
  held: readonly SlackDraftItem[];
  mediaOf: DraftMediaOf;
  rows: readonly CardText[];
  words: readonly string[];
}): { drafts: readonly PlacedDraft[]; queued: ReturnType<typeof queueDraftsOf> } {
  const rowSummaries = Map.groupBy(
    docs.flatMap((doc) => (doc.summary === undefined ? [] : [{ slug: doc.slug, summary: doc.summary }])),
    (one) => one.slug,
  );
  const queued = queueDraftsOf({
    items: held,
    mediaOf,
    rowSummaries: new Map([...rowSummaries].map(([slug, ones]) => [slug, ones.map((one) => one.summary)])),
  });
  return { drafts: draftsFound({ counted, queued, rows, words }), queued };
}

/**
 * The Slack draft register, folded, as `slack draft list` reads it for the Queue — a line it could not decode said on
 * stderr, as that verb says it — or why the register would not read.
 *
 * @param home the state home whose draft register is read
 * @returns the held drafts, or why the register would not read
 */
export function heldDraftsOf({ home }: { home: string }): Result<readonly SlackDraftItem[], string> {
  const lines = readSlackDraftLinesOrError({ home });
  if (lines.isErr()) {
    return err(lines.error.message);
  }
  const log = parseSlackDraftLog({ lines: lines.value });
  const note = skippedDraftNote({ skipped: log.skipped });
  if (note !== undefined) {
    logger.warn({ msg: note });
  }
  return ok(foldSlackDraftLog({ log }));
}
