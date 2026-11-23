/**
 * Whether a line a comparison pass is handed quotes the original draft (`./slackDraft.ts`): the pass must be blind to
 * A, and the lines it is handed were written by the session that wrote A, so this is the check that keeps A's words
 * out of B's prompt. Split from the prompt so the matcher, and the Slack token shapes it reads, are held in one read.
 *
 * Pure.
 */

/** How many of the original's words in a row, found in its purpose line, make that line a quote of it. */
const QUOTED_RUN = 6;

/**
 * One way a stretch of the original may show: its words, or a bare mention, which matches any one to
 * {@link MENTION_WORDS} words of the purpose because the name it shows is held only as an id.
 */
type Shown = readonly string[] | "mention";

/** One stretch of the original — a plain word, or one Slack token — and every way it may show. */
type Slot = readonly Shown[];

/**
 * A text's words, case-folded, for a quote check that ignores case and punctuation. An apostrophe counts only inside a
 * word, so `'sounds good'` quoted in single quotes still reads as `sounds good`. The text is stripped of invisible
 * characters, so a zero-width space inside a word cannot split it, then folded through upper
 * and lower case and decomposed with every combining mark dropped, so a case change that adds a mark (`İ` lowers to
 * `i` plus a dot) cannot split a word either, and `İstanbul`, `ISTANBUL` and `istanbul` read alike.
 */
function wordsIn({ text }: { text: string }): readonly string[] {
  const visible = text.normalize("NFKC").replaceAll(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, "");
  const folded = visible.toUpperCase().toLowerCase().normalize("NFKD").replaceAll(/\p{M}/gu, "");
  return Array.from(folded.matchAll(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu), (match) => match[0]);
}

/**
 * Whether the purpose line the pass is handed quotes the original: a run of {@link QUOTED_RUN} of its words in a row,
 * or the whole of a shorter one. The `--why` is written by the session that wrote the original, so nothing else stops
 * it carrying those words into a prompt that must be blind to them.
 *
 * @param purpose the row's `--why`
 * @param words the original's plain text
 * @returns true when a pass handed `purpose` would see the original's words
 */
export function purposeQuotesDraft({ purpose, words }: { purpose: string; words: string }): boolean {
  const slots = slotsOf({ words });
  const said = wordsIn({ text: purpose });
  for (let start = 0; start < slots.length; start += 1) {
    for (let at = 0; at < said.length; at += 1) {
      if (quotedFrom({ at, said, seen: 0, slots, start, whole: start === 0 })) {
        return true;
      }
      // A run may begin partway into a token's words, a link label's last few say.
      const partway = slots[start]!.some(
        (shown) =>
          shown !== "mention" &&
          shown.some(
            (_, k) => k > 0 && wordsThen({ at, said, seen: 0, slots, start, whole: false, words: shown.slice(k) }),
          ),
      );
      if (partway) {
        return true;
      }
    }
  }
  return false;
}

/** Words as Slack shows them: its three escapes decoded, after the markup they protect is read. */
function shownWords({ text }: { text: string }): readonly string[] {
  return wordsIn({ text: text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&") });
}

/**
 * The original as slots: each plain word one slot, each Slack token one slot carrying every way it may show, chosen
 * per token so a run may cross a link's label into a date's format words, which a pair of
 * all-labels and all-inner views misses. A labelled token shows its label, and its own text too, since which part
 * Slack draws depends on the token: a link's URL, never split into a quoted run by its tokens.
 * A mention or channel shows a name held only as an id; a bare `<!here>` its word, or a mention-like name.
 */
function slotsOf({ words }: { words: string }): readonly Slot[] {
  const slots: Slot[] = [];
  let last = 0;
  for (const match of words.matchAll(/<([^>]*)>/g)) {
    slots.push(...shownWords({ text: words.slice(last, match.index) }).map((word): Slot => [[word]]));
    // Inside a code span Slack draws the token literally, head and label as one run.
    slots.push([...tokenSlot({ token: match[1]! }), shownWords({ text: match[1]! })]);
    last = match.index + match[0].length;
  }
  slots.push(...shownWords({ text: words.slice(last) }).map((word): Slot => [[word]]));
  return slots;
}

/** Every way one Slack token's inside may show. */
function tokenSlot({ token }: { token: string }): Slot {
  const pipe = token.indexOf("|");
  const head = pipe === -1 ? token : token.slice(0, pipe);
  const labelled: Shown[] = pipe === -1 ? [] : [shownWords({ text: token.slice(pipe + 1) })];
  if (/^(?:[@#]|!subteam\^)/.test(head)) {
    return ["mention", ...labelled];
  }
  if (head.startsWith("!date^")) {
    // A date token shows its format's literal words, never its `date^<ts>^` head, its link or a `{placeholder}`.
    // What a placeholder renders to is NOT read: it is the reader's locale and timezone, so no one rendering is the one
    // A shows, and an A that is only a date token, retyped as its rendered date into the purpose, reaches B. That needs
    // the writing session to build the input, which no draft reaches by accident; reading it closed would mean
    // expanding a timestamp under every locale Slack draws.
    const format = head.split("^").at(2);
    const formatWords = format === undefined ? [] : shownWords({ text: format.replaceAll(/\{[^}]*\}/g, " ") });
    return [formatWords, ...labelled];
  }
  if (head.startsWith("!")) {
    return [shownWords({ text: head.slice(1) }), ...(pipe === -1 ? ["mention" as const] : labelled)];
  }
  return [shownWords({ text: head }), ...labelled];
}

/**
 * The most words one mention's shown name may span: "Alice Smith" is two. A longer name is
 * not modelled, so a purpose retyping an A built around a five-word display name reaches B (stated
 * rather than chased): every word added here lets a mention swallow more of an unrelated purpose, and each one refuses
 * B on rows where no word of A was quoted. The name is resolved only at send, so it cannot be read exactly here.
 */
const MENTION_WORDS = 4;

/** Where a quote check stands: the purpose's next word, the original's next slot, and the words matched so far. */
interface QuoteAt {
  readonly at: number;
  readonly said: readonly string[];
  readonly seen: number;
  readonly slots: readonly Slot[];
  readonly start: number;
  readonly whole: boolean;
}

/**
 * Whether the original from slot `start` matches the purpose from `at` far enough to be a quote: {@link QUOTED_RUN} of
 * the purpose's words, or the original's whole end when the match began at its first slot and matched a word. Each slot
 * may show any of its ways; a mention matches any one to {@link MENTION_WORDS} words and counts each one it took, so
 * the run is measured in words Slack shows, never in the one token a mention is held as.
 */
function quotedFrom(where: QuoteAt): boolean {
  const { at, said, seen, slots, start, whole } = where;
  if (seen >= QUOTED_RUN) {
    return true;
  }
  if (start === slots.length) {
    return whole && seen > 0;
  }
  return slots[start]!.some((shown) => {
    if (shown !== "mention") {
      return wordsThen({ ...where, words: shown });
    }
    for (let take = 1; take <= MENTION_WORDS && at + take <= said.length; take += 1) {
      if (quotedFrom({ ...where, at: at + take, seen: seen + take, start: start + 1 })) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Whether `words`, one way slot `start` shows, match the purpose from `at` and the rest of the original follows: a run
 * that reaches {@link QUOTED_RUN} inside them is a quote whatever comes after, so a long label quoted in part counts.
 */
function wordsThen(where: QuoteAt & { readonly words: readonly string[] }): boolean {
  const { at, said, seen, start, words } = where;
  let matched = 0;
  while (matched < words.length && said[at + matched] === words[matched]) {
    matched += 1;
  }
  if (seen + matched >= QUOTED_RUN) {
    return true;
  }
  return matched === words.length && quotedFrom({ ...where, at: at + matched, seen: seen + matched, start: start + 1 });
}
