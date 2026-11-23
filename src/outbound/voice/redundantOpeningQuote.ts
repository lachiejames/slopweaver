/**
 * A reply that OPENS by quoting back everything the other side said — the quote picks nothing out.
 *
 * ## The rule this enforces, and where it came from
 *
 * The owner's response-shape guidance says: when they said more than one thing, quote the line you are
 * answering, then answer it. The condition is the whole rule. A Gmail reply drafted with the vendor's one-line
 * email quoted back at its top established it: quoting back the only thing said is unnecessary, and quoting
 * back is useful when someone said multiple things and the reply must make clear which one it answers.
 *
 * ## The criterion: whole-source coverage, never a count of "points"
 *
 * A quote earns its place by SELECTING. So the defect is an opening quote whose text, once whitespace is
 * normalised, is the whole of what the source authored — give or take a bare greeting before it and a bare
 * sign-off after it, because a mail wraps its one line in both and quoting the line alone still selects
 * nothing. Counting sentences, lines or question marks was rejected: an abbreviation, a decimal or a wrapped
 * line is not a second point, and no measurement here validates any such proxy.
 *
 * Both sides are NFKC-normalised, so a compatibility form (a fullwidth `？`, a `ﬁ` ligature) matches its plain
 * character; past that, case, punctuation and words are compared exactly. No Markdown is stripped: removing
 * `*`, `_` or a link destination can turn materially different text into an apparent exact quote.
 *
 * ## Residue, stated so nobody discovers it mid-send
 *
 * - A PARTIAL quote of a genuinely single-point source passes: nothing here can prove the excerpt selects
 *   nothing, only that a whole-source quote does.
 * - A paraphrase passes, being no faithful quote at all.
 * - The greeting and sign-off shapes are deliberately narrow — a closer followed by a lowercase word, a
 *   question or more than a short run of capitalised name and title words is treated as CONTENT, so an
 *   "Also, send the deck." tucked after "Thanks!" keeps the quote legitimate. A greeting outside
 *   {@link GREETING_OPENERS} is content too, and so is any pleasantry but a "Happy <occasion>" or a set
 *   "hope/trust …" well-wishing phrase ("you're well", "you had a great weekend", "all is well", "the weekend
 *   went well") whose occasion is one of {@link OCCASIONS}. A set pleasantry counts with or without an opener
 *   before it ("Happy Friday!" alone). Each miss is a missed refusal, never a false one. The pleasantry arm
 *   exists because the message that prompted the rule opened "Hey Ada, Hope you had a great weekend."
 *   before its one question.
 * - The one FALSE refusal class left: a second point written only in signature-shaped words where a name may
 *   stand. The shapes are title case, a product-name shape ("iOS"), acronyms of up to three capitals and a
 *   `|`-style separator, plus, after a closer only, an email or a run of digits (a phone, but a date too). It
 *   is refused after a closer with no full stop and none of {@link REQUEST_CUES} ("Thanks, Review The
 *   Numbers", "Thanks, ETA TBD", "Thanks, 12/03/24"), or as up to three such words, "and" or a
 *   {@link GREETING_ADDRESSEES} word straight after a greeting's opener ("Hi Review Budget. Then archive.",
 *   "Hi Review and Approve."). No word-shape test tells these from a signature.
 *   The `redundant-quote` hatch is its way through.
 * - The source is only as clean as the caller's strip. An HTML-only mail's `<blockquote>` history reaches
 *   `src/corpus/gmail/quoted.ts` already flattened to plain paragraphs (its header says so), so that history
 *   reads as more of what they said and a whole-message quote of such a parent passes. A signature with no
 *   `-- ` delimiter is not stripped there either; this module reads only signature-shaped words after a
 *   closer as a sign-off (the class above), and anything else as content. A parent whose text Gmail did not
 *   inline (a body held behind an attachment id) is an empty source, so nothing is checked. A parent that is
 *   ALL quoted history keeps it, since the strip never empties a body, and its `>` markers read as content.
 *   Each is missed, never false.
 * - The caller supplies the source. Only a path that knows the exact message being answered can ask this
 *   question at all; `gmail draft --reply-to` is one, and a Slack thread reply, which names a thread rather
 *   than the message it answers, is not.
 */

/** Words that open a bare greeting line — "Hi Ada," — and nothing else. Lowercase; matched case-insensitively. */
const GREETING_OPENERS: readonly string[] = [
  "good afternoon",
  "good morning",
  "g'day",
  "hello",
  "hey",
  "hi",
  "hiya",
  "dear",
  "morning",
];

/** Lowercase words a greeting may address instead of a capitalised name: "Hi all," "Hey team,". */
const GREETING_ADDRESSEES: ReadonlySet<string> = new Set(["all", "everyone", "folks", "there", "team"]);

/** Phrases that open a bare sign-off. Longest first, so "thank you" is never half-matched by a shorter one. */
const SIGN_OFF_OPENERS: readonly string[] = [
  "all the best",
  "best regards",
  "kind regards",
  "many thanks",
  "warm regards",
  "sent from my",
  "talk soon",
  "thank you",
  "regards",
  "cheers",
  "thanks",
  "best",
  "ta",
];

/**
 * Words no signature carries and a request after the closer does — "Thanks, Please Send The Deck" — so any one
 * of them, in any casing, makes the tail content. Lowercase, punctuation stripped before the lookup.
 */
const REQUEST_CUES: ReadonlySet<string> = new Set([
  "also",
  "can",
  "could",
  "kindly",
  "let",
  "need",
  "please",
  "pls",
  "send",
  "would",
]);

/** How many name, title and company words a sign-off may carry after its closer, contact details aside. */
const SIGN_OFF_NAME_WORDS_MAX = 8;

/** How many name words a greeting may carry after its opener. */
const GREETING_NAME_WORDS_MAX = 3;

/** How many words one pleasantry may run to — "Hope your week is going well so far." is eight. */
const PLEASANTRY_WORDS_MAX = 10;

/**
 * The days and occasions a pleasantry wishes someone well over — "Happy Friday!", "Hope you had a great
 * weekend." — as a regex alternation. Closed on purpose: "Happy Customers." or "I trust you had the budget
 * approved." names something else, which may be the point.
 */
const OCCASIONS = String.raw`(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|day|break|holiday|holidays|trip|christmas|easter|new\s+year)`;

/** How many pleasantry sentences may follow a greeting, or stand alone without one, before the text counts as content. */
const PLEASANTRIES_MAX = 2;

/** Normalise line endings, Unicode compatibility forms and every whitespace run to one space. */
function normalised({ text }: { text: string }): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * The draft's OPENING quote block, marker stripped and normalised, or undefined when the draft does not
 * open with one. Leading blank lines are skipped; any authored text before the first `>` means the draft
 * opens on its answer and this rule does not apply.
 */
function openingQuote({ draft }: { draft: string }): string | undefined {
  const lines = draft.replace(/\r\n?/gu, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first === -1) {
    return undefined;
  }
  const quoted: string[] = [];
  const rest = lines.slice(first);
  for (const [index, line] of rest.entries()) {
    const marker = /^\s*>\s?/u.exec(line);
    if (marker !== null) {
      quoted.push(line.slice(marker[0].length));
      continue;
    }
    // An unmarked blank line between two quoted paragraphs is still inside the block.
    const next = rest.slice(index + 1).find((later) => later.trim().length > 0);
    const bridgesQuote = line.trim().length === 0 && next !== undefined && /^\s*>/u.test(next);
    if (!bridgesQuote) {
      break;
    }
  }
  const text = normalised({ text: quoted.join("\n") });
  return text.length === 0 ? undefined : text;
}

/** The words of a run of text, split on spaces, empty ones dropped. */
function wordsOf({ text }: { text: string }): readonly string[] {
  return text.split(" ").filter((word) => word.length > 0);
}

/**
 * Whether a word reads as part of a name, title or company: capitalised with a lowercase letter after
 * ("David", "O'Brien"), a product name opening lowercase then uppercase ("iPhone"), or an initial or acronym of
 * at most three capitals ("J.", "CEO"), or a bare separator from a closed set such as a signature's "|" — an
 * emoji or any other symbol is content, since "⚠️" after "Thanks," says something. A longer all-capitals
 * word is shouting, not a name — "SEND THE DECK." after "Thanks." is a second point, and reading it as a
 * signature would refuse a quote that selects.
 */
function isNameWord({ word }: { word: string }): boolean {
  const bare = word.replace(/[,;:.]+$/u, "");
  const separator = /^[|/·•–—-]+$/u.test(bare);
  // Letters and name punctuation only, so "DEPLOYMENT=failed" or "v2.1" is never a name.
  const nameShaped = /^[\p{L}'’&.-]+$/u.test(bare);
  return (
    separator ||
    (nameShaped && (/^\p{Lu}.*\p{Ll}/u.test(bare) || /^\p{Ll}\p{Lu}/u.test(bare) || /^\p{Lu}{1,3}$/u.test(bare)))
  );
}

/** Whether a signature word is contact detail — an email address or a run of phone digits — rather than a name. */
function isContactWord({ word }: { word: string }): boolean {
  const bare = word.replace(/[,;]+$/u, "");
  // Split rather than one pattern: an adjacent-quantifier email regex backtracks polynomially (redos-check).
  const [local, domain, ...extra] = bare.split("@");
  const email =
    extra.length === 0 &&
    local !== undefined &&
    local.length > 0 &&
    domain !== undefined &&
    domain.includes(".") &&
    /^[\p{L}\p{N}.-]+$/u.test(domain) &&
    !domain.startsWith(".") &&
    !domain.endsWith(".");
  return email || (/^[+(]?[\d()+-]{2,}$/u.test(bare) && /\d/u.test(bare));
}

/**
 * `text` with a leading phrase from `openers` and the punctuation after it removed, or undefined when it
 * opens on none of them. Matched on a word boundary, so "Tanya" is not "ta" and "Highly" is not "hi".
 * `punctuated` says the opener was closed off at once — "Hi," — so no name follows it.
 */
function afterOpener({
  text,
  openers,
}: {
  text: string;
  openers: readonly string[];
}): { rest: string; punctuated: boolean } | undefined {
  const lower = text.toLocaleLowerCase("en-AU");
  const opener = openers.find(
    (candidate) => lower.startsWith(candidate) && !/[\p{L}\p{N}']/u.test(lower.charAt(candidate.length)),
  );
  if (opener === undefined) {
    return undefined;
  }
  const tail = text.slice(opener.length);
  return {
    punctuated: /^\s*[,!.:;-]/u.test(tail),
    rest: tail.replace(/^[\s,!.:;-]+/u, "").trim(),
  };
}

/** Whether the words after a greeting's opener are only whom it addresses: "the owner", "all", "Rosa and the owner". */
function isGreetingName({ name }: { name: string }): boolean {
  const words = wordsOf({ text: name });
  return (
    words.length <= GREETING_NAME_WORDS_MAX &&
    words.every((word) => {
      const bare = word.toLocaleLowerCase("en-AU").replace(/\W/gu, "");
      return isNameWord({ word }) || GREETING_ADDRESSEES.has(bare) || bare === "and";
    })
  );
}

/**
 * Whether one sentence is a pleasantry that asks and tells nothing — "Hope you had a great weekend.",
 * "Hope all is well", "Happy Friday!". Only a state may follow the subject: "hope you can…" or "hope you send…"
 * is a request wearing one, and so is anything with a question mark. It is ONE short clause: a `;`, `:` or
 * `,` joins a second one ("Hope you are well; review the budget."), which may be the point.
 */
function isPleasantry({ sentence }: { sentence: string }): boolean {
  if (/[?;:,]/u.test(sentence) || wordsOf({ text: sentence }).length > PLEASANTRY_WORDS_MAX) {
    return false;
  }
  // Only a set phrase of WELL-WISHING, and the WHOLE sentence: "you're well", "you had a great weekend", "all
  // is well", "your week is going well so far". Any other verb reports or asks ("Hope you send the deck.", "I
  // trust you had deleted it."), and anything after the phrase may be the point ("…well and send the deck.").
  const outing = String.raw`(?:a|an|the|your)\s+(?:\p{L}+\s+){0,2}${OCCASIONS}`;
  const state = String.raw`(?:(?:(?:keeping|doing|going)\s+)?(?:well|good|great|fine)(?:\s+so\s+far)?|having\s+${outing})`;
  const hopeful = new RegExp(
    String.raw`^(?:i\s+)?(?:hope|trust)\s+(?:` +
      String.raw`you(?:['’]re|\s+are)\s+${state}` +
      String.raw`|you(?:['’]ve|\s+have)\s+been\s+${state}` +
      String.raw`|you(?:(?:['’]ve|\s+have)\s+had|\s+had|\s+enjoyed)\s+${outing}` +
      String.raw`|(?:all|everything)(?:['’]s|\s+is|\s+was)\s+${state}` +
      String.raw`|(?:your|the)\s+${OCCASIONS}(?:['’]s|\s+is|\s+was|\s+went)\s+${state}` +
      String.raw`)[.!]*$`,
    "iu",
  );
  return hopeful.test(sentence) || new RegExp(String.raw`^happy\s+${OCCASIONS}[.!]*$`, "iu").test(sentence);
}

/**
 * Whether the text before the quoted span is empty or a bare greeting — an optional opener and whom it
 * addresses, then at most {@link PLEASANTRIES_MAX} pleasantries: "Hey Ada, Hope you had a great weekend.",
 * or "Happy Friday!" alone.
 */
function isBareGreeting({ text }: { text: string }): boolean {
  if (text.length === 0) {
    return true;
  }
  let remaining = text;
  const opened = afterOpener({ openers: GREETING_OPENERS, text });
  if (opened !== undefined) {
    const { rest, punctuated } = opened;
    const cut = /[,!.:;]/u.exec(rest);
    const name = cut === null ? rest : rest.slice(0, cut.index);
    // "Hi, hope you're well." and "Hi, Delete Records." have no name: what follows "Hi," is already a sentence.
    remaining = rest;
    if (!punctuated && isGreetingName({ name })) {
      remaining = cut === null ? "" : rest.slice(cut.index + 1).trim();
    }
  }
  if (remaining.length === 0) {
    return true;
  }
  const sentences = remaining.split(/(?<=[.!])\s+/u).filter((sentence) => sentence.length > 0);
  return sentences.length <= PLEASANTRIES_MAX && sentences.every((sentence) => isPleasantry({ sentence }));
}

/** Whether the text after the quoted span is empty or a bare sign-off such as "Thanks, Alex Chen". */
function isBareSignOff({ text }: { text: string }): boolean {
  if (text.length === 0) {
    return true;
  }
  const rest = afterOpener({ openers: SIGN_OFF_OPENERS, text })?.rest;
  if (rest === undefined || /[?!]/u.test(rest)) {
    return false;
  }
  const words = wordsOf({ text: rest });
  // A signature holds no sentence: "Please Send The Deck." is a request, "David J." an initial.
  const holdsSentence = words.some((word) => /\p{L}{2,}\.$/u.test(word));
  const asks = words.some((word) => REQUEST_CUES.has(word.toLocaleLowerCase("en-AU").replace(/\W/gu, "")));
  const nameWords = words.filter((word) => !isContactWord({ word }));
  return (
    !holdsSentence &&
    !asks &&
    nameWords.length <= SIGN_OFF_NAME_WORDS_MAX &&
    nameWords.every((word) => isNameWord({ word }))
  );
}

/**
 * Whether a draft opens by quoting back the whole of what its source said, so the quote selects nothing.
 *
 * Pure and total: an empty source, a draft with no opening quote, a quote that is not a faithful excerpt of
 * the source and a quote that leaves any real content of the source unquoted all answer undefined.
 *
 * @param draft the reply as composed, `>` markers and all
 * @param source what the other side authored in the message being answered — for mail, the body with its
 *   quoted history and signature already stripped by `src/corpus/gmail/quoted.ts`
 * @returns the redundant quote's normalised text, for the refusal to name; undefined when the opening quote,
 *   if any, earns its place
 */
export function redundantOpeningQuote({ draft, source }: { draft: string; source: string }): string | undefined {
  const quote = openingQuote({ draft });
  const whole = normalised({ text: source });
  if (quote === undefined || whole.length === 0) {
    return undefined;
  }
  const at = whole.indexOf(quote);
  if (at === -1) {
    return undefined;
  }
  const before = whole.slice(0, at).trim();
  const after = whole.slice(at + quote.length).trim();
  return isBareGreeting({ text: before }) && isBareSignOff({ text: after }) ? quote : undefined;
}
