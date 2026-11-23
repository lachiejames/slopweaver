/**
 * The reader for `slopweaver slack draft list --json` — a message composed under the owner's own name, parked for
 * the owner to read before anything reaches Slack.
 *
 * Same discipline as `readThread.ts`: a row that will not parse refuses the WHOLE reading, so the panel
 * says NOT MEASURED rather than drawing a draft with a paragraph missing. That rule is sharper here than
 * anywhere else on the page, because what this reads is the exact bytes a release would post — a preview
 * that quietly dropped a run would show the owner something other than what the owner is approving.
 *
 * The runs are parsed rather than flattened to a string on purpose. The owner asked for a *"Slack platform native
 * UI draft in a slide over"*, and bold, a link, a mention and a bullet are what makes one look like Slack
 * rather than like a paragraph of plain text.
 *
 * Because one unreadable row takes every card's draft down, this reader draws EVERY rich-text element the
 * payload's own type admits (`@slack/types`' `RichTextBlockElement` and `RichTextElement`), not only the ones
 * a renderer happened to emit when it was written. MEASURED: the quote renderer
 * (`src/outbound/slack/blockquote.ts`) began recording `rich_text_quote`, four held drafts carried one, and every
 * queue card naming any draft read NOT MEASURED — reproduce with `slopweaver slack draft list --json | jq
 * '[.items[].draft.payload.blocks[]?.elements[]?.type] | unique'`. `site/__tests__/unit/slackDraftListContract.test.ts`
 * keys a fixture on each member of both unions, so a new one fails the site typecheck rather than a card.
 */

import { type Bag, bags, isBag, str, strings, sub } from "../../lib/bag";
import type { SlackPeople } from "../../lib/slackPeople";
import { type DraftJudgement, draftJudgementOf } from "./draftJudgement";
import { type DraftAttachments, draftMediaOf } from "./draftMedia";
import { type DraftPriorAsk, draftPriorAskOf } from "./draftPriorAsk";
import { type DraftProofMissing, draftProofFieldsOf, type LeadingReceipt } from "./draftProofMissing";
import { type DraftReceipts, draftReceiptsOf } from "./draftReceipts";
import { type DraftComparisonView, type DraftVariantWords, draftComparisonOf } from "./readDraftComparison";
import { type DraftVersionView, draftRevisionOf } from "./readDraftVersions";
import { payloadLines } from "./readSlackDraftsBlocks";
import { peopleOf } from "./readSlackDraftsPeople";
import { type DraftLine, notText } from "./readSlackDraftsRuns";

/** One mention the draft resolved, so the panel can name who a `<@U…>` actually notifies. */
export interface DraftMention {
  readonly key: string;
  readonly target: string;
  readonly kind: string;
}

/** The thread a parked reply goes under: its root, and the root as the recording read it when it could. */
export interface DraftThread {
  readonly ts: string;
  /** The root's author, when Slack said. */
  readonly parentUserId: string | undefined;
  /** The root's text, cut short; `undefined` on a row recorded without the read. */
  readonly parentText: string | undefined;
  /** The root's Slack permalink, when the recording could build one — what the card links the thread by. */
  readonly permalink: string | undefined;
}

/** A Slack `ts` as an identifier, which a thread root must be. */
const SLACK_TS = /^[0-9]{10}\.[0-9]{6}$/;

/**
 * A row's thread, off its `shape`, `threadTs` and `threadParent`: `undefined` for a top-level row, the thread
 * for a reply, and `"malformed"` for any disagreement — a thread row with no root is the row that would be read
 * as top-level, so it refuses the reading rather than drawing a post into the channel.
 */
function threadOf({ draft }: { draft: Bag }): DraftThread | undefined | "malformed" {
  const shape = draft["shape"];
  const threadTs = draft["threadTs"];
  const parent = draft["threadParent"];
  if (shape === "top-level") {
    return threadTs === undefined && parent === undefined ? undefined : "malformed";
  }
  if (shape !== "thread" || typeof threadTs !== "string" || !SLACK_TS.test(threadTs)) {
    return "malformed";
  }
  if (parent === undefined) {
    return { parentText: undefined, parentUserId: undefined, permalink: undefined, ts: threadTs };
  }
  if (!isBag(parent) || typeof parent["text"] !== "string" || notText({ bag: parent, key: "userId" })) {
    return "malformed";
  }
  const permalink = parent["permalink"];
  if (permalink !== undefined && (typeof permalink !== "string" || !permalink.startsWith("https://"))) {
    return "malformed";
  }
  return {
    parentText: parent["text"],
    parentUserId: str({ bag: parent, key: "userId" }),
    permalink,
    ts: threadTs,
  };
}

/**
 * How a held draft goes out, as the verb decided it (`draftRelease`, `src/cli/commands/slack/draftReport.ts`): the
 * one command that sends it, or the re-record a top-level row whose why says thread reply needs, since both
 * release verbs refuse that row. The card prints this rather than choosing a verb itself.
 */
export type DraftRelease =
  { readonly kind: "send"; readonly command: string } | { readonly kind: "re-record"; readonly why: string };

/**
 * A row's release: present on a held row and absent on a resolved one, or `"malformed"` for either the wrong way
 * round — a held card with no command is one that would have to guess the verb.
 */
function releaseOf({ item, held }: { item: Bag; held: boolean }): DraftRelease | undefined | "malformed" {
  const release = item["release"];
  if (!held) {
    return release === undefined ? undefined : "malformed";
  }
  if (!isBag(release)) {
    return "malformed";
  }
  const command = str({ bag: release, key: "command" });
  const why = str({ bag: release, key: "why" });
  if (release["kind"] === "send" && command !== undefined) {
    return { command, kind: "send" };
  }
  if (release["kind"] === "re-record" && why !== undefined) {
    return { kind: "re-record", why };
  }
  return "malformed";
}

/** What became of a parked draft: still waiting on the owner's word, sent through the door, or dropped unsent. */
export type ParkedDraftState = "held" | "released" | "dropped";

/** What a parked draft does, as `slack draft record --act` declares it (`src/outbound/slack/draftRegister.ts`). */
export type ParkedDraftAct = "reply" | "bump" | "review-ask";

/** Every act this build draws a badge for. */
const ACTS: readonly ParkedDraftAct[] = ["reply", "bump", "review-ask"];

/** The states `slack draft list --json` prints, closed: an unknown one refuses the reading. */
const STATES: readonly ParkedDraftState[] = ["held", "released", "dropped"];

/** One parked draft, as `slack draft list --json` prints it — its attachments per `./draftMedia.ts`. */
export interface ParkedDraft extends DraftAttachments {
  readonly id: string;
  /** Only `held` is a draft still waiting on the owner; the other two stay readable, so a card naming one can show it. */
  readonly state: ParkedDraftState;
  /** When it was released or dropped — always present on those two, absent while it is held. */
  readonly resolvedIso: string | undefined;
  /**
   * What became of it, as the register recorded: a dropped row's note — which names its re-cut, when it was re-cut
   * (`../../lib/slackDraftIds.ts` follows it to the live cut) — or a released row's coordinates. Absent while held.
   */
  readonly outcome: string | undefined;
  readonly tsIso: string;
  readonly channel: string;
  /** What the channel is called, when the recording read could name it. */
  readonly channelName: string | undefined;
  /**
   * Who it goes out as: `me` under the owner's own name, or `bot` — a finding shared top-level into a channel goes out as
   * the bot, and its words live in a card wrapper rather than the payload's own blocks.
   */
  readonly actor: "me" | "bot";
  /**
   * What the draft DOES, as its recorder declared it with `slack draft record --act` — the card's badge. Never
   * guessed from `why`: a row recorded before the field, or carrying one this build does not know, draws no badge.
   */
  readonly act: ParkedDraftAct | undefined;
  /**
   * The board row that raised it, as `slack draft record --row` named it — the card inherits that row's tags, its
   * workstream among them. A row recorded before the field, or carrying anything but a string, names none.
   */
  readonly row: string | undefined;
  /** The Slack user id the send would go out under — the bot's own, on a bot row. */
  readonly authorId: string | undefined;
  readonly why: string;
  /**
   * The thread this replies under, for a thread row — its root `ts`, and the root's author and text as the
   * recording read them — else `undefined` for a top-level post. A thread row is sent by `slack reply`.
   */
  readonly thread: DraftThread | undefined;
  /**
   * What the recorder declared about an earlier ask (`./draftPriorAsk.ts`): `none`, or our earlier message, the
   * replies it drew and what changed since — which the card draws above the message. `undefined` when the row
   * declares nothing. A present one that will not read refuses the row.
   */
  readonly priorAsk: DraftPriorAsk | undefined;
  /** How it goes out — always present while held, absent once resolved. */
  readonly release: DraftRelease | undefined;
  /**
   * What a session judged of the owner's words on it — the card leads with a hold's reason. The reader always sets it; a
   * hand-built draft that never met the register may leave it out, and draws as one nobody judged.
   */
  readonly judgement?: DraftJudgement;
  /**
   * The links and files it brings, why it needs none, or what was tried for one it lacks (`./draftReceipts.ts`) — the
   * card leads with it. Absent on a row recorded before the field and on a bump that declared none.
   */
  readonly receipts?: DraftReceipts | undefined;
  /** What the owner's approval binds: the destination, the identity, the thread and the exact bytes. */
  readonly digest: string;
  readonly lines: readonly DraftLine[];
  /** The notification fallback, which is also the whole message as plain text. */
  readonly fallback: string;
  readonly mentions: readonly DraftMention[];
  /** Voice findings that did not refuse — the owner's to judge, so they are shown rather than dropped. */
  readonly advisory: readonly string[];
  /** Who each member id the reading carries is, off member bronze — the same roster on every draft of one read. */
  readonly people: SlackPeople;
  /**
   * The handles the install's profile declares for its own bot (`slackBot.selfHandles`), the same on every draft of
   * one read — absent or empty when it declares none, which a bot row member bronze cannot name then says out loud.
   */
  readonly botHandles?: readonly string[];
  /**
   * Codex's draft beside this one and the owner's pick between them (`./readDraftComparison.ts`) — `undefined` on a row that
   * never owed one: a bot row, or one recorded before the comparison existed.
   */
  readonly comparison?: DraftComparisonView | undefined;
  /** The words as the console voice edits them, on a held as-me row it can revise (`./readDraftVersions.ts`). */
  readonly editableText?: string | undefined;
  /** Every version once the voice revised it, oldest first; absent on a row never revised. */
  readonly versions?: readonly DraftVersionView[] | undefined;
  /**
   * What a HELD row lacks as a finding or as a first message in a channel, when the Queue sends it back unseen
   * (`./draftProofMissing.ts`): no card draws it, and a card naming it says so. Absent on every row the Queue may draw.
   */
  readonly proofMissing?: readonly DraftProofMissing[] | undefined;
  /**
   * The annotated screenshot a cleared first message in a channel leads with, which its card draws first, above the
   * fold. Absent on every other row.
   */
  readonly leadingReceipt?: LeadingReceipt | undefined;
}

/**
 * Whether a parked draft is still waiting on the owner's word: held, and not sent back unseen for want of its proof
 * (`./draftProofMissing.ts`).
 *
 * @returns true while the register still holds it unsent and the Queue may draw it
 */
export function isParked({ draft }: { draft: ParkedDraft }): boolean {
  return draft.state === "held" && draft.proofMissing === undefined;
}

/** Every mention one row recorded, or `undefined` when a row is not one. */
function mentionsOf({ draft }: { draft: Bag }): readonly DraftMention[] | undefined {
  const rows = bags({ bag: draft, key: "mentions" });
  if (rows === undefined) {
    return undefined;
  }
  const out: DraftMention[] = [];
  for (const row of rows) {
    const key = str({ bag: row, key: "key" });
    const target = str({ bag: row, key: "target" });
    const kind = str({ bag: row, key: "kind" });
    if (key === undefined || target === undefined || kind === undefined) {
      return undefined;
    }
    out.push({ key, kind, target });
  }
  return out;
}

/**
 * Who a row goes out as: an absent `actor` is the owner, the register's contract before `--as bot` could be recorded, and
 * anything but `bot` present is `"malformed"` — a card must never draw the owner's face over a message the bot would send.
 */
function actorOf({ draft }: { draft: Bag }): "me" | "bot" | "malformed" {
  const actor = draft["actor"];
  if (actor === undefined) {
    return "me";
  }
  return actor === "bot" ? "bot" : "malformed";
}

/**
 * What the row does, for its badge. Unlike {@link actorOf} an unknown value is NOT malformed: the badge is display
 * only and outside the digest, and a register written by a newer checkout than this console's reader must not blank
 * every draft card over a word it has not learnt yet — it draws no badge, which is never a wrong one.
 */
function actOf({ draft }: { draft: Bag }): ParkedDraftAct | undefined {
  const act = draft["act"];
  return ACTS.find((known) => known === act);
}

/**
 * The whole message as plain text: a bot card's wrapper `fallback`, since the card's own `text` is empty, else the
 * payload's `text`. `undefined` when the one it needs is missing.
 */
function fallbackOf({ payload }: { payload: Bag }): string | undefined {
  const wrapper = bags({ bag: payload, key: "attachments" })?.[0];
  if (wrapper !== undefined) {
    return str({ bag: wrapper, key: "fallback" });
  }
  return str({ bag: payload, key: "text" });
}

/** One variant's words, read exactly as a row's own: `undefined` when any of them will not read. */
function variantWordsOf({ bag }: { bag: Bag }): DraftVariantWords | undefined {
  const digest = str({ bag, key: "digest" });
  const payload = sub({ bag, key: "payload" });
  const advisory = strings({ bag, key: "advisory" });
  const mentions = mentionsOf({ draft: bag });
  const lines = payload === undefined ? undefined : payloadLines({ payload });
  const fallback = payload === undefined ? undefined : fallbackOf({ payload });
  if (digest === undefined || advisory === undefined || mentions === undefined) {
    return undefined;
  }
  if (lines === undefined || fallback === undefined) {
    return undefined;
  }
  return { advisory, digest, fallback, lines, mentions };
}

/**
 * Read a `slack draft list --json` payload.
 *
 * @param payload the parsed stdout
 * @returns every parked draft, newest first, or `undefined` when the payload is not one
 */
export function readParkedDrafts(payload: unknown): readonly ParkedDraft[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const items = bags({ bag: payload, key: "items" });
  const people = peopleOf({ payload });
  // Absent is an install declaring no bot handle (or a CLI older than the field); present and malformed refuses.
  let botHandles: readonly string[] | undefined = [];
  if (payload["botHandles"] !== undefined) {
    botHandles = strings({ bag: payload, key: "botHandles" });
  }
  if (items === undefined || people === undefined || botHandles === undefined) {
    return undefined;
  }
  const out: ParkedDraft[] = [];
  for (const item of items) {
    const id = str({ bag: item, key: "id" });
    const state = STATES.find((one) => one === str({ bag: item, key: "state" }));
    const resolvedIso = str({ bag: item, key: "resolvedIso" });
    const outcome = str({ bag: item, key: "outcome" });
    const draft = sub({ bag: item, key: "draft" });
    if (id === undefined || state === undefined || draft === undefined || notText({ bag: item, key: "outcome" })) {
      return undefined;
    }
    // A released or dropped row says WHEN; one that does not is not a row this reader can describe truthfully.
    if (state !== "held" && resolvedIso === undefined) {
      return undefined;
    }
    const tsIso = str({ bag: draft, key: "tsIso" });
    const channel = str({ bag: draft, key: "channel" });
    const why = str({ bag: draft, key: "why" });
    const digest = str({ bag: draft, key: "digest" });
    const payloadBag = sub({ bag: draft, key: "payload" });
    const advisory = strings({ bag: draft, key: "advisory" });
    const mentions = mentionsOf({ draft });
    const media = draftMediaOf({ draft });
    const thread = threadOf({ draft });
    const priorAsk = draftPriorAskOf({ draft });
    const release = releaseOf({ held: state === "held", item });
    const judgement = draftJudgementOf({ draft, item });
    const comparison = draftComparisonOf({ draft, item, wordsOf: variantWordsOf });
    const receipts = draftReceiptsOf({ draft });
    const revision = draftRevisionOf({ item });
    // A malformed media list refuses the row below; a receipt beside one names nothing it could carry.
    const attached = media === undefined ? [] : media.map((entry) => entry.sha256);
    const proof = draftProofFieldsOf({ attached, held: state === "held", item });
    if (comparison === "malformed" || receipts === "malformed" || revision === "malformed" || proof === "malformed") {
      return undefined;
    }
    if (
      tsIso === undefined ||
      channel === undefined ||
      why === undefined ||
      digest === undefined ||
      payloadBag === undefined ||
      advisory === undefined ||
      mentions === undefined ||
      media === undefined ||
      thread === "malformed" ||
      priorAsk === "malformed" ||
      release === "malformed" ||
      judgement === "malformed"
    ) {
      return undefined;
    }
    const lines = payloadLines({ payload: payloadBag });
    const fallback = fallbackOf({ payload: payloadBag });
    const actor = actorOf({ draft });
    if (lines === undefined || fallback === undefined || actor === "malformed") {
      return undefined;
    }
    out.push({
      act: actOf({ draft }),
      actor,
      advisory,
      authorId: str({ bag: draft, key: "authorId" }),
      botHandles,
      channel,
      channelName: str({ bag: draft, key: "channelName" }),
      ...(comparison === undefined ? {} : { comparison }),
      digest,
      ...(revision.editableText === undefined ? {} : { editableText: revision.editableText }),
      fallback,
      id,
      judgement,
      ...proof,
      lines,
      media,
      mentions,
      outcome,
      people,
      priorAsk,
      ...(receipts === undefined ? {} : { receipts }),
      release,
      resolvedIso,
      // Display only, like `act`: a value this build cannot read names no row rather than refusing the draft.
      row: str({ bag: draft, key: "row" }),
      state,
      thread,
      tsIso,
      ...(revision.versions === undefined ? {} : { versions: revision.versions }),
      why,
    });
  }
  return out;
}
