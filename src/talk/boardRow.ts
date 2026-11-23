/**
 * One board row as the console voice reads it — pure, so what the model is shown is a unit test.
 *
 * The voice answers "what am I even looking at" about a card on the queue, and the answer the owner wants
 * opens on the OWNER's words: what they said earlier, then what the supervisor is now clarifying about it. The queue's own reading of a row caps its summary at 320 characters, so
 * the card on screen cannot carry that; this projection of the whole doc can.
 *
 * ## What is kept, and in which order
 *
 * The owner's words first — `ruling:`, the quote and steers stored on the row, and every body section {@link OWNER_WORD_HEADING}
 * matches — because they are
 * what the voice is for. Then the row's question, options, lean and stakes, then the rest of the body. The whole answer is
 * bounded by bytes, and a cut is stated in the payload rather than made silently: a model handed half a doc
 * as if it were the whole one would read the missing half as absent.
 *
 * ## The run's own words, beside the doc's
 *
 * A seat writes where its deliverable is into the QUESTION it records, which lives in the run's journal, never in the
 * doc. One row's doc named no file while its journal's question said
 * `Folder: ~/dev/acme-desktop-tauri … Plan: PLAN.md in the folder.`, and the voice, having read the doc, told the owner
 * the full briefing was not there yet. So the row carries its latest recorded question and every local file the
 * summary, body and question name ({@link localFilesNamed}).
 *
 * ## What is never followed
 *
 * `rulingAnchor:` and `evidence:` name files, and so may the question. They are returned as the strings the doc and
 * journal carry and never opened, so a row cannot turn this read into a read of whatever path it names: the voice
 * reads one through `file_read`, its own bounded door.
 */
import { runDisposition } from "../handover/boardTypes.js";
import type { HandoverDoc } from "../handover/doc.js";
import type { RunEvent } from "../handover/ledger.js";
import { type OpenQuestion, openQuestionAfter } from "../handover/openQuestion.js";
import { heldHisWordsOf } from "../handover/prSteers.js";
import { localFilesNamed } from "./namedFiles.js";

/** The most a row read hands back, in UTF-8 bytes. The page's own tool cap is 24 KiB; this sits inside it. */
export const BOARD_ROW_MAX_BYTES = 16 * 1024;

/**
 * A body heading that opens the owner's own words. The board spells it several ways, each owner-neutral and in the
 * pronoun form docs on disk carry — a "word", "words" or "ruling" heading led by "The owner's" or the pronoun,
 * "Owner ruling…", or a heading ending "in the owner's words" or "in <pronoun> words" — and an ask whose origin sat
 * under any but the first once read back as carrying no words of the owner at all: a heading ending "in <pronoun>
 * words" was invisible to it. A heading that says it "needs <pronoun> word" or "needs the owner's word" is
 * deliberately NOT one: it names a wait, never a quote.
 * Surveyed with `grep -h '^##' ~/.slopweaver/handovers/*.md | grep -i 'h[i]s word\|owner.s word\|ruling'`.
 */
export const OWNER_WORD_HEADING =
  /^#{2,3} (?:(?:His|The owner's) words?\b|(?:His|The owner's) ruling|Owner ruling|.*\bin (?:his|the owner's) words\b|.*, (?:his|the owner's) words\b)/iu;

/** The run's journal as `talk row` read it: its events and the lines it could not decode, or why it would not read. */
export type BoardRowJournal =
  { readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] } | { readonly unread: string };

/** A board slug: lowercase letters, digits and hyphens. Anchored, so a path cannot pass. */
const BOARD_SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/u;

/** The board row the voice is handed. */
export interface BoardRowForVoice {
  readonly slug: string;
  readonly kind: string;
  readonly status: string;
  readonly priority: string | undefined;
  readonly askedIso: string | undefined;
  /** The owner's own words on the row, as {@link boardRowOwnerWords} reads them. */
  readonly ownerWords: readonly string[];
  readonly summary: string | undefined;
  readonly problem: string | undefined;
  readonly options: readonly { readonly option: string; readonly tradeoff: string }[];
  readonly lean: string | undefined;
  readonly risk: string | undefined;
  /** Files the row names, as strings. Never opened. */
  readonly names: readonly string[];
  /** The run's question, as its card reads it, possibly cut; absent when the journal records none. */
  readonly question: string | undefined;
  /**
   * True when {@link question} is the one the owner's card holds open, false for an earlier one since answered or withdrawn,
   * undefined when the journal has undecodable lines and so whether it is held cannot be said.
   */
  readonly questionHeld: boolean | undefined;
  /** Why the journal could not be read, so an absent question is never read as "it asked nothing". */
  readonly journalUnread: string | undefined;
  /** Every local file the summary, body and question name ({@link localFilesNamed}). Never opened. */
  readonly files: readonly string[];
  /** The rest of the body, in order, possibly cut. */
  readonly body: string;
  /** Present when something was cut to fit {@link BOARD_ROW_MAX_BYTES}. */
  readonly truncated: string | undefined;
}

/**
 * Whether a string is shaped like a board slug.
 *
 * @param slug the candidate
 * @returns whether it may name a row
 */
export function isBoardSlug({ slug }: { slug: string }): boolean {
  return BOARD_SLUG.test(slug);
}

/**
 * Project one parsed board doc into what the voice is handed.
 *
 * @param doc the doc's parsed front matter
 * @param text the whole file, whose body is split into sections here
 * @param journal the run's journal events, or why it could not be read
 * @param maxBytes the byte bound on the serialised answer
 * @returns the bounded projection
 */
export function boardRowForVoice({
  doc,
  text,
  journal,
  maxBytes,
}: {
  doc: HandoverDoc;
  text: string;
  journal: BoardRowJournal;
  maxBytes: number;
}): BoardRowForVoice {
  const sections = bodySections({ text });
  const rest = sections.filter((section) => !OWNER_WORD_HEADING.test(section));
  const ownerWords = boardRowOwnerWords({ doc, text });
  const names: string[] = [...doc.evidence];
  if (doc.rulingAnchor !== undefined) {
    names.push(doc.rulingAnchor);
  }
  const body = rest.join("\n\n");
  const { question, questionHeld, journalUnread } = questionOf({ journal });
  const texts = [doc.summary, body, question].filter((one): one is string => one !== undefined);
  const whole: BoardRowForVoice = {
    askedIso: doc.askedIso,
    body,
    files: localFilesNamed({ texts }),
    ownerWords,
    journalUnread,
    kind: doc.kind,
    lean: doc.lean,
    names,
    options: doc.options.map((entry) => ({ option: entry.option, tradeoff: entry.tradeoff })),
    priority: doc.priority,
    problem: doc.problem,
    question,
    questionHeld,
    risk: doc.risk,
    slug: doc.slug,
    status: doc.status,
    summary: doc.summary,
    truncated: undefined,
  };
  return bounded({ maxBytes, whole });
}

/**
 * The question a row carries: the one its card holds open, exactly as the card reads it (`runDisposition`, so a
 * correction is applied and there is one interpretation of "open"); else the latest one it recorded, marked as no
 * longer held, because a seat that finished still wrote where its deliverable is. A journal with undecodable lines
 * carries why, beside the latest question its readable lines record, held or not unknown: one bad line elsewhere
 * must not hide where the deliverable is.
 */
function questionOf({ journal }: { journal: BoardRowJournal }): {
  question: string | undefined;
  questionHeld: boolean | undefined;
  journalUnread: string | undefined;
} {
  if ("unread" in journal) {
    return { journalUnread: journal.unread, question: undefined, questionHeld: undefined };
  }
  const run = runDisposition({ events: journal.events, unreadableLines: journal.unreadableLines });
  if (run.kind === "unreadable") {
    return {
      journalUnread: run.reason,
      question: latestRecordedQuestion({ events: journal.events }),
      questionHeld: undefined,
    };
  }
  if (run.kind === "waiting-on-owner") {
    return { journalUnread: undefined, question: run.question, questionHeld: true };
  }
  const earlier = latestRecordedQuestion({ events: journal.events });
  if (earlier === undefined) {
    return { journalUnread: undefined, question: undefined, questionHeld: undefined };
  }
  return { journalUnread: undefined, question: earlier, questionHeld: false };
}

/**
 * The journal's latest recorded question as it last read — asked, then corrected, offered or reshaped — whether or
 * not it has since been answered or withdrawn.
 *
 * The same step the card folds (`openQuestionAfter`), over the whole journal, keeping the last text it held.
 *
 * @param events the journal's events, in order
 * @returns the question's text, or `undefined` when the journal never recorded one
 */
export function latestRecordedQuestion({ events }: { events: readonly RunEvent[] }): string | undefined {
  let open: OpenQuestion | undefined;
  let latest: string | undefined;
  for (const event of events) {
    open = openQuestionAfter({ event, open });
    if (open !== undefined) {
      latest = open.question;
    }
  }
  return latest;
}

/**
 * The owner's own words on one row, as every voice read takes them: its `ruling:`, then the quote stored at its anchor, then
 * each further steer stored beside it (`../handover/hisWordsSteers.ts`), then each body section
 * {@link OWNER_WORD_HEADING} matches, in order. `board_row` reads them whole and `talk find-card` searches them, so a
 * row's words are the same words to both.
 *
 * The stored quote and steers are the half a relay row carries most often, and the half this once skipped: MEASURED:
 * a relay row's pack entry read `ownerWords: []` beside six stored
 * steers (`grep -cE '^(h[i]s|owner)WordsSteer.Words:' ~/.slopweaver/handovers/<relay-row-slug>.md`).
 * A steer that does not read is left out here — the Queue card names its defect; the voice has no use for one.
 *
 * @param doc the doc's parsed front matter
 * @param text the whole file, whose body is split into sections here
 * @returns the owner's words on the row, ruling first
 */
export function boardRowOwnerWords({ doc, text }: { doc: HandoverDoc; text: string }): readonly string[] {
  const words: string[] = [];
  if (doc.ruling !== undefined) {
    words.push(doc.ruling);
  }
  words.push(...heldHisWordsOf({ doc }).map((quote) => quote.words));
  words.push(...bodySections({ text }).filter((section) => OWNER_WORD_HEADING.test(section)));
  return words;
}

/** The body after the front matter, split at each `##` or `###` heading, blank sections dropped. */
function bodySections({ text }: { text: string }): readonly string[] {
  const match = /^---\n[\s\S]*?\n---\n?/u.exec(text);
  const body = match === null ? text : text.slice(match[0].length);
  return body
    .split(/\n(?=#{2,3} )/u)
    .map((section) => section.trim())
    .filter((section) => section !== "" && !section.startsWith("# "));
}

/**
 * Cut the projection to fit, and say what was cut: the body, then the question, then why the journal could not be
 * read, then the doc's names, options,
 * summary, problem, lean and risk, then — only on a doc with oversized front matter — its slug, kind, status, priority
 * and asked instant to 160 characters each, then the files from the end, then the owner's words from the end.
 *
 * The owner's words are the last thing to go because they are what the read is for, and the files next-to-last because a
 * deliverable a run left in one is what this read was widened for; the body goes first because the
 * summary usually restates it. `files` was read off the whole texts before any cut, so a path the cut body or question
 * loses is still handed over, and the first-named files outlast the rest. Every check measures the row WITH its cut
 * note and its ellipses, so what comes back fits whenever the bound holds the cut skeleton — a few hundred bytes
 * against {@link BOARD_ROW_MAX_BYTES}.
 */
function bounded({ whole, maxBytes }: { whole: BoardRowForVoice; maxBytes: number }): BoardRowForVoice {
  const size = byteLength({ value: whole });
  if (size <= maxBytes) {
    return whole;
  }
  const noted = ({ row, notes }: { row: BoardRowForVoice; notes: readonly string[] }): BoardRowForVoice => ({
    ...row,
    truncated: `the row is ${String(size)} bytes; this read carries ${String(maxBytes)}; cut: ${notes.join(", ")}`,
  });
  const cuts: string[] = [];
  let row = whole;
  for (const stage of CUT_STAGES) {
    if (byteLength({ value: noted({ notes: cuts, row }) }) <= maxBytes) {
      break;
    }
    const done = stage({
      fitsWith: ({ row: candidate, note }) =>
        byteLength({ value: noted({ notes: [...cuts, note], row: candidate }) }) <= maxBytes,
      row,
    });
    if (done !== undefined) {
      row = done.row;
      cuts.push(done.note);
    }
  }
  return noted({ notes: cuts, row });
}

/** Whether a candidate row fits the bound with every cut so far and this cut's own note. */
type FitsWith = (args: { row: BoardRowForVoice; note: string }) => boolean;

/** One cut: the row it leaves and the note naming it, or undefined when the row has nothing for it to cut. */
type CutStage = (args: {
  row: BoardRowForVoice;
  fitsWith: FitsWith;
}) => { readonly row: BoardRowForVoice; readonly note: string } | undefined;

/** The body, by fifths. */
const cutBody: CutStage = ({ row, fitsWith }) => {
  if (row.body === "") {
    return undefined;
  }
  const note = "body";
  return {
    note,
    row: { ...row, body: shortened({ fits: (body) => fitsWith({ note, row: { ...row, body } }), text: row.body }) },
  };
};

/** The journal's question, by fifths. */
const cutQuestion: CutStage = ({ row, fitsWith }) => {
  const asked = row.question;
  if (asked === undefined) {
    return undefined;
  }
  const note = "question";
  const question = shortened({
    fits: (candidate) => fitsWith({ note, row: { ...row, question: candidate } }),
    text: asked,
  });
  return { note, row: { ...row, question } };
};

/** Why the journal could not be read, by fifths: the one field no cut reached. */
const cutJournalUnread: CutStage = ({ row, fitsWith }) => {
  const unread = row.journalUnread;
  if (unread === undefined) {
    return undefined;
  }
  const note = "why the journal could not be read";
  const journalUnread = shortened({
    fits: (candidate) => fitsWith({ note, row: { ...row, journalUnread: candidate } }),
    text: unread,
  });
  return { note, row: { ...row, journalUnread } };
};

/** The doc's names, options, summary, problem, lean and risk, whole. */
const cutDocProse: CutStage = ({ row }) => ({
  note: "names, options, summary, problem, lean and risk",
  row: { ...row, lean: undefined, names: [], options: [], problem: undefined, risk: undefined, summary: undefined },
});

/**
 * The doc's own front-matter fields, to 160 characters each. Only a doc whose own front matter is oversized reaches
 * here: `talk row` checks the slug it was asked for, never the one the doc declares.
 */
const cutDocFields: CutStage = ({ row }) => {
  const cutTo = ({ text }: { text: string }): string => (text.length > 160 ? `${text.slice(0, 160)} …` : text);
  return {
    note: "the doc's own slug, kind, status, priority and asked instant",
    row: {
      ...row,
      askedIso: row.askedIso === undefined ? undefined : cutTo({ text: row.askedIso }),
      kind: cutTo({ text: row.kind }),
      priority: row.priority === undefined ? undefined : cutTo({ text: row.priority }),
      slug: cutTo({ text: row.slug }),
      status: cutTo({ text: row.status }),
    },
  };
};

/** The files from the end, saying how many of them it kept. */
const cutFiles: CutStage = ({ row, fitsWith }) => {
  const all = row.files.length;
  if (all === 0) {
    return undefined;
  }
  const noteFor = ({ kept }: { kept: number }): string => `files (kept the first ${String(kept)} of ${String(all)})`;
  let kept = all;
  while (kept > 0 && !fitsWith({ note: noteFor({ kept }), row: { ...row, files: row.files.slice(0, kept) } })) {
    kept -= 1;
  }
  return { note: noteFor({ kept }), row: { ...row, files: row.files.slice(0, kept) } };
};

/** The owner's words from the end: a long last one is cut by fifths before it is dropped. */
const cutOwnerWords: CutStage = ({ row, fitsWith }) => {
  if (row.ownerWords.length === 0) {
    return undefined;
  }
  const note = "the owner's words from the end";
  let words = [...row.ownerWords];
  while (words.length > 0 && !fitsWith({ note, row: { ...row, ownerWords: words } })) {
    const last = words[words.length - 1]!;
    words =
      last.length > 200
        ? [...words.slice(0, -1), `${last.slice(0, Math.floor(last.length * 0.8))} …`]
        : words.slice(0, -1);
  }
  return { note, row: { ...row, ownerWords: words } };
};

/** The cuts, in the order the voice can best spare what each removes. */
const CUT_STAGES: readonly CutStage[] = [
  cutBody,
  cutQuestion,
  cutJournalUnread,
  cutDocProse,
  cutDocFields,
  cutFiles,
  cutOwnerWords,
];

/**
 * A text cut by fifths until it fits with its ellipsis, or nothing when no part of it does.
 *
 * @param text the whole text
 * @param fits whether a candidate, ellipsis included, fits
 * @returns the cut text, ending ` …`, or `""`
 */
function shortened({ text, fits }: { text: string; fits: (candidate: string) => boolean }): string {
  let kept = text;
  while (kept.length > 0 && !fits(`${kept} …`)) {
    kept = kept.slice(0, Math.floor(kept.length * 0.8));
  }
  return kept === "" ? "" : `${kept} …`;
}

/** The UTF-8 size of a value as the tool route will serialise it. */
function byteLength({ value }: { value: unknown }): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
