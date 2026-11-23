/**
 * Reading a voice tool call's arguments: the stage switch it names, and a relay's candidate ruling, triage ruling,
 * outward act and check-in verdict, each or why it is refused. Split from `talkToolRun.ts` to keep it under the line
 * cap.
 */
import { type AlsoAnswersRead, alsoAnswersOf } from "../../lib/alsoAnsweredCards";
import type { RelayOutward } from "../../lib/relayAnswer";
import { threadKeyOf } from "../../lib/slackLink";
import type { UnreadSource } from "../../lib/talkActionItems";
import {
  CANDIDATE_ID,
  type CandidateRulingWire,
  CHECK_IN_KEY,
  type CheckInCovers,
} from "../../lib/talkRelayRequestWire";
import { triageVisitFor } from "../../lib/triageWalk";
import type { TriageFront, TriageWalk } from "../../lib/triageWalkTypes";
import {
  feedbackRefusal,
  type TriageRulingWire,
  triageFeedbackOf,
  triageLabelOf,
  triageVerdictOf,
} from "../../lib/triageWords";
import { isStageSwitch, STAGE_TOGGLE_ORDER, type StageSwitch, type StageToggle } from "../../lib/voiceStage";
import { SPOKEN_REACTIONS } from "../../lib/workstreamCandidatesTypes";
import type { ToolSeams } from "./talkToolRunTypes";

/**
 * A relay's `also_answers`, held to what this call served the owner and what their Queue holds now. Absent reads
 * nothing from the page, so a relay naming no other card costs no projection.
 *
 * Served means listed by the latest `action_items` answer, or the card the walk put in front of the owner and has not
 * moved past (`../../lib/cardWalk.ts` `front`). An owner who follows a card's linked report and rules on it there, with
 * no card open on the page, still has the relay name that card, so it does not stay up unruled.
 *
 * @param args the tool call's arguments
 * @param seams the page's open card, its Queue, the keys the latest `action_items` answer listed and the walk
 * @returns the keys to land beside the open card, in the order named, with every register the Queue read behind them
 * could not deliver, so the relay's answer names them — or why the whole call is refused
 */
export function alsoAnsweredBy({
  args,
  seams,
}: {
  args: Record<string, unknown>;
  seams: Pick<ToolSeams, "cardWalk" | "cards" | "servedCards" | "view">;
}):
  | Exclude<AlsoAnswersRead, { readonly kind: "accepted" }>
  | { readonly kind: "accepted"; readonly keys: readonly string[]; readonly unread: readonly UnreadSource[] } {
  const value = args["also_answers"];
  if (value === undefined) {
    return { keys: [], kind: "accepted", unread: [] };
  }
  let about = "";
  const open = seams.view().open;
  if (open !== undefined) {
    about = open;
  }
  const { rows, unread } = seams.cards();
  const currentKeys = new Set(rows.map((row) => row.key));
  const servedKeys = new Set(seams.servedCards.read());
  const front = seams.cardWalk.read().front;
  if (front !== undefined) {
    servedKeys.add(front);
  }
  const read = alsoAnswersOf({ about, currentKeys, servedKeys, unread, value });
  if (read.kind === "refused") {
    return read;
  }
  return { ...read, unread };
}

/** One stage switch the owner told the voice to flip, and which way. */
export interface StageSettingChange {
  readonly setting: StageToggle;
  readonly state: StageSwitch;
}

/**
 * The stage switch a `set_stage_setting` call names, or `undefined` when either argument is not one the stage has
 * — so a malformed call is refused before any switch moves.
 *
 * @param args the tool call's arguments
 * @returns the change, or `undefined`
 */
export function stageSettingChangeOf({ args }: { args: Record<string, unknown> }): StageSettingChange | undefined {
  const setting = STAGE_TOGGLE_ORDER.find((one) => one === args["setting"]);
  const state = args["state"];
  if (setting === undefined || !isStageSwitch(state)) {
    return undefined;
  }
  return { setting, state };
}

/**
 * The workstream candidate a relay names the owner's ruling on, or why the pair is refused: both or neither, the id
 * candidate-shaped, the word one of the owner's, and never beside a check-in verdict — one turn carries one ruling.
 *
 * @param args the tool call's arguments
 * @returns the ruling, `undefined` when the relay names no candidate, or the refusal sentence
 */
export function candidateRulingOf({
  args,
}: {
  args: Record<string, unknown>;
}): { readonly ruling: CandidateRulingWire | undefined } | { readonly why: string } {
  const candidate = args["candidate"];
  const reaction = args["reaction"];
  if (candidate === undefined && reaction === undefined) {
    return { ruling: undefined };
  }
  if (typeof candidate !== "string" || !CANDIDATE_ID.test(candidate)) {
    return {
      why: "candidate must be the id of the workstream candidate you read the owner, such as c-105, beside reaction",
    };
  }
  const word = SPOKEN_REACTIONS.find((one) => one === reaction);
  if (word === undefined) {
    return { why: `reaction must be one of ${SPOKEN_REACTIONS.join(", ")}, beside candidate` };
  }
  if (args["check_in"] !== undefined || args["covers"] !== undefined) {
    return { why: "a relay carries one ruling: candidate with reaction, or check_in with covers, never both" };
  }
  return { ruling: { candidate, reaction: word } };
}

/**
 * The owner's triage ruling a relay carries, or why it is refused: a verdict of theirs, a label only beside one, on the
 * card `triage_card` names — the one in front of the owner or the one just left, never whichever is current when the
 * relay happens to run — and never beside another ruling — one turn carries one.
 *
 * @param args the tool call's arguments
 * @param walk the page's triage pass, `undefined` with none running
 * @param front the card the owner had in front of them as the answer carrying the relay began, which binds the ruling to it
 * @returns the ruling and the card it is on, `undefined` when the relay carries none, or the refusal sentence
 */
export function triageRulingOf({
  args,
  walk,
  front,
}: {
  args: Record<string, unknown>;
  walk: TriageWalk | undefined;
  front: TriageFront;
}):
  | { readonly triage: { readonly ruling: TriageRulingWire; readonly key: string } | undefined }
  | { readonly why: string } {
  const triage = args["triage"];
  const label = args["label"];
  const feedback = args["feedback"];
  if (triage === undefined && label === undefined && feedback === undefined && args["triage_card"] === undefined) {
    return { triage: undefined };
  }
  const verdict = triageVerdictOf({ value: triage });
  if (verdict === undefined) {
    return { why: "triage must be the owner's verdict on the triage card; label and feedback go only beside it" };
  }
  const word = triageLabelOf({ value: label });
  if (label !== undefined && word === undefined) {
    return { why: "label must be one of the owner's inbox-zero labels" };
  }
  const wrong = feedbackRefusal({ feedback, verdict });
  if (wrong !== undefined) {
    return { why: wrong };
  }
  const named = triageFeedbackOf({ value: feedback });
  const card = args["triage_card"];
  if (walk === undefined || typeof card !== "string" || triageVisitFor({ front, key: card, walk }) === undefined) {
    return {
      why:
        "triage_card must be the key triage_next gave for the card in front of the owner, the one they ruled; with no such " +
        "card, relay again without triage",
    };
  }
  const others = ["check_in", "covers", "candidate", "reaction"].filter((name) => args[name] !== undefined);
  if (others.length > 0) {
    return { why: "a relay carries one ruling: triage, candidate or check_in, never two" };
  }
  const ruling = named === undefined ? { label: word, verdict } : { feedback: named, label: word, verdict };
  return { triage: { key: card, ruling } };
}

/**
 * What a relay says the owner's words ask to be done outside the call, or why the pair is refused: `outward` is required,
 * `slack-send` carries the link of the thread it goes to, and the other two carry none. A `slack-send` with no
 * usable link is refused with the way on — the steer still travels as `other-outward`, unwatched — never dropped.
 *
 * @param args the tool call's arguments
 * @returns the outward act, or the refusal sentence
 */
export function relayOutwardOf({
  args,
}: {
  args: Record<string, unknown>;
}): { readonly outward: RelayOutward } | { readonly why: string } {
  const kind = args["outward"];
  const sends = args["sends"];
  if (kind === "none" || kind === "other-outward") {
    if (sends !== undefined) {
      return { why: "sends goes only with outward: slack-send; drop it, or pass outward: slack-send" };
    }
    return { outward: { kind } };
  }
  if (kind !== "slack-send") {
    return { why: "outward must be none, slack-send or other-outward" };
  }
  if (typeof sends !== "string" || threadKeyOf({ link: sends }) === undefined) {
    return {
      why:
        "outward: slack-send needs sends: the Slack link of the thread it goes to, read off the owner's screen or a tool, " +
        "never composed; with none, relay again with outward: other-outward",
    };
  }
  return { outward: { kind, url: sends } };
}

/** The check-in the owner's words are a verdict on, and how far that verdict reaches. */
export interface CheckInVerdict {
  readonly key: string;
  readonly covers: CheckInCovers;
}

/**
 * The check-in a relay names, or why the pair is refused: both or neither, the key an `act:` key, the reach one
 * of the two.
 *
 * @param args the tool call's arguments
 * @returns the verdict, `undefined` when the relay names no check-in, or the refusal sentence
 */
export function checkInVerdictOf({
  args,
}: {
  args: Record<string, unknown>;
}): { readonly verdict: CheckInVerdict | undefined } | { readonly why: string } {
  const key = args["check_in"];
  const covers = args["covers"];
  if (key === undefined && covers === undefined) {
    return { verdict: undefined };
  }
  if (typeof key !== "string" || !CHECK_IN_KEY.test(key)) {
    return { why: "check_in must be the act:<id> key of the check-in you read the owner, beside covers" };
  }
  if (covers !== "rule" && covers !== "this") {
    return { why: "covers must be rule or this, beside check_in" };
  }
  return { verdict: { covers, key } };
}
