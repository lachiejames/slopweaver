/**
 * OWNER DISPLEASURE QUOTING THE BOT'S OWN WORDS — the one addressing shape that is a signal about the last
 * turn rather than an ask for a new one.
 *
 * ## The incident
 *
 * The second half of the monitor-backtest failure. Minutes after the bot posted an answer built
 * on charts it had drawn itself, the owner replied — quoting one sentence of that answer back as a Slack
 * blockquote and adding four words:
 *
 * ```
 * > the monitors are not deployed ... these charts are a replay of the pr's queries and thresholds over
 * > real cost data @<bot> thanks for nothing
 * ```
 *
 * The loop judged it `respond` / `fresh-visible-session` and spent a whole new Opus worker on it. Read as an
 * ask that is defensible — it even wrote three ranked hypotheses for what had gone wrong. It is still the
 * wrong move, and the owner's ruling is that it is: a complaint quoting the bot's own sentence is not a
 * question, and answering it with a fresh investigation spends a worker guessing at a diagnosis the person
 * holding it could give in one line. What the owner is owed is a STOP, and a surface.
 *
 * ## Why it fires on the addressing text and nothing else
 *
 * The same trust boundary `./proposalAsk.ts` holds: this reads the owner's own addressing text, keeping it
 * on the `controlPlane` side of `./judgement.ts`'s split. Routing thread text into a control-plane
 * classifier is the shape that split exists to prevent, and firing can only ever ADD a caution — it never
 * selects a need, raises a tier or obliges a response.
 *
 * ## A tripwire, not a fence
 *
 * Two conditions, both required: a quoted line, and a displeasure phrase. Requiring BOTH is what keeps it
 * narrow — plain frustration with no quote is often a real ask ("this is useless, can you check X"), and a
 * quote with no complaint is ordinary thread convention. It will miss a complaint worded around the list;
 * that costs exactly what today already costs. It cannot verify the quote is the BOT's own sentence — only
 * the thread can settle that, and the guidance says to go and check rather than assuming.
 */

/**
 * Lower-cased phrases that read as displeasure with what was just delivered.
 *
 * Every entry is language the owner has actually used about a bot answer, not a general profanity list: the
 * first is the incident reply itself, the rest are from the owner's own account of it the same day. Add one
 * alongside a real message, never speculatively — a broader list turns this into a tone detector, which is
 * not what it is.
 *
 * @internal — exported so a test can assert the table's own contents rather than only its matches.
 */
export const DISPLEASURE_PHRASES: readonly string[] = [
  "thanks for nothing",
  "dogshit",
  "why the fuck",
  "what the fuck",
  "how many times",
  "how many goddamn times",
  "useless",
  "waste of time",
];

/**
 * What fired, so a brief can quote the evidence back rather than asserting a mood.
 *
 * @internal — the shape {@link classifyOwnerDispleasure} returns; exported so a caller can name what fired.
 */
export interface OwnerDispleasure {
  /** The displeasure phrase that matched, as it appears in {@link DISPLEASURE_PHRASES}. */
  readonly phrase: string;
  /** The first quoted line found, trimmed of its `>` marker — what the message is complaining ABOUT. */
  readonly quoted: string;
}

/** The first Slack blockquote line in a message, without its marker, or `undefined` when there is none. */
function firstQuotedLine({ text }: { text: string }): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(">")) {
      const quoted = trimmed.slice(1).trim();
      if (quoted.length > 0) {
        return quoted;
      }
    }
  }
  return undefined;
}

/**
 * Whether this addressing text is displeasure quoting something already said. Pure and total.
 *
 * @param text the owner's own addressing text, exactly as the owner wrote it
 * @returns what matched, or `undefined` when either half is absent
 *
 * @internal — exported so a test can assert the classification without rendering guidance.
 */
export function classifyOwnerDispleasure({ text }: { text: string }): OwnerDispleasure | undefined {
  const quoted = firstQuotedLine({ text });
  if (quoted === undefined) {
    return undefined;
  }
  const lower = text.toLowerCase();
  const phrase = DISPLEASURE_PHRASES.find((candidate) => lower.includes(candidate));
  if (phrase === undefined) {
    return undefined;
  }
  return { phrase, quoted };
}

/**
 * The brief's guidance for a displeasure-shaped address — nothing at all for every other ask.
 *
 * Rendered only when {@link classifyOwnerDispleasure} fires, for the same two reasons `proposalAskLines`
 * gives: it tells the judging session what this message IS, which is the observation the incident turn never
 * made, and it leaves every other brief exactly the length it is today.
 *
 * @param text the owner's own addressing text
 * @returns the guidance lines, or nothing when this is not that shape
 */
export function ownerDispleasureLines({ text }: { text: string }): readonly string[] {
  const displeasure = classifyOwnerDispleasure({ text });
  if (displeasure === undefined) {
    return [];
  }
  return [
    `THIS QUOTES SOMETHING BACK AND SAYS "${displeasure.phrase}" — STOP, do not dispatch an investigation.`,
    `The quoted line is: "${displeasure.quoted}"`,
    "",
    "Check FIRST whether that line is this bot's own last answer in this thread (`slack read-thread`). If it",
    "is, this is not a new ask at all: it is a verdict on the turn that just ran, and a fresh worker sent to",
    "'answer' it will spend an hour guessing at a diagnosis the person holding it would give in one line.",
    "",
    "What is owed instead, in this order:",
    "  1. Say back, in one line, exactly what you believe was wrong — quoting the part of the ask the answer",
    "     did not discharge. No apology without an artefact; an apology alone is a second nothing.",
    "  2. Ask the ONE question that settles it, if you still cannot tell. That is a legitimate ending.",
    "  3. Record it, so it binds later turns rather than only this one — `slopweaver turn breakage`, with a",
    "     `--cause` naming what the answer missed. A complaint nobody wrote down arrives again next week.",
    "",
    "Re-run the original work only once you know WHICH of its failures you are fixing. Redoing it on a guess",
    "is how the same answer gets sent twice.",
  ];
}
