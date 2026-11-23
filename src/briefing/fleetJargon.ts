/**
 * The one rule about a card's VOCABULARY: a fleet word may appear above the fold only where the card has
 * already said what it means, above the fold.
 *
 * A badly worded or badly framed card wastes the owner's time: they cannot react effectively to it. This
 * rule generalises the rule that a briefing card defines its terms, which `./reactNowCard.ts`'s
 * `undefinedLabelIn` already enforces for a Title-Case label and a bare number-word — and which says nothing
 * at all about a lower-case fleet word.
 *
 * The worked example is a card that opened _"A settled ask still reads ready and the fill spawned it
 * tonight"_ and went on to name a `reaper` and a `row`: four fleet words in two clauses, none of them
 * explained, on a card whose question the owner could not see the reason for.
 *
 * ## The refusal is UNGLOSSED, never the word — and that distinction is measured
 *
 * MEASURED over the owner's own 322 distinct recorded turns, 125k words (repro: `python3` over
 * `~/.slopweaver/supervisor-scratch/**\/owner-turn-*.txt`, deduping by content digest and keeping the text
 * after each file's `verbatim:` marker, counting `\bWORD\b` case-insensitively):
 *
 * ```text
 *   row 93 · board 52 · spawn 45 · tick 35 · silver 11 · fill 11 · settled 10 · sweep 7 · gold 5
 *   reaper 1 · seam 0 · waiver 0
 * ```
 *
 * The owner uses almost every one of these words themselves, so a list that BANNED them would refuse their own
 * vocabulary back at them. What the owner cannot do is read a word this repository has given a second, private
 * meaning and know which meaning is meant — `row` is a board entry here and a table row everywhere else. So
 * the criterion is a gloss, not a ban, and a card may use any of these freely once it has said what it means.
 *
 * ## Each term with an ordinary meaning is matched in its FLEET SENSE, never as a bare word
 *
 * The same measurement is why: `row` at 93 uses is mostly ordinary English, and a rule firing on
 * every `row` would be a rule firing on nothing useful. So those entries carry a collocation — `the fill`
 * rather than `fill`, `a finding row` rather than `row`, `settled ask` rather than `settled`, `touch-seam`
 * rather than `seam` — and a false positive is retired by SHARPENING that collocation, never by listing the
 * card that tripped it. `seam` earned its collocation exactly that way: a card about a visible seam in a composed
 * screenshot was refused by an earlier bare pattern.
 *
 * **One entry is bare, and that is a claim about the word rather than an omission.** `reaper` has no ordinary
 * reading a briefing card would reach for, and the measurement agrees — one use across 125k words. Every
 * other term, including the two that started bare, earned its collocation from a counterexample: a visible
 * seam in a screenshot and a legal waiver in a vendor-access card are both cards a careful composer would
 * write. The retirement is always a sharper collocation, never a list of blessed
 * cards, and if `reaper` ever turns up in ordinary prose it goes the same way.
 *
 * ## What a gloss IS
 *
 * The term, followed immediately by a definitional frame: `is`, `are`, `means`, an em-dash, a parenthesis, or
 * `, which` / `, that is` / `, i.e.`. So _"A plan store is one of four separate Claude logins this machine
 * keeps"_ glosses `plan store`, and _"the fill spawned it tonight"_ glosses nothing. The frame must sit above
 * the fold, which is the half `undefinedLabelIn` gets wrong for its own class: a term explained only inside a
 * `details` body is a term the owner meets unexplained in the sentence they are being asked to act on.
 *
 * Pure: one string in, one refusal or nothing out. No I/O, no clock, no list of blessed cards.
 */

import { absentAs, absentAsEmpty, absentAsNumber } from "#lib/absent.js";

/**
 * The per-invocation break-glass for the four card-framing rules, in the shape every other outbound door's is.
 *
 * It lifts the FINDINGS — the unglossed word, the settled question, the mechanism framing, the unpickable
 * option, the missing age line — and never the schema's required `premise` field, which is structural. The
 * case it exists for is reading an ARCHIVE: `slopweaver briefing check` over a page rendered before these
 * rules landed would otherwise refuse every card on it for carrying no age line, which makes the verb useless
 * on exactly the pages a correction has to be computed against.
 *
 * **`briefing render` never honours it.** That is the door that PUBLISHES, and a badly-framed page reaching the owner
 * under an ambient, traceless variable is the failure these rules exist to stop — so `renderRun.ts` passes the
 * rules on unconditionally and this variable reaches the reader alone. Registered as `card-framing` in
 * `../hatch/registry.ts`, in the `ambient` lane, which is what its being a read rather than a send makes it.
 */
export const CARD_FRAMING_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_CARD_FRAMING";

/**
 * One fleet word, the collocation that means this repository's sense of it, and what it means in plain words.
 *
 * @internal — the registry row {@link ungloss} walks; no caller outside this module names the type.
 */
interface FleetTerm {
  /** The word a refusal names, lower case. */
  readonly term: string;
  /** This repository's sense of it. Deliberately a collocation, never the bare word — see the file overview. */
  readonly sense: RegExp;
  /** What it means, in words the owner has not had to learn, for the refusal to offer as the replacement. */
  readonly plainly: string;
}

/**
 * A proof grade in its grade sense: the word standing next to landing, merging or proof language.
 *
 * `gold`, `silver` and `bronze` are all ordinary English on their own — a colour, a metal, a medal — so
 * unlike `reaper` or `waiver` these three need their collocation or the rule fires on "the gold standard".
 * One shared builder rather than three hand-written patterns, so the three can never drift apart.
 *
 * @param word the grade word
 * @returns the pattern matching that word where it means a proof grade
 */
function gradeSense({ word }: { word: string }): RegExp {
  const near = "land|lands|landed|landing|merge|merges|merged|proof|proofs|grade|graded|owed|owes|owing";
  return new RegExp(String.raw`\b(?:${near})\s+(?:[a-z]+\s+)?${word}\b|\b${word}\s+(?:${near}|anchor|bar)\b`, "i");
}

/**
 * Every fleet word a card may not use above the fold without glossing it there.
 *
 * The four the owner's own ruling named — settled, fill, reaper, row — plus the six that sat beside them on
 * the same page's seven me-facing cards, and the two phrases a ruling quoted back off a card
 * (`10 golden runs per case`, `batch review ask`). It grows from a card that actually reached the owner, never
 * from imagination: a word nobody has written into a card is a word this list cannot help with.
 */
const FLEET_TERMS: readonly FleetTerm[] = [
  {
    plainly: "a request of the owner's that has already been answered",
    sense: /\bsettled\s+(?:ask|asks|row|rows)\b|\balready\s+settled\b/i,
    term: "settled",
  },
  {
    plainly: "the scan that starts work nobody is holding",
    sense:
      /\bfill\s+(?:scan|scans|spawn|spawns|spawned|scanned|refused)\b|\b(?:the|a|this|that|tonight's|each|every)\s+fill\s+(?:spawned|started|ran|refused|scanned|picked|found)\b/i,
    term: "fill",
  },
  {
    plainly: "the sweep that closes a run whose session has died",
    sense: /\breapers?\b/i,
    term: "reaper",
  },
  {
    // The hardest word in the list, and the collocation is the narrowest for that reason. An earlier pattern
    // took a determiner plus any adjective, and refused "the first row in the comparison
    // table" — ordinary English. So only a FLEET
    // qualifier counts. The trade is stated rather than hidden: `the new row`, which one real card wrote, is
    // now MISSED. A card that reads slightly worse is cheaper than a card about a table that cannot publish.
    plainly: "one entry on the handover board",
    sense:
      /\b(?:board|finding|handover|routing|planned|ask|run|spawn|settled|dispatch)\s+rows?\b|\brows?\s+on the board\b|\bthe board's\s+rows?\b/i,
    term: "row",
  },
  {
    // NOT the bare word, unlike `reaper` and `waiver` below. A visible seam in a composed screenshot is
    // ordinary English and a card describing one should not have to redefine it, which an earlier bare
    // pattern got wrong. The fleet sense is the hyphenated
    // workstream name (`touch-seam`) or the word standing in front of a fleet noun.
    plainly: "the boundary between two systems that an investigation is tracing",
    sense: /\b[a-z]+-seams?\b|\bseams?\s+(?:session|sessions|investigation|row|rows|page|workstream)\b/i,
    term: "seam",
  },
  {
    plainly: "one pass of the supervisor's loop",
    sense: /\b(?:the|this|that|each|every|next|per|one)\s+ticks?\b(?!\s+(?:of|box|boxes|mark|marks)\b)/i,
    term: "tick",
  },
  {
    plainly: "one pass of the supervisor's loop that rebuilds this page",
    sense: /\b(?:the|a|this|that|each|every|next|per|one)\s+sweeps?\b(?!\s+of\b)/i,
    term: "sweep",
  },
  {
    plainly: "a landing whose proof is weaker than the best that was available",
    sense: gradeSense({ word: "silver" }),
    term: "silver",
  },
  {
    plainly: "a landing whose proof is the weakest this repository records",
    sense: gradeSense({ word: "bronze" }),
    term: "bronze",
  },
  {
    plainly: "a landing carrying the strongest proof that was available",
    sense: gradeSense({ word: "gold" }),
    term: "gold",
  },
  {
    // NOT bare either. A legal waiver is ordinary English and a card about vendor access should not have to
    // define one. The fleet sense is the word
    // standing next to the landing, gate or proof language it is a waiver OF.
    plainly: "a recorded decision to land without something a rule normally requires",
    sense:
      /\b(?:land|lands|landed|landing|merge|merged|gate|gates|proof|grade|acknowledge|acknowledged)\s+(?:[a-z]+\s+)?waivers?\b|\bwaivers?\s+(?:acknowledged|on the gate|for the gate|on a gate)\b/i,
    term: "waiver",
  },
  {
    // One of two phrases refused off a real card: "10 golden runs per case". A golden
    // retriever or a golden hour is ordinary English, so only the eval sense counts.
    plainly: "a stored example question with the answer we expect",
    sense: /\bgolden\s+(?:runs?|cases?|sets?|answers?|questions?)\b|\bten-golden\b/i,
    term: "golden",
  },
  {
    // The other refused phrase. No ordinary reading, so the phrase itself is the sense.
    plainly: "one message asking several people to review several pull requests",
    sense: /\bbatch\s+review\s+asks?\b/i,
    term: "batch review ask",
  },
];

/**
 * The determiner or quantifier a real gloss opens its noun phrase with.
 *
 * This is what separates a DEFINITION from a statement about the term's state, and it is the sharpening a
 * false positive forced rather than one that was designed: `the routing row is parked` matched an earlier
 * frame of `is` alone and read as glossed while defining nothing. A gloss names WHAT the thing is — "a row is
 * one entry on the board" — so the word after `is` is a determiner, not a participle.
 */
const NOUN_PHRASE_OPENER = "a|an|the|one|each|every|any|what|how|this|that|two|three|four|five|our|its|hi[s]";

/**
 * The definitional frame that has to follow a term for the card to have glossed it.
 *
 * Written as the SUFFIX of a gloss match rather than as a separate search, so `plan store is one of four` and
 * `plan store, which is one of four` both count while `the plan store failed` does not. The em-dash and
 * parenthesis arms carry the same opener requirement, so `the reaper (workspace 90) closed it` is a card
 * citing a session rather than a card explaining a word.
 */
const GLOSS_FRAME = String.raw`(?:\s*[—–(]\s*(?:${NOUN_PHRASE_OPENER})\b|,\s*(?:which|that is|i\.e\.)\b|\s+(?:is|are)\s+(?:not\s+)?(?:${NOUN_PHRASE_OPENER})\b|\s+means\b)`;

/** One term a card used above the fold without saying what it means. */
export interface UnglossedTerm {
  /** The fleet word, as the registry names it. */
  readonly term: string;
  /** The phrase the card actually wrote, so a composer can find the sentence. */
  readonly used: string;
  /** What the term means in plain words. */
  readonly plainly: string;
}

/**
 * Whether one phrase the card wrote is followed anywhere above the fold by a definitional frame.
 *
 * Built per call rather than cached on the registry row because the pattern depends on the MATCHED phrase,
 * not on the term: a card writing `a finding row` has to gloss `finding row`, and one writing `the row` has
 * to gloss `row`. Escaping is by character class rather than by a library because every registry sense
 * matches lower-case words and spaces only — a phrase with a regex metacharacter in it could not have come
 * out of one.
 */
function glossed({ aboveFold, used }: { aboveFold: string; used: string }): boolean {
  const phrase = used
    .trim()
    .replace(/[^a-zA-Z0-9\s'-]/g, "")
    .replace(/\s+/g, String.raw`\s+`);
  if (phrase.length === 0) {
    return false;
  }
  return new RegExp(phrase + GLOSS_FRAME, "i").test(aboveFold);
}

/**
 * Every phrase one registry entry's sense matches above the fold.
 *
 * A fresh global copy of the sense, because a `RegExp` literal shared at module scope carries `lastIndex`
 * across calls once it is global and would answer differently on a second card.
 */
function usesOf({ aboveFold, entry }: { aboveFold: string; entry: FleetTerm }): readonly string[] {
  const global = new RegExp(entry.sense.source, `${entry.sense.flags.replace("g", "")}g`);
  return [...aboveFold.matchAll(global)].map((match) => match[0]);
}

/**
 * The first fleet word a card used above the fold without glossing it there.
 *
 * A term counts as glossed when ANY of its uses carries the frame, wherever that use sits. The order a card
 * happens to be written in is not the composer's argument — "the fill spawned it; the fill is the scan that
 * starts idle work" explains itself perfectly well — so a rule reading only the first use would refuse a card
 * that had done exactly what it was asked.
 *
 * ## The gloss may be looked for somewhere WIDER than the uses
 *
 * A card reads both out of one string, which is why `glossScope` defaults to `aboveFold`. A SECTION does
 * not: `./sectionQuality.ts` reads uses out of one disclosure level and allows the gloss to come from that
 * level or any level enclosing it, because a reader who has opened a nested fold has the text around it open
 * too. The reverse is refused by construction — text a reader has not opened is never in `glossScope`.
 *
 * @param aboveFold every above-the-fold cell of one card, joined — the text the owner cannot avoid reading
 * @param glossScope where a definition may sit, when that is wider than where the uses are read from;
 *   defaults to `aboveFold`, which is the card's own contract
 * @returns the term, the first phrase the card wrote and what it means, or `undefined` when all are glossed
 */
export function ungloss({
  aboveFold,
  glossScope,
}: {
  aboveFold: string;
  glossScope?: string | undefined;
}): UnglossedTerm | undefined {
  const scope = absentAs({ value: glossScope, whenAbsent: aboveFold });
  for (const entry of FLEET_TERMS) {
    const uses = usesOf({ aboveFold, entry });
    if (uses.length === 0) {
      continue;
    }
    // Every phrase of this term ANYWHERE a gloss may sit, not only the ones at the level being judged. A
    // gloss is recognised on the phrase it follows, so an enclosing level writing "every tick — one pass of
    // the loop —" explains a nested level's "this tick" only if that enclosing phrase is looked at too.
    // When the scope IS the text — every card — this is the same list and the card rule is unchanged.
    const candidates = scope === aboveFold ? uses : usesOf({ aboveFold: scope, entry });
    if (candidates.some((used) => glossed({ aboveFold: scope, used }))) {
      continue;
    }
    return { plainly: entry.plainly, term: entry.term, used: uses[0]!.trim() };
  }
  return undefined;
}

/**
 * The shape that replaces an unglossed cell, worded once so the form and the gate cannot drift apart on it.
 *
 * It names the two ways out rather than one, because both are legitimate: say what the word means, or use
 * words the owner never had to learn. The second is the better card and the first is the honest one when the word is
 * load-bearing.
 */
export const FLEET_JARGON_ADVICE =
  "Say what it means in the same breath, above the fold, or write the card without the word.";

/**
 * The gate's refusal for one unglossed fleet word.
 *
 * @param cell what the composer should go and fix — `what`, `option A`
 * @param found the term {@link ungloss} reported
 * @returns one line naming the cell, the phrase, what it means and the shape that replaces it
 */
export function fleetJargonRefusal({ cell, found }: { cell: string; found: UnglossedTerm }): string {
  return (
    `${cell} uses the fleet word "${found.used}" and never says what it means — ` +
    `"${found.term}" here is ${found.plainly}. ${FLEET_JARGON_ADVICE}`
  );
}

/**
 * One plain-words substitution for a fleet word's sense: the phrase it rewrites, and what it writes instead.
 *
 * @internal — a row of {@link FLEET_REWRITES}; no caller outside this module names the type.
 */
interface FleetRewrite {
  /** The phrase, with the determiner or qualifier it keeps in a capture group. Never global here. */
  readonly pattern: RegExp;
  /** The replacement, built from the pattern's capture groups (index 1 onward), so grammar survives. */
  readonly to: (groups: readonly string[]) => string;
}

/**
 * `entry` or `entries`, by whether the word it replaces carried a plural `s`.
 *
 * @param plural the `s` the matched word carried, or the empty string
 * @returns the replacement noun, in the same number
 */
function entryWord({ plural }: { plural: string }): string {
  return plural === "" ? "entry" : "entries";
}

/** The words a grade becomes, keyed by grade: what each one says about the proof, not its colour. */
const GRADE_PLAINLY: Readonly<Record<string, string>> = {
  bronze: "the weakest proof this repository records",
  gold: "the strongest proof available",
  silver: "a weaker proof than the best available",
};

/**
 * What a grade becomes in front of a noun it qualifies — `gold anchor`, `silver bar`.
 *
 * The strength has to survive: `proof anchor` for all three, which the script this replaces wrote, lets a
 * weakest-proof anchor satisfy what required the strongest.
 */
const GRADE_ADJECTIVE: Readonly<Record<string, string>> = {
  bronze: "weakest-proof",
  gold: "strongest-proof",
  silver: "weaker-proof",
};

/** The landing, merging and proof words a grade stands next to — `gradeSense`'s own list, restated once. */
const GRADE_NEAR = "land|lands|landed|landing|merge|merges|merged|proof|proofs|grade|graded|owed|owes|owing";

/**
 * The two rewrites every grade takes: the grade beside a landing word, and the grade naming a proof's anchor
 * or bar.
 *
 * The word the sense allows between the landing word and the grade is kept, EXCEPT an article — every
 * replacement phrase brings its own, so `landed the gold` reads `landed the strongest proof available` rather
 * than `the the`.
 *
 * @param grade the grade word, a key of {@link GRADE_PLAINLY}
 * @returns the grade's two rewrites
 */
function gradeRewrites({ grade }: { grade: string }): readonly FleetRewrite[] {
  const plainly = absentAs({ value: GRADE_PLAINLY[grade], whenAbsent: grade });
  return [
    {
      // The grade must END its clause. A phrase like "the weakest proof this repository records" reads as a
      // noun phrase, so substituting it in front of a noun the grade was qualifying doubles that noun:
      // MEASURED by review: "The merged bronze records are archived." became "…this
      // repository records records are archived." A grade qualifying a noun is the anchor/bar rewrite below,
      // and anything else is left for a composer and reported.
      pattern: new RegExp(String.raw`\b(${GRADE_NEAR})\s+(?:([a-z]+)\s+)?${grade}\b(?=\s*(?:[.,;:!?)]|$))`, "i"),
      to: ([near = "", between = ""]) => {
        const kept = between === "" || /^(?:the|a|an)$/i.test(between) ? "" : `${between} `;
        return `${near} ${kept}${plainly}`;
      },
    },
    {
      pattern: new RegExp(String.raw`\b${grade}\s+(anchor|bar)\b`, "i"),
      to: ([noun = ""]) => `${absentAs({ value: GRADE_ADJECTIVE[grade], whenAbsent: grade })} ${noun}`,
    },
  ];
}

/**
 * The rewrites `slopweaver briefing recut` applies, keyed by the {@link FLEET_TERMS} entry each one retires.
 *
 * They are the supervisor chair's `recut.py` substitutions, moved here beside the senses they answer so the
 * two cannot drift, with three of that script's defects fixed rather than ported: a plural lost its `s`
 * (`board rows` became `board entry`), `ticks` became `passs`, and `fill scan` became `idle-work scan scan`.
 * A fourth is a meaning, not a spelling: the script wrote _the strongest proof available_ for all three
 * grades, which is exactly wrong for `silver` and `bronze`.
 *
 * NEVER `plainly`. A definition is not a substitution — `the board row` with the row's definition pasted in
 * reads `the one entry on the handover board`. `seam` and `waiver` have no row here on purpose: no short
 * phrase keeps their meaning in every sentence they appear in, so recut reports those uses instead of
 * guessing at them. Every rewrite is proved by a test that the term's own sense no longer matches after it.
 */
const FLEET_REWRITES: Readonly<Record<string, readonly FleetRewrite[]>> = {
  bronze: gradeRewrites({ grade: "bronze" }),
  fill: [
    { pattern: /\bfill\s+(scans?)\b/i, to: ([noun = ""]) => `idle-work ${noun}` },
    {
      pattern: /\bfill\s+(spawn|spawns|spawned|scanned|refused)\b/i,
      to: ([verb = ""]) => `idle-work scan ${verb}`,
    },
    {
      pattern:
        /\b(the|a|this|that|tonight's|each|every)\s+fill\s+(spawned|started|ran|refused|scanned|picked|found)\b/i,
      to: ([determiner = "", verb = ""]) => `${determiner} idle-work scan ${verb}`,
    },
  ],
  gold: gradeRewrites({ grade: "gold" }),
  // A `run` already standing in front of the word is CONSUMED: the replacement brings its own, and without
  // this "the run reaper" reads "the run run closer" (MEASURED by review).
  reaper: [{ pattern: /\b(?:run\s+)?reaper(s?)\b/i, to: ([plural = ""]) => `run closer${plural}` }],
  row: [
    {
      pattern: /\b(board|finding|handover|routing|planned|ask|run|spawn|settled|dispatch)\s+row(s?)\b/i,
      to: ([qualifier = "", plural = ""]) => `${qualifier} ${entryWord({ plural })}`,
    },
    { pattern: /\brow(s?)\s+on the board\b/i, to: ([plural = ""]) => `${entryWord({ plural })} on the board` },
    {
      pattern: /\b(the) board's\s+row(s?)\b/i,
      to: ([determiner = "", plural = ""]) => `${determiner} board's ${entryWord({ plural })}`,
    },
  ],
  settled: [
    { pattern: /\bsettled\s+(asks?)\b/i, to: ([noun = ""]) => `answered ${noun}` },
    { pattern: /\balready\s+settled\b/i, to: () => "already answered" },
  ],
  silver: gradeRewrites({ grade: "silver" }),
  sweep: [
    {
      pattern: /\b(the|a|this|that|each|every|next|per|one)\s+sweep(s?)\b(?!\s+of\b)/i,
      to: ([determiner = "", plural = ""]) => `${determiner} ${plural === "" ? "refresh" : "refreshes"}`,
    },
  ],
  tick: [
    {
      pattern: /\b(this|the|each|every|next|per|one|that)\s+tick(s?)\b(?!\s+(?:of|box|boxes|mark|marks)\b)/i,
      to: ([determiner = "", plural = ""]) => `${determiner} ${plural === "" ? "pass" : "passes"}`,
    },
  ],
};

/** What {@link recutText} did to one string. */
export interface RecutText {
  /** The rewritten string. */
  readonly text: string;
  /** How many substitutions each fleet term took, only the terms that took any. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Rewrite every fleet word in `text` that has a plain-words substitution, in registry order.
 *
 * The order is {@link FLEET_TERMS}' own, and within a term its rewrites' listed order, so a phrase two terms
 * could both claim is settled the same way every time. Already-glossed prose is rewritten too: the point of a
 * recut is plain words, and a gloss that survives beside a replaced word explains a word no longer there.
 *
 * ## It can put its replacement next to the same word, and that is residue rather than a bug
 *
 * A substitution is text, not grammar. Where the sentence already carries the word the replacement ends in,
 * the two land together: _"Did the next tick pass?"_ becomes _"Did the next pass pass?"_, and _"Did the sweep
 * refresh the page?"_ becomes _"Did the refresh refresh the page?"_. The meaning
 * survives and the sentence reads awkwardly.
 *
 * Three shapes ARE fixed, because each loses or corrupts meaning rather than reading badly: a grade beside a
 * noun it qualifies, a `run` already in front of `reaper`, and an article the replacement brings its own of.
 * The remainder is left: every further guard is one more clause of English grammar in a regular expression,
 * and the verb is an assist a composer reads the diff of — `--dry-run` prints what would change before
 * anything is written.
 *
 * @see the residue is named in `skills/supervisor/reference/verbs.md` too, so a chair meets it before it
 *   surprises them.
 *
 * @param text one authored cell
 * @returns the rewritten cell and the per-term substitution counts
 */
export function recutText({ text }: { text: string }): RecutText {
  let current = text;
  const counts: Record<string, number> = {};
  for (const entry of FLEET_TERMS) {
    for (const rewrite of absentAsEmpty({ value: FLEET_REWRITES[entry.term] })) {
      const global = new RegExp(rewrite.pattern.source, `${rewrite.pattern.flags.replace("g", "")}g`);
      current = current.replace(global, (...args: unknown[]) => {
        counts[entry.term] = absentAsNumber({ value: counts[entry.term], whenAbsent: 0 }) + 1;
        // `replace` passes the match, then each capture group (a string, or `undefined` when an optional
        // group did not take part), then the numeric offset. The groups are everything before that offset.
        const offsetAt = args.findIndex((arg, index) => index > 0 && typeof arg === "number");
        const groups = args.slice(1, offsetAt).map((group) => (typeof group === "string" ? group : ""));
        return rewrite.to(groups);
      });
    }
  }
  return { counts, text: current };
}
