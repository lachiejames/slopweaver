/**
 * What the Queue page hands the console voice when it calls `read_page`: the card the owner has open, whole, and
 * a short list of what else the page is drawing.
 *
 * The card is the SAME `QueueCard` the panel renders, so "what am I even looking at" is answered from what
 * is on the owner's screen rather than a second reading of it. An ask card names its board slug, because the card
 * caps its text and the owner's own earlier words sit in the row itself — `board_row` reads those.
 */
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import { draftLinesWords } from "./draftWords";
import type { StepCard, StepChecklistLine, StepRow } from "./queueCard";
import type { LiftedSection } from "./queueFocus";
import type { QueueRow } from "./queueRows";
import { markedInView, markInView } from "./queueStopping";
import { reasonTextOf } from "./quotedReason";
import { heldDraftsNamed } from "./slackDraftIds";
import type { WorkspacePlacement } from "./workspacePlacementBasis";
import { findingLabel } from "./workspacePlacementContext";

/** How many drawn rows the reading lists when nothing is open. Enough to answer "what's here", no more. */
export const QUEUE_VOICE_ROWS = 12;

/** One card, flattened to what is worth reading out. */
export interface CardForVoice {
  readonly key: string;
  readonly kind: string;
  readonly pill: string;
  readonly question: string;
  readonly subject: string;
  /** The card's background, or `undefined` when its record holds none. */
  readonly what: string | undefined;
  /** What is undecided, or `undefined` when the register states none. */
  readonly problem: string | undefined;
  /**
   * The ask card's concrete scenes, in the order it numbers them — what the voice tells the owner first when asked what a
   * card is about. Empty on every other register, and on an ask that recorded none.
   */
  readonly examples: readonly string[];
  /** Why it is the owner's, or `undefined` on a card that draws no such sentence — a hand step, an ask, a draft. */
  readonly whyYou: string | undefined;
  readonly options: readonly { readonly letter: string; readonly sentence: string }[];
  /** A hand step's own fields under their labels — empty on every other register. */
  readonly rows: readonly StepRow[];
  /** The exact string each of the card's copy blocks holds, in drawn order — empty when there is nothing to paste. */
  readonly pastes: readonly string[];
  /** A hand step's script, line by line as drawn, or `undefined` when it carries none. */
  readonly checklist: readonly StepChecklistLine[] | undefined;
  /** The verb's recommendation, or `undefined` when no verb makes one. */
  readonly lean: string | undefined;
  /** What happens if the owner does nothing, or `undefined` on an ask, or a hand step whose poster did not say. */
  readonly ifSilent: string | undefined;
  readonly askedIso: string | undefined;
  /** The board slug `board_row` takes, on an ask. */
  readonly boardSlug: string | undefined;
  /**
   * Why the panel refused to draw this card, when it did — the card's fields are then empty, and only its heading
   * stands, as the panel draws it.
   */
  readonly refused: string | undefined;
  /**
   * The workspace mark the card wears — no workspace, a conflict, or a stated workspace over the address it
   * overrules — or `undefined` when its fields place it cleanly. Carried on the open card itself, since a row
   * opened from a fold is in no drawn list that would name it.
   */
  readonly mark: { readonly label: string; readonly title: string } | undefined;
  /**
   * Both drafts on a card that waits on the owner's pick, A then B, each whole — so the voice reads the owner the two it asks
   * "Claude's or Codex's?" about. A post card, or an ask or hand card drawing one held draft, which owns it
   * (`./queueDraftOwnership.ts`). Empty on every other card.
   */
  readonly drafts: readonly { readonly letter: "A" | "B"; readonly by: string; readonly text: string }[];
  /**
   * The words a card would send, exactly as the card draws them, or `undefined` on a card with no one held draft.
   * Carried on every post card, one draft or two (then it is A's, the original), and on an ask or hand card that owns
   * one held draft: asked "What is the reply?" over a one-draft card, the voice must find the draft itself, never
   * only the card's summary to paraphrase.
   */
  readonly draft: string | undefined;
}

/** One register fold the Queue draws in place of the rows past its first few. */
export type QueueFold = {
  readonly register: string;
  readonly count: number;
  readonly marked: number;
} & (
  | {
      /** The tier it sits in, as a fold has always been named. */
      readonly tier: string;
    }
  | {
      /**
       * What stops the owner's work, their PR reviews or their focus, ahead of the tiers (`./queueFocus.ts`): those hold more than
       * one tier.
       */
      readonly section: LiftedSection;
    }
);

/** The selector's view as the voice needs it: its words, and the count printed beside them. */
export interface QueueViewForVoice {
  readonly label: string;
  /** The selector's own figure, check-ins included, or `undefined` while it prints a dash. */
  readonly count: number | undefined;
}

/**
 * The tag filter narrowing what the page draws, as the voice needs it: without it "three waiting" reads as the
 * whole queue when a tag has hidden the rest.
 */
export interface QueueTagFilterForVoice {
  /** Every tag selector in the address, verbatim — `workstream:console`, `!area`. */
  readonly selectors: readonly string[];
  /**
   * Whether the selection hides any card from the context-filtered queue, or `undefined` until the board reads —
   * whether, never how many, since the page prints that count only when the filter hides every card.
   */
  readonly hidden: boolean | undefined;
  /** The selectors that do not parse, so filter nothing. */
  readonly ignored: readonly string[];
}

/**
 * The Queue page's reading for the voice.
 *
 * @param drawn the rows the page is drawing, in the order it draws them
 * @param open the one the owner has open, if any
 * No count of cards rides here but the selector's own, under `view`: a figure the page does not print is one the
 * voice could say against it, so the rows past the list say only whether they exist.
 *
 * @param unread the registers whose latest read has not answered — one drawing a kept reading included — by the
 *   freshness line's own labels
 * @param tags the tag filter narrowing `drawn`, when one is set; absent on a page with no tag filter
 * @param view the selector's view, its own words and the count it prints beside them, check-ins included — so "three
 *   drawn" never reads as the whole queue when the owner is looking at Slack drafts alone, and the voice says the number they
 *   see
 * @param folded each register fold the page draws in place of its rows past the first few — the register, its tier (or
 *   its section, among what stops the owner's work, their PR reviews or their focus), how many rows it holds and how many of them
 *   wear a workspace mark — so a finding the page folded is never out of the voice's hearing either
 * @param openLeft why the open card is no longer in the list and who took it (`./cardDeparture.ts`), when it left —
 *   so the voice never asks the owner to rule on a card their words already took off
 * @param withheld how many cards in this context a gate refused and the page holds off its list — a count only,
 *   since their words are what failed (`./queueWithholding.ts`)
 * @param shows the view's own filter over a row's placement, so a stopping card it draws from another workspace is
 *   said as that workspace's card (`markInView`, `./queueStopping.ts`), as the page draws it
 * @returns the reading `read_page` returns under `shows`: each drawn row with its workspace mark, and whether any of
 *   the rows past the list carry one, so a finding is never folded out of the voice's hearing
 */
export function queueForVoice({
  drawn,
  open,
  openLeft,
  unread,
  tags,
  view,
  folded,
  withheld,
  shows,
}: {
  drawn: readonly QueueRow[];
  shows: (row: { readonly placement: WorkspacePlacement }) => boolean;
  open: QueueRow | undefined;
  openLeft?: string | undefined;
  withheld: number;
  unread: readonly string[];
  tags?: QueueTagFilterForVoice | undefined;
  view?: QueueViewForVoice | undefined;
  folded: readonly QueueFold[];
}): {
  readonly open: CardForVoice | undefined;
  /** Why the open card left the list and who took it, when it did; `undefined` while it is still in the list. */
  readonly openLeft: string | undefined;
  /** How many cards in this context failed their own checks and are held off the Queue (`./queueWithholding.ts`). */
  readonly withheld: number;
  readonly tags: QueueTagFilterForVoice | undefined;
  readonly view: QueueViewForVoice | undefined;
  readonly unread: readonly string[];
  readonly drawn: readonly {
    readonly key: string;
    readonly pill: string;
    readonly question: string;
    readonly mark: { readonly label: string; readonly title: string } | undefined;
  }[];
  /**
   * Every card the page draws, by key, in the order it draws them — the whole list, past the summary's cap, folded
   * cards left out as the page leaves them out. It is what the voice's window holds `action_items` to on the Queue
   * on the Queue.
   */
  readonly drawnKeys: readonly string[];
  readonly drawnMore: boolean | undefined;
  readonly drawnMarked: boolean | undefined;
  readonly folded: readonly QueueFold[];
} {
  // A tag filter waiting on the board has drawn nothing yet, and a "none more" would be over tags nobody read.
  const tagsWait = tags !== undefined && tags.hidden === undefined;
  let drawnMore: boolean | undefined;
  let drawnMarked: boolean | undefined;
  if (!tagsWait) {
    drawnMore = drawn.length > QUEUE_VOICE_ROWS;
    drawnMarked = markedInView({ rows: drawn.slice(QUEUE_VOICE_ROWS), shows }) > 0;
  }
  return {
    drawn: drawn.slice(0, QUEUE_VOICE_ROWS).map((row) => ({
      key: row.key,
      mark: markInView({ row, shows }),
      pill: row.pill,
      question: row.card.question,
    })),
    drawnKeys: drawn.map((row) => row.key),
    drawnMarked,
    drawnMore,
    folded,
    open: open === undefined ? undefined : { ...cardForVoice({ row: open }), mark: markInView({ row: open, shows }) },
    openLeft,
    tags,
    unread,
    view,
    withheld,
  };
}

/**
 * Why a row's card was refused, when it was — so no surface reads out a card the panel will not draw. Every
 * register's record carries its form: a hand step's (`./handCard.ts`), and every briefing card's
 * (`./briefingCardForm.ts`, plus a finding act's lookup). Only an act reaches here refused: every other refused row
 * is held off the Queue before any surface sees it (`./queueWithholding.ts`).
 *
 * The voice words what it reads for the owner, so a quoted read's reason travels as one string here (`reasonTextOf`).
 *
 * @param row a queue row
 * @returns the refusal's sentence, or `undefined` when its card was drawn
 */
export function cardRefusal({ row }: { row: QueueRow }): string | undefined {
  if (row.record.form.kind !== "refused") {
    return undefined;
  }
  return reasonTextOf({ reason: row.record.form.why });
}

/**
 * One row's card, flattened, with the workspace mark it wears.
 *
 * @param row the queue row the owner has open
 * @returns the card's words — a field its record does not hold is `undefined`, never read out as content
 */
export function cardForVoice({ row }: { row: QueueRow }): CardForVoice {
  return {
    ...cardWords({ row }),
    draft: draftForVoice({ row }),
    drafts: draftsForVoice({ row }),
    mark: findingLabel({ placement: row.placement }),
  };
}

/**
 * The one held draft a card would send: a post card's own, or the one an ask or hand card draws as held, which owns
 * it once its post card is absorbed (`./queueDraftOwnership.ts`). A card drawing two held drafts has no one draft.
 *
 * @returns the draft, or `undefined`
 */
function sentDraftOf({ row }: { row: QueueRow }): ParkedDraft | undefined {
  if (row.record.kind === "post") {
    return row.record.post;
  }
  if (row.record.kind !== "ask" && row.record.kind !== "hand") {
    return undefined;
  }
  const held = heldDraftsNamed({ named: row.record.drafts });
  if (held.length !== 1) {
    return undefined;
  }
  return held[0];
}

/**
 * The words a card would send, as the plain text of the lines it draws.
 *
 * @returns the draft's words, or `undefined` on a card with no one held draft
 */
function draftForVoice({ row }: { row: QueueRow }): string | undefined {
  const post = sentDraftOf({ row });
  if (post === undefined) {
    return undefined;
  }
  return draftLinesWords({ labels: post, lines: post.lines });
}

/**
 * The two drafts a post card asks the owner to choose between, as the plain text of the lines the card draws — never a
 * notification fallback, which a hand-written row may word differently from its blocks.
 *
 * @returns A then B while the owner's pick is owed, else nothing
 */
function draftsForVoice({ row }: { row: QueueRow }): CardForVoice["drafts"] {
  const post = sentDraftOf({ row });
  if (post === undefined) {
    return [];
  }
  const codex = post.comparison?.codex;
  if (codex === undefined) {
    return [];
  }
  const by = post.comparison?.composer === "claude-code" ? "Claude" : "the recording session";
  return [
    { by, letter: "A", text: draftLinesWords({ labels: post, lines: post.lines }) },
    {
      by: "Codex",
      letter: "B",
      text: draftLinesWords({ labels: { mentions: codex.mentions, people: post.people }, lines: codex.lines }),
    },
  ];
}

/**
 * Every string a step card's copy blocks hold, in drawn order: its literal, then each checklist line's command.
 *
 * @returns the pastes, empty when the card has none
 */
function stepPastes({ card }: { card: StepCard }): readonly string[] {
  const lines =
    card.checklist === undefined
      ? []
      : card.checklist.flatMap((line) => (line.command === undefined ? [] : [line.command]));
  return card.copy === undefined ? lines : [card.copy, ...lines];
}

/**
 * One row's card words, flattened.
 *
 * @returns every field but the mark
 */
function cardWords({ row }: { row: QueueRow }): Omit<CardForVoice, "draft" | "drafts" | "mark"> {
  const { card } = row;
  const boardSlug = row.record.kind === "ask" ? row.record.row.slug : undefined;
  if (card.kind === "step") {
    const refusal = cardRefusal({ row });
    if (refusal !== undefined) {
      return {
        askedIso: row.whenIso,
        boardSlug,
        checklist: undefined,
        examples: [],
        ifSilent: undefined,
        key: row.key,
        kind: row.kind,
        lean: undefined,
        options: [],
        pastes: [],
        pill: row.pill,
        problem: undefined,
        question: card.question,
        refused: refusal,
        rows: [],
        subject: card.subject,
        what: card.what.whole,
        whyYou: undefined,
      };
    }
    const decision = card.decision;
    let options: CardForVoice["options"] = [];
    if (decision !== undefined) {
      options = decision.options.map((option) => ({ letter: option.letter, sentence: option.sentence }));
    }
    return {
      askedIso: row.whenIso,
      boardSlug,
      checklist: card.checklist,
      examples: [],
      // A hand step's do-nothing line, when its poster wrote one — the voice reads it too.
      ifSilent: card.rows.find((one) => one.label === "if you do nothing")?.value,
      key: row.key,
      kind: row.kind,
      lean: decision?.lean,
      options,
      pastes: stepPastes({ card }),
      pill: row.pill,
      problem: decision?.problem,
      question: card.question,
      refused: undefined,
      rows: card.rows,
      subject: card.subject,
      what: card.what.whole,
      whyYou: undefined,
    };
  }
  const refused = cardRefusal({ row });
  if (refused !== undefined) {
    return {
      askedIso: row.whenIso,
      boardSlug,
      checklist: undefined,
      examples: [],
      ifSilent: undefined,
      key: row.key,
      kind: row.kind,
      lean: undefined,
      options: [],
      pastes: [],
      pill: row.pill,
      problem: undefined,
      question: card.question,
      refused,
      rows: [],
      subject: card.subject,
      what: undefined,
      whyYou: undefined,
    };
  }
  return {
    askedIso: row.whenIso,
    boardSlug,
    checklist: undefined,
    examples: card.examples?.kind === "scenes" ? card.examples.scenes : [],
    ifSilent: card.ifSilent,
    key: row.key,
    kind: row.kind,
    lean: card.lean,
    options: card.options.map((option) => ({ letter: option.letter, sentence: option.sentence })),
    pastes: card.commands,
    pill: row.pill,
    problem: card.problem,
    question: card.question,
    refused: undefined,
    rows: [],
    subject: card.subject,
    what: card.what?.whole,
    whyYou: card.whyYou,
  };
}
