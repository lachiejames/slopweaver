/**
 * The AS-ME DRAFT register: a message composed under the owner's own name, checked as far as it can be
 * without posting, and PARKED for the owner to read before anything reaches Slack.
 *
 * A sibling of the withheld-reply queue (`../../admit/queue.ts`), deliberately not a widening of it. That
 * register's `HeldReply` is a reply the DOOR withheld, so every row carries the ask it answers — a message
 * timestamp, a thread, who asked and what they asked. A message the owner is about to post has none of those
 * beyond, at most, the thread it goes into, and making them optional would make an invalid reply
 * representable in the type that exists to prevent exactly that.
 *
 * A change to a provider the owner has not approved shows as a Slack draft instead, in the local console. This is
 * the register that console reads.
 *
 * Everything here is pure. The filesystem edge is `../../admit/slackDraftStore.ts`; nothing in this module
 * can post, read a clock or mint an id.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";
import { stableStringify } from "../../lib/stableStringify.js";
import type {
  ComparisonOutcome,
  DraftComposer,
  DraftPick,
  DraftPickVoice,
  DraftVariant,
  DraftWords,
  ParkedComparison,
  SlackDraftComparison,
} from "./draftComparison.js";
import { type SlackDraftError, SlackDraftErrors } from "./draftErrors.js";
import { DRAFT_HOLD_REASONS, type DraftHoldReason } from "./draftHoldReasons.js";
import type { SlackDraftVersion } from "./draftRevision.js";
import type { ParkedDraftReceipts } from "./receiptsLine.js";
import type { ReviewerContext } from "./reviewAskShape.js";
import type { SlackCardPayload, SlackDripMessagePayload, SlackNoFoldPayload } from "./types.js";

/**
 * The exact bytes a parked row would post: an as-me drip message, or — on a bot row — the card or no-fold message
 * the `--as bot` lane renders. Each arm is the type its own lane already sends, so a row cannot hold a shape its
 * release could not post.
 */
export type ParkedDraftPayload = SlackDripMessagePayload | SlackCardPayload | SlackNoFoldPayload;

/** A {@link ParkedDraftPayload} narrowed to the lane that renders it. */
export type ParkedPayloadShape =
  | { readonly kind: "drip"; readonly payload: SlackDripMessagePayload }
  | { readonly kind: "card"; readonly payload: SlackCardPayload }
  | { readonly kind: "no-fold"; readonly payload: SlackNoFoldPayload };

/**
 * Which lane's bytes a parked payload is: a drip message names its `form`, a bot card carries its one wrapper in
 * `attachments`, and a bot no-fold message is neither.
 *
 * @param payload the row's payload
 * @returns the payload, tagged with its shape
 */
export function parkedPayloadShape({ payload }: { payload: ParkedDraftPayload }): ParkedPayloadShape {
  if ("form" in payload) {
    return { kind: "drip", payload };
  }
  if ("attachments" in payload) {
    return { kind: "card", payload };
  }
  return { kind: "no-fold", payload };
}

/**
 * What a parked row IS, declared at recording: a `finding` the fleet found, or any other `message`. A top-level
 * as-me row outside a DM must declare it; absent on one anyway (an older recorder), `./findingIdentity.ts`'s
 * `asMeChannelFinding` holds it as a finding.
 */
export type ParkedDraftKind = "finding" | "message";

/**
 * What the message DOES, declared at recording — the act the Queue card's badge names (a bump read like a reply
 * because nothing typed said which it was). The
 * recorder that knows declares it: the thread-chase recipe a `bump`, a first review ask a `review-ask`. Absent on
 * every row parked before the field, and the card then draws no badge — never one guessed from the row's `why`.
 * A QUESTION is a badge on a board ask row only: on an ask the owner is the one asked, on a draft they are the asker.
 */
export const PARKED_DRAFT_ACTS = ["reply", "bump", "review-ask"] as const;

/** One of {@link PARKED_DRAFT_ACTS}. */
export type ParkedDraftAct = (typeof PARKED_DRAFT_ACTS)[number];

/**
 * Why an as-me finding may go top-level into a channel: it is a PRIVATE channel the bot is not in, read LIVE under
 * the bot's own token at recording — a public one it posts into unjoined. The only reason there is: a message into a channel the bot cannot post in may go as the
 * owner — a direct message is not a channel, so it never needs one.
 */
export type BotCannotPost = "not-in-channel";

/**
 * The register's schema version. Bumped when a field a reader depends on changes meaning.
 *
 * @internal stamped onto every line by {@link slackDraftEventLine}; no caller outside this file reads it.
 */
export const SLACK_DRAFT_SCHEMA_VERSION = 1;

/** One mention the draft carries, flattened out of the resolution's Maps so it survives a round trip. */
export interface ParkedMention {
  /** The key the author wrote in the form — a handle, an email, a native id. */
  readonly key: string;
  /** The Slack id a reader is actually notified by. The console prints the label; this is the target. */
  readonly target: string;
  readonly kind: "person" | "group";
}

/**
 * One parked draft, exactly as a release will re-check it.
 *
 * `form` and `payload` are BOTH recorded on purpose. The form is what a release re-prepares, so the release
 * runs the live gates over live state rather than trusting bytes written hours ago; the payload is what the
 * digest binds, so a re-preparation that produces anything else is drift the release refuses rather than
 * silently posting. Recording only one of the two loses one of those two properties.
 */
export interface ParkedSlackDraft {
  readonly id: string;
  readonly tsIso: string;
  readonly channel: string;
  /** What the channel is called, when the recording read could name it. The console prints `#name`. */
  readonly channelName?: string | undefined;
  /**
   * `true` when the recording's `conversations.info` read answered `is_mpim`: a group DM, which carries a `C…` id
   * like a channel, so only this stamp says the first-message proof bar does not apply
   * (`./firstMessageProof.ts`). Absent on every other row, and on one the read could not classify.
   */
  readonly groupDm?: true | undefined;
  /**
   * The Slack user id the send would go out under, as `auth.test` reported it at recording time. Bound into
   * the digest so a draft recorded under one identity cannot be released under another.
   */
  readonly authorId?: string | undefined;
  /**
   * Where in the conversation it posts: `top-level` in the channel, or `thread` as a reply under
   * {@link threadTs}. A thread row is released only by `slack reply --draft`, and a top-level one only by
   * `slack post --draft` (`../../cli/commands/slack/releaseRun.ts`), so an approval cannot move a reply out
   * of its thread. MEASURED: two drafts whose why said THREAD REPLY were parked
   * top-level, because no thread could be recorded, and each released into its channel under the owner's name.
   */
  readonly shape: "top-level" | "thread";
  /** The root `ts` a `thread` row replies under — present exactly when `shape` is `thread`. Digest-bound. */
  readonly threadTs?: string | undefined;
  /** The message it replies under, as read at recording, so the console can draw the parent above it. */
  readonly threadParent?: ParkedThreadParent | undefined;
  /**
   * What the recording READ of the thread it replies into — the watermark a release re-reads the thread against
   * (`./releaseFreshness.ts`). Present on a `thread` row recorded after the field; NOT in the digest, because it is
   * the world the approval was given in, never what the approval binds.
   */
  readonly readThrough?: ParkedReadThrough | undefined;
  /** The exact `--form` JSON as authored, before linkification — what a release re-prepares. */
  readonly form: string;
  /** The exact bytes `chat.postMessage` would carry. What the console renders and the digest binds. */
  readonly payload: ParkedDraftPayload;
  /**
   * WHOSE name it goes out under: `bot` for a row recorded `--as bot`, released by `slack post --as bot --draft`
   * through the card lane. Absent means as the owner, which every row written before the field was. The digest binds the
   * identity through {@link authorId} — the bot's own user id on a bot row — so the field routes the release and
   * draws the console card, and cannot move an approval between identities.
   */
  readonly actor?: "bot" | undefined;
  /** What the row is, as declared at recording — see {@link ParkedDraftKind}. */
  readonly kind?: ParkedDraftKind | undefined;
  /**
   * What the message does — see {@link ParkedDraftAct}. Display only: NOT in the digest, so declaring it never
   * changes what the owner's approval binds.
   */
  readonly act?: ParkedDraftAct | undefined;
  /**
   * The board row that raised the draft — `--row <slug>`, checked at recording against a handover doc that holds it.
   * The Queue card joins that row and shows its tags, so a bump reads with its workstream. Display only, like
   * {@link act}: NOT in the digest. Absent on every row parked before the field.
   */
  readonly row?: string | undefined;
  /**
   * The shared finding this bump follows up — `--followup-of <sd-id>`, a RELEASED `kind: "finding"` row, checked under
   * the register lock (`./sharedFindings.ts`). Any row naming a finding spends its one follow-up card. Display and
   * audit only, like {@link act}: NOT in the digest. Absent on every other row.
   */
  readonly followupOf?: string | undefined;
  /** Present on an as-me top-level finding in a channel, naming why the bot could not post it there. */
  readonly botCannotPost?: BotCannotPost | undefined;
  readonly mentions: readonly ParkedMention[];
  /** Voice findings that did not refuse. Shown with the draft, because the owner is the one judging the voice. */
  readonly advisory: readonly string[];
  /** One line saying what this draft is for, so a row in a list is readable without opening it. */
  readonly why: string;
  /** Binds the destination, the identity, the exact payload and any media. See {@link parkedDraftDigest}. */
  readonly digest: string;
  /**
   * The files the release attaches under the message, in attach order — each one's name, exact size and
   * SHA-256. The bytes themselves live in the private content store (`../../admit/slackDraftMediaStore.ts`),
   * addressed by that hash. Absent on a row that carries none, which is every row written before the field.
   */
  readonly media?: readonly ParkedSlackDraftMedia[] | undefined;
  /**
   * Whether this message's question was asked before, declared at recording (`--asked-before`, `./priorAsk.ts`):
   * `none`, or the earlier message with what the team said to it. Absent on a row that asks nothing, and on every
   * row recorded before the field. Display and judgement only — except a declared change's PROOF, which
   * {@link parkedDraftDigest} binds like media.
   */
  readonly priorAsk?: ParkedPriorAsk | undefined;
  /**
   * The owner's yes to these words' CONTENT, already given — `--approved <anchor>`, resolved to their own words at
   * recording, or
   * inherited from the one approved row a re-cut supersedes (`./draftApproval.ts`). A row carrying it is SENT, never
   * parked for a second yes: the next chair pass releases it (`../../supervisor/approvedDraftGate.ts`). NOT in the
   * digest, like {@link act}: it records who already decided, never what the release binds. Absent on every row
   * awaiting the owner's word.
   */
  readonly approval?: DraftApproval | undefined;
  /**
   * What changed since the owner approved the row this one re-cuts — `--meaning-changed`, the words' meaning or a
   * thread that moved materially. Present, the row carries no {@link approval} and waits for the owner's yes again; absent on every
   * other row. Display only, NOT in the digest.
   */
  readonly meaningChanged?: string | undefined;
  /**
   * The held rows this one re-cuts — what `--supersedes` named, recorded on the park itself so a drop of one of them
   * can prove this row carries its words. A drop note naming a row proves nothing on its own: any held row can be named
   * Absent on a row that re-cuts nothing, and on every row recorded before the field.
   */
  readonly recuts?: readonly string[] | undefined;
  /**
   * Which visible host wrote these words, read off the recording process. Display and comparison eligibility only, NOT
   * in the digest. Absent on a bot row and on every row recorded before the field.
   */
  readonly composer?: DraftComposer | undefined;
  /**
   * Whether a Codex draft is owed beside this one (`pending`) or why not (`skipped`) — `./draftComparison.ts`. Absent on
   * a bot row and on every row recorded before the field, which never get one. NOT in the digest.
   */
  readonly comparison?: ParkedComparison | undefined;
  /**
   * What `--reviewer` declared at recording, so Codex's draft of the same ask meets the review-ask gate under the
   * declaration the original did (`./reviewAskShape.ts`). Absent when none was declared, on a bot row, and on every row
   * recorded before the field. NOT in the digest: a release passes the gate as `approved` either way.
   */
  readonly reviewer?: ReviewerContext | undefined;
  /**
   * What the card brings so the reader can check its claim — `./draftReceipts.ts`: links and files DERIVED off the
   * payload and {@link media}, or `--self-evident` / `--tried` declared. Absent on a bump and on every row recorded
   * before the field. NOT in the digest: `attached` is a function of bytes the digest already binds, and the two
   * declarations are display, like {@link why}.
   */
  readonly receipts?: ParkedDraftReceipts | undefined;
  /**
   * The impact in people a finding declares — `--impact "<count> <who> <what happened>"` (`./findingProof.ts`), whose
   * count the message's first line carries. Absent on a row that raises no finding and on every row recorded before
   * the field. NOT in the digest: it is a declaration about bytes the digest already binds, like {@link receipts}.
   */
  readonly impact?: string | undefined;
}

/**
 * Where the owner's yes to a row's content came from: the anchor it resolved at, the words read there, and when they
 * said them.
 *
 * An agreement to "this is what we say" does not account for how the owner types, so the session still handles that
 * part and executes the sending of a pre-approved draft unless there is a good reason otherwise.
 */
export interface DraftApproval {
  /** A `talk-call:`, `talk:`, `call:` or `transcript:` anchor naming the owner's own words. */
  readonly anchor: string;
  /** The owner's words at the anchor, as the record holds them. */
  readonly heard: string;
  /** When the owner said them, as the record states. */
  readonly atIso: string;
  /** The approved row this one re-cuts, when the approval came across a `--supersedes` rather than a fresh anchor. */
  readonly inheritedFrom?: string | undefined;
  /**
   * On an inherited approval, when the row it came from was last judged. A re-cut is not a judgement of words that
   * landed since, so the new row keeps this boundary rather than its own park instant.
   */
  readonly judgedIso?: string | undefined;
  /** On an inherited approval, how many landing ledger rows the row it came from had been judged against. */
  readonly judgedLandings?: number | undefined;
  /**
   * On an inherited approval, the hold that kept it unsent on the row it came from (`thread-moved`, `no-fleet-slot`,
   * `slack-refused`), so a re-cut never turns a stated block into a bare send obligation.
   */
  readonly hold?: Pick<DraftHold, "atIso" | "reason" | "why"> | undefined;
}

/**
 * The declaration a row that asks a question carries: `none`, or the earlier ask as the recording read it.
 *
 * A question the team already answered is not asked again unless something materially changed, and then only on a
 * Queue card carrying our earlier message, their answer, and proof: a bare claim that something changed is not
 * enough.
 */
export type ParkedPriorAsk =
  | { readonly kind: "none" }
  | {
      readonly kind: "prior";
      /** The earlier message's own Slack link, as declared. */
      readonly permalink: string;
      /** Our earlier message, as read at recording. */
      readonly ours: ParkedPriorMessage;
      /** The first {@link PRIOR_ANSWERS_KEPT} replies by anybody else, after ours, oldest first. */
      readonly answers: readonly ParkedPriorMessage[];
      /** How many replies by anybody else the read found — more than {@link answers} holds when it was cut. */
      readonly answerCount: number;
      /** The newest `ts` the recording read there, which a release re-reads the earlier thread against. */
      readonly readThroughTs: string;
      /** What materially changed since they answered, in the recorder's words (`--changed`). */
      readonly changed?: string | undefined;
      /** The pictures that show it (`--changed-media`), stored like {@link ParkedSlackDraft.media}. Digest-bound. */
      readonly proof?: readonly ParkedSlackDraftMedia[] | undefined;
      /** Why the replies there are not an answer to the question (`--not-answered`). */
      readonly notAnswered?: string | undefined;
    };

/** One message of an earlier exchange, kept to recognise it — never the whole conversation. */
export interface ParkedPriorMessage {
  readonly ts: string;
  /** Who wrote it, when Slack said. */
  readonly userId?: string | undefined;
  /** Its text, cut to {@link THREAD_PARENT_MAX_CHARS}. */
  readonly text: string;
}

/** How many answers a row keeps — the first is what the card shows, the rest fold below it. */
export const PRIOR_ANSWERS_KEPT = 3;

/**
 * The thread root a `thread` row replies under, snapshotted at recording. NOT in the digest: its author can
 * edit it, and what the owner's approval binds is where the reply goes and what it says, not the words above it.
 */
export interface ParkedThreadParent {
  /** Who wrote the root, when Slack said. */
  readonly userId?: string | undefined;
  /** The root's text, cut to {@link THREAD_PARENT_MAX_CHARS}. */
  readonly text: string;
  /**
   * The root's own Slack permalink, built at recording on `auth.test`'s workspace URL, so the console card links the
   * thread it replies into rather than naming it, so the owner
   * need not go into Slack and find it. Absent when `auth.test` named no workspace, when the
   * destination is not a conversation id, and on every row recorded before the field. Not digest-bound.
   */
  readonly permalink?: string | undefined;
}

/**
 * The thread as the recording read it: the newest message it saw, and every live message there with the edit
 * stamp it carried. A release compares the thread now against this — a message after `throughTs`, a seen
 * one edited since, or a seen one gone — and stops for judgement on any of them. Identifiers only, never text.
 */
export interface ParkedReadThrough {
  /** The newest message `ts` the recording read in the thread, root included; the zero `ts` when it read none. */
  readonly throughTs: string;
  /**
   * Every live message read, whoever wrote it, with `edited.ts` when it had been edited (`readThroughOf`,
   * `./releaseFreshness.ts`): only the release judges authorship, and only of what it can still see.
   */
  readonly seen: readonly ParkedSeenMessage[];
}

/** One message a recording read, by identity and edit stamp. */
export interface ParkedSeenMessage {
  readonly ts: string;
  readonly editedTs?: string | undefined;
}

/** How much of a thread root a row keeps — enough to recognise the thread, never the whole conversation. */
export const THREAD_PARENT_MAX_CHARS = 280;

/** A Slack `ts` as an identifier — seconds and microseconds, never scaled into an instant. */
export const SLACK_TS = /^[0-9]{10}\.[0-9]{6}$/;

/** One attachment a parked draft carries: what a reader sees, and the hash that names its stored bytes. */
export interface ParkedSlackDraftMedia {
  /** The filename Slack shows — a basename, never a path. */
  readonly name: string;
  /** The lowercase-hex SHA-256 of the exact bytes admitted at recording. */
  readonly sha256: string;
  /** The exact byte count of those bytes. */
  readonly bytes: number;
}

/** What has happened to one row. Appended, never rewritten. */
export type SlackDraftEvent =
  | {
      readonly kind: "parked";
      readonly id: string;
      readonly tsIso: string;
      readonly draft: ParkedSlackDraft;
      /**
       * On a park carrying a fresh approval or a declared change of meaning, how many landing ledger rows it read under
       * the register lock, so a landing written before it never reads as written after it.
       */
      readonly landingsRead?: number | undefined;
    }
  | {
      readonly kind: "released";
      readonly id: string;
      readonly tsIso: string;
      readonly channel: string;
      readonly ts: string;
      /** The thread root it landed under, for a `thread` row. Absent on a top-level release. */
      readonly threadTs?: string | undefined;
      /** The link a reader follows to the landed message. Absent on a row released before the field existed. */
      readonly permalink?: string | undefined;
      /**
       * The digest of the words that went out, so a voice edit journalled while the send was in flight never reads as
       * what landed (`./draftRevision.ts` `sentRow`). Absent on a row released before the field existed.
       */
      readonly digest?: string | undefined;
      /**
       * The conversation changes the releasing session read and judged did not change what the message means —
       * `--thread-moved-cleared`, exactly the set the release's re-read found. Absent when nothing had moved.
       */
      readonly threadMovedClearedTs?: readonly string[] | undefined;
      /**
       * The one line of thanks sent IN PLACE of the approved words, when the just-in-time re-read found the message
       * no longer needed (`--thanks-instead`). Absent on an ordinary release.
       */
      readonly thanksInstead?: string | undefined;
    }
  | {
      /**
       * The released message at `channel`/`ts` was deleted by `slack delete` (`./draftDeletion.ts`). The row stays
       * `released` — it did go out — but a finding carrying one is no longer shared (`./sharedFindings.ts`).
       */
      readonly kind: "deleted";
      readonly id: string;
      readonly tsIso: string;
      readonly channel: string;
      readonly ts: string;
    }
  | {
      readonly kind: "dropped";
      readonly id: string;
      readonly tsIso: string;
      readonly note: string;
      /**
       * How many card-landing ledger rows the drop judged, so a landing whose words were written at or past that row is one it
       * never weighed. Absent on a drop no `slack draft drop` checked, or written before the field.
       */
      readonly landingsRead?: number | undefined;
    }
  | {
      readonly kind: "approved";
      readonly id: string;
      readonly tsIso: string;
      readonly approval: DraftApproval;
      /** How many card-landing ledger rows the approve judged; absent when none read. */
      readonly landingsRead?: number | undefined;
    }
  | {
      readonly kind: "held";
      readonly id: string;
      readonly tsIso: string;
      readonly reason: DraftHoldReason;
      readonly why: string;
      /** How many card-landing ledger rows the hold judged; absent on a hold a refused release recorded. */
      readonly landingsRead?: number | undefined;
    }
  | {
      /** One Codex pass over a row whose park owed a comparison — `./draftComparison.ts`. */
      readonly kind: "compared";
      readonly id: string;
      readonly tsIso: string;
      readonly outcome: ComparisonOutcome;
    }
  | {
      /** Which draft the owner chose on a comparison card. A `codex` pick makes the candidate the row's words. */
      readonly kind: "picked";
      readonly id: string;
      readonly tsIso: string;
      readonly variant: DraftVariant;
      readonly voice?: DraftPickVoice | undefined;
    }
  | ({
      /** The owner's words naming another channel for a held row — `./draftChannelSteer.ts`. Never moves `draft.channel`. */
      readonly kind: "steered";
      readonly id: string;
    } & DraftChannelSteer)
  | ({
      /** A new version of a held row's words, from the owner's words on a call — `./draftRevision.ts`. Body only. */
      readonly kind: "revised";
      readonly id: string;
      readonly tsIso: string;
      /** The version this event makes: the row's version count plus one. */
      readonly version: number;
    } & Omit<SlackDraftVersion, "atIso" | "number">);

export { DRAFT_HOLD_REASONS, type DraftHoldReason };

/** The hold a row carries now: its reason, what the session saw, and when it was recorded. */
export interface DraftHold {
  readonly reason: DraftHoldReason;
  readonly why: string;
  readonly atIso: string;
  /**
   * What a hold on the approval itself set down — the recorded approval, or a change of meaning waiting on the
   * owner's word, or both — when, and why; carried across every later hold until an approve, so the drop can ask
   * whether the owner has spoken on the card since. Folded, never written.
   */
  readonly setDown?:
    | {
        readonly approval?: DraftApproval | undefined;
        readonly change?: string | undefined;
        readonly atIso: string;
        readonly why: string;
        /**
         * How many landing ledger rows that hold read, so "spoken since" is ledger order: a landing it counted, however
         * late the owner spoke it, is not an answer to the hold. Absent where the hold counted none.
         */
        readonly landingsRead?: number | undefined;
      }
    | undefined;
}

/**
 * Where a parked draft has got to.
 *
 * @internal the field type of {@link SlackDraftItem.state}; nothing outside this file names it directly.
 */
export type SlackDraftState = "held" | "released" | "dropped";

/** One row, folded to its current state. */
export interface SlackDraftItem {
  readonly id: string;
  readonly state: SlackDraftState;
  readonly draft: ParkedSlackDraft;
  /** When it was released or dropped. Absent while it is still held. */
  readonly resolvedIso?: string | undefined;
  /** The Slack permalink coordinates of the released message, or the drop's note. */
  readonly outcome?: string | undefined;
  /** On a dropped row, how many card-landing ledger rows its drop judged; absent when the drop recorded none. */
  readonly landingsRead?: number | undefined;
  /** Why it is held and not sent, when a session or a refused release said so after its park. */
  readonly hold?: DraftHold | undefined;
  /**
   * When the row's current judgement was RECORDED — its park when that carried `approval` or `meaningChanged`, else
   * the latest `approved` or `held` event. The tick gate compares it with when the owner's words landed; absent on a row no
   * judgement has touched.
   */
  readonly judgedIso?: string | undefined;
  /**
   * How many card-landing ledger rows the row's latest counted judgement read, so a landing whose words were written
   * at or past that row stays owed whatever instant the owner spoke them at. A judgement that counted
   * none keeps the earlier count; absent on a row no counted judgement has touched, where the gate compares instants.
   */
  readonly judgedLandings?: number | undefined;
  /**
   * How many landing ledger rows the judgement that recorded the row's change of meaning read — its park, or its
   * `meaning-changed` hold — kept across later holds until an approve, so only words written past it answer the change
   * Absent when that judgement counted none, where the drop compares instants.
   */
  readonly changedLandings?: number | undefined;
  /** The comparison the row carries, as folded: its park's word, or the latest pass outcome. */
  readonly comparison?: SlackDraftComparison | undefined;
  /** Which draft the owner chose, once chosen. */
  readonly pick?: DraftPick | undefined;
  /** The original's words, kept once a Codex pick made the candidate the row's words. */
  readonly original?: DraftWords | undefined;
  /**
   * The latest channel steer written on THIS row while it was held (`./draftChannelSteer.ts`). Never copied into
   * {@link draft}: the parked channel is digest-bound, so a steer is an obligation a release reads across the row's
   * re-cut lineage (`./draftSteerGate.ts`), and only a re-cut into a steered channel moves where it goes.
   */
  readonly steer?: DraftChannelSteer | undefined;
  /**
   * Every version of the row's words once a voice edit revised them (`./draftRevision.ts`), oldest first — v1 the words
   * it was parked or picked with. {@link draft} carries the newest. Absent on a row never revised.
   */
  readonly versions?: readonly SlackDraftVersion[] | undefined;
}

/** A Slack channel as a steer names it: the id a release compares, the name the owner said. */
export interface SlackDraftChannel {
  readonly id: string;
  readonly name: string;
}

/** The owner's words on a held row naming another channel for it, as `talk relay` recorded them. */
export interface DraftChannelSteer {
  /** The relay's `talk:<turnId>` anchor — what a reader opens to hear the owner say it. */
  readonly anchor: string;
  /** Every channel the owner named other than the row's own; a release may go only into one of these. */
  readonly channels: readonly SlackDraftChannel[];
  /** The channel the row was parked for when the owner said it. */
  readonly from: { readonly id: string; readonly name?: string | undefined };
  /** The owner's words, whitespace-collapsed and cut to {@link DRAFT_STEER_HEARD_MAX_CHARS}. */
  readonly heard: string;
  readonly tsIso: string;
}

/** How much of the owner's words a steer keeps — enough to recognise the steer; the relay's row keeps the rest. */
export const DRAFT_STEER_HEARD_MAX_CHARS = 280;

/** The row fields {@link parkedDraftDigest} reads. */
type DigestedField = "authorId" | "channel" | "groupDm" | "mentions" | "payload" | "media" | "threadTs" | "priorAsk";

/**
 * The identity the owner's approval is BOUND to: where it goes, who it goes out as, and the exact bytes.
 *
 * Not the whole row, and each omission is deliberate. The id and instant are the register's bookkeeping and
 * say nothing about what a reader would see. The advisory findings are commentary. The `form` is excluded
 * because two forms can render the same bytes and what the owner approved is what would be POSTED — binding the
 * source instead would refuse a re-preparation that is byte-identical, which is the opposite of the point.
 *
 * **Media joins the hashed object only when there is some.** Absent and empty both hash exactly as a row did
 * before the field existed, so every approval already given still names its row; one attachment present
 * binds its order, name, byte count and SHA-256, so a row whose stored bytes are swapped, renamed or
 * reordered cannot be released under an approval of the original.
 *
 * **So does a thread.** A top-level row hashes exactly as before the field; a `thread` row binds its root
 * `ts`, so the same words approved for one thread cannot be released into another, nor top-level.
 *
 * **So does a re-ask's proof.** A row with no `priorAsk`, or one whose earlier ask was simply unanswered, hashes
 * exactly as before the field; one declaring a change binds the earlier message, the change's words and its
 * pictures, and one declaring the replies no answer binds that reason, so the owner cannot approve one justification and
 * have another stand in its place.
 *
 * **So does a group DM's stamp.** An unstamped row hashes exactly as before the field; `groupDm: true` exempts a
 * text-only first message from its proof, so a stamp written onto a row afterwards breaks the approval it rode in on.
 *
 * @param draft the row's content fields, before the digest exists
 * @returns a 32-char hex digest, identical for identical destination, identity, payload, media and proof
 */
export function parkedDraftDigest({ draft }: { draft: Pick<ParkedSlackDraft, DigestedField> }): string {
  const { groupDm, media, threadTs, priorAsk } = draft;
  const withMedia = media !== undefined && media.length > 0;
  const proven = provenPriorAsk({ priorAsk });
  return createHash("sha256")
    .update(
      stableStringify({
        value: {
          authorId: draft.authorId,
          channel: draft.channel,
          mentions: draft.mentions,
          payload: draft.payload,
          ...(withMedia ? { media: media.map(({ bytes, name, sha256 }) => ({ bytes, name, sha256 })) } : {}),
          ...(threadTs === undefined ? {} : { threadTs }),
          ...(proven === undefined ? {} : { priorAsk: proven }),
          // Bound only when set, so every unstamped row hashes as it always has and a stamp written in later breaks it.
          ...(groupDm === true ? { groupDm } : {}),
        },
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * The part of a re-ask's declaration an approval binds: the earlier message, then the change's words and its
 * pictures, or the reason the replies were no answer. The answers are what the recording READ, so they stay out, as
 * a thread's parent does; a prior that was simply unanswered binds nothing, so it hashes as a row without the field.
 *
 * @param priorAsk the row's declaration, absent on a row that predates it
 * @returns the bound fields, or `undefined` when nothing the owner judges rides on the declaration
 */
function provenPriorAsk({ priorAsk }: { priorAsk: ParkedPriorAsk | undefined }): Record<string, unknown> | undefined {
  if (priorAsk?.kind !== "prior") {
    return undefined;
  }
  const { changed, notAnswered, permalink, proof } = priorAsk;
  if (proof !== undefined && proof.length > 0) {
    return { changed, permalink, proof: proof.map(({ bytes, name, sha256 }) => ({ bytes, name, sha256 })) };
  }
  return notAnswered === undefined ? undefined : { notAnswered, permalink };
}

/**
 * Encode one event as a JSONL line.
 *
 * @param event the event to append
 * @returns the JSON line, with no trailing newline
 */
export function slackDraftEventLine({ event }: { event: SlackDraftEvent }): string {
  return JSON.stringify({ schemaVersion: SLACK_DRAFT_SCHEMA_VERSION, ...event });
}

/**
 * The one row an id names, refusing rather than answering `undefined`, and refusing a spent row by name.
 *
 * @param id the row the caller named
 * @param items every folded row
 * @param mustBeHeld whether a released or dropped row is a failure — true for a release, false for a read
 * @returns the row, or which check refused it
 */
export function slackDraftById({
  id,
  items,
  mustBeHeld,
}: {
  id: string;
  items: readonly SlackDraftItem[];
  mustBeHeld: boolean;
}): Result<SlackDraftItem, SlackDraftError> {
  const found = items.find((item) => item.id === id);
  if (found === undefined) {
    return err(SlackDraftErrors.notFound({ id }));
  }
  if (mustBeHeld && found.state !== "held") {
    return err(SlackDraftErrors.spent({ id, outcome: found.outcome, state: found.state }));
  }
  return ok(found);
}
