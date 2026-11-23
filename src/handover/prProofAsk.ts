/**
 * Whether the owner's words ASK for proof on a pull request, which kinds, and whether a live body carries them — the
 * pure half of the gate that makes a card about that pull request lead with the gap instead of a question that skips it.
 *
 * MEASURED: the owner asked, on one pull request, for before and after proof with screenshots, links to the runs in
 * GitHub, and links and screenshots from Datadog test optimisation. Weeks later the body still carried no image, no
 * Actions run link and no Datadog link, and the card put a different question to the owner twice. Repro:
 * `grep -h '^hisWords:' $SLOPWEAVER_HOME/handovers/<row-slug>.md`.
 *
 * Not `./proofAsk.ts`, which is `handover settle --as answered`'s presence check over one witness URL. The two
 * come from the same measured ask; folding them into one detector is a board row, not this module.
 *
 * ## An ask, never a mention
 *
 * An evidence noun alone is not an ask: "the proof looks good" names proof and asks for nothing. A sentence asks
 * when a REQUEST word — expected, want, need, should, show, carry, include, attach — ends within {@link ASK_REACH}
 * characters before the noun, or a noun already asked does, so one request governs the list it opens. Lexical on
 * purpose, so a fixture table falsifies it; it reads the owner's words, never a session's paraphrase of them.
 *
 * ## What a body must carry
 *
 * Each requested kind is matched by an exact shape, never a word: an embedded image (a badge is not one), a
 * `github.com/<owner>/<repo>/actions/runs/<id>` link, a Datadog console link. A generic "proof" or "evidence" is met
 * by any one of the three. The word "Datadog" in prose meets nothing.
 *
 * Pure: strings in, values out.
 */

import { PROOF_KINDS, type ProofKind } from "./proofKinds.js";
import { PASTE_PLACEHOLDER } from "./prSteers.js";

/** What one passage of the owner's words asks for: nothing, or the kinds (empty when it asks for proof of any kind). */
export type ProofAsk = { readonly kind: "none" } | { readonly kind: "asked"; readonly kinds: readonly ProofKind[] };

/** How far before an evidence noun a request word may sit and still govern it, in characters. */
const ASK_REACH = 80;

/** A word that makes the evidence after it a request rather than a mention. */
const REQUEST =
  /\b(?:expect(?:ed|ing)?|want(?:ed)?|need(?:s|ed)?|should|must|show(?:ing)?|carr(?:y|ies)|include|attach|put|add|give me|ask(?:ed)? for|would like|i'd like|prove|proving)\b/giu;

/** How far before a request word a negation may sit and still cancel it, in characters. */
const NEGATION_REACH = 40;

/**
 * A negation ending just before a request word, at most three words between — "I do not need screenshots", "no need
 * for", "don't really want", "do not at all need" — which makes it a refusal of proof, not an ask.
 * Lexical like the rest: a negation further off is stated residue.
 */
const NEGATED = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|won'?t|shouldn'?t|without)\s+(?:[a-z']+\s+){0,3}$/u;

/** Each evidence noun, and the kind it asks for — `undefined` for proof of any kind. */
const EVIDENCE: readonly { readonly pattern: RegExp; readonly kind: ProofKind | undefined }[] = [
  { kind: "image", pattern: /\b(?:screenshots?|screen ?shots?|images?|pictures?)\b/giu },
  { kind: "image", pattern: /\bbefore[- ]and[- ]after\b/giu },
  { kind: "run-link", pattern: /\blinks? to (?:the |those |these )?(?:ci |actions |github )?runs?\b/giu },
  { kind: "run-link", pattern: /\b(?:run|actions|ci) links?\b/giu },
  // Proof-shaped only: a bare "Datadog" is a product the owner talks about, and read as an ask it led a card about a sales
  // call with a missing Datadog link (MEASURED, `slopweaver handover currency --json`).
  {
    kind: "datadog",
    pattern:
      /\bdatadog (?:links?|screenshots?|traces?|dashboards?)\b|\bfrom datadog\b|\btest optimi[sz]ation\b|\bci visibility\b/giu,
  },
  { kind: undefined, pattern: /\b(?:proof|evidence)\b/giu },
];

/**
 * A block the owner pasted into a turn — usually the bot's own message they are answering — which is not their words,
 * so a "screenshot" inside it asks for nothing. MEASURED: pasted console copy plus `[Image #N]` placeholders
 * read as image asks on dozens of rows. Repro: `grep -c '<pasted_content' ~/.slopweaver/handovers/*.md`.
 */
const PASTED_CONTENT = /<pasted_content\b[^>]{0,200}>[\s\S]{0,200000}?<\/pasted_content\b[^>]{0,200}>/giu;

/** A sentence boundary the owner's words are split at, so a request in one sentence never governs a noun in the next. */
const SENTENCE = /[.!?;\n]+/u;

/** One evidence noun found in a sentence: where it starts and ends, and the kind it asks for. */
interface NounAt {
  readonly start: number;
  readonly end: number;
  readonly kind: ProofKind | undefined;
}

/**
 * The evidence nouns one sentence asks for. A noun is asked when a request word, or a noun already asked, ends within
 * {@link ASK_REACH} characters before it — so a list ("screenshots and links to those runs and also Datadog") is
 * governed by the one request word that opens it.
 *
 * @param sentence the sentence, lowercased
 * @returns the asked nouns, in the order written
 */
function askedNouns({ sentence }: { sentence: string }): readonly NounAt[] {
  const nouns = EVIDENCE.flatMap(({ pattern, kind }) =>
    [...sentence.matchAll(pattern)].map((match) => ({ end: match.index + match[0].length, kind, start: match.index })),
  ).toSorted((a, b) => a.start - b.start);
  const governs = [...sentence.matchAll(REQUEST)]
    .filter((match) => !NEGATED.test(sentence.slice(Math.max(0, match.index - NEGATION_REACH), match.index)))
    .map((match) => match.index + match[0].length);
  const asked: NounAt[] = [];
  for (const noun of nouns) {
    const reached = governs.some((end) => end <= noun.start && noun.start - end <= ASK_REACH);
    if (reached) {
      asked.push(noun);
      governs.push(noun.end);
    }
  }
  return asked;
}

/**
 * What one passage of the owner's words asks a pull request's body to carry.
 *
 * @param words the owner's words, verbatim as a row stores them
 * @returns `none`, or `asked` with the kinds named — empty kinds when the owner asked for proof without naming one
 */
export function proofAskOf({ words }: { words: string }): ProofAsk {
  const kinds = new Set<ProofKind>();
  let asked = false;
  const typed = words.replaceAll(PASTED_CONTENT, " ").replaceAll(PASTE_PLACEHOLDER, " ");
  for (const sentence of typed.toLowerCase().split(SENTENCE)) {
    for (const noun of askedNouns({ sentence })) {
      asked = true;
      if (noun.kind !== undefined) {
        kinds.add(noun.kind);
      }
    }
  }
  if (!asked) {
    return { kind: "none" };
  }
  return { kind: "asked", kinds: PROOF_KINDS.filter((one) => kinds.has(one)) };
}

/**
 * An inline markdown or HTML image, or an HTML video — what a body embeds as a picture. With
 * {@link REFERENCE_EMBED} and {@link BARE_ATTACHMENT} these are every shape GitHub's own editor writes for a pasted
 * or dropped image or video, plus the hand-written variants. The detector stays a heuristic over
 * open-ended markup: a `<picture>` with only a `srcset`, or an image behind a link it does not resolve, reads as
 * carrying none, and the card then leads with a gap the body does fill. The residue is that direction on purpose;
 * the gap sentence names the pull request, so the owner can open it.
 */
const EMBED =
  /!\[[^\]]{0,500}\]\(\s*([^)\s]{1,2000})|<(?:img|video)\b[^>]{0,2000}?\bsrc\s{0,20}=\s{0,20}(?:["']([^"']{1,2000})["']|([^\s"'>]{1,2000}))/giu;

/**
 * A reference-style markdown image — `![alt][label]`, `![alt][]` or `![alt]` — whose source is a definition elsewhere
 * in the body. Group 1 is the alt, group 2 the label when one is written.
 */
const REFERENCE_EMBED = /!\[([^\]]{0,500})\](?:\[([^\]]{0,500})\])?(?![([])/gu;

/** A link reference definition, `[label]: url`, at the start of a line. */
const REFERENCE_DEFINITION = /^ {0,3}\[([^\]]{1,500})\]:[ \t]*<?([^\s>]{1,2000})>?/gmu;

/** A GitHub attachment URL alone on its line, which GitHub renders as the image or video itself. */
const BARE_ATTACHMENT = /^[ \t]*https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]{1,100}[ \t]*$/mu;

/** An image source that is a badge, never proof: a shields badge, or a path naming itself a badge. */
const BADGE = /shields\.io|\bbadge\b|\/badge[./?]/iu;

/**
 * Every source a reference-style image in the body resolves to through its definition. A reference with no
 * definition is not an image GitHub renders, so it resolves to nothing.
 *
 * @param body the body, as GitHub returns it
 * @returns the resolved sources
 */
function referenceImageSources({ body }: { body: string }): readonly string[] {
  const definitions = new Map<string, string>();
  for (const definition of body.matchAll(REFERENCE_DEFINITION)) {
    definitions.set(definition[1]!.trim().toLowerCase(), definition[2]!);
  }
  const sources: string[] = [];
  for (const embed of body.matchAll(REFERENCE_EMBED)) {
    const written = embed[2];
    const label = written === undefined || written.trim() === "" ? embed[1]! : written;
    const source = definitions.get(label.trim().toLowerCase());
    if (source !== undefined) {
      sources.push(source);
    }
  }
  return sources;
}

/** A GitHub Actions run link. */
const RUN_LINK = /github\.com\/[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}\/actions\/runs\/\d{1,20}(?!\d)/u;

/** A Datadog console link, on any of its sites. */
const DATADOG_LINK = /https?:\/\/[A-Za-z0-9.-]{0,100}datadoghq\.(?:com|eu)\//iu;

/**
 * Which kinds of proof a pull request's body carries.
 *
 * @param body the body, as GitHub returns it
 * @returns the kinds it carries, in {@link PROOF_KINDS} order
 */
export function proofCarriedBy({ body }: { body: string }): readonly ProofKind[] {
  const carried = new Set<ProofKind>();
  for (const match of body.matchAll(EMBED)) {
    // Exactly one alternative matched: the markdown image's group, or the HTML tag's quoted or unquoted one.
    const sources = [match[1], match[2], match[3]].filter((one) => one !== undefined);
    if (sources.some((one) => !BADGE.test(one))) {
      carried.add("image");
    }
  }
  if (referenceImageSources({ body }).some((one) => !BADGE.test(one)) || BARE_ATTACHMENT.test(body)) {
    carried.add("image");
  }
  if (RUN_LINK.test(body)) {
    carried.add("run-link");
  }
  if (DATADOG_LINK.test(body)) {
    carried.add("datadog");
  }
  return PROOF_KINDS.filter((one) => carried.has(one));
}

/**
 * The kinds an ask names that a body does not carry. An ask naming no kind is met by any one.
 *
 * @param asked the kinds the owner asked for, empty for proof of any kind
 * @param carried the kinds the body carries
 * @returns the missing kinds — for a kindless ask, every kind when the body carries none, else none
 */
export function proofMissing({
  asked,
  carried,
}: {
  asked: readonly ProofKind[];
  carried: readonly ProofKind[];
}): readonly ProofKind[] {
  if (asked.length === 0) {
    return carried.length === 0 ? PROOF_KINDS : [];
  }
  return asked.filter((kind) => !carried.includes(kind));
}
