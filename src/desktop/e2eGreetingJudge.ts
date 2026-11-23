/**
 * Whether the voice opened a call as a colleague: `call-live`'s judge over the voice's first FINAL segment. Pure; the
 * call store read is `src/cli/commands/desktop/e2eCallEvidenceRead.ts`'s.
 *
 * Why it is a judge and not a note in the report: a `call-live` run on the installed app, on a console carrying the
 * greeting lines, answered the bare "Hello." with " Hey. I'm ChatGPT. I can talk
 * through ideas, help write or plan things, or even work with what's on your screen. What do you wanna tackle?" and
 * the step PASSED, because it judged only that SOME voice row followed the owner's. Repro: the `final:true`
 * `who:"voice"` segment of `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.
 *
 * What fails, each named: a product or model name, a self-introduction, and a list of what the voice can do — the
 * three things `src/talk/colleagueGreetingLines.ts` rules out — and an opening past the "few words" those lines ask
 * for, the structural bound behind the patterns, since no finite pattern set names every phrasing. What it must never fail is what those lines ASK for: a
 * greeting back in a few words ("Hey.", "Morning, what's up?") and the line check's "Yep, I'm here".
 */
import type { CallRecord } from "../talk/callRecord.js";
import { type E2eVerdict, failed } from "./e2eOutcome.js";

/** One way an opening introduced the voice rather than greeting the owner. */
type GreetingFaultKind = "product-name" | "self-introduction" | "capability-list" | "long-opening";

/** One fault, and the words that tripped it. */
export interface GreetingFault {
  readonly kind: GreetingFaultKind;
  readonly words: string;
}

/** One call's opening words, and every fault {@link greetingFaults} found in them. */
export interface E2eCallOpening {
  readonly callId: string;
  /** The voice's first final segment, `undefined` when it finished none. */
  readonly text: string | undefined;
  readonly faults: readonly GreetingFault[];
}

/*
 * Word edges. JavaScript's `\b` knows only ASCII word characters, so it finds an edge inside "éChatGPT"; every pattern below bounds a word by "no letter, mark, digit or underscore beside it" instead.
 * `(?<!W)` opens a word and `(?!W)` closes one, W being that class.
 */

/**
 * The names a voice introducing itself reaches for: the provider's and the product's own. Whole words in any script,
 * any case, so "GPT-6" and "chat gpt" trip it and "Codexes", "éChatGPT" or a word merely containing "gpt" does not.
 * A model suffix after the version never opens on an ASCII digit, so it never overlaps the version's own `\d+`:
 * overlapping quantifiers are what backtrack polynomially (`redos-check`). It may still open on
 * any other numeral, so "gpt4٣" trips it.
 */
const PRODUCT_NAME =
  /(?<![\p{L}\p{M}\p{N}_])(?:chat\s?gpt|open\s?ai|codex|gpt(?:-?\d+(?:\.\d+)*(?:(?!\d)[\p{L}\p{N}_]+)?)?|slopweaver)(?![\p{L}\p{M}\p{N}_])/iu;

/**
 * A self-introduction: "I'm"/"I am"/"this is" followed by what it is (an AI, an assistant, a model, a bot, a
 * personal assistant), or "my name is". Up to three words of any kind may sit between, not a list of determiners, so
 * "I'm the assistant", "I'm just a bot" and "I'm your friendly AI" all trip it. The "I'm here" a line
 * check asks for names nothing it is, so it never trips this. Every apostrophe here takes the typographic ’ as well,
 * which a transcript may carry, and a word between is any run of characters but whitespace and sentence punctuation,
 * so it may hold any Unicode dash, a digit or a slash ("I'm your 24/7 assistant"), and end in a comma
 * ("I'm a friendly, virtual assistant").
 */
const SELF_INTRODUCTION =
  /(?<![\p{L}\p{M}\p{N}_])(?:i['’]?m|i am|this is)\s+(?:[^\s,.!?;:]+,?\s+){0,3}?(?:ai|a\.i\.|assistant|language model|chat ?bot|bot|model)(?![\p{L}\p{M}\p{N}_])|(?<![\p{L}\p{M}\p{N}_])my name(?:['’]s| is)(?![\p{L}\p{M}\p{N}_])/iu;

/**
 * "I'm" or "this is" before a capitalised word that is not the start of a common phrase: "I'm Sol", "Hi, this is Sol"
 * A bare "Rosa here." is NOT caught: a name before "here" is also how the owner is greeted
 * back ("Hey, Ada, Rosa here" reads either way), and `FEW_WORDS` bounds what it can carry. Case-SENSITIVE but for the
 * "this" itself, because the transcript capitalises a name and
 * nothing else a greeting says after "I'm" or "this is". Any uppercase or titlecase
 * letter, not only ASCII, so "I am Éva" and "I'm ǅuro" trip it. A bare "I'm OK" answers how the owner
 * is, so it passes, but not when a capitalised word follows it: "I'm Okay Yılmaz" is a name.
 */
const NAMED_INTRODUCTION =
  /(?<![\p{L}\p{M}\p{N}_])(?:I['’]m|I am|[Tt]his is)\s+(?!I(?![\p{L}\p{M}\p{N}_]))(?!(?:OK|Okay)(?![\p{L}\p{M}\p{N}_])(?![ \t]+[\p{Lu}\p{Lt}]))[\p{Lu}\p{Lt}][\p{L}\p{M}\p{N}_]*/u;

/**
 * What the voice can do, offered: "I can" before ANY verb but the line check's "hear" and "see", so "I can talk through
 * ideas" and "I can summarize documents" both trip it. A verb allowlist let an unlisted capability pass.
 * Also "I'm here to help" and "you can talk things through with me". "I can hear you" and "I'm here" name
 * no capability, so neither trips it. The verb is any run of non-space characters, so "co-write" counts.
 * What it does NOT catch: a capability joined on after "hear" or "see" ("I can hear you and translate documents").
 * These patterns are a heuristic over an unbounded phrasing space, and each review constructed one more shape;
 * `FEW_WORDS` is the structural bound, and repeated call-live runs are the real proof.
 */
const CAPABILITY_LIST =
  /(?<![\p{L}\p{M}\p{N}_])I can (?!(?:hear|see)(?![\p{L}\p{M}\p{N}_]))[^\s.,!?;:]+|(?<![\p{L}\p{M}\p{N}_])(?:(?:I['’]?m|I am) )?here to (?:help|assist)(?![\p{L}\p{M}\p{N}_])|(?<![\p{L}\p{M}\p{N}_])you can \S+ (?:\S+ )*with me(?![\p{L}\p{M}\p{N}_])/iu;

/**
 * A list inside one sentence, "research, writing, and planning": two commas, then "and" or "or" anywhere later in the
 * sentence. A greeting back enumerates nothing, so a list is a capability list whatever verb introduces it ("I help
 * with…"), and a four-item list with no Oxford comma ("research, writing, planning and more") is
 * one too. Sentence-bounded, so "Hey, Ada. Morning, all." is not one. What it does NOT catch, on purpose:
 * a THREE-item list with no Oxford comma ("Research, writing and planning."), because one comma
 * and an "and" is also how a greeting back reads ("Morning, you and the team good?"); `FEW_WORDS` is what bounds it.
 */
const ENUMERATION = /[^,.!?]*,[^,.!?]*,[^.!?]*?(?<![\p{L}\p{M}\p{N}_])(?:and|or)(?![\p{L}\p{M}\p{N}_])[^.!?]*/iu;

/**
 * The most words a greeting back holds. The lines ask for "a few words"; every measured self-introduction ran past 20
 * (26 and 27 words in the two measured) and every passing opening held 6 or fewer. Phrasing a regex cannot list still costs words.
 */
const FEW_WORDS = 12;

/**
 * The words in a line, split on whitespace.
 *
 * @param text the line
 * @returns how many words it holds
 */
function wordCount({ text }: { text: string }): number {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

/**
 * The first of several patterns that matches, tried in order.
 *
 * @param text the line, whitespace already folded
 * @param patterns each pattern, earliest first
 * @returns the first match, `undefined` when none matched
 */
function firstMatch({ text, patterns }: { text: string; patterns: readonly RegExp[] }): RegExpExecArray | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) {
      return match;
    }
  }
  return undefined;
}

/**
 * Every fault in the voice's opening words, in a fixed order: product name, self-introduction, capability list, and
 * an opening longer than a few words. Every whitespace run is read as one space first, so a pattern's literal space
 * matches a doubled one or a tab a transcript carries ("I can  write.").
 *
 * @param text the voice's first final segment, as recorded
 * @returns each fault with the words that tripped it, empty when it greeted the owner as a colleague
 */
export function greetingFaults({ text: recorded }: { text: string }): readonly GreetingFault[] {
  const text = recorded.replace(/\s+/gu, " ");
  const faults: GreetingFault[] = [];
  const product = PRODUCT_NAME.exec(text);
  if (product !== null) {
    faults.push({ kind: "product-name", words: product[0] });
  }
  const introduced = firstMatch({ patterns: [SELF_INTRODUCTION, NAMED_INTRODUCTION], text });
  if (introduced !== undefined) {
    faults.push({ kind: "self-introduction", words: introduced[0] });
  }
  const listed = firstMatch({ patterns: [CAPABILITY_LIST, ENUMERATION], text });
  if (listed !== undefined) {
    faults.push({ kind: "capability-list", words: listed[0].trim() });
  }
  const words = wordCount({ text });
  if (words > FEW_WORDS) {
    faults.push({ kind: "long-opening", words: `${String(words)} words` });
  }
  return faults;
}

/**
 * The voice's first FINAL segment of a call, in the order the segments began: what it opened with once it finished
 * saying it. A segment the call dropped mid-word is skipped, since it is not what the voice settled on.
 *
 * @param call the call, folded
 * @returns its words, trimmed, or `undefined` when the voice finished no segment
 */
export function firstVoiceFinal({ call }: { call: Pick<CallRecord, "segments"> }): string | undefined {
  const first = call.segments.find((segment) => segment.who === "voice" && segment.final);
  if (first === undefined) {
    return undefined;
  }
  return first.text.trim();
}

/**
 * `call-live`'s greeting verdict: the voice finished an opening on EVERY one of its calls (a run opens one; a clean
 * opening on one call never covers another left unjudged), and no call opened with a product name, a
 * self-introduction, a list of what it can do or more than a few words.
 *
 * @param openings each call's opening, as {@link greetingFaults} judged it
 * @returns `undefined` when every call greeted the owner, else the failure
 */
export function greetingVerdict({ openings }: { openings: readonly E2eCallOpening[] }): E2eVerdict | undefined {
  const faulted = openings.find((opening) => opening.faults.length > 0);
  if (faulted !== undefined) {
    const named = faulted.faults.map((fault) => `${fault.kind} "${fault.words}"`).join(", ");
    return failed({
      detail: `the voice opened call ${faulted.callId} with "${String(faulted.text)}": ${named}`,
      kind: "self-introduced",
    });
  }
  if (openings.length === 0) {
    return failed({
      detail: "no call of this scenario holds a final voice segment to judge",
      kind: "evidence-missing",
    });
  }
  const unjudged = openings.find((opening) => opening.text === undefined);
  if (unjudged !== undefined) {
    return failed({
      detail: `call ${unjudged.callId} holds no final voice segment to judge`,
      kind: "evidence-missing",
    });
  }
  return undefined;
}
