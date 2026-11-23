/**
 * Whether the owner's last words leave the floor with them: they asked the voice to wait, or trailed off mid-thought.
 * Pure, so the judgement is a test over their real words; the page reads it before it asks the voice to take its turn
 * (`resumeDueOf`, `./voiceActivity.ts`), and a silence it covers stays theirs — unless their words then end on the code
 * word "over" (`./overWord.ts`), which hands the floor back whatever came before it.
 *
 * The owner sometimes just wants to wait before saying the next thing. Measured over two calls, every silence of 12s or
 * more that met no answer and that the owner ended themselves: four followed a steer the voice should have taken on,
 * and two were the owner's own pause — "Moving on to the next thing. Umm" (24s, then they shared their screen) and "I
 * might just handle this one by hand actually. One sec" (24s). Both are caught here, by words alone, and none of the
 * four steers is. Repro: each owner segment with `final: true` in `$SLOPWEAVER_HOME/talk/calls/{<call-a>,<call-b>}-*.jsonl` followed by
 * 12s with no voice segment and no tool line.
 *
 * Words alone, not the voice's judgement: told in one sentence to answer a steer AND stay quiet on a wait, the live
 * voice answered a steer with only "Got it.", where the plain sentence carried it on to the next thing.
 */

/** How many characters at the end of the owner's words are read: the wait has to be the last thing said. */
const TAIL_CHARS = 60;

/**
 * An explicit ask to wait, anywhere in the tail, unless a negation stands earlier in its sentence ({@link NEGATION}).
 * Global, so `matchAll` can read every occurrence; never `test` one, which a global pattern makes stateful.
 */
const WAIT_PHRASES: readonly RegExp[] = [
  // Not "a second" or "a minute": "a second card", "a minute ago".
  /\b(?:one|just a|half a) (?:sec|second|moment|minute|tick)\b/g,
  /\ba (?:sec|moment|tick)\b/g,
  /\bgive me (?:a |one |just a )?(?:sec|second|moment|minute|tick)\b/g,
  /\b(?:hang|hold) on\b/g,
  /\blet me (?:think|see|check|look)\b/g,
  /\bbear with me\b/g,
];

/**
 * What the owner is reading, as they would name it: "it", or any of "this", "that" or "the" with or without one of the
 * things a card is ("this briefing", "the rest", "that one"). One phrase, so every body names it alike.
 */
const READING_OBJECT = String.raw`(?:it|(?:this|that|the)(?: (?:card|briefing|page|doc|document|one|rest|bit|part|section|thing))?)`;

/**
 * The verbs that carry the owner's reading on, shared by every pattern that takes one so "let me" and "I'll" never
 * drift apart ("I'll carry on reading." must hold too). The hold phrases are a closed list: a wording of the hold none
 * of them names is residue, read as no hold, and is added here when a call shows it.
 */
const READING_CONTINUE = String.raw`(?:keep (?:on )?|carry on |continue |go on )`;

/**
 * The owner saying they are still reading the card in front of them, as the LAST thing said: the floor is theirs until
 * they speak again. Measured: the owner opened a briefing, read it aloud and ended "let me just keep reading", which matched none of {@link WAIT_PHRASES}, so five seconds
 * later the page resumed, the console's own turn re-introduced the card the owner had open and asked whether to send
 * it back, and the owner had to cut in to say they were still on the briefing. Repro: the `resume` tool line and the
 * `wrote` line nine seconds after it in `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.
 *
 * Anchored to the END, not anywhere in the tail as a wait phrase is: "keep reading the next one" asks the voice to
 * read, and "I'm reading it now, send it" hands the floor back, so anything after the reading words breaks the hold.
 * Each pattern names the OWNER as its subject ("let me", "I'm", "I'll"). A bare "keep reading" or "just keep reading"
 * is never one: said while the voice reads a card aloud it tells the voice to go on, so holding the floor there would
 * silence the very thing the owner asked for ("Assistant, keep reading.").
 *
 * And none may sit straight after a word that embeds it in an instruction ({@link READING_EMBEDDING}): "let her know
 * I'm still reading" and "check if I'm still reading" ask the voice for something.
 */
const READING_HOLD_BODIES: readonly string[] = [
  String.raw`let me (?:just )?(?:${READING_CONTINUE}|finish )?read(?:ing)?(?: ${READING_OBJECT})?`,
  String.raw`(?:i['’]m|i am) (?:just )?(?:still )?reading(?: ${READING_OBJECT})?`,
  String.raw`(?:i['’]m|i am) still on ${READING_OBJECT}(?: one)?`,
  String.raw`(?:i['’]ll|i will|i['’]m (?:just )?(?:gonna|going to)) (?:just )?${READING_CONTINUE}reading(?: ${READING_OBJECT})?`,
];

/**
 * The words that, straight before the owner's reading words, make them the object of an instruction to the voice: a
 * complementiser ("know", "if", "whether", "that"), a person it is said to ("her", "them") or a reporting
 * verb — or a negation of them ("don't let me keep reading"). The owner's own "I'd say" is not a reporting verb: "I'd
 * say I'm still reading" holds.
 *
 * Which side the hold errs on is chosen, not found: the two errors cost differently. A wrong hold is a silence the
 * owner ends by speaking again; a missed one is the voice moving the owner off the card they are reading. So the
 * reading words hold wherever they stand — after a filler, a connective or any lead-in ("at the moment I'm still
 * reading"), which a list of clause openers could never complete — unless one of these words embeds them. The
 * residue is the other side of the same choice: an instruction joined by a bare comma ("send it later, I'm
 * still reading") or by a word not listed here reads as the owner's own hold.
 */
const READING_EMBEDDING =
  /\b(?:know|if|whether|that|him|her|them|us|me|tell|(?<!\bi(?:['’]d| would) (?:[\p{L}\p{M}\p{N}_]+ ){0,3})say|ask|check|message|text|post|reply|wonder|don['’]?t|not|never)/u;

/**
 * What a word is made of, in ANY script: a letter, a combining mark, a digit or an underscore. JavaScript's `\w` and
 * `\b` are ASCII-only, and a letter without its marks splits a decomposed "Zöe" (`o` + U+0308) in two, so every word
 * test below is built on this rather than on either.
 */
const WORD = String.raw`\p{L}\p{M}\p{N}_`;

/**
 * Only marks may follow the reading words, never a letter or digit of ANY script: `\W` counts a Hebrew or accented
 * letter as punctuation, so "I'm still reading עכשיו" ("now") would hold.
 */
const READING_HOLDS: readonly RegExp[] = READING_HOLD_BODIES.map(
  (body) => new RegExp(String.raw`(?<!${READING_EMBEDDING.source} )(?<![${WORD}'’])${body}[^${WORD}]*$`, "u"),
);

/**
 * Words ending on a question mark ask something, so they are never the owner's hold: "can you check whether at the
 * moment I'm still reading?" embeds the owner's words further back than {@link READING_EMBEDDING}'s one-word reach. The
 * same request with no question mark is residue, held by the cost trade above. Closing marks after it are still its
 * end, the same set {@link lastSentenceOf} sets aside: "(I’m still reading?)" asks.
 */
const READING_ASKED = /\?[\s.!?"'”’»›)\]]*$/u;

/**
 * A last sentence that OPENS on a reporting verb, after at most a vocative ("assistant, tell …"), is an instruction
 * however long it runs: "Tell Dr. Alexandra Catherine Montgomery-Worthington I'm still reading." puts its "tell"
 * further back than the tail reaches. Only the opening counts, so a long sentence of the owner's own with an
 * "I'd say" in it still holds. The vocative is a name in any script ("李, tell …"), as in {@link READING_QUOTED}.
 */
const READING_INSTRUCTED = new RegExp(
  String.raw`^[^${WORD}]*(?:\p{L}[${WORD}'’-]*, )?(?:say|tell|repeat|reply|message|text|post)(?![${WORD}])`,
  "u",
);

/**
 * A negation directly in front of the reading words: "I'm not still reading" says the owner is done. Read on the last
 * sentence only, so "I'm not still reading. Actually, I'm still reading." holds.
 */
const READING_NEGATED = /\b(?:i['’]m|i am) not (?:just )?(?:still )?(?:reading|on)\b/;

/**
 * A title whose period is an abbreviation, never a sentence end ("tell Dr. Smith I'm still reading", "tell Capt. Smith
 * …"). A title this list does not name is the declared residue: its period ends the sentence early, the
 * words after it read as the owner's own clause, and the floor holds — the side a missed hold's cost chooses ({@link
 * READING_EMBEDDING}). Only a title that goes BEFORE a name is listed: one that can follow it, or be a word of its own,
 * ends a sentence as often as not ("…emailed John Smith Jr. I am still reading"; "Main St."), so "jr", "sr" and "st"
 * end one, on that same cheap side.
 */
const TITLE = String.raw`\b(?:dr|mr|mrs|ms|mx|prof|capt|cpt|col|gen|lt|maj|sgt|cmdr|adm|rev|fr|hon|sen|rep|gov|pres)`;

/**
 * The reading words as reported speech in the same clause — "say: I'm still reading", "tell her I'm still on it" — are
 * words for the voice to say, never the owner's hold. Such words fall through to the ordinary resume.
 * The owner's own "I said" is not one: "Chill, I said I'm still reading" repeats the hold, the likeliest way it is
 * said a second time, with up to three words between, "I already clearly said" too; more is residue, and so is "I
 * think she said", read as the owner's, on the cheap side. Nor is the owner's own "I'd say", "I'd probably say": "I'd
 * say that's right, I'm still reading" gives a view and quotes nothing. The one told is a name in any script, so a word
 * boundary here is a letter or digit of any script, never JavaScript's ASCII-only `\w`: "please tell 李 I'm still
 * reading" is reported. It crosses every period {@link SENTENCE_END} does
 * not end a sentence on, a title's, a decimal's and one before a letter or comma: "she said version 2.0 well I'm
 * still reading" and "She said at 9 a.m., I am still reading." are reported.
 */
const READING_QUOTED = new RegExp(
  String.raw`(?<![${WORD}])(?:(?<!\bi(?:['’]d| would) (?:[${WORD}]+ ){0,3})say|says|(?<!\bi (?:[${WORD}]+ ){0,3})said|tell [${WORD}'’-]+|repeat)(?![${WORD}])(?:[^.!?]|(?<=${TITLE})\.|\.(?=[\d\p{L},]))*[.!?]*\s*$`,
  "u",
);

/**
 * A colon or a quote mark anywhere in the last sentence: whatever verb comes before it ("message her: I'm still
 * reading"), a transcript marks the words after it as quoted, so they are never the owner's own clause. A mark, not
 * a list of reporting verbs, since no list of verbs is ever complete. A clock time's colon, a digit on each side ("it's 3:30"), is not one; "channel 2: well …" is. A single quote
 * counts only where it OPENS a quote, after anything but a letter or digit ("reply 'well I am still reading'", "she
 * said—'well …'"), since inside a word it is the apostrophe of the owner's own "I'm". A quote OPENED in an earlier
 * sentence ("She said 'Earlier. I'm still reading'") is residue: only the last sentence is read, and a single quote
 * closing after a letter is an apostrophe here, so it holds — the cheap side of the trade at {@link READING_EMBEDDING}.
 * Every OPENING quote mark Unicode names (`\p{Pi}`: “ ‘ « ‹ …), the closing double ones and the low-9 and corner
 * brackets count, never `\p{Pf}` whole: its ’ is the apostrophe of "I’m" ("«I'm still reading"). "A letter" is any
 * script's ({@link WORD}), so "Zoë's card" keeps its apostrophe.
 */
const READING_REPORTED_MARK = new RegExp(String.raw`(?<!\d):|:(?!\d)|["\p{Pi}”»›„「」『』]|(?<![${WORD}])['’]`, "u");

/**
 * The last sentence of the owner's words: everything after the last sentence end that is not its own closing mark. A
 * period with a digit after it is a decimal point ("version 2.0"), and one after a {@link TITLE} an abbreviation:
 * neither is an end. Nor is one with a letter or a comma straight after it, inside or closing an abbreviation
 * ("Send this: at 9 a.m., I am still reading"). An abbreviation ending on a
 * period and a space ("e.g. I'm …") still ends one: residue, on the cheap side of {@link READING_EMBEDDING}'s trade.
 */
const SENTENCE_END = new RegExp(String.raw`[!?]|(?<!${TITLE})\.(?![\d\p{L},])`, "gu");

/**
 * A closing mark that can only close: a curly or angled closing quote, or a closing bracket ('"(Read this!)"'), or a
 * straight single quote straight after the end with no space, which an opening one never is ("She said 'Earlier.' I'm
 * still reading").
 */
const ONLY_CLOSES = /^\s*[”»›’)\]]|^'/u;

/** A straight double quote, which opens or closes by how many came before it. */
const STRAIGHT_QUOTE = /^\s*"/;

/**
 * The last sentence of the owner's words ({@link SENTENCE_END}). English puts a quote's closing mark AFTER its period
 * ('She said "Earlier." I'm still reading'), so a mark straight after the end closes the earlier sentence and is no
 * quote of the last one. A straight double quote there closes only when an odd number
 * came before it; an even count makes it an opening quote, which stays.
 */
function lastSentenceOf({ words }: { words: string }): string {
  // Trailing ends and closing marks are the last sentence's own: they are set aside to FIND where it starts, so they
  // never make an empty sentence of their own, and handed back with it, so a quote mark among them still counts
  // ("I’m still reading”"). `body` is a prefix of `words`, so an index
  // into one is an index into the other.
  const body = words.replace(/[.!?\s"'”’»›)\]]+$/u, "");
  const ends = [...body.matchAll(SENTENCE_END)];
  const last = ends.at(-1);
  if (last === undefined) {
    return words;
  }
  let start = last.index + 1;
  for (;;) {
    const rest = body.slice(start);
    const closing = ONLY_CLOSES.exec(rest);
    const straight = STRAIGHT_QUOTE.exec(rest);
    const straightCloses = straight !== null && body.slice(0, start).split('"').length % 2 === 0;
    if (closing !== null) {
      start += closing[0].length;
    } else if (straight !== null && straightCloses) {
      start += straight[0].length;
    } else {
      return words.slice(start);
    }
  }
}

/** {@link READING_QUOTED}, tried at one position of the whole text rather than over a cut copy of it. */
const READING_QUOTED_AT = new RegExp(READING_QUOTED.source, "uy");

/**
 * Whether a reporting verb STARTING in the last {@link TAIL_CHARS} characters quotes the owner's reading words. Each
 * start is tried on the whole text, so a lookbehind still sees the words before the cut: a 60-character copy turned the
 * owner's own "I said this takes longer than I expected and I'm still reading" into a bare "said" that reported
 * speech, and a word cut in half at the edge would read as one starting there.
 */
function quotedInTail({ folded }: { folded: string }): boolean {
  for (let at = Math.max(0, folded.length - TAIL_CHARS); at < folded.length; at += 1) {
    READING_QUOTED_AT.lastIndex = at;
    if (READING_QUOTED_AT.test(folded)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the owner's words end on them saying they are still reading ({@link READING_HOLDS}). The hold is anchored to
 * the end of the whole text, so its lookbehinds see every word before it; a quote MARK, a negation and an instruction
 * are read on the WHOLE last sentence: "tell the reviewer: I checked the first section … well I'm still reading" puts
 * its colon further back than the tail reaches. A reporting verb stays a tail test ({@link quotedInTail}): a long
 * sentence of the owner's own often carries an "I'd say" that quotes nothing.
 */
function endsOnReading({ folded }: { folded: string }): boolean {
  const sentence = lastSentenceOf({ words: folded });
  const reported =
    quotedInTail({ folded }) || READING_REPORTED_MARK.test(sentence) || READING_INSTRUCTED.test(sentence);
  if (READING_NEGATED.test(sentence) || reported || READING_ASKED.test(folded)) {
    return false;
  }
  return READING_HOLDS.some((hold) => hold.test(folded));
}

/**
 * A negation anywhere earlier in a wait phrase's own sentence: "Don't hold on. Send it now." then muted held the floor
 * for good, and so did "Do not, please, hold on" and "Do not under any circumstances hold on" against a nearer window.
 * The whole sentence, because a mute is how the owner ends their turn: misread, "I'm not sure, hold on" lets the voice
 * take it after five seconds, where the opposite misreading held it until the owner spoke.
 */
const NEGATION = /\b(?:don['’]?t|do not|never|not|no need)\b/;

/** Where the sentence holding an index begins: just past the last sentence end before it. */
function sentenceStart({ tail, index }: { tail: string; index: number }): number {
  const ends = [...tail.slice(0, index).matchAll(/[.!?]/g)];
  const last = ends.at(-1);
  return last === undefined ? 0 : last.index + 1;
}

/** Whether the tail holds a wait phrase with no negation earlier in its sentence. */
function phraseAsksToWait({ tail }: { tail: string }): boolean {
  return WAIT_PHRASES.some((phrase) =>
    [...tail.matchAll(phrase)].some(
      (found) => !NEGATION.test(tail.slice(sentenceStart({ index: found.index, tail }), found.index)),
    ),
  );
}

/**
 * The owner's words ending on "wait", which asks for one as often as it tells the voice not to ("don't sit there and
 * wait"), so it holds the floor only while the owner is live and can say which they meant.
 */
const BARE_WAIT = /\bwait\W*$/;

/**
 * A filler or a joining word the owner trails off on — the thought is not finished. Not "so" or "like", which end finished
 * sentences too ("I think so", "however you like").
 */
const TRAILING_FILLER = /\b(?:u+m+|u+h+m*|h+m+|e+r+m*|and|but|or)\W*$/;

/** The owner's words, lowercased with their whitespace folded. */
function foldOf({ text }: { text: string }): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether the owner's words, as heard so far, end with them holding the floor.
 *
 * @param text the owner's words, newest last; only the end is read
 * @returns true when the end asks the voice to wait, says the owner is still reading, or trails off on a filler
 */
export function asksToWait({ text }: { text: string }): boolean {
  const folded = foldOf({ text });
  const tail = folded.slice(-TAIL_CHARS);
  return TRAILING_FILLER.test(tail) || BARE_WAIT.test(tail) || phraseAsksToWait({ tail }) || endsOnReading({ folded });
}

/**
 * Whether the owner's words end on an unmistakable ask to wait: what still holds the floor once they have muted, since
 * a mute is how they end their turn — a filler before it is only where the mute cut them off ("Can you check the
 * staging pool and", then muted), and a bare "wait" as likely told the voice not to.
 *
 * @param text the owner's words, newest last; only the end is read
 * @returns true when the end asks the voice to wait in a wait phrase, or says in words the owner is still reading
 */
export function asksInWordsToWait({ text }: { text: string }): boolean {
  const folded = foldOf({ text });
  return phraseAsksToWait({ tail: folded.slice(-TAIL_CHARS) }) || endsOnReading({ folded });
}
