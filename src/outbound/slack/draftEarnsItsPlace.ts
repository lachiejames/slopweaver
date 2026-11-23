/**
 * The earns-its-place gate — a draft parked as the owner already reads the way the owner trims one, so they never
 * have to.
 *
 * The owner stripped five figures, filler, alert detail and open questions off one parked draft by voice, and the
 * lesson generalises: a freeform "keen to hear what you reckon" after the hook drains the reader, "chart and ticket
 * attached" does not earn its space, and the next drafts should be approvable on the first try. The cut the owner
 * kept is three paragraphs, about seventy words, one figure and one question, with the rest on an annotated chart. So
 * `slack draft record --as me` REFUSES a draft past that shape rather than parking it for the owner to trim (rule 7:
 * shape is enforced by the schema, never by review).
 *
 * **What it counts**, over {@link asMeSequences}: a one-card's `lines`, a one-list's `lead` and `trailing`, a drip's
 * one message. A one-list's `bullets` are exempt from every rule, because a roster's list IS its substance (a batch
 * review ask carries one line per person). Four caps and one phrase list:
 *
 * - **Paragraphs** ≤ {@link PARAGRAPHS_MAX}.
 * - **Words** ≤ {@link WORDS_MAX} — the owner's own number. Every word the owner would read counts: text runs,
 *   code included, a link's label (a whole pull-request title is still on the screen), one per mention.
 * - **Figures** ≤ {@link FIGURES_MAX}, distinct, in authored text runs only (`./draftFigures.ts`).
 * - **Questions** ≤ {@link QUESTIONS_MAX}: one clear question, never a list of them.
 * - **Filler**: a freeform close or an announcement of an attachment the reader can already see.
 * - **Trailing**: a paragraph that asks the reader something ends on that ask (`./draftEndsOnAsk.ts`).
 *
 * **What it deliberately does not do.** It does not require a question, or put one anywhere: an FYI and a reply need
 * none, and the cut the owner kept has a paragraph after its question — so `trailing` binds the asking paragraph,
 * never the paragraphs after it. It never runs at release, so bytes the owner approved can never stall, and never on
 * a `--as bot` card, whose figures are typed fields under their own gates.
 *
 * **Two surfaces read it.** `slack draft record --as me` over the form, and the talk console's running list over the
 * Slack mrkdwn it offers (`../voice/copyDraftSequences.ts`, `../voice/copyVerdict.ts`) through
 * {@link earnsItsPlaceFindingsOf}. The tray's reasons must never copy the message, so every finding carries a
 * `blindFix` naming no fragment of the draft beside its `fix`.
 *
 * MEASURED while planning, over the 186 parked as-me rows in `$SLOPWEAVER_HOME/queue/slack-drafts.jsonl`
 * that carry a form: 84 would have refused. Of the 31 that ask for a review (by `--act` or `--why`), 6 refuse, every
 * one on four paragraphs or more, 4 of them past 100 words too; 4 of the 14 bumps refuse. Most of those were released
 * before the rule, some unedited, so the register is not the owner's verdict on this shape: the cut they kept is. Re-measure: `jq -c 'select(.kind=="parked" and .draft.form != null) | .draft.form' "$SLOPWEAVER_HOME/queue/slack-drafts.jsonl"`
 * and run each form through {@link earnsItsPlaceFindings}.
 *
 * Pure: no network, no clock, no filesystem.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusalLines } from "../../hatch/render.js";
import { asMeSequences } from "../artifact/runs.js";
import type { AsMeArtifact, DripInlineRun } from "../artifact/types.js";
import { sentencesAfterAsk } from "./draftEndsOnAsk.js";
import { figuresInDraftText } from "./draftFigures.js";

/** The paragraphs the cut the owner kept carries: the hook with its question, where it came from, and an opener. */
export const PARAGRAPHS_MAX = 3;

/** The owner's own number: a hundred words max. */
export const WORDS_MAX = 100;

/** One number in the prose; every other one goes on the annotated image. */
export const FIGURES_MAX = 1;

/** One clear question, never a list of them. */
export const QUESTIONS_MAX = 1;

/**
 * A freeform close: an open invitation after the point, which drains the reader's energy. A fixed list, as
 * `./reviewAskShape.ts`'s is — a miss leaves a close unflagged (the state before this gate), a false read costs a
 * reword. "no rush" is NOT here: it is the one close wanted on a one-person ask.
 */
const FREEFORM_CLOSE = new RegExp(
  [
    String.raw`\bkeen\s+to\s+hear\b`,
    String.raw`\b(?:would|i'?d)\s+love\s+to\s+hear\b`,
    String.raw`\blet\s+me\s+know\s+(?:what\s+you\s+(?:think|reckon)|your\s+thoughts|if\s+(?:you\s+have\s+)?any\s+(?:questions|thoughts))\b`,
    String.raw`(?:^|[.!?]\s+)(?:any\s+)?thoughts\s*\?`,
    String.raw`\byou(?:'d|\s+would)\s+know\s+(?:this\s+)?better\s+than\s+(?:me|i)\b`,
    String.raw`\byou\s+know\s+this\s+(?:setup|area|stuff|one)\s+best\b`,
  ].join("|"),
  "giu",
);

/**
 * Something the reader can already see under the message, announced in words — and ONLY announced: the phrase ends
 * its clause ("chart and ticket attached."). A reference that goes on to say something ("the graph above shows it
 * started overnight", "see above" pointing at a colleague's message in the thread) is content, and never matches.
 */
const ATTACHMENT_ANNOUNCEMENT = new RegExp(
  [
    String.raw`\b(?:chart|graph|screenshot|image|picture|pic|ticket|receipt)s?(?:\s+(?:and|&)\s+(?:the\s+)?(?:chart|graph|screenshot|image|picture|pic|ticket)s?)?\s+(?:is\s+|are\s+)?(?:attached|below|above)(?=\s*(?:[.,;:!)]|$))`,
    String.raw`\b(?:see\s+)?attached\s+(?:is\s+|are\s+)?(?:the\s+|a\s+)?(?:chart|graph|screenshot|image|picture|ticket)s?(?=\s*(?:[.,;:!)]|$))`,
    String.raw`\bsee\s+(?:the\s+)?attached(?=\s*(?:[.,;:!)]|$))`,
  ].join("|"),
  "gimu",
);

/**
 * Which rule a draft broke.
 *
 * @internal — named only through {@link EarnsItsPlaceFinding}'s `rule`.
 */
export type EarnsItsPlaceRule = "paragraphs" | "words" | "figures" | "questions" | "filler" | "trailing";

/** One rule a draft broke, and the move that fixes it. */
export interface EarnsItsPlaceFinding {
  readonly rule: EarnsItsPlaceRule;
  readonly fix: string;
  /**
   * The same move naming no fragment of the draft — counts and positions only — for a surface whose reasons must
   * never copy the message (the running list, `../voice/copyVerdict.ts`). `fix` quotes figures and filler phrases.
   */
  readonly blindFix: string;
}

/** A counted paragraph's runs. */
type CountedSequence = readonly DripInlineRun[];

/**
 * The run sequences the gate counts: every paragraph but a one-list's bullets.
 *
 * @returns the counted sequences, in reading order
 */
function countedSequences({ artifact }: { artifact: AsMeArtifact }): readonly CountedSequence[] {
  return asMeSequences({ artifact })
    .filter((sequence) => sequence.field !== "bullets")
    .map((sequence) => sequence.runs);
}

/**
 * The words a reader reads in one sequence: text (code included), a link's label, and one token per mention.
 *
 * @returns the visible text, one space between runs
 */
function visibleWordsOf({ runs }: { runs: readonly DripInlineRun[] }): string {
  return runs
    .map((run) => {
      if (run.type === "text") {
        return run.text;
      }
      if (run.type === "link") {
        return run.label;
      }
      return "@someone";
    })
    .join(" ");
}

/**
 * The author's own words in one sequence: text runs that are neither code nor somebody else's quoted words. A
 * skipped run contributes a space, so the words either side of it never weld.
 *
 * @returns the authored prose
 */
function authoredTextOf({ runs }: { runs: readonly DripInlineRun[] }): string {
  return runs.map((run) => (run.type === "text" && run.code !== true && run.quoted !== true ? run.text : " ")).join("");
}

/**
 * How many words a string holds: whitespace tokens carrying a letter or a digit.
 *
 * @returns the count
 */
function wordCount({ text }: { text: string }): number {
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * The four caps: paragraphs, words, figures, questions.
 *
 * @returns one finding per cap broken, in that order
 */
function capFindings({
  sequences,
  authored,
}: {
  sequences: readonly CountedSequence[];
  authored: string;
}): readonly EarnsItsPlaceFinding[] {
  const words = sequences.reduce((total, runs) => total + wordCount({ text: visibleWordsOf({ runs }) }), 0);
  const figures = figuresInDraftText({ text: authored });
  const questions = [...authored.matchAll(/\?+/gu)].length;
  const findings: EarnsItsPlaceFinding[] = [];
  if (sequences.length > PARAGRAPHS_MAX) {
    const fix =
      `${String(sequences.length)} paragraphs, past ${String(PARAGRAPHS_MAX)}: open on the one-sentence finding and its ` +
      "number, ask the one question, and cut every paragraph that is detail a colleague can pull for";
    findings.push({ blindFix: fix, fix, rule: "paragraphs" });
  }
  if (words > WORDS_MAX) {
    const fix =
      `${String(words)} words, past ${String(WORDS_MAX)} (a link's label counts, since it is on the screen): peel ` +
      "details back until each word earns its place, and give a pull request a short label";
    findings.push({ blindFix: fix, fix, rule: "words" });
  }
  if (figures.length > FIGURES_MAX) {
    const keep =
      "keep the ONE that sells the finding in the prose and draw the rest as annotations on the attached image";
    findings.push({
      blindFix: `${String(figures.length)} figures, past ${String(FIGURES_MAX)}: ${keep}`,
      fix:
        `${String(figures.length)} figures (${figures.join(", ")}): ${keep} (\`--media\`); an identifier the count ` +
        "misreads goes in a code run",
      rule: "figures",
    });
  }
  if (questions > QUESTIONS_MAX) {
    const fix =
      `${String(questions)} questions: ask ONE clear, specific question whose answer is obvious to the person ` +
      "tagged, and cut the rest";
    findings.push({ blindFix: fix, fix, rule: "questions" });
  }
  return findings;
}

/**
 * The two shape rules that are not counts: filler phrases, and a paragraph running on past its ask.
 *
 * @returns one finding per rule broken, filler first
 */
function shapeFindings({
  sequences,
  authored,
}: {
  sequences: readonly CountedSequence[];
  authored: string;
}): readonly EarnsItsPlaceFinding[] {
  const findings: EarnsItsPlaceFinding[] = [];
  const filler = [FREEFORM_CLOSE, ATTACHMENT_ANNOUNCEMENT].flatMap((pattern) =>
    [...authored.matchAll(pattern)].map((hit) => hit[0].trim()),
  );
  if (filler.length > 0) {
    const move = "end on the one question, or say plainly that it is an FYI, and let an attachment speak for itself";
    findings.push({
      blindFix: `a freeform close or an attachment announced in words does not earn its space: ${move}`,
      fix: `${filler.map((phrase) => `"${phrase}"`).join(", ")} does not earn its space: ${move}`,
      rule: "filler",
    });
  }
  const runOn = sequences
    .map((runs, index) => ({ after: sentencesAfterAsk({ runs }), paragraph: index + 1 }))
    .filter(({ after }) => after > 0);
  if (runOn.length > 0) {
    const where = runOn
      .map(
        ({ after, paragraph }) =>
          `paragraph ${String(paragraph)} runs ${String(after)} ${after === 1 ? "sentence" : "sentences"} past its ask`,
      )
      .join(", ");
    const fix =
      `${where}: end that paragraph on the ask and cut what follows it there, since the reader stops reading at the ask; ` +
      "context a reader needs goes in its own paragraph";
    findings.push({ blindFix: fix, fix, rule: "trailing" });
  }
  return findings;
}

/**
 * Every rule a draft as the owner breaks, over its counted paragraphs — the core both surfaces share: the parked form
 * through {@link earnsItsPlaceFindings}, the running list's mrkdwn through `../voice/copyDraftSequences.ts`. Pure.
 *
 * @param sequences the counted paragraphs, in reading order, a list's bullets already left out
 * @returns one finding per broken rule, in the order a composer would fix them
 */
export function earnsItsPlaceFindingsOf({
  sequences,
}: {
  sequences: readonly CountedSequence[];
}): readonly EarnsItsPlaceFinding[] {
  const authored = sequences.map((runs) => authoredTextOf({ runs })).join("\n");
  return [...capFindings({ authored, sequences }), ...shapeFindings({ authored, sequences })];
}

/**
 * Every rule a parked as-me draft breaks, each with the move that fixes it — nothing when it already reads the way
 * the owner trims one. Pure.
 *
 * @param artifact the validated, linkified as-me form the draft would park
 * @returns one finding per broken rule, in the order a composer would fix them
 */
export function earnsItsPlaceFindings({ artifact }: { artifact: AsMeArtifact }): readonly EarnsItsPlaceFinding[] {
  return earnsItsPlaceFindingsOf({ sequences: countedSequences({ artifact }) });
}

/**
 * The advisory line a draft parked past the gate under an open hatch carries, so the owner's card says it went past.
 *
 * @param artifact the validated, linkified as-me form the draft parks
 * @returns one line naming the rules it broke, or nothing when it broke none
 */
export function earnsItsPlaceAdvisory({ artifact }: { artifact: AsMeArtifact }): readonly string[] {
  const findings = earnsItsPlaceFindings({ artifact });
  if (findings.length === 0) {
    return [];
  }
  const rules = findings.map((finding) => finding.rule).join(", ");
  return [`parked past the earns-its-place gate under its hatch: broke ${rules}`];
}

/**
 * Why a parked as-me draft cannot park as written — nothing when it earns every word, or when the hatch is open.
 *
 * @param artifact the validated, linkified as-me form the draft would park
 * @param enabled false when the `earns-its-place` hatch is open for this recording
 * @returns each broken rule's fix, then the four-line refusal, or nothing
 */
export function earnsItsPlaceRefusal({
  artifact,
  enabled,
}: {
  artifact: AsMeArtifact;
  enabled: boolean;
}): readonly string[] {
  if (!enabled) {
    return [];
  }
  const findings = earnsItsPlaceFindings({ artifact });
  if (findings.length === 0) {
    return [];
  }
  return [
    ...findings.map((finding) => `${finding.rule}: ${finding.fix}`),
    ...hatchRefusalLines({
      detail: `broke ${findings.map((finding) => finding.rule).join(", ")}`,
      hatch: hatchFor({ id: "earns-its-place" }),
    }),
  ];
}
