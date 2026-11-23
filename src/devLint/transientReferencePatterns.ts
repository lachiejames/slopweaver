/**
 * The transient-references gate's criterion, one class per kind of reference that only means something to one
 * installation's history or store: what each of the fifteen classes matches, which regions of a file it reads,
 * and which class wins where two would match the same characters. Pure data and pure matching;
 * `transientReferences.ts` runs it.
 *
 * Every pattern is a factory, since a global regular expression carries `lastIndex` between scans.
 */

/** Every class of transient reference, in the order a report prints them. */
export const TRANSIENT_CLASSES = [
  "owner-pronoun",
  "date",
  "iso-date",
  "time-of-day",
  "commit-hash",
  "pr-number",
  "turn-id",
  "session-id",
  "call-id",
  "attributed-quote",
  "state-row-id",
  "state-pointer-id",
  "voice-turn-id",
  "chair-counter",
  "handover-id",
] as const;

/** A class of transient reference, as the debt list names it. */
export type TransientClass = (typeof TRANSIENT_CLASSES)[number];

/**
 * Which text a class reads. `prose` is a whole Markdown, YAML or shell file; `comment` a comment in TypeScript or
 * CSS; `string` a string, a template's literal text or JSX text in TypeScript, or a test's name; `fixture` any
 * other literal text under a `__tests__` segment, the data a test feeds in; `data` a whole JSON or JSONL file. A
 * class whose shape a program also uses as DATA (an ISO instant, a clock time, a hex digest, a UUID) reads no
 * `string`, so a schedule is never counted; a class only prose uses (a written date, a pull request, a turn, a
 * call, a quotation) reads strings too, since a refusal or a test's name is prose a reader sees. Only the
 * installation-state identifier classes read `fixture` and `data`: a knowledge row, a store pointer or a voice turn
 * is an id into one installation's store wherever it is written, and a fixture needs a synthetic one, never a real.
 */
type RegionKind = "comment" | "prose" | "string" | "fixture" | "data";

/** One pattern, and a check on its matched text the regex could state only slowly ("carries a digit and a letter"). */
interface ClassPattern {
  readonly regex: RegExp;
  /** `before` is the character preceding the match, `""` at the start of the file. */
  readonly keep?: (args: { text: string; before: string }) => boolean;
}

/** One class's rule: what it matches and where. */
interface ClassRule {
  readonly name: Exclude<TransientClass, "owner-pronoun">;
  readonly reads: readonly RegionKind[];
  /** A factory, since a global regular expression carries `lastIndex` between scans. */
  readonly patterns: () => readonly (RegExp | ClassPattern)[];
}

/** Hex in either case, spelled out rather than through the `i` flag, which makes every class Unicode-folded. */
const HEX = "[0-9a-fA-F]";

/** Whether a hex run carries a digit and a letter, so neither a number nor a hex-spelled word is a hash. */
const isMixedHex = ({ text }: { text: string }): boolean => /\d/u.test(text) && /[a-fA-F]/u.test(text);

/** Title-case month names and their abbreviations, case-sensitive so the modal "may" and "march on" stay words. */
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;

/**
 * A year inside any installation's plausible lifetime. A worked example of a date FORMAT is written in another
 * century (1 Jan 2001) and stays outside the criterion; a history reference carries the year it happened in.
 */
const YEAR = String.raw`20[2-9]\d`;

/** A day of the month with an optional ordinal suffix. */
const DAY = String.raw`(?:[12]\d|3[01]|0?[1-9])(?:st|nd|rd|th)?`;

/** Whole against any letter, mark, digit or underscore, on the left. */
const LEFT = String.raw`(?<![\p{L}\p{M}\p{N}_])`;
/** Whole against any letter, mark, digit or underscore, on the right. */
const RIGHT = String.raw`(?![\p{L}\p{M}\p{N}_])`;

/** A pattern from source, global and Unicode-aware. */
const re = ({ source, flags = "gu" }: { source: string; flags?: string }): RegExp => new RegExp(source, flags);

/** A UUID's five groups, in either case. */
const UUID = String.raw`${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}`;

/** A lowercase slug of at least three hyphenated parts, the shape of a run's name, so `set-repo` is never one. */
const RUN_SLUG = String.raw`[a-z0-9]+(?:-[a-z0-9]+){2,}`;

/**
 * Whether a knowledge row id is one the repository reserves for fixtures: twelve zeroes and a four-digit number
 * (`l-0000000000000001`), or the format example `0123456789abcdef`. A convention, not a guess at randomness.
 */
const isSyntheticStateRowId = ({ text }: { text: string }): boolean =>
  /^[lp]-(?:0{12}\d{4}|0123456789abcdef)$/u.test(text);

/** Whether a voice turn id is one the repository reserves for fixtures: `turn_`, eighteen zeroes, three digits. */
const isSyntheticVoiceTurnId = ({ text }: { text: string }): boolean => /^turn_0{18}\d{3}$/u.test(text);

/**
 * The first counter the repository reserves for a synthetic supervisor chair. One installation's chairs count up
 * from one and a real chain stays far below it, so a fixture's `handoff-9008` is synthetic and `handoff-8` is not.
 */
const SYNTHETIC_CHAIR_FLOOR = 9000;

/** Whether a chair name (`handoff-9367`, `fresh-supervisor-handoff-9367`) carries a counter the repository reserves. */
const isSyntheticChairCounter = ({ text }: { text: string }): boolean =>
  Number(/\d+$/u.exec(text)![0]) >= SYNTHETIC_CHAIR_FLOOR;

/**
 * Whether a store pointer names a UUID the repository reserves for fixtures: its second group `0000`
 * (`aaaaaaaa-0000-4000-8000-000000000001`). A real session, call or transcript id is random there.
 */
const isSyntheticStatePointer = ({ text }: { text: string }): boolean =>
  new RegExp(String.raw`${HEX}{8}-0000-${HEX}{4}-${HEX}{4}-${HEX}{12}$`, "u").test(text);

/**
 * A key naming a session, transcript, call, turn or conversation record, in camelCase or snake_case and with any
 * qualifier before it: `sessionId`, `session_id`, `chairSessionId`, `previousCallId`, `conversation_id`. A UUID
 * held under one is a store pointer however it is quoted; a UUID under any other key (a message's `uuid`, a
 * provider object's `id`) is no installation's pointer, so a bare UUID is never one.
 */
const POINTER_KEY = String.raw`[A-Za-z]*(?:[sS]ession|[tT]ranscript|[cC]all|[tT]urn|[cC]onversation)(?:Id|_id)`;

/** Every region kind, for a class that reads an installation-state id wherever it is written. */
const EVERY_REGION: readonly RegionKind[] = ["prose", "comment", "string", "fixture", "data"];

/**
 * Every class but `owner-pronoun`, in PRIORITY order: where two match overlapping characters the earlier one is
 * the finding and the later one is dropped, so a session id is not also a commit hash and a timestamp is not also
 * a time of day. `attributed-quote` is a span over a whole quotation and claims nothing, so a date inside one is
 * still its own finding.
 */
const CLASS_RULES: readonly ClassRule[] = [
  {
    // A store pointer: a talk, call, transcript or session record named by its UUID, a `--session` example, or a
    // UUID held under a session-like key.
    // Before `session-id`, so the whole anchor is the finding rather than its bare UUID.
    name: "state-pointer-id",
    // The flag first, so `--session <uuid>` is the finding rather than the `session <uuid>` inside it.
    patterns: () => [
      {
        keep: ({ text }) => !isSyntheticStatePointer({ text }),
        regex: re({ source: String.raw`(?<![\p{L}\p{N}_-])--session[ =]${UUID}${RIGHT}` }),
      },
      {
        keep: ({ text }) => !isSyntheticStatePointer({ text }),
        regex: re({ source: String.raw`${LEFT}(?:talk-call|talk|call|transcript|session)(?::| )${UUID}${RIGHT}` }),
      },
      {
        // A UUID held under a pointer key, `"sessionId": "<uuid>"` or `sessionId: "<uuid>"`: the UUID alone is the
        // finding, so it sits wholly inside a fixture string as well as a JSON file, and an escaped quote of JSON
        // held in a string is read too. The key is read by a lookbehind AFTER the UUID, so the pattern still opens
        // on a character class and V8's fast scan finds it; the quote the key requires is its left boundary.
        keep: ({ text }) => !isSyntheticStatePointer({ text }),
        regex: re({
          source: String.raw`${UUID}(?<=${POINTER_KEY}\\?["']?\s*[:=]\s*\\?["'\x60]${UUID})${RIGHT}`,
        }),
      },
    ],
    reads: EVERY_REGION,
  },
  {
    // A knowledge or proposal row of one installation's register, by its id or as `knowledge row <slug>`.
    name: "state-row-id",
    patterns: () => [
      {
        keep: ({ text }) => !isSyntheticStateRowId({ text }),
        regex: re({ source: String.raw`${LEFT}[lp]-[0-9a-f]{16}${RIGHT}` }),
      },
      re({ source: String.raw`${LEFT}knowledge row \x60?${RUN_SLUG}${RIGHT}` }),
    ],
    reads: EVERY_REGION,
  },
  {
    // One installation's voice turn, by its provider id.
    name: "voice-turn-id",
    patterns: () => [
      {
        keep: ({ text }) => !isSyntheticVoiceTurnId({ text }),
        regex: re({ source: String.raw`${LEFT}turn_[A-Za-z0-9]{21}${RIGHT}` }),
      },
    ],
    reads: EVERY_REGION,
  },
  {
    // One installation's supervisor chair, by its counter: `handoff-291`, `fresh-supervisor-handoff-291`, and the
    // directory or fixture named for it (`handoff-291/shell.txt`, `handoff-291-tick-288`). The whole number is the
    // match, so `handoff-9291-tick-288` is one synthetic counter rather than a real one inside it.
    name: "chair-counter",
    patterns: () => [
      {
        keep: ({ text }) => !isSyntheticChairCounter({ text }),
        regex: re({ source: String.raw`${LEFT}(?:(?:fresh-)?supervisor-)?handoff-[1-9]\d*${RIGHT}` }),
      },
    ],
    reads: EVERY_REGION,
  },
  {
    // A handover run or board row cited as provenance. Backticks, the word `handover` or `board row` beside the
    // name, or `handover resume`, and a slug of three parts at least, so `handover set-repo` is a verb, not one.
    name: "handover-id",
    patterns: () => [
      re({ source: String.raw`\x60${RUN_SLUG}\x60,? handover${RIGHT}` }),
      re({ source: String.raw`${LEFT}(?:handover|board row) \x60${RUN_SLUG}\x60` }),
      re({ source: String.raw`${LEFT}handover resume ${RUN_SLUG}${RIGHT}` }),
    ],
    reads: ["prose", "comment", "string"],
  },
  {
    name: "session-id",
    patterns: () => [
      {
        keep: ({ before }) => !/[\p{L}\p{M}\p{N}_]/u.test(before),
        regex: re({ source: String.raw`${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}${RIGHT}` }),
      },
    ],
    reads: ["prose", "comment"],
  },
  {
    name: "call-id",
    patterns: () => [
      // A talk or voice call, a Codex artifact, a transcript entry: a named record and its short hex id, which must
      // carry a digit and a letter of its own. A console call is written `talk-<hex>`, `talk:<hex>` or `talk <hex>`
      // as often as `talk-call <hex>`, so `talk` alone names one too, behind the same separators as every other name.
      {
        keep: ({ text }) => isMixedHex({ text: text.slice(text.search(/[ :#-]+[0-9a-fA-F]+$/u)) }),
        regex: re({
          source: String.raw`${LEFT}(?:talk-call|talk|voice[- ]call|call|artifact|transcript|recording)[ :#-]+${HEX}{6,12}${RIGHT}`,
        }),
      },
      // A cmux relay by its file id: the instant it was written, compact, then twelve hex characters.
      re({ source: String.raw`${LEFT}${YEAR}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])T\d{6}Z-${HEX}{12}${RIGHT}` }),
      // A Codex pass by its own label: p1..p3 plans, r1..r9 reviews.
      re({ source: String.raw`${LEFT}Codex(?:'s)? (?:pass )?[pPrR]\d${RIGHT}` }),
      // A finding within one, cited without the name: `r3-31`.
      re({ source: String.raw`${LEFT}[pr]\d-\d{2}${RIGHT}` }),
    ],
    reads: ["prose", "comment", "string"],
  },
  {
    name: "iso-date",
    patterns: () => [
      re({
        source: String.raw`${LEFT}${YEAR}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?${RIGHT}`,
      }),
    ],
    reads: ["prose", "comment"],
  },
  {
    name: "date",
    patterns: () => [
      // A date without a year counts, but never the day and month of one whose year is outside the installation
      // span: `1 Jan 2001` is a worked example of a format.
      re({ source: String.raw`${LEFT}${DAY} ${MONTH}\.?(?: ${YEAR})?${RIGHT}(?! \d{4})` }),
      re({ source: String.raw`${LEFT}${MONTH}\.? ${DAY}(?:,? ${YEAR})?${RIGHT}(?!,? \d{4})` }),
      re({ source: String.raw`${LEFT}${MONTH}\.? ${YEAR}${RIGHT}` }),
    ],
    reads: ["prose", "comment", "string"],
  },
  {
    name: "time-of-day",
    patterns: () => [
      re({
        source: String.raw`${LEFT}(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?: ?(?:Z|UTC|AEST|AEDT|[ap]m))(?![\p{L}\p{N}_])`,
      }),
      re({ source: String.raw`${LEFT}(?:1[0-2]|0?[1-9])(?::[0-5]\d)? ?[ap]m${RIGHT}` }),
    ],
    reads: ["prose", "comment"],
  },
  {
    name: "pr-number",
    patterns: () => [
      // `#3774` or `owner/repo#3774`. Never after `&` (an HTML entity) or `#`, never before `-` (a Markdown
      // anchor), and two to five digits, so a step label `#1` and a six-digit colour are not pull requests.
      re({ source: String.raw`(?<![&#\p{N}])#\d{2,5}(?![\p{L}\p{M}\p{N}_-])` }),
      re({ flags: "giu", source: String.raw`${LEFT}(?:PRs?|pull requests?|issues?) #?\d{2,5}${RIGHT}` }),
      re({ source: String.raw`/(?:pull|issues)/\d+${RIGHT}` }),
    ],
    reads: ["prose", "comment", "string"],
  },
  {
    name: "turn-id",
    patterns: () => [
      // Named first, so its wider span is the finding: `owner 272-5`, `ruling 1-3`.
      re({
        flags: "giu",
        source: String.raw`${LEFT}(?:owner|turn|ruling|steer|pick) (?:turn |ruling |pick |ask |steer |word )?\d{1,4}-\d{1,3}${RIGHT}`,
      }),
      // An owner turn or ruling id written bare, `272-5`: a three-digit turn, a hyphen, the item within it. Never
      // part of a longer number or hyphenated run, so a date or a range of years is not one.
      re({ source: String.raw`(?<![\p{L}\p{N}_.:/-])[1-9]\d{2}-\d{1,2}(?![\p{L}\p{N}_/-]|\.\d)` }),
    ],
    reads: ["prose", "comment", "string"],
  },
  {
    // Seven to forty hex characters carrying a digit and a letter, whole, never one hex run's middle, never after
    // `#` (a colour) or `0x` (a literal), never a UUID's part (a hyphen on either side).
    name: "commit-hash",
    patterns: () => [
      {
        keep: ({ text, before }) => !/[\p{L}\p{N}_#-]/u.test(before) && isMixedHex({ text }),
        // The left boundary is `keep`'s, not a lookbehind's: a pattern opening on a lookbehind is tried at every
        // offset, one opening on a character class is found by V8's fast scan.
        regex: re({ source: String.raw`${HEX}{7,40}(?![\p{L}\p{N}_-])` }),
      },
    ],
    reads: ["prose", "comment"],
  },
  {
    name: "attributed-quote",
    patterns: () => [
      // A quotation followed by its attribution: `"..." (owner, 2 Nov)` or `_"..."_ (the owner`.
      re({ source: String.raw`["“][^"”\n]{12,}["”]_?\s*\((?:the )?owner${RIGHT}` }),
      // An attribution followed by its quotation: `owner: "..."`, `in their words, "..."`.
      re({
        flags: "giu",
        source: String.raw`${LEFT}(?:the owner|owner|(?:in )?(?:h(?:is|er)|their) words?)(?:'s words?)?(?:,[^:"“\n]{0,40})?[:,] _?["“][^"”\n]{12,}`,
      }),
    ],
    reads: ["prose", "comment", "string"],
  },
];

/** One match of one class, as a half-open span of the file's text. */
export interface ClassMatch {
  readonly name: Exclude<TransientClass, "owner-pronoun">;
  readonly start: number;
  readonly end: number;
}

/** A region of a file's text a class may read. */
export interface TextRegion {
  readonly kind: RegionKind;
  readonly start: number;
  readonly end: number;
}

/**
 * Every match of every class across a WHOLE file, in priority order, regions not yet applied. Pure. Matching the
 * whole text once, rather than each region on its own, keeps a pattern's boundary checks reading the file's real
 * neighbouring characters, and lets a file with no candidate at all skip the parse that finds its regions.
 *
 * @param content the file's text
 * @returns each candidate, grouped by class in {@link CLASS_RULES}'s order
 */
export function candidateMatches({ content }: { content: string }): readonly ClassMatch[] {
  return candidatesOf({ content, rules: CLASS_RULES });
}

/**
 * Every match of only the classes that read a JSON or JSONL file's `data` region, in priority order. Pure. A data
 * file is matched by these alone, since {@link classMatches} drops every other class's candidate there anyway, and
 * a large data file is mostly instants and digests.
 *
 * @param content the data file's text
 * @returns each candidate of a class that reads `data`
 */
export function dataCandidateMatches({ content }: { content: string }): readonly ClassMatch[] {
  return candidatesOf({ content, rules: CLASS_RULES.filter((rule) => rule.reads.includes("data")) });
}

/** Every match of the given rules across a whole text, grouped by rule in the given order. */
function candidatesOf({ content, rules }: { content: string; rules: readonly ClassRule[] }): readonly ClassMatch[] {
  return rules.flatMap((rule) =>
    rule.patterns().flatMap((pattern) => {
      const { regex, keep }: ClassPattern = pattern instanceof RegExp ? { regex: pattern } : pattern;
      return [...content.matchAll(regex)]
        .filter(
          (match) =>
            keep === undefined || keep({ before: match.index === 0 ? "" : content[match.index - 1]!, text: match[0] }),
        )
        .map((match): ClassMatch => ({ end: match.index + match[0].length, name: rule.name, start: match.index }));
    }),
  );
}

/** Whether two half-open spans share a character. */
const overlaps = ({ a, b }: { a: { start: number; end: number }; b: { start: number; end: number } }): boolean =>
  a.start < b.end && b.start < a.end;

/** The region wholly containing a span, found by binary search over regions sorted by start and never overlapping. */
function regionHolding({
  regions,
  span,
}: {
  regions: readonly TextRegion[];
  span: { start: number; end: number };
}): TextRegion | undefined {
  let low = 0;
  let high = regions.length - 1;
  let found: TextRegion | undefined;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const region = regions[mid]!;
    if (region.start <= span.start) {
      found = region;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found !== undefined && span.end <= found.end ? found : undefined;
}

/** The matches in `spans` that share no character with an earlier one, in their given order. */
const firstOfEachOverlap = ({ spans }: { spans: readonly ClassMatch[] }): readonly ClassMatch[] =>
  spans.filter((span, index) => !spans.slice(0, index).some((other) => overlaps({ a: span, b: other })));

/**
 * Sort a file's candidates into what is COUNTED and what is DATA. Pure.
 *
 * Counted: wholly inside a region of a kind the class reads, with the overlap between token classes resolved by
 * priority, so one reference is one finding. Data: a token-class candidate in a region its class does not read (a
 * test's fixture string, a code string a comment-only class skips), touching no counted match. Data is not debt —
 * a date a test feeds to date logic stays — so it is reported beside the count, never ratcheted. A candidate in a
 * JSON or JSONL `data` region its class does not read is dropped outright, neither counted nor reported.
 *
 * @param candidates every class's matches over the whole file, in priority order ({@link candidateMatches})
 * @param regions where the classes may read, sorted by start and never overlapping
 * @returns the counted matches and the data-shaped ones, each in source order
 */
export function classMatches({
  candidates,
  regions,
}: {
  candidates: readonly ClassMatch[];
  regions: readonly TextRegion[];
}): { readonly counted: readonly ClassMatch[]; readonly data: readonly ClassMatch[] } {
  const reads = new Map(CLASS_RULES.map((rule) => [rule.name, rule.reads]));
  const claimed: ClassMatch[] = [];
  const quotes: ClassMatch[] = [];
  const unread: ClassMatch[] = [];
  for (const found of candidates) {
    const region = regionHolding({ regions, span: found });
    const read = region !== undefined && reads.get(found.name)!.includes(region.kind);
    if (!read && region?.kind === "data") {
      // A JSON date or digest no class reads is neither debt nor worth reporting: a data file is mostly that.
      continue;
    }
    if (!read) {
      unread.push(found);
    } else if (found.name === "attributed-quote") {
      quotes.push(found);
    } else if (!claimed.some((other) => overlaps({ a: found, b: other }))) {
      claimed.push(found);
    }
  }
  const counted = [...claimed, ...firstOfEachOverlap({ spans: quotes })];
  const data = firstOfEachOverlap({
    spans: unread.filter(
      (found) => found.name !== "attributed-quote" && !counted.some((other) => overlaps({ a: found, b: other })),
    ),
  });
  const bySource = (a: ClassMatch, b: ClassMatch): number => a.start - b.start;
  return { counted: counted.toSorted(bySource), data: data.toSorted(bySource) };
}
