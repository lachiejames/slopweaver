/**
 * The owner's own words behind a board row — the excerpt a queue card leads with, stored on the row's front matter.
 *
 * The owner's exact words sit prominent on the expanded queue card, because a direct quote is what lets them react,
 * and every existing card carries one retroactively. A row's `anchor:` says WHERE the owner said it; this is WHAT they
 * said there, read off the record the anchor names (`./hisWordsResolve.ts`) and written beside it as a group of flat
 * keys that travel together.
 *
 * ## Why the words are stored rather than read at render time
 *
 * The console never imports from `src/` and reads the board as `handover list --json`. Resolving a transcript
 * pointer walks a transcript of tens of megabytes, so reading every row's words on every board read would tax the
 * one read every surface shares. The words are a CACHE, and not of a frozen record: a call's segment is replaced by
 * a later snapshot and a card landing can grow (`../talk/callRecord.ts`, `../talk/cardLanding.ts`). So
 * `handover quote` re-reads every anchor it is given and rewrites any group that no longer equals the record.
 *
 * ## A read that failed is recorded too
 *
 * A card refuses when its anchor names the owner's words and no quote is stored — the promise is that those words lead it.
 * An anchor whose record will not read (a hand-typed `transcript:<handoff>#<turn>` from before pointers were
 * checked, a turn file that is gone) does not name words anyone can quote, so it is stored as `unread` with the
 * reason, and its card says so instead of refusing forever. MEASURED on the first dry run over the live board:
 * 871 rows in scope, 183 of them unreadable, 153 of those a malformed legacy pointer
 * (`slopweaver handover quote | grep -c "not a well-formed pointer"`).
 *
 * ## What the excerpt claims, and what it does not
 *
 * `words` is the record's text with every whitespace run collapsed to one space, and every other control character and
 * every lone surrogate dropped —
 * front matter is read one line per key (`./docFlat.ts`) — capped at {@link HIS_WORDS_MAX} code points, cut only between graphemes, and NOTHING
 * else: no marker is ever written into it, because a quote is only verbatim if every character in it is one the record
 * holds. `cut` says WHERE the quote is known to be short of what the owner said — `start` when the
 * record itself kept only the tail (a relay of a long turn), `end` when this cap applied — and the card draws the
 * ellipsis there. A record that does not say — an old relay, a call file — is `none`: a card says "as <record>
 * captured it".
 *
 * ## A group that does not read is a DEFECT of the quote, never a problem of the doc
 *
 * `./doc.ts`'s `blockerFor` turns any doc problem into `malformed`, and both front-matter editors refuse a doc with
 * problems. So a half-written, duplicated or re-anchored group reported as a doc problem would take the row off the
 * board AND leave the backfill unable to repair it. It is {@link HisWordsGroup}'s `defect` arm instead: the card
 * refuses to draw a quote it cannot trust, and `handover quote --apply` rewrites the group.
 *
 * Pure: strings in, values out.
 */
import { duplicateKeyProblem, flatValue } from "./docFlat.js";

/** The longest excerpt a row stores, in Unicode code points — a paragraph of speech, not a pasted document. */
export const HIS_WORDS_MAX = 1500;

/** Where a quote is known to be short of what the owner said: nowhere, its start (the record kept the tail), or its end. */
export type HisWordsCut = "none" | "start" | "end";

const CUTS: readonly HisWordsCut[] = ["none", "start", "end"];

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** How many code points a string holds — the unit the cap bounds, so no one grapheme can carry a document past it. */
function codePointsIn({ text }: { text: string }): number {
  return Array.from(text).length;
}

/**
 * The longest run of whole graphemes from one end of a text that stays within the cap, so a cut never splits an emoji
 * or a letter from its accent. A lone grapheme longer than the whole cap cannot be kept whole, so it alone is cut at a
 * code point.
 */
function capped({ text, keep }: { text: string; keep: "head" | "tail" }): string {
  const graphemes = Array.from(GRAPHEMES.segment(text), (one) => one.segment);
  if (keep === "tail") {
    graphemes.reverse();
  }
  const kept: string[] = [];
  let used = 0;
  for (const one of graphemes) {
    const size = codePointsIn({ text: one });
    if (used + size > HIS_WORDS_MAX) {
      break;
    }
    kept.push(one);
    used += size;
  }
  if (kept.length === 0) {
    const points = Array.from(text);
    return keep === "head" ? points.slice(0, HIS_WORDS_MAX).join("") : points.slice(-HIS_WORDS_MAX).join("");
  }
  if (keep === "tail") {
    kept.reverse();
  }
  return kept.join("");
}

/** Which kind of record the owner's words were read off — the console maps each to its own words. */
export type HisWordsWhere = "console-typed" | "console-voice" | "call" | "call-landing" | "session";

/** The anchor schemes whose record holds the owner's own words, as opposed to a pointer somewhere else. */
export type HisWordsScheme = "talk" | "call" | "talk-call" | "transcript";

/** The owner's words as a row stores them. */
export interface HisWords {
  /** The excerpt, one line, at most {@link HIS_WORDS_MAX} code points. */
  readonly words: string;
  /**
   * The instant the record carries for them, in `toISOString` spelling. What it MEANS is `where`'s, never "when the
   * owner said it" by default: a console turn's is when it was relayed, a call stretch's when it was last recorded, a
   * card landing's and a session turn's when the owner said or typed it.
   */
  readonly atIso: string;
  readonly where: HisWordsWhere;
  /** The anchor the words were read off — equal to the row's own `anchor:` while the quote is current. */
  readonly anchor: string;
  /** Where the quote is known to be short of what the owner said. */
  readonly cut: HisWordsCut;
}

/** What a writer stores: the words, or the anchor they could not be read off and why. */
export type HisWordsRecord =
  | { readonly kind: "held"; readonly hisWords: HisWords }
  | { readonly kind: "unread"; readonly anchor: string; readonly why: string };

/** A row's stored group: none, a record, or one that does not read and must not be drawn. */
export type HisWordsGroup =
  { readonly kind: "absent" } | HisWordsRecord | { readonly kind: "defect"; readonly why: string };

/** Every key a group may declare — the five a quote is written as, then the one an unread record adds. */
export const OWNER_WORDS_KEYS = [
  "ownerWords",
  "ownerWordsAnchor",
  "ownerWordsIso",
  "ownerWordsWhere",
  "ownerWordsCut",
  "ownerWordsUnread",
] as const;

/** One of {@link OWNER_WORDS_KEYS}. */
export type HisWordsKey = (typeof OWNER_WORDS_KEYS)[number];

/**
 * A key of one of a row's FURTHER steers (`./hisWordsSteers.ts`): `ownerWordsSteer<n>` and the role it stores. Here
 * rather than there so {@link problemsBesideHisWords} owns a steer's duplicate key without importing its reader.
 */
export const OWNER_WORDS_STEER_KEY = /^ownerWordsSteer([1-9][0-9]*)(Anchor|Words|Iso|Where|Cut|Unread)$/u;

/** The prefix every key of a group and of a steer is written under. */
const OWNER_WORDS_PREFIX = "ownerWords";

/** The pronoun spelling of {@link OWNER_WORDS_PREFIX}, which rows already on disk carry. */
const PRONOUN_WORDS_PREFIX = "hisWords";

/**
 * A stored key in its owner-neutral spelling: a key opening with the pronoun prefix reads as the same key under
 * {@link OWNER_WORDS_PREFIX}; every other key is itself.
 *
 * @returns the key a reader looks the value up under
 */
function ownerNeutralKey({ key }: { key: string }): string {
  if (!key.startsWith(PRONOUN_WORDS_PREFIX)) {
    return key;
  }
  return `${OWNER_WORDS_PREFIX}${key.slice(PRONOUN_WORDS_PREFIX.length)}`;
}

/**
 * Every spelling a group's keys may be stored under, for an editor that removes the group whole: each key, then its
 * pronoun twin.
 *
 * @param keys the owner-neutral keys of one group or one steer
 * @returns the keys in both spellings
 */
export function bothSpellingsOf({ keys }: { keys: readonly string[] }): readonly string[] {
  return [...keys, ...keys.map((key) => `${PRONOUN_WORDS_PREFIX}${key.slice(OWNER_WORDS_PREFIX.length)}`)];
}

/**
 * A doc's flat fields as the owner-words readers see them: every key in the owner-neutral spelling, whichever one it
 * was stored under. A key declared in BOTH spellings is reported duplicated, so the group it belongs to reads as a
 * defect exactly as a key declared twice in one spelling does, and the first declaration's value is the one kept.
 *
 * @param fields the doc's flat scalars (`./docFlat.ts` `flatFields`)
 * @param duplicated every key the front matter declared more than once
 * @returns the fields and the duplicated keys, each in the owner-neutral spelling
 */
export function ownerWordsView({
  fields,
  duplicated,
}: {
  fields: ReadonlyMap<string, string>;
  duplicated: readonly string[];
}): { readonly fields: ReadonlyMap<string, string>; readonly duplicated: readonly string[] } {
  const viewed = new Map<string, string>();
  const twice = new Set(duplicated.map((key) => ownerNeutralKey({ key })));
  for (const [key, value] of fields) {
    const neutral = ownerNeutralKey({ key });
    if (viewed.has(neutral)) {
      twice.add(neutral);
      continue;
    }
    viewed.set(neutral, value);
  }
  return { duplicated: [...twice], fields: viewed };
}

const WHERES: readonly HisWordsWhere[] = ["console-typed", "console-voice", "call", "call-landing", "session"];

/** Each scheme's prefix. `talk-call:` does not start with `talk:`, so the order here cannot misread one. */
const SCHEMES: readonly { readonly scheme: HisWordsScheme; readonly prefix: string }[] = [
  { prefix: "talk:", scheme: "talk" },
  { prefix: "call:", scheme: "call" },
  { prefix: "talk-call:", scheme: "talk-call" },
  { prefix: "transcript:", scheme: "transcript" },
];

/**
 * Which owner-words scheme an anchor uses, judged by its prefix alone — the resolver validates the rest. The prefix is
 * matched exactly as the resolver's own parsers spell it, so no anchor is classed as the owner's words that they would
 * refuse as malformed.
 *
 * @param anchor the row's `anchor:`, absent when it declares none
 * @returns the scheme, or `undefined` for an anchor that points somewhere other than the owner's words
 */
export function ownerWordsSchemeOf({ anchor }: { anchor: string | undefined }): HisWordsScheme | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  return SCHEMES.find((one) => anchor.startsWith(one.prefix))?.scheme;
}

/** Text as one flat line the reader gives back byte for byte: well-formed, no control characters, single spaces. */
function oneLine({ text }: { text: string }): string {
  // A control character that is not whitespace is DROPPED, never turned into a space the record does not hold, and
  // before the collapse, so none survives for JSON to escape as `\u00XX` and a record holds only
  // what it reads back as. Whitespace is Unicode's White_Space — a newline, a tab, U+0085 — never JS `\s`, which omits
  // U+0085 and adds U+FEFF; a run of it is one space. A lone surrogate, which no encoding can write, is dropped too
  // rather than replaced by a U+FFFD the record never held. Only the one space a collapse may leave at
  // either end is trimmed — never JS `trim`, which would also take a U+FEFF the record holds; the stored
  // value is quoted, so an edge U+FEFF reads back as written.
  return collapsed({ text }).replace(/^ | $/g, "");
}

/**
 * Whether a stored anchor is one flat line: the flat reader decodes an escaped `\n`, and a refusal quotes the anchor
 * on one line, so an anchor no writer here wrote is a defect rather than a value carried on.
 *
 * @returns true when the anchor reads back as written on one line
 */
export function isFlatAnchor({ anchor }: { anchor: string }): boolean {
  return collapsed({ text: anchor }) === anchor;
}

/** Text with surrogates and non-whitespace controls dropped and every whitespace run one space — edges kept. */
function collapsed({ text }: { text: string }): string {
  return text
    .replace(/\p{Cs}/gu, "")
    .replace(/(?!\p{White_Space})\p{Cc}/gu, "")
    .replace(/\p{White_Space}+/gu, " ");
}

/**
 * A record's text as the excerpt a row stores: one line, well-formed, capped.
 *
 * @param text the record's text, exactly as it holds it
 * @param headLost the record says it kept only the END of what the owner said — the cap then keeps the tail too, and the
 *   quote is cut at its `start`
 * @returns the excerpt and where it is known cut, or `undefined` when nothing but whitespace is left
 */
export function hisWordsExcerpt({
  text,
  headLost,
}: {
  text: string;
  headLost: boolean;
}): { readonly words: string; readonly cut: HisWordsCut } | undefined {
  const flat = oneLine({ text });
  if (flat.length === 0) {
    return undefined;
  }
  if (headLost) {
    // A space the cap exposes is the owner's, not the collapse's edge, so it stays; the stored value is quoted.
    return { cut: "start", words: capped({ keep: "tail", text: flat }) };
  }
  if (codePointsIn({ text: flat }) <= HIS_WORDS_MAX) {
    return { cut: "none", words: flat };
  }
  return { cut: "end", words: capped({ keep: "head", text: flat }) };
}

/**
 * The unread record for an anchor whose words would not read, its reason flattened to the line a row can hold.
 *
 * @param anchor the anchor that was read
 * @param why the resolver's own message
 * @returns the record to store
 */
export function unreadOwnerWords({ anchor, why }: { anchor: string; why: string }): HisWordsRecord {
  return {
    anchor,
    kind: "unread",
    why: capped({ keep: "head", text: oneLine({ text: why }) }),
  };
}

/**
 * The front-matter fields a record is written as, values already spelled for the flat reader.
 *
 * Every string is JSON-quoted, and the flat reader decodes `JSON.stringify`'s whole escape set
 * (`./flatScalarCodec.ts`), so the value read back is the value written.
 *
 * @param record what to store
 * @returns the fields, in {@link OWNER_WORDS_KEYS} order
 */
export function hisWordsFields({ record }: { record: HisWordsRecord }): readonly { key: string; value: string }[] {
  if (record.kind === "unread") {
    return [
      { key: "ownerWordsAnchor", value: JSON.stringify(record.anchor) },
      { key: "ownerWordsUnread", value: JSON.stringify(record.why) },
    ];
  }
  const { hisWords } = record;
  return [
    { key: "ownerWords", value: JSON.stringify(hisWords.words) },
    { key: "ownerWordsAnchor", value: JSON.stringify(hisWords.anchor) },
    { key: "ownerWordsIso", value: JSON.stringify(hisWords.atIso) },
    { key: "ownerWordsWhere", value: hisWords.where },
    { key: "ownerWordsCut", value: hisWords.cut },
  ];
}

/**
 * Whether two records say the same thing — what `handover quote` compares a stored group with a fresh read by.
 *
 * @param stored the record on the row
 * @param read the record the anchor gives now
 * @returns `true` when every field they write is equal
 */
export function sameHisWords({ stored, read }: { stored: HisWordsRecord; read: HisWordsRecord }): boolean {
  const one = hisWordsFields({ record: stored });
  const other = hisWordsFields({ record: read });
  return one.length === other.length && one.every((field, at) => field.value === other[at]!.value);
}

/**
 * A doc's flat problems less the duplicate-key ones a group owns: one of its keys declared twice is the group's
 * DEFECT ({@link hisWordsGroupOf}, `./hisWordsSteers.ts` for a further steer's), which a card draws, never a doc
 * problem that pulls the row and locks both front-matter editors out of the repair.
 *
 * @param problems the flat reader's problems (`./docFlat.ts` `flatFields`)
 * @param duplicated the keys it found declared more than once
 * @returns the problems that are the doc's own
 */
export function problemsBesideHisWords({
  problems,
  duplicated,
}: {
  problems: readonly string[];
  duplicated: readonly string[];
}): readonly string[] {
  const groupKeys: readonly string[] = OWNER_WORDS_KEYS;
  const owned = new Set(
    duplicated
      .filter((key) => {
        const neutral = ownerNeutralKey({ key });
        return groupKeys.includes(neutral) || OWNER_WORDS_STEER_KEY.test(neutral);
      })
      .map((key) => duplicateKeyProblem({ key })),
  );
  return problems.filter((problem) => !owned.has(problem));
}

/** Whether an instant is spelled exactly as `toISOString` spells it — the only spelling a group is written in. */
function isCanonicalIso({ iso }: { iso: string }): boolean {
  const at = Date.parse(iso);
  return !Number.isNaN(at) && new Date(at).toISOString() === iso;
}

/** Whether a stored string is one a writer here could have written: non-blank, one flat line, within the cap. */
function isFlatLine({ text }: { text: string }): boolean {
  // A cut may leave one space of the owner's at an edge, so the edges are not held to `oneLine`'s trim.
  return oneLine({ text }).length > 0 && codePointsIn({ text }) <= HIS_WORDS_MAX && collapsed({ text }) === text;
}

/**
 * The record a group's declared keys spell, or why they spell none — the one validator for the row's own group and
 * for each further steer's, which reads its numbered keys under these names.
 *
 * @param value the stored value under one of the group's keys
 * @param declared every one of the group's keys the row declares
 * @returns the record, or the sentence saying why it does not read
 */
export function hisWordsRecordOf({
  value,
  declared,
}: {
  value: ({ key }: { key: HisWordsKey }) => string | undefined;
  declared: readonly HisWordsKey[];
}): HisWordsRecord | string {
  const anchor = value({ key: "ownerWordsAnchor" });
  if (anchor !== undefined && !isFlatAnchor({ anchor })) {
    return "the stored ownerWordsAnchor is not one line";
  }
  const why = value({ key: "ownerWordsUnread" });
  if (why !== undefined) {
    const extra = declared.filter((key) => key !== "ownerWordsAnchor" && key !== "ownerWordsUnread");
    if (anchor === undefined || extra.length > 0 || !isFlatLine({ text: why })) {
      return "the stored unread record needs exactly ownerWordsAnchor and a one-line ownerWordsUnread";
    }
    return { anchor, kind: "unread", why };
  }
  const missing = OWNER_WORDS_KEYS.filter((key) => key !== "ownerWordsUnread" && value({ key }) === undefined);
  if (missing.length > 0) {
    return `the stored quote is missing ${missing.join(", ")}`;
  }
  const words = value({ key: "ownerWords" })!;
  const atIso = value({ key: "ownerWordsIso" })!;
  const where = WHERES.find((one) => one === value({ key: "ownerWordsWhere" }));
  const cut = CUTS.find((one) => one === value({ key: "ownerWordsCut" }));
  if (where === undefined || cut === undefined || !isCanonicalIso({ iso: atIso })) {
    return "the stored quote's where, cut or instant does not read";
  }
  if (!isFlatLine({ text: words })) {
    return "the stored quote is blank, longer than the cap, or not one line";
  }
  return { hisWords: { anchor: anchor!, cut, atIso, where, words }, kind: "held" };
}

/**
 * Read a doc's group off its flat fields — absent, a record, or a defect naming what is wrong with it.
 *
 * @param fields the doc's flat scalars (`./docFlat.ts` `flatFields`)
 * @param duplicated every key the front matter declared more than once — one of the group's is a defect
 * @param anchor the doc's own `anchor:` — a record read off any other anchor is stale and is a defect
 * @returns the group
 */
export function hisWordsGroupOf({
  fields,
  duplicated,
  anchor,
}: {
  fields: ReadonlyMap<string, string>;
  duplicated: readonly string[];
  anchor: string | undefined;
}): HisWordsGroup {
  // The reader keeps the FIRST of two anchors, which may be the one that is not the owner's words, so the row's quote
  // is a defect whether or not a group is stored — never an absence the backfill and the card pass over.
  if (duplicated.includes("anchor")) {
    return {
      kind: "defect",
      why: "the row declares anchor: more than once, so which of the owner's words it names is unknown",
    };
  }
  const declared = OWNER_WORDS_KEYS.filter((key) => fields.has(key));
  if (declared.length === 0) {
    return { kind: "absent" };
  }
  const twice = OWNER_WORDS_KEYS.filter((key) => duplicated.includes(key));
  if (twice.length > 0) {
    return { kind: "defect", why: `the stored quote declares ${twice.join(", ")} more than once` };
  }
  const record = hisWordsRecordOf({ declared, value: ({ key }) => flatValue({ fields, key }) });
  if (typeof record === "string") {
    return { kind: "defect", why: record };
  }
  const readOff = record.kind === "held" ? record.hisWords.anchor : record.anchor;
  if (readOff !== anchor) {
    return { kind: "defect", why: `the stored quote was read off ${readOff}, not this row's anchor` };
  }
  return record;
}
