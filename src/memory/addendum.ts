/**
 * `dated-addendum` — a memory that grew a dated amendment instead of being rewritten.
 *
 * The no-legacy rule says a
 * memory is rewritten in present tense as if it had always read that way. The shape it forbids is a tail like
 * `**Settled <date>:** …` or `- **Read-only, added <date>:** …` — a paragraph whose OPENING announces
 * when it was changed. Such a tail leaves the earlier paragraph standing, so the file argues with itself.
 *
 * ## The criterion, and what it was measured against
 *
 * A paragraph OPENER — a paragraph, heading or list item as markdown splits them ({@link paragraphsOf}) — whose lead-in names an
 * amendment and then its date. A LABEL (a leading bold span or a heading) does with an amendment verb that
 * OPENS A PHRASE — the label's first word (behind an opening bracket or quote, if any), or the first after a
 * comma, semicolon, colon or dash (`--` included) — with the date either straight after the bare verb, a comma,
 * colon or dash allowed (`Settled <date>`, `Updated: <date>`, `Read-only, added <date>`) or up to three words later behind a comma or a parenthesis (`Superseded in part,
 * <date>`); a verb in capitals may also continue a shouted phrase (`SCOPE CHANGED (<date>`, `TIER 3 WIDENED`, `THAT HALF IS
 * SUPERSEDED, <date>`). `Second` or `Third` opening a label does the same way (`Second data point, <date>`);
 * no other ordinal was measured, so `Fourth data point, <date>` is not seen. Plain prose does only with the verb in capitals and the date straight after
 * (`How to apply — CORRECTED <date>`). Either does by opening `As of <date>` or `Since <date>`. Measured
 * over twelve real corpora: every hit a genuine addendum.
 *
 * **It is REPORTED, never refused at write time** — by `memory check`, the reporter after each write, the push
 * `memory gate` and hygiene, where a false hit costs one `--accept`. Eight review passes each found a sound
 * memory in whichever shape a write was refused on, the narrowest included: `- **Narrowed <date>** back to
 * 15 connections` records a pool's history, not an edit to the memory.
 *
 * **Four review passes shaped the criterion, each finding sound prose it read as an amendment.** Three
 * reached the date through a bare preposition — `The monitor was added ON <date>`, `## What changed ON
 * <date>`, `A bulk UPDATE ON <date>` — which reports when something outside happened, so the date must be set
 * off by punctuation or nothing. The fourth used the word as a NOUN inside a phrase — `**An own correction, <date>:**`,
 * `**Slack's rate-limit update, <date>:**`, `**The Node 22 update (<date>):**` — so the verb
 * must open its phrase. `**Second opinion (Codex, <date>):**` stays quiet because the parenthesis opens on
 * a name. What it costs, found by diffing each rule over the backups: `**Now structural, PR <number> (<date>)**`,
 * `**CORRECTED same day, ~<time> <date>**`, `**Second cause of the SAME symptom, not build skew (<date>**`
 * and `**The owner's correction (<date>)**` are not seen, nor a dated snapshot like `**Updated weekly
 * — last run <date>**`.
 *
 * **The paragraph is read as it renders, so an edit that renders identically never changes the verdict or the
 * key.** The lead-in is taken from micromark's rendered text, whitespace collapsed and a code span's content
 * included, because the quote is `memory gate`'s key and a rewrap or a respelling must not re-key a standing
 * addendum.
 * A lower-case `correction` wrapped onto the start of a line (`An own\ncorrection, <date>`) is plain prose and
 * stays quiet, since prose needs the verb in capitals.
 *
 * Stated residue, pinned by tests so it stays a known blind spot rather than a claim: an amendment that does not
 * open its paragraph (`… Since <date> the step is …` mid-paragraph) and a dated lead-in with no amendment word
 * (`**Routing, <date>:**`) are not seen. `**The owner's words, <date>:**` carries no amendment word, which is
 * what keeps a date anchoring when the owner SAID something quiet. An HTML block is never an opener, so a raw-HTML
 * line (`<div>`, `<!--`) that interrupts a tight list item's paragraph is not read even though it renders as
 * that paragraph's next line — joining blocks to mimic that is a hand splitter again.
 */
import { micromark, parse, postprocess, preprocess } from "micromark";

import { splitFrontmatter } from "./parse.js";
import type { MemoryFinding, MemoryLeaf } from "./types.js";

/** The amendment verbs, each spelled as it would open a label in lower case. */
const AMENDMENT_VERBS = [
  "added",
  "adds",
  "update[ds]?",
  "amend(?:ed|ment)?",
  "addendum",
  "widened",
  "tightened",
  "narrowed",
  "extended",
  "revised",
  "corrected",
  "correction",
  "clarified",
  "confirmed",
  "reaffirmed",
  "settled",
  "superseded",
  "reversed",
  "changed",
];

/** The verbs as written lower, Capitalised or SHOUTED — spelled out, because the date beside them is case-sensitive. */
const ANY_CASE_VERB = [
  ...AMENDMENT_VERBS,
  ...AMENDMENT_VERBS.map((verb) => `${verb[0]!.toUpperCase()}${verb.slice(1)}`),
  ...AMENDMENT_VERBS.map((verb) => verb.toUpperCase()),
].join("|");

/**
 * A day and a month as written — `<day> Sep`, `<day> September`, `<day> Sept` — with the three-letter month as capture
 * group 1's tail. Case-sensitive, and the month must end its word, so `3 separate` and `2 decisions` are not
 * dates: both read as one while the pattern ignored case and stopped at three letters, and a sound memory
 * was read as an amendment on it. Each month takes only ITS OWN tail, checked by a lookahead, so a number
 * before `Mary`, `Jane` or `Mart` is a name rather than dates.
 */
export const DAY_MONTH_SOURCE = String.raw`\b(\d{1,2} (?:Jan(?=(?:uary)?\b)|Feb(?=(?:ruary)?\b)|Mar(?=(?:ch)?\b)|Apr(?=(?:il)?\b)|May\b|Jun(?=e?\b)|Jul(?=y?\b)|Aug(?=(?:ust)?\b)|Sep(?=(?:t|tember)?\b)|Oct(?=(?:ober)?\b)|Nov(?=(?:ember)?\b)|Dec(?=(?:ember)?\b)))(?:uary|ruary|ch|il|e|y|ust|tember|t|ober|ember)?\b`;

/** A day-month date with its year when written (`20xx` only, so a day-month followed by `, 1200 rows` stops at the month), or an ISO date. */
const DATE = String.raw`(?:${DAY_MONTH_SOURCE.replaceAll("(\\d", "(?:\\d")}(?:,? 20\d{2}\b)?|\b\d{4}-\d{2}-\d{2}\b)`;

/**
 * What sets a label's date off from a few words before it: a comma (`in part, <date>`, `, measured <date>`) or
 * an opening parenthesis (`(<date>`). Never a bare preposition — `changed on <date>` reports an event.
 */
const DATE_SEPARATOR = String.raw`(?:,\s*(?:measured\s+)?|\s*\(\s*)`;

/**
 * One word between a label's verb and its separator: anything up to whitespace, a comma or a parenthesis, so a
 * word as written counts as one — `rule-10`, `owner's`, `v2.1`, `Zoë` — never only its ASCII `\w` run
 */
const WORD = String.raw`\s+[^\s,(]+`;

/**
 * What may sit between a bare verb and its date: a space, a comma, a colon or a dash (`Updated: <date>`,
 * `Updated — <date>`, `Updated -- <date>`), every one of which a writer uses to hang the date off the verb.
 */
const VERB_TO_DATE = String.raw`(?:,?\s+|\s*(?:[:—–]|--)\s*|\s+-\s+)`;

/** A label prefix ending in a separator that opens a new phrase; `--` is a dash glued or not, `-` only spaced. */
const PHRASE_BREAK = /(?:[,;:—–]|--|\s-)$/;

/** Brackets or quotes a label may open with before what it dates: `(Since <date>)`. */
const OPENING_MARKS = String.raw`[([{"'“‘]*`;

/** A label prefix of {@link OPENING_MARKS} alone, which leaves the verb after it the label's first word. */
const ONLY_OPENING_MARKS = new RegExp(`^${OPENING_MARKS}$`);

/**
 * A label's amendment, its verb (or two joined by `and`) as group 1: the date straight after it (`Settled
 * <date>`) or up to three words later behind a {@link DATE_SEPARATOR} (`Superseded in part, <date>`). Global,
 * because a label may hold a noun use before the phrase that really amends.
 */
const LABEL_AMENDMENT = new RegExp(
  String.raw`\b((?:${ANY_CASE_VERB})(?:\s+(?:and|AND)\s+(?:${ANY_CASE_VERB}))?)\b(?:${VERB_TO_DATE}|(?:${WORD}){0,3}${DATE_SEPARATOR})${DATE}`,
  "g",
);

/** A label opened by an ordinal and up to three words, then a separated date: `Second data point, <date>`. */
const ORDINAL_AMENDMENT = new RegExp(
  String.raw`^${OPENING_MARKS}(?:Second|Third|SECOND|THIRD)(?:${WORD}){1,3}${DATE_SEPARATOR}${DATE}`,
);

/**
 * Prose's amendment: a verb SHOUTED in capitals with the date after it (`How to apply — CORRECTED <date>`).
 * Global, because only a match that {@link startsWord} counts — `AUTO-UPDATED` and `CREATED/UPDATED` are one word.
 */
const SHOUTED_AMENDMENT = new RegExp(
  String.raw`\b(?:${AMENDMENT_VERBS.map((verb) => verb.toUpperCase()).join("|")})\b${VERB_TO_DATE}${DATE}`,
  "g",
);

/** An opener that dates a state before saying anything else: `As of <date>, …`, `Since <date> the step is …`. */
const DATED_STATE_OPENER = new RegExp(String.raw`^${OPENING_MARKS}(?:As of|Since|AS OF|SINCE),?\s+${DATE}`);

/** Patterns anchored at a label's start. */
const LABEL_OPENERS = [DATED_STATE_OPENER, ORDINAL_AMENDMENT];

/** Patterns anchored at plain prose's start. */
const PROSE_OPENERS = [DATED_STATE_OPENER];

/**
 * Whether the rendered text before a verb leaves it starting its own word: nothing, whitespace, an opening
 * bracket or quote, or a {@link PHRASE_BREAK}. One rule for a label and for prose, so a `--` glued to the verb
 * starts a word in both and a `-` or `/` glued to it starts one in neither.
 */
function startsWord({ before }: { before: string }): boolean {
  return before === "" || /[\s([{"'“‘]$/.test(before) || PHRASE_BREAK.test(before);
}

/** Whether a label's amendment verb opens its phrase, given the label text before it. */
function opensPhrase({ before, verb }: { before: string; verb: string }): boolean {
  const trimmed = before.trimEnd();
  // Opening brackets or quotes alone still leave the verb the label's first word: `(Updated <date>)`.
  if (ONLY_OPENING_MARKS.test(trimmed) || PHRASE_BREAK.test(trimmed)) {
    return true;
  }
  // A shout continues only into a NEW word: `AUTO-UPDATED` is one word whose verb opens nothing,
  // while a parenthesis starts one as a space does: `OPTION C (CONFIRMED <date>`.
  return verb === verb.toUpperCase() && startsWord({ before }) && continuesShout({ before });
}

/**
 * Whether a label prefix ends in a SHOUTED phrase: its trailing words carry no lowercase letter and two capitals
 * between them, so `OPTION C`, `TIER 3` and `RULE-10` shout while a lone `I` does not.
 */
function continuesShout({ before }: { before: string }): boolean {
  const shouted: string[] = [];
  // Words stop at a parenthesis as well as a space, as they do between a verb and its date.
  for (const word of before
    .split(/[\s(]+/)
    .filter((part) => part !== "")
    .toReversed()) {
    if (/\p{Ll}/u.test(word)) {
      break;
    }
    shouted.push(word);
  }
  return [...shouted.join("").matchAll(/\p{Lu}/gu)].length >= 2;
}

/** The first eight words of an unbolded opener, which are all of it that counts as its lead-in. */
const LEAD_IN_WORDS = /^\s*(?:\S+\s*){1,8}/;

/** One dated amendment found in a memory. */
export interface DatedAddendum {
  /** 1-based line in the whole file, frontmatter included. */
  readonly line: number;
  /** The lead-in that carried the amendment word and the date, as written, its whitespace collapsed. */
  readonly leadIn: string;
}

/** An opener's judged part: `text` with code spans masked, `raw` the same span as rendered, offsets aligned. */
interface LeadIn {
  readonly text: string;
  readonly raw: string;
  readonly label: boolean;
}

/**
 * The block tokens that hold an opener: a paragraph wherever it sits (a list item, a blockquote), an ATX heading
 * marker and all, and a setext heading's text.
 */
const OPENER_TOKENS = new Set(["paragraph", "atxHeading", "setextHeadingText"]);

/** The block tokens that are headings, and so labels whatever their marker. */
const HEADING_TOKENS = new Set(["atxHeading", "setextHeadingText"]);

/**
 * The leaf tokens whose source renders as itself: text, a code span's content, an escaped character, an autolink,
 * and inline HTML — which micromark escapes into text unless a caller opts into raw HTML, and none here does.
 */
const TEXT_TOKENS = new Set([
  "data",
  "codeTextData",
  "characterEscapeValue",
  "autolinkProtocol",
  "autolinkEmail",
  "htmlTextData",
]);

/**
 * The tokens whose contents never render as text: a link's destination and title, a reference's label, and an
 * image, whose alt text is an attribute rendered flat — so markup inside it must not make a label.
 */
const HIDDEN_TOKENS = new Set(["resource", "reference", "image"]);

/**
 * A byte-order mark opening the body. micromark's `preprocess` skips it without counting an offset and turns NUL
 * into U+FFFD, so the body is normalised the same way first — or every slice after it is read one character off
 *
 */
const LEADING_BOM = /^﻿/;

/** One micromark token, as its event stream carries it. */
type MarkdownToken = ReturnType<typeof postprocess>[number][1];

/** One rendered run of an opener: its text, and whether it is a code span's (quoted, never judged). */
interface Run {
  readonly text: string;
  readonly code: boolean;
}

/**
 * The backtick a code span is quoted between, whatever its delimiter and padding: `` ``cfg`` `` and `` `cfg` ``
 * render alike, so both quote as `` `cfg` `` and a standing key keeps its familiar spelling.
 */
const CODE_QUOTE: Run = { code: true, text: "`" };

/** What a code span's every character reads as when judged: a word character that is no verb, date or separator. */
const CODE_MASK = "x";

/** An opener being read: its rendered runs so far, what is open around the next token, and its leading strong span. */
interface OpenerWalk {
  readonly opener: MarkdownToken;
  readonly runs: Run[];
  hidden: number;
  code: number;
  leadingStrong: MarkdownToken | null;
  labelRuns: number | null;
}

/** One opener of a body: the 1-based body line it opens on, its rendered text, and where a leading strong span ends. */
interface Paragraph {
  readonly line: number;
  readonly heading: boolean;
  readonly raw: string;
  readonly text: string;
  readonly labelEnd: number | null;
}

/** What a character reference renders as, decoded by micromark itself between two letters that keep its whitespace. */
function decodedReference({ source }: { source: string }): string {
  return micromark(`a${source}a`)
    .slice("<p>a".length, -"a</p>".length)
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The run one entered token renders as inside an opener, or `null` when it renders no text there. */
function runOf({ body, token, walk }: { body: string; token: MarkdownToken; walk: OpenerWalk }): Run | null {
  if (walk.hidden > 0) {
    return null;
  }
  const code = walk.code > 0;
  const source = body.slice(token.start.offset, token.end.offset);
  if (token.type === "lineEnding") {
    return { code, text: " " };
  }
  if (token.type === "characterReference") {
    return { code, text: decodedReference({ source }) };
  }
  return TEXT_TOKENS.has(token.type) ? { code, text: source } : null;
}

/** Folds one event inside an opener into its walk. */
function stepWalk({
  body,
  entering,
  token,
  walk,
}: {
  body: string;
  entering: boolean;
  token: MarkdownToken;
  walk: OpenerWalk;
}): void {
  const step = entering ? 1 : -1;
  walk.hidden += HIDDEN_TOKENS.has(token.type) ? step : 0;
  walk.code += token.type === "codeText" ? step : 0;
  if (token.type === "codeText" && walk.hidden === 0) {
    walk.runs.push(CODE_QUOTE);
  }
  if (!entering) {
    walk.labelRuns = token === walk.leadingStrong ? walk.runs.length : walk.labelRuns;
    return;
  }
  if (token.type === "strong" && walk.hidden === 0 && walk.runs.length === 0 && walk.leadingStrong === null) {
    walk.leadingStrong = token;
  }
  const run = runOf({ body, token, walk });
  if (run !== null) {
    walk.runs.push(run);
  }
}

/**
 * An opener's runs joined into what it renders as: whitespace outside code collapsed to one space, `text` the same
 * with each code span MASKED as one opaque word, and `labelEnd` the offset its leading strong span closes at.
 * Masked, not blanked: as spaces a code span vanished as a word, so `` Settled `pool.max` <date> `` put the date
 * straight after the verb and a long span slipped a verb inside the eight-word window.
 */
function renderedOf({ walk }: { walk: OpenerWalk }): Paragraph {
  let raw = "";
  let text = "";
  let labelEnd: number | null = null;
  walk.runs.forEach((run, index) => {
    labelEnd = index === walk.labelRuns ? raw.length : labelEnd;
    const piece = run.code ? run.text : run.text.replaceAll(/\s+/g, " ");
    const joined = !run.code && raw.endsWith(" ") && piece.startsWith(" ") ? piece.slice(1) : piece;
    raw += joined;
    text += run.code ? CODE_MASK.repeat(joined.length) : joined;
  });
  labelEnd = walk.labelRuns === walk.runs.length ? raw.length : labelEnd;
  return { heading: HEADING_TOKENS.has(walk.opener.type), labelEnd, line: walk.opener.start.line, raw, text };
}

/**
 * A body's paragraphs and headings as micromark, the CommonMark parser this repo already renders with, reads them.
 * Hand-written splitters broke on every rewrap markdown renders identically, and reading the source slice broke on
 * every inline spelling that renders identically — `__` for `**`, a hard break, a code span's padding, an autolink
 * for a link, a title on a link. So both what counts as one opener and what
 * it SAYS are the parser's answer: the text is built from the rendered tokens, and two bodies that render alike
 * give the same findings with the same keys.
 */
function paragraphsOf({ body }: { body: string }): readonly Paragraph[] {
  const events = postprocess(
    parse()
      .document()
      .write(preprocess()(body, undefined, true)),
  );
  const paragraphs: Paragraph[] = [];
  let walk: OpenerWalk | null = null;
  for (const [kind, token] of events) {
    if (walk === null) {
      walk =
        kind === "enter" && OPENER_TOKENS.has(token.type)
          ? { code: 0, hidden: 0, labelRuns: null, leadingStrong: null, opener: token, runs: [] }
          : null;
    } else if (token === walk.opener) {
      paragraphs.push(renderedOf({ walk }));
      walk = null;
    } else {
      stepWalk({ body, entering: kind === "enter", token, walk });
    }
  }
  return paragraphs;
}

/**
 * The part of an opener that is judged. A LABEL is a leading strong span (`**` or `__`, which render alike) or a
 * heading of either kind; anything else is plain prose, judged by its first eight words. A strong span that never
 * closes renders its `**` as text, and is judged as a label by the same eight.
 */
function leadInOf({ paragraph }: { paragraph: Paragraph }): LeadIn {
  const { raw, text, labelEnd } = paragraph;
  // A heading is a label whole, so a strong span opening it (`## **Settled** <date>`) never cuts it short.
  if (labelEnd !== null && !paragraph.heading) {
    return { label: true, raw: raw.slice(0, labelEnd), text: text.slice(0, labelEnd) };
  }
  const opened = text.startsWith("**") || text.startsWith("__") ? 2 : 0;
  const label = paragraph.heading || opened > 0;
  const words = LEAD_IN_WORDS.exec(text.slice(opened));
  if (words === null) {
    return { label, raw: "", text: "" };
  }
  // A heading's leading strong span is read whole even past eight words, as it is in a paragraph.
  const wordsEnd = opened + words[0].length;
  const end = labelEnd === null ? wordsEnd : Math.max(wordsEnd, labelEnd);
  return { label, raw: raw.slice(opened, end), text: text.slice(opened, end) };
}

/**
 * Where a label's amendment date ends, or `null` — the first verb opening its phrase wins. A rejected match is
 * retried one character on, never past its end: its three-word run can swallow the verb that does open a phrase
 * (`Pool UPDATE CHANGED (<date>`), which `matchAll` would never try. What comes before
 * the verb is judged on the RENDERED text, code included: blanked, a code span opening the label left the verb
 * looking like its first word (`` `gh` correction, <date> ``).
 */
function labelAmendmentEnd({ leadIn }: { leadIn: LeadIn }): number | null {
  const { raw, text } = leadIn;
  const pattern = new RegExp(LABEL_AMENDMENT.source, "g");
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    // The FIRST verb of a joined pair is the one that opens the phrase: `SCOPE SETTLED and changed` shouts it.
    const verb = match[1]!.split(/\s+/)[0]!;
    if (opensPhrase({ before: raw.slice(0, match.index), verb })) {
      return match.index + match[0].length;
    }
    pattern.lastIndex = match.index + 1;
  }
  return null;
}

/** Where plain prose's shouted amendment date ends, or `null` — the first shouted verb starting its own word wins. */
function shoutedProseEnd({ leadIn }: { leadIn: LeadIn }): number | null {
  const { raw, text } = leadIn;
  const pattern = new RegExp(SHOUTED_AMENDMENT.source, "g");
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (startsWord({ before: raw.slice(0, match.index) })) {
      return match.index + match[0].length;
    }
    pattern.lastIndex = match.index + 1;
  }
  return null;
}

/** Where the date that makes a lead-in an amendment ends, or `null` when it is not one. */
function amendmentEnd({ leadIn }: { leadIn: LeadIn }): number | null {
  const { raw, text, label } = leadIn;
  // Skip only what is blank as RENDERED, so a code span opening the lead-in is never skipped past.
  const skipped = raw.length - raw.trimStart().length;
  for (const pattern of label ? LABEL_OPENERS : PROSE_OPENERS) {
    const match = pattern.exec(text.slice(skipped));
    if (match !== null) {
      return skipped + match.index + match[0].length;
    }
  }
  return label ? labelAmendmentEnd({ leadIn }) : shoutedProseEnd({ leadIn });
}

/**
 * The lead-in quoted through the end of the date that makes it an amendment, or `null` when it is not one. Cut
 * at the date and whitespace-collapsed because the quote is the gate's key: neither an edit after the date nor
 * a rewrap may re-key a standing addendum.
 */
function amendmentLeadIn({ leadIn }: { leadIn: LeadIn }): string | null {
  const end = amendmentEnd({ leadIn });
  if (end === null) {
    return null;
  }
  return leadIn.raw.slice(0, end).replaceAll(/\s+/g, " ").trim();
}

/**
 * Every dated amendment in a memory's body, in document order. The frontmatter is not body, so a date in the
 * `description` is never read here; the body is the one `splitFrontmatter` counted its offset over, since a lone
 * CR it reads as a line break once shifted a raw re-split past the addendum. A code block or an HTML block holds no paragraph, and the parser alone decides
 * where one starts and ends: the line mask the graph checks use toggled on any three backticks and blanked an
 * escaped `\<!--`, dropping an addendum a renderer shows.
 *
 * @param text the whole memory file
 * @returns each opener whose lead-in dates an amendment
 */
export function datedAddenda({ text }: { text: string }): readonly DatedAddendum[] {
  const split = splitFrontmatter({ text });
  const body = split.body.replace(LEADING_BOM, "").replaceAll("\u0000", "�");
  const { bodyOffset } = split;
  const found: DatedAddendum[] = [];
  for (const paragraph of paragraphsOf({ body })) {
    const leadIn = amendmentLeadIn({ leadIn: leadInOf({ paragraph }) });
    if (leadIn !== null) {
      found.push({ leadIn, line: bodyOffset + paragraph.line });
    }
  }
  return found;
}

/**
 * The sentence reported for one dated amendment. It carries NO line number, deliberately: `memory gate`'s
 * accepted debt list keys on the message, and a number in it would re-report every standing addendum the
 * moment an edit above it shifted the line.
 *
 * @param leadIn the lead-in that dated the amendment
 * @returns the finding message
 */
export function datedAddendumMessage({ leadIn }: { leadIn: string }): string {
  return `\`${leadIn}\` dates an amendment — rewrite the memory in present tense as if it had always read this way; a date that anchors when the owner said something opens with the owner's words, not an amendment word`;
}

/**
 * The `dated-addendum` findings for one leaf.
 *
 * @param leaf the parsed leaf, whose `text` is read
 * @returns one finding per dated amendment, each on the opener's line
 */
export function datedAddendumFindings({ leaf }: { leaf: MemoryLeaf }): readonly MemoryFinding[] {
  return datedAddenda({ text: leaf.text }).map((hit) => ({
    check: "dated-addendum" as const,
    file: leaf.file,
    line: hit.line,
    message: datedAddendumMessage({ leadIn: hit.leadIn }),
  }));
}
