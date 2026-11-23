/**
 * The ONE Queue card a kept `gmail clear-meeting-notes` mail gets: its slug, its fields and the `handover register`
 * argv that places it. Pure. Keyed by the message, so a second run finds the first run's card rather than stacking
 * another — the mail is never a silent skip, and never asked about twice.
 */
import { splitSentences } from "../../../briefing/text.js";
import { askExampleProblems } from "../../../handover/askExamples.js";
import { cardAlignmentProblems } from "../../../handover/cardAlignment.js";
import { type StatedWorkspace, workspaceRegisterArgv } from "../../../handover/workspace.js";
import {
  type KeptMeetingReason,
  keptReasonText,
  type MeetingDisposition,
  meetingLabel,
} from "./clearMeetingNotesCore.js";

/**
 * What one card placement answered: placed now, still standing on the Queue, or settled by the owner — archived or
 * carrying a settlement, so off the Queue, and never placed a second time.
 */
export type CardReceipt = "placed" | "existing" | "settled";

/** The fields one `handover register --ask` row carries, before they become argv. */
export interface MeetingCard {
  readonly slug: string;
  readonly ask: string;
  readonly problem: string;
  readonly options: readonly string[];
  readonly lean: string;
  readonly risk: string;
  readonly blastRadius: string;
  readonly stillReal: string;
  /** The concrete scene the card leads with (`src/handover/askExamples.ts`), ending on its question. */
  readonly example: string;
}

/** The scene when the full one breaks the shape — a long title or provider message — still true of every kept mail. */
const PLAIN_SCENE =
  "You open your inbox and a Gemini notes mail is still sitting there, kept back from archiving. " +
  "Archive it without its transcript in the corpus?";

/**
 * The card's scene: the owner in their inbox, the mail still there and why, ending on the card's question. Falls to
 * {@link PLAIN_SCENE} when the meeting's own words would break the scene's shape, rather than refusing the card.
 *
 * @param meeting how the mail's meeting is named
 * @param why the sentence saying why it stayed, closed with a full stop
 * @returns the scene
 */
function meetingScene({ meeting, why }: { meeting: string; why: string }): string {
  const scene =
    `You open your inbox and the Gemini notes mail for ${meeting} is still there. It stayed because ${why} ` +
    "Archive it without its transcript in the corpus?";
  if (askExampleProblems({ examples: [scene], gap: undefined }).length > 0) {
    return PLAIN_SCENE;
  }
  return scene;
}

/** The ask when the full one would be refused — still true of every kept mail, whose meeting and why the card's other fields carry. */
const PLAIN_ASK =
  "Archive this Gemini notes mail without its transcript in the corpus? It stays in the inbox until you answer.";

/**
 * The card's question: the meeting, then why it stayed. The reason is the THIRD sentence, outside the two the heading
 * gate reads (`../../../handover/cardAlignment.ts`), because a provider's message may carry a request id. A subject
 * title is not ours to word either, and one refused card fails the whole scheduled run, so a title the gate would
 * refuse moves into parentheses after the words, and one that still cannot pass falls to {@link PLAIN_ASK}.
 *
 * @param meeting how the mail's meeting is named
 * @param why the sentence saying why it stayed, closed with a full stop
 * @returns the first of those the gate takes
 */
function meetingAsk({ meeting, why }: { meeting: string; why: string }): string {
  const asks = [meeting, `the meeting (${meeting})`].map(
    (named) =>
      `Archive the Gemini notes mail for ${named} without its transcript in the corpus? It stays in the inbox until ` +
      `you answer. It stayed because ${why}`,
  );
  const taken = asks.find((ask) => cardAlignmentProblems({ question: ask }).length === 0);
  if (taken === undefined) {
    return PLAIN_ASK;
  }
  return taken;
}

/** The options a card offers, as `handover register --options` lines (`<what the owner could do> :: <what it costs>`). */
function cardOptions({ reason }: { reason: KeptMeetingReason }): readonly string[] {
  const leave = "Leave the mail in the inbox :: it stays until the transcript can be read";
  if (reason.kind === "no-docs-grant") {
    return ["Re-run `slopweaver gmail connect --grant manage` and approve Google Docs :: one consent screen", leave];
  }
  if (reason.kind === "provider-error") {
    return ["Ask the document's owner to share it with you :: one message to them", leave];
  }
  return ["Archive it anyway :: the corpus will not hold this meeting's transcript", leave];
}

/**
 * The card slug for one kept mail — keyed by the message, so a second run finds the first run's card. Pure.
 *
 * @param messageId the kept mail
 * @returns the slug
 */
export function meetingCardSlug({ messageId }: { messageId: string }): string {
  return `meeting-notes-mail-${messageId.toLowerCase()}`;
}

/**
 * The Queue card for one kept mail: what stayed, why, and what the owner could do. Pure.
 *
 * @param disposition the kept mail
 * @param reason why it stayed
 * @returns the card's fields
 */
export function meetingCard({
  disposition,
  reason,
}: {
  disposition: MeetingDisposition;
  reason: KeptMeetingReason;
}): MeetingCard {
  const meeting = meetingLabel({ disposition });
  const why = keptReasonText({ reason });
  const options = cardOptions({ reason });
  const closed = why.endsWith(".") ? why : `${why}.`;
  return {
    ask: meetingAsk({ meeting, why: closed }),
    blastRadius: "One mail in your inbox, and whether this meeting's transcript is in the corpus",
    example: meetingScene({ meeting, why: closed }),
    lean: options[0]!.split(" :: ")[0]!,
    options,
    // `handover register` caps the problem at one sentence, and a provider's message may run to several; the whole
    // reason still reads in the ask.
    problem: splitSentences({ text: why })[0]!,
    risk: "Archiving loses the only pointer to a transcript the corpus does not hold",
    slug: meetingCardSlug({ messageId: disposition.messageId }),
    stillReal: `gmail clear-meeting-notes read message ${disposition.messageId} in the inbox on this run`,
  };
}

/**
 * The argv `handover register` parses for one card. Pure.
 *
 * @param card the card's fields
 * @param home the Slopweaver home the row is written under
 * @param workspace whose work the card is, from the mailbox the mail was read in, or `undefined` when it cannot say
 * @returns the full process argv
 */
export function meetingCardArgv({
  card,
  home,
  workspace,
}: {
  card: MeetingCard;
  home: string;
  workspace: StatedWorkspace | undefined;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    card.ask,
    "--slug",
    card.slug,
    "--problem",
    card.problem,
    "--options",
    card.options.join("\n"),
    "--lean",
    card.lean,
    "--risk",
    card.risk,
    "--blast-radius",
    card.blastRadius,
    "--still-real",
    card.stillReal,
    "--example",
    card.example,
    ...workspaceRegisterArgv({ stated: workspace }),
    "--home",
    home,
  ];
}
