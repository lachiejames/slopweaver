/**
 * The card a turn posts when it ended WITHOUT an answer, pure: its index, its lead sentence, and the coverage
 * table its fold carries.
 *
 * A notice family of its own beside `./blockedForm.ts`, and for the same reason: it imports `./answer.ts`'s
 * shared primitives (the clamp, the bullets, the prose paragraph, the provenance footer) and nothing imports
 * it back, so the dependency runs one way only. Nothing here posts, reads a clock, or touches the corpus;
 * `./turnSettle.ts` is the effectful edge that builds this card and hands it to the poster.
 *
 * ## Why a failure notice still carries the coverage table
 *
 * Baseline retrieval quality on this corpus is mean recall@k 55%, every recency case measures 0%, and a
 * real query ranked a "Welcome to Notion" template page second. A turn that broke AFTER loading the corpus
 * still knows what it saw, and saying so is worth more than silence about it. The manifest is a TABLE
 * rather than prose for a measured reason: `checkDetailWhole` excludes tables from the whole-detail prose
 * cap (they are bounded by rows x columns instead), so the coverage rows cost the notice no room.
 */
import { TABLE_CELL_VISIBLE_MAX, TABLE_MAX_ROWS, TLDR_VISIBLE_MAX } from "../../outbound/artifact/schema.js";
import type { DetailBlock, InlineRun, TableDetail } from "../../outbound/artifact/types.js";
import { type CoverageLeg, type CoverageManifest, skippedTotal } from "../../retrieval/coverage.js";
import {
  clampVisible,
  notesBullets,
  proseParagraph,
  provenanceRuns,
  type TurnAnswerCard,
  type TurnFailureCause,
} from "./answer.js";
import { missingCoverageNote } from "./failureCoverageNote.js";
import { questionForPlainField } from "./quotedQuestion.js";

/** One coverage row's cells, as plain strings. Pure — the table wraps these in runs. */
function coverageCells({ leg }: { leg: CoverageLeg }): readonly string[] {
  const skipped = skippedTotal({ skipped: leg.skipped });
  const counts = skipped === 0 ? String(leg.indexed) : `${String(leg.indexed)} (−${String(skipped)})`;
  return [leg.leg, leg.state, counts, leg.detail];
}

/**
 * The coverage manifest as a table — the part of the card that says what the answer could not see.
 *
 * Rows are capped at Slack's measured table bound. Overflow is REPORTED rather than dropped: the last row
 * becomes a count of what did not fit, because a manifest that silently omits a leg is worse than no
 * manifest — it reads as a complete accounting of a corpus and is not one.
 *
 * @param coverage the manifest from the corpus load
 * @returns the table sub-block, one row per leg
 */
export function coverageTable({ coverage }: { coverage: CoverageManifest }): TableDetail {
  const cell = ({ text }: { text: string }): readonly InlineRun[] => [
    { text: clampVisible({ cap: TABLE_CELL_VISIBLE_MAX, text }), type: "text" },
  ];
  const legs = coverage.legs;
  const fits = legs.length <= TABLE_MAX_ROWS;
  const shown = fits ? legs : legs.slice(0, TABLE_MAX_ROWS - 1);
  const rows = shown.map((leg) => coverageCells({ leg }).map((text) => cell({ text })));
  const overflow = legs.length - shown.length;
  return {
    columns: ["leg", "state", "indexed", "why"],
    rows: fits
      ? rows
      : [
          ...rows,
          [
            cell({ text: `+${String(overflow)} more` }),
            cell({ text: "—" }),
            cell({ text: "—" }),
            cell({ text: "legs beyond Slack's row cap" }),
          ],
        ],
    type: "table",
  };
}

/**
 * The above-the-fold index of a failure card: the bar, then the human.
 *
 * Everything here is colleague-facing, so it names NO internal machinery — no gate, no finding code, no
 * queue id, no session path. That is the owner's ruling rather than a style preference: one low-quality
 * answer costs more trust than many good ones built, so the message a watching colleague gets has to read as
 * a high bar being held, not as a machine breaking. The technical truth is not hidden — it is one click away
 * in the detail fold, which the same ruling explicitly leaves technical.
 *
 * @param cause why the turn ended without an answer
 * @param ownerMention the identity-map key to tag, or `undefined` when no owner is configured — in which
 *   case NO tag line is written at all, because claiming a human was pulled in when nobody was pinged is the
 *   same class of lie the whole card is being rewritten to remove
 * @returns the index lines, in display order
 */
function failureIndex({
  cause,
  ownerMention,
}: {
  cause: TurnFailureCause;
  ownerMention: string | undefined;
}): readonly (readonly InlineRun[])[] {
  const bar: readonly (readonly InlineRun[])[] =
    cause === "unproven"
      ? [[{ text: "Nothing goes out unproven — when this bot answers, the evidence is behind it.", type: "text" }]]
      : [];
  if (ownerMention === undefined) {
    return bar;
  }
  const ask =
    cause === "unproven"
      ? " is tagged in to sort out what was missing and get you the answer."
      : " is tagged in to look at what broke and get you the answer.";
  return [
    ...bar,
    [
      { person: ownerMention, type: "mention" },
      { text: ask, type: "text" },
    ],
  ];
}

/**
 * The card a turn posts when it ended WITHOUT an answer — either the gate held the answer back, or the turn
 * broke before it had one.
 *
 * A separate builder from `./answer.ts`'s `turnHeldForm`, because the two carry genuinely different things: this one
 * has no citations and nothing to be truthful about except the ending and whichever legs were read before
 * it happened.
 *
 * The FACE and the FOLD are written for two different readers, which is the whole shape of this card. The
 * face is for the colleague who asked: it says an answer was not given and that a human is on it, in words
 * that are true of a high bar being held rather than of a machine falling over. The fold is for whoever
 * fixes it: it carries the ending's own words, verbatim, including the gate's finding.
 *
 * @param cause why the turn ended without an answer — which face it wears
 * @param question the question as asked
 * @param names what each Slack user id in the question reads as — see {@link questionForPlainField}
 * @param reason why the turn could not answer, in the ending's own words — FOLD only
 * @param coverage the manifest, when the corpus load got far enough to produce one
 * @param modelId the model that was to produce the answer
 * @param ownerMention the identity-map key to tag, or `undefined` when no owner is configured
 * @returns the form and the list of fields it had to shorten
 */
export function turnFailureForm({
  cause,
  question,
  names = {},
  reason,
  coverage,
  modelId,
  ownerMention,
}: {
  cause: TurnFailureCause;
  question: string;
  names?: Readonly<Record<string, string>>;
  reason: string;
  coverage?: CoverageManifest | undefined;
  modelId: string;
  ownerMention?: string | undefined;
}): TurnAnswerCard {
  const lead =
    cause === "unproven"
      ? `The answer was composed and then refused before it could be sent. ${reason}`
      : `The turn stopped before it could answer. ${reason}`;
  const tldr = failureTldr({ cause, names, question });
  const detail: DetailBlock[] = [proseParagraph({ text: lead })];
  const notes = [missingCoverageNote({ cause, coverage })];
  if (coverage !== undefined) {
    detail.push(coverageTable({ coverage }));
  }
  if (ownerMention === undefined) {
    notes.push("Nobody was tagged — no `slackBot.ownerUserId` is configured in profile.json.");
  }
  if (tldr.shortened) {
    notes.push("The question was shortened to fit the lead line; it is quoted whole in the thread above.");
  }
  detail.push(notesBullets({ notes }));
  detail.push({ runs: provenanceRuns({ modelId }), type: "paragraph" });
  return {
    artifact: {
      citations: [],
      detail,
      index: failureIndex({ cause, ownerMention }),
      kind: "update",
      media: [],
      tldr: tldr.text,
    },
    clamped: tldr.shortened ? ["tldr"] : [],
  };
}

/**
 * The one sentence a failure card leads with — already inside {@link TLDR_VISIBLE_MAX}.
 *
 * The QUESTION is what gets shortened, never the frame around it, and that ordering is the whole point of
 * building the sentence here rather than clamping it whole afterwards: the clause a reader needs is the one
 * saying no answer was posted and why, and clamping the finished sentence would drop exactly that clause for
 * any question long enough to reach the cap.
 *
 * @param cause why the turn ended without an answer
 * @param question the question as asked
 * @param names what each Slack user id in the question reads as — see {@link questionForPlainField}
 * @returns the lead sentence, and whether the question had to be shortened to fit it
 */
function failureTldr({
  cause,
  names,
  question,
}: {
  cause: TurnFailureCause;
  names: Readonly<Record<string, string>>;
  question: string;
}): {
  readonly text: string;
  readonly shortened: boolean;
} {
  // Two SENTENCES rather than a clause and a separator, and that is the rule rather than the wording: the
  // `unproven` arm beside it already read this way, and the `broke` arm carried a hard-coded em dash between
  // its two ideas — the exact authoring mistake an owner ruling asked to be made
  // impossible. `../../outbound/artifact/headline.ts` is the form that makes it impossible where a composer
  // owns every word, and `authored-separator` in `yarn lint` is what keeps a separator out of a `tldr`
  // anywhere else. This line cannot take the clause form: `asked` is the ASKER's question, and putting
  // somebody else's words under a rule that refuses punctuation is the scar `../../outbound/artifact/aboveFold.ts`
  // records at length.
  const frame =
    cause === "unproven"
      ? { after: '" but it did not clear the bar to post.', before: 'I had an answer to "' }
      : { after: '". Nothing was posted.', before: 'Something broke while I was answering "' };
  // Markup RESOLVED before the clamp measures anything: a clamp through the middle of `<@U0SYN…` leaves a
  // span `scanRawMarkup` no longer matches, so the gate passes over an id no reader can read — a silent
  // wrong where today's refusal is at least loud. `./quotedQuestion.ts` carries the whole argument.
  const prose = questionForPlainField({ names, question });
  const asked = clampVisible({ cap: TLDR_VISIBLE_MAX - frame.before.length - frame.after.length, text: prose });
  return { shortened: asked !== prose, text: `${frame.before}${asked}${frame.after}` };
}
