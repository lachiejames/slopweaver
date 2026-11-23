/**
 * What a session judged of the owner's words on a held row, as `slack draft list --json` prints it: the reading
 * `./readSlackDrafts.ts` takes of a row's approval, change of meaning and hold. Its own module so the register reader
 * stays under its size cap.
 */
import { type Bag, isBag, str } from "../../lib/bag";

/**
 * The first hold reason — `src/outbound/slack/draftHoldReasons.ts`'s `NOT_OWNER_YES_REASON`, restated and held equal
 * by the mirror tests of the list below and of `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const NOT_OWNER_YES_REASON = "not-owner-yes" as const;

/**
 * Why a held row carrying the owner's words is not sent — `src/outbound/slack/draftRegister.ts`'s `DRAFT_HOLD_REASONS`,
 * restated because `site/` cannot import that tree; `site/__tests__/unit/draftHoldReasonsMirror.test.ts` holds the two
 * lists equal.
 */
export const DRAFT_HOLD_REASONS = [
  NOT_OWNER_YES_REASON,
  "meaning-changed",
  "thread-moved",
  "no-fleet-slot",
  "slack-refused",
] as const;

/** One of {@link DRAFT_HOLD_REASONS}. */
export type DraftHoldReason = (typeof DRAFT_HOLD_REASONS)[number];

/**
 * What a session judged of the owner's words on a held row (`slack draft approve` / `slack draft hold`): the owner's yes bound to these
 * exact words, a change of meaning that set it down, and why it is not sent. Each absent when the row says nothing.
 */
export interface DraftJudgement {
  /** The owner's words the approval binds, and where the owner said them. */
  readonly approval: { readonly anchor: string; readonly heard: string } | undefined;
  /** What changed the draft's meaning since the owner's yes, so it waits on the owner's word again. */
  readonly meaningChanged: string | undefined;
  /** Why it is held and not sent — what the card leads with. */
  readonly hold:
    | {
        readonly reason: DraftHoldReason;
        readonly why: string;
        readonly atIso: string;
        /** The yes, or change of meaning, a not-a-yes hold (the reason `DRAFT_HOLD_REASONS` lists first, `src/outbound/slack/draftHoldReasons.ts`) set down and a later hold still carries. */
        readonly setDown?: HoldSetDown | undefined;
      }
    | undefined;
  /**
   * When the row's current judgement was recorded (`src/outbound/slack/draftRegister.ts` `judgedIso`) — the instant a
   * change of meaning, which carries none of its own, is news against the owner's words. Absent on a row nothing judged.
   */
  readonly judgedIso?: string | undefined;
}

/** What an earlier not-a-yes hold set down: the owner's heard words, a change waiting on the owner's word, and why. */
export interface HoldSetDown {
  readonly why: string;
  readonly heard: string | undefined;
  readonly change: string | undefined;
}

/**
 * A row's judgement, or `"malformed"` when a present field will not read: a hold the card cannot state is not one it
 * may draw as a plain draft awaiting the owner's word, which is the silence this reading exists to end.
 *
 * @param item the listed row, which carries the hold
 * @param draft the row's parked draft, which carries the approval and any change of meaning
 * @returns the judgement, or `"malformed"`
 */
export function draftJudgementOf({ item, draft }: { item: Bag; draft: Bag }): DraftJudgement | "malformed" {
  const approval = draft["approval"];
  const meaningChanged = draft["meaningChanged"];
  const hold = item["hold"];
  const judgedIso = item["judgedIso"];
  if (notText({ bag: draft, key: "meaningChanged" }) || notInstant({ bag: item, key: "judgedIso" })) {
    return "malformed";
  }
  const readApproval = approval === undefined ? undefined : approvalOf({ value: approval });
  const readHold = hold === undefined ? undefined : holdOf({ value: hold });
  if (readApproval === "malformed" || readHold === "malformed") {
    return "malformed";
  }
  return {
    approval: readApproval,
    hold: readHold,
    judgedIso: typeof judgedIso === "string" ? judgedIso : undefined,
    meaningChanged: typeof meaningChanged === "string" ? meaningChanged : undefined,
  };
}

/** Whether `bag[key]` is present but not a string — absent is fine, malformed is not. */
function notText({ bag, key }: { bag: Bag; key: string }): boolean {
  return bag[key] !== undefined && typeof bag[key] !== "string";
}

/** Whether `bag[key]` is present but not an instant that parses — absent is fine, malformed is not. */
function notInstant({ bag, key }: { bag: Bag; key: string }): boolean {
  const value = bag[key];
  return value !== undefined && (typeof value !== "string" || Number.isNaN(Date.parse(value)));
}

/** A present approval: the owner's anchor and words, or `"malformed"`. */
function approvalOf({ value }: { value: unknown }): DraftJudgement["approval"] | "malformed" {
  if (!isBag(value)) {
    return "malformed";
  }
  const anchor = str({ bag: value, key: "anchor" });
  const heard = str({ bag: value, key: "heard" });
  if (anchor === undefined || heard === undefined) {
    return "malformed";
  }
  return { anchor, heard };
}

/** A present hold: a reason this build knows, a non-blank why and its instant, or `"malformed"`. */
function holdOf({ value }: { value: unknown }): DraftJudgement["hold"] | "malformed" {
  if (!isBag(value)) {
    return "malformed";
  }
  const stored = str({ bag: value, key: "reason" });
  const reason = DRAFT_HOLD_REASONS.find((one) => one === stored);
  const why = str({ bag: value, key: "why" });
  const atIso = str({ bag: value, key: "atIso" });
  if (reason === undefined || why === undefined || why.trim() === "" || atIso === undefined) {
    return "malformed";
  }
  const setDown = value["setDown"] === undefined ? undefined : setDownOf({ value: value["setDown"] });
  if (setDown === "malformed") {
    return "malformed";
  }
  return { atIso, reason, why, ...(setDown === undefined ? {} : { setDown }) };
}

/**
 * A present set-down record: its why, and the heard words or change it set down, or `"malformed"`. A later hold
 * replacing the one that set the owner's yes down must not hide why it stopped standing.
 */
function setDownOf({ value }: { value: unknown }): HoldSetDown | "malformed" {
  if (!isBag(value) || notText({ bag: value, key: "change" })) {
    return "malformed";
  }
  const why = str({ bag: value, key: "why" });
  const approval = value["approval"];
  const read = approval === undefined ? undefined : approvalOf({ value: approval });
  if (why === undefined || read === "malformed") {
    return "malformed";
  }
  return { change: str({ bag: value, key: "change" }), heard: read === undefined ? undefined : read.heard, why };
}
