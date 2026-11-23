/**
 * One parser per optional field of a relay body, each returning its value or the refusal `./talkRelayRequest.ts`'s
 * parse passes straight back.
 */
import type { RelayWorkspace } from "./relayWorkspace";
import { type CopyOfferWire, copyOfferWireOf } from "./runningListCopy";
import { refuseSlot } from "./slots";
import {
  CANDIDATE_ID,
  type CandidateRulingWire,
  CHECK_IN_KEY,
  type CheckInCovers,
  isNoPictureReason,
  NO_PICTURE_REASON_LIST,
  type ParsedTalkRelay,
  READ_SOURCE,
  RELAY_READS_MAX,
  type Refused,
  refused,
} from "./talkRelayRequestWire";
import {
  feedbackRefusal,
  type TriageRulingWire,
  triageFeedbackOf,
  triageLabelOf,
  triageVerdictOf,
} from "./triageWords";
import { decodeWebpDataUrl } from "./webpDataUrl";
import { isWorkspace } from "./workspacePlacement";
import { SPOKEN_REACTIONS } from "./workstreamCandidatesTypes";

/** The longest reason a stated workspace carries — one line on a row, never a paragraph. */
const WORKSPACE_BECAUSE_MAX = 300;

/**
 * Whose work the relay is, or why the request's `workspace` is refused: one of the two workspaces, with a one-line
 * reason that carries no control character, since the verb writes it onto the row as one line.
 *
 * @param value the body's `workspace`
 * @returns the statement, `undefined` when the page stated none, or the refusal
 */
export function workspaceOf({
  value,
}: {
  value: unknown;
}): { readonly kind: "workspace"; readonly workspace: RelayWorkspace | undefined } | Refused {
  if (value === undefined) {
    return { kind: "workspace", workspace: undefined };
  }
  if (typeof value !== "object" || value === null) {
    return refused({ status: 400, why: "workspace must be an object with workspace and because" });
  }
  const held: Record<string, unknown> = { ...value };
  const { workspace, because } = held;
  if (!isWorkspace(workspace)) {
    return refused({ status: 400, why: "workspace.workspace must be team or self" });
  }
  const reasonOk =
    typeof because === "string" &&
    because.trim() !== "" &&
    because.length <= WORKSPACE_BECAUSE_MAX &&
    !/\p{Cc}/u.test(because);
  if (!reasonOk) {
    return refused({
      status: 400,
      why: `workspace.because must be one line of up to ${String(WORKSPACE_BECAUSE_MAX)} characters`,
    });
  }
  return { kind: "workspace", workspace: { because, workspace } };
}

/**
 * How far the owner's verdict on a check-in reaches, or why the request's `covers` is refused: a value outside the two,
 * or one on a relay that is not about a check-in.
 *
 * @param value the body's `covers`
 * @param about the body's `about`, already checked as a queue key or empty
 * @returns the reach, `undefined` when the relay is not a ruling, or the refusal
 */
export function coversOf({
  value,
  about,
}: {
  value: unknown;
  about: string;
}): { readonly kind: "covers"; readonly covers: CheckInCovers | undefined } | Refused {
  if (value === undefined) {
    return { covers: undefined, kind: "covers" };
  }
  if (value !== "rule" && value !== "this") {
    return refused({ status: 400, why: "covers must be rule or this" });
  }
  if (!CHECK_IN_KEY.test(about)) {
    return refused({
      status: 400,
      why: "covers records the owner's word on a check-in, so about must be act:<actionId>",
    });
  }
  return { covers: value, kind: "covers" };
}

/**
 * The owner's ruling on a workstream candidate, or why the request's pair is refused: both or neither, the id
 * candidate-shaped, the word one of the owner's, and never beside a check-in's `covers`.
 *
 * @param candidate the body's `candidate`
 * @param reaction the body's `reaction`
 * @param covers the check-in reach already parsed, which a candidate ruling may not sit beside
 * @returns the ruling, `undefined` when the relay is not one, or the refusal
 */
export function candidateRulingOf({
  candidate,
  reaction,
  covers,
}: {
  candidate: unknown;
  reaction: unknown;
  covers: CheckInCovers | undefined;
}): { readonly kind: "ruling"; readonly ruling: CandidateRulingWire | undefined } | Refused {
  if (candidate === undefined && reaction === undefined) {
    return { kind: "ruling", ruling: undefined };
  }
  if (typeof candidate !== "string" || !CANDIDATE_ID.test(candidate)) {
    return refused({ status: 400, why: "candidate must be a candidate id such as c-105, beside reaction" });
  }
  const word = SPOKEN_REACTIONS.find((one) => one === reaction);
  if (word === undefined) {
    return refused({ status: 400, why: `reaction must be one of ${SPOKEN_REACTIONS.join(", ")}, beside candidate` });
  }
  if (covers !== undefined) {
    return refused({ status: 400, why: "a relay carries one ruling: candidate with reaction, or covers, never both" });
  }
  return { kind: "ruling", ruling: { candidate, reaction: word } };
}

/**
 * The copy-tray offer a relay carries, or why the request's `offered` is refused: one {@link copyOfferWireOf} reads
 * back, and never beside `wordsAlone`.
 *
 * @param value the body's `offered`
 * @param wordsAlone whether the relay is the words-alone retry
 * @returns the offer, `undefined` when the relay carries none, or the refusal
 */
export function offeredOf({
  value,
  wordsAlone,
}: {
  value: unknown;
  wordsAlone: boolean;
}): { readonly kind: "offered"; readonly offered: CopyOfferWire | undefined } | Refused {
  if (value === undefined) {
    return { kind: "offered", offered: undefined };
  }
  if (wordsAlone) {
    return refused({ status: 400, why: "wordsAlone carries the owner's words only: offered must be absent" });
  }
  const read = copyOfferWireOf({ value });
  if ("why" in read) {
    return refused({ status: 400, why: read.why });
  }
  return { kind: "offered", offered: read.offer };
}

/**
 * The owner's triage ruling, or why the request's pair is refused: a known verdict, a label or feedback only beside one,
 * feedback only beside a verdict that sends the card back, a card to rule on in `about`, and never beside another
 * ruling.
 *
 * @param triage the body's `triage`
 * @param label the body's `label`
 * @param feedback the body's `feedback`, the class of defect the owner named
 * @param about the body's `about`, already checked as a queue key or empty
 * @param otherRuling whether the body also carries a check-in or candidate ruling
 * @returns the ruling, `undefined` when the relay is not one, or the refusal
 */
export function triageRulingOf({
  triage,
  label,
  feedback,
  about,
  otherRuling,
}: {
  triage: unknown;
  label: unknown;
  feedback: unknown;
  about: string;
  otherRuling: boolean;
}): { readonly kind: "triage"; readonly ruling: TriageRulingWire | undefined } | Refused {
  if (triage === undefined && label === undefined && feedback === undefined) {
    return { kind: "triage", ruling: undefined };
  }
  const verdict = triageVerdictOf({ value: triage });
  if (verdict === undefined) {
    return refused({
      status: 400,
      why: "triage must be one of the owner's triage verdicts; label and feedback ride only beside it",
    });
  }
  const word = triageLabelOf({ value: label });
  if (label !== undefined && word === undefined) {
    return refused({ status: 400, why: "label must be one of the owner's inbox-zero labels" });
  }
  const wrong = feedbackRefusal({ feedback, verdict });
  if (wrong !== undefined) {
    return refused({ status: 400, why: wrong });
  }
  const named = triageFeedbackOf({ value: feedback });
  if (about === "") {
    return refused({ status: 400, why: "triage rules the card the owner has open, so about must name it" });
  }
  if (otherRuling) {
    return refused({ status: 400, why: "a relay carries one ruling: triage, candidate or covers, never two" });
  }
  if (named === undefined) {
    return { kind: "triage", ruling: { label: word, verdict } };
  }
  return { kind: "triage", ruling: { feedback: named, label: word, verdict } };
}

/**
 * The read sources, or `undefined` when the value is not a short list of tool-shaped names.
 *
 * @returns the names, or `undefined` when any is not tool-shaped or there are too many
 */
export function readSourcesOf({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > RELAY_READS_MAX) {
    return undefined;
  }
  const names = value.filter((name): name is string => typeof name === "string" && READ_SOURCE.test(name));
  if (names.length !== value.length) {
    return undefined;
  }
  return names;
}

/**
 * The voice's reading for this mode: required in full mode, absent in heard-only and words-alone mode.
 *
 * @returns the reading and whether the relay is words alone, or the refusal
 */
export function readingOf({
  reads,
  say,
  wordsAlone,
}: {
  reads: readonly string[];
  say: unknown;
  wordsAlone: unknown;
}): { readonly kind: "say"; readonly say: string | undefined; readonly wordsAlone: boolean } | Refused {
  if (wordsAlone !== undefined) {
    if (wordsAlone !== true) {
      return refused({ status: 400, why: "wordsAlone must be true when present" });
    }
    if (say !== undefined || reads.length > 0) {
      return refused({
        status: 400,
        why: "wordsAlone carries the owner's words only: say must be absent and readsAfter empty",
      });
    }
    return { kind: "say", say: undefined, wordsAlone: true };
  }
  if (reads.length > 0) {
    if (say !== undefined) {
      return refused({
        status: 400,
        why: "say must be absent when readsAfter is not: after a read only the owner's words travel",
      });
    }
    return { kind: "say", say: undefined, wordsAlone: false };
  }
  if (typeof say !== "string") {
    return refused({ status: 400, why: "say must be a string" });
  }
  const refusedSay = refuseSlot({ slot: { shape: "text", slot: "say" }, value: say });
  if (refusedSay !== undefined) {
    return refused({ status: 400, why: refusedSay });
  }
  return { kind: "say", say, wordsAlone: false };
}

/**
 * The picture's decoded bytes, or why the relay carries none, or why it is refused.
 *
 * @returns the decoded screen, or the refusal
 */
export function pictureOf({
  value,
}: {
  value: unknown;
}): { readonly kind: "screen"; readonly screen: ParsedTalkRelay["screen"] } | Refused {
  if (typeof value !== "object" || value === null) {
    return refused({ status: 400, why: "screen must say whether a picture is attached" });
  }
  const held: Record<string, unknown> = { ...value };
  if (held["kind"] === "none") {
    const reason = held["reason"];
    if (!isNoPictureReason(reason)) {
      return refused({
        status: 400,
        why: `screen.reason must be one of ${NO_PICTURE_REASON_LIST.join(", ")}`,
      });
    }
    return { kind: "screen", screen: { kind: "none", reason } };
  }
  const dataUrl = held["dataUrl"];
  if (held["kind"] !== "attached" || typeof dataUrl !== "string") {
    return refused({ status: 400, why: "screen must be attached with a dataUrl, or none with a reason" });
  }
  const decoded = decodeWebpDataUrl({ dataUrl, field: "screen.dataUrl" });
  if (decoded.kind === "refused") {
    return refused({ status: decoded.status, why: decoded.why });
  }
  return { kind: "screen", screen: { bytes: decoded.bytes, kind: "attached" } };
}
