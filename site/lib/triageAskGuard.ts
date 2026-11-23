/**
 * Whether the voice may begin, or pick back up, the owner's triage pass: only when the owner's own newest words, as the
 * page heard them, ask to triage. A pass is the one thing on the call that runs a clock on the owner, so it starts on
 * their word and never on the model's reading of a request for "the next card": measured, a request to be taken to the next cue
 * card began a pass at card 1 of 9 with its two-minute clock, and two minutes later the voice said "Time's up on that
 * card" over the owner's answer. Repro: `grep -n '"triage_next"\|next cue card' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * So the page judges the owner's words, as `./openCardsOffGuard.ts` does for the `openCards` switch, and refuses when
 * unsure: a triage word counts only inside an ASK ("let's triage", "it's triaging time", "triage my queue", "turn on
 * triage mode"), so one said about something else ("is that a triage card?") refuses. A refused pass leaves the card
 * walk to `action_items` and `open_card`, which run no clock, and the owner can still say "let's triage". The bound,
 * stated rather than discovered: an ask worded outside the shapes below refuses until the owner rewords it, and a
 * misheard ask passes.
 */
import type { GateEntry } from "./relayGate";

/**
 * How far back, in characters of the owner's heard words, an ask to triage still counts: about two spoken sentences, so the
 * ask is the one the owner just made rather than one from earlier in the call. Their newest stretch of speech always
 * counts whole, however long, so an ask they keep talking after is still their newest words
 * ({@link newestStretchStart}).
 */
export const TRIAGE_ASK_WINDOW = 240;

/** What the page tells the model when it refuses the pass, so it walks the card with no clock instead. */
export const TRIAGE_NOT_ASKED_REFUSAL =
  "The owner has not asked to triage, so no triage pass begins and no clock runs on any card. For the next card on their " +
  "Queue, take its key from action_items and open_card it. Call triage_next only once they ask to triage in so many " +
  "words.";

/** One mention of triage: "triage", "triaging", "triaged", the recogniser's "tri-age". */
const TRIAGE_WORD = /\btri-?ag(?:e|es|ed|ing)\b/gu;

/**
 * A word that turns the mention just after it into a refusal ("not in triage mode", "I didn't turn on triage mode",
 * "stop triaging"), read in the same stretch of words before it. A bare "no" counts only directly before the mention
 * ("no triage"), so "no worries, let's triage" still asks.
 */
const NEGATED_BEFORE =
  /(?:\b(?:not|never|stop|stopped|stopping|end|ending|quit|without|exit|finish|finished|done with|no more)\b|n't\b)[^.?!]{0,24}$|\bno\s+$/u;

/** A mention turned off by what follows it ("triage mode off", "triage mode is off", "triage isn't on"). */
const NEGATED_AFTER = /^(?:\s+mode)?\s+(?:(?:is\s+|'s\s+)?off\b|(?:isn't|is not|wasn't|was not)\s+on\b)/u;

/**
 * Words directly before a mention that make it an ask: "let's triage", "let's do some triage", "start triaging", "can
 * we triage", "time to triage", "turn on triage mode", "back to triage". A bare "do" never counts ("how do triage cards
 * work"), only "do a" or "do some".
 */
const ASK_BEFORE =
  /(?:\blet'?s(?:\s+(?:do|go|start|begin))?|\blet us|\bstart|\bbegin|\bkick off|\bdo\s+(?:a|some)|\brun|\btime\s+(?:to|for)|\bgo\s+(?:to|into)|\bturn on|\bswitch on|\bput\s+(?:me|us)\s+(?:in|into)|\benter|\bresume|\bcontinue|\bback to|\b(?:can|could|shall|should)\s+we|\bwant to|\bwanna|\bi'd like to|\bneed to)\s+(?:(?:a|the|my|some|our|into|with)\s+)?$/u;

/** "Triaging time" asks only as "it's triaging time" or "is it triage time", never "yesterday's triage time". */
const ASK_TIME_BEFORE = /\b(?:it's|its|it is|is it)\s+$/u;

/** The "…time" half of {@link ASK_TIME_BEFORE}. */
const ASK_TIME_AFTER = /^\s+time\b/u;

/**
 * An imperative opening a sentence: "triage my queue", "triage mode on". It counts only where the mention starts a
 * sentence or follows a filler ("okay, triage my queue"), so "I triage my queue on Mondays" is no ask.
 */
const IMPERATIVE_AFTER = /^\s+(?:mode\s+on\b|(?:my|the|our)\s+(?:queue|cards?|inbox)\b)/u;

/** Where a sentence starts: the beginning, a stop or comma, or a filler word that opens an instruction. */
const SENTENCE_START = /(?:^|[.?!,]\s*|\b(?:okay|ok|alright|right|so|yo|hey|now|please|then)\s+)$/u;

/**
 * Whether the words around one mention make it an ask.
 *
 * @param before up to forty characters of the owner's words just before the mention
 * @param after everything the owner said after the mention
 * @returns true when one of the ask shapes holds
 */
function askShaped({ before, after }: { before: string; after: string }): boolean {
  if (ASK_BEFORE.test(before)) {
    return true;
  }
  if (ASK_TIME_AFTER.test(after) && ASK_TIME_BEFORE.test(before)) {
    return true;
  }
  return IMPERATIVE_AFTER.test(after) && SENTENCE_START.test(before);
}

/**
 * Everything the owner was heard saying this call, joined in the order it arrived, lowercased with curly apostrophes
 * straightened.
 *
 * @param log the call's relay-gate record, which every fragment the owner was heard saying joins
 * @returns the owner's words, `""` when they have said nothing this call
 */
export function heardOwnerWords({ log }: { log: readonly GateEntry[] }): string {
  let text = "";
  for (const entry of log) {
    if (entry.kind === "heard") {
      text += entry.text;
    }
  }
  return normalised({ text });
}

/**
 * Words as the guard reads them: whitespace collapsed, trimmed, lowercased, curly apostrophes straightened.
 *
 * @param text words as they arrived
 * @returns the words, normalised
 */
function normalised({ text }: { text: string }): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase().replace(/[’‘]/gu, "'");
}

/**
 * Where the owner's newest stretch of speech begins in {@link heardOwnerWords}'s text: the stretch OPENED last, its words the growth
 * its steps recorded. Opened last rather than grown last, because an older stretch's delayed delta can land after a
 * newer one begins (`./relayGate.ts`'s `heardTailOf`), and that must never pull an older ask back in.
 *
 * A clear ask to turn on triage mode and start triage, followed by about 280 characters more in
 * the same breath was refused twice by the 240-character window alone (measured), so the newest stretch counts whole. Repro:
 * `grep -n '"triage_next"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * A step that rewrote its stretch restarts what is known of it, so only its tail is located. A stretch that is not
 * exactly their last spoken fragments — a word heard after it, a typed turn among them, its words not matching —
 * leaves the window at its 240 characters. Either way the window reaches back less, never past where their newest
 * stretch began.
 *
 * The residue, stated: "opened last" trusts that a stretch's FIRST step arrives in turn order — it is the server's
 * `turn.created`, emitted as their turn begins (`./talkPlanEvents.ts`'s `foldTurn`) — while its later deltas may not,
 * which is what the trailing-fragment match covers. The 240-character rule already trusts arrival order the same way.
 * Ordering by audio span instead would close a first step arriving late, but spans are optional on
 * every event, so it would leave this fix off on any call whose events carry none.
 *
 * @param log the call's relay-gate record
 * @param heard {@link heardOwnerWords}'s text of that record
 * @returns the index its words start at, or `undefined` when there is no stretch or its words do not end the heard text
 */
function newestStretchStart({ log, heard }: { log: readonly GateEntry[]; heard: string }): number | undefined {
  const grown = new Map<string, string>();
  let newest: string | undefined;
  for (const entry of log) {
    if (entry.kind !== "speech-segment") {
      continue;
    }
    if (!grown.has(entry.id)) {
      grown.set(entry.id, "");
      newest = entry.id;
    }
    if (entry.grew !== undefined) {
      grown.set(entry.id, `${grown.get(entry.id)!}${entry.grew}`);
    } else if (!entry.final) {
      grown.set(entry.id, "");
    }
  }
  if (newest === undefined) {
    return undefined;
  }
  const raw = grown.get(newest)!;
  const words = normalised({ text: raw });
  // The owner's newest words are their LAST spoken fragments, each vouched for by this stretch: a word heard after
  // the stretch (a newer stretch's fragment arriving before its stretch opens, or one repeating the
  // stretch word for word) or a typed turn repeating it is not it.
  if (words === "" || !endsHeardSpeech({ id: newest, log, raw }) || !heard.endsWith(words)) {
    return undefined;
  }
  return heard.length - words.length;
}

/**
 * Whether the last heard fragments of the record are spoken, never typed, each grown into this stretch by a LATER
 * open step of it, and spell exactly these words. Words arrive before the step that files them under a stretch
 * (`./relayGate.ts`'s `heardTailOf`), so a fragment with no such step after it — heard once the stretch closed, or
 * belonging to a stretch not yet opened — is not this stretch's, however exactly its text matches.
 *
 * @param id the stretch's id
 * @param log the call's relay-gate record
 * @param raw a stretch's words as its steps grew them, unnormalised
 * @returns true only when the trailing spoken fragments are this stretch's and join to exactly `raw`
 */
function endsHeardSpeech({ id, log, raw }: { id: string; log: readonly GateEntry[]; raw: string }): boolean {
  const claimed = new Set<number>();
  let tail = "";
  for (let at = log.length - 1; at >= 0; at -= 1) {
    const entry = log[at];
    if (entry.kind !== "heard" || entry.text === "") {
      continue;
    }
    if (entry.typed === true || !grownLater({ at, claimed, heard: entry, id, log })) {
      return false;
    }
    tail = `${entry.text}${tail}`;
    if (tail.length >= raw.length) {
      return tail === raw;
    }
  }
  return false;
}

/**
 * Claim the first unclaimed open step of this stretch after a fragment that grew it by exactly that fragment's text,
 * over the same audio when both say which.
 *
 * @param at the fragment's index in the record
 * @param claimed indices of steps already vouching for a later fragment, added to on a match
 * @param heard the fragment
 * @param id the stretch's id
 * @param log the call's relay-gate record
 * @returns whether a step vouched for it
 */
function grownLater({
  at,
  claimed,
  heard,
  id,
  log,
}: {
  at: number;
  claimed: Set<number>;
  heard: Extract<GateEntry, { kind: "heard" }>;
  id: string;
  log: readonly GateEntry[];
}): boolean {
  for (let next = at + 1; next < log.length; next += 1) {
    const step = log[next];
    if (step.kind !== "speech-segment" || step.id !== id || step.final || step.grew !== heard.text) {
      continue;
    }
    const otherAudio =
      heard.span !== undefined &&
      step.span !== undefined &&
      (heard.span.startMs !== step.span.startMs || heard.span.endMs !== step.span.endMs);
    if (claimed.has(next) || otherAudio) {
      continue;
    }
    claimed.add(next);
    return true;
  }
  return false;
}

/**
 * Whether the owner's newest words ask to triage: their LAST mention of triage ends inside the last {@link TRIAGE_ASK_WINDOW}
 * characters or inside their newest stretch of speech, the words directly around it make it an ask, and nothing just
 * around it turns it into a no. The last
 * mention decides, so "let's triage — actually no, not triage" refuses, and so does "let's triage. Is that a triage
 * card?". That fails closed: no pass begins, and the owner can say it again.
 *
 * @param log the call's relay-gate record, read for what the owner was actually heard saying
 * @returns true only for an un-negated ask to triage, the newest mention, within the window
 */
export function heardTriageAsked({ log }: { log: readonly GateEntry[] }): boolean {
  const heard = heardOwnerWords({ log });
  const mentions = [...heard.matchAll(TRIAGE_WORD)];
  const last = mentions.at(-1);
  if (last === undefined) {
    return false;
  }
  const end = last.index + last[0].length;
  const inWindow = end > heard.length - TRIAGE_ASK_WINDOW;
  const stretchStart = newestStretchStart({ heard, log });
  // The whole mention inside the owner's newest stretch, never one straddling its first word.
  const inStretch = stretchStart !== undefined && last.index >= stretchStart;
  if (!inWindow && !inStretch) {
    return false;
  }
  const before = heard.slice(Math.max(0, last.index - 40), last.index);
  const after = heard.slice(end);
  return askShaped({ after, before }) && !NEGATED_BEFORE.test(before) && !NEGATED_AFTER.test(after);
}
