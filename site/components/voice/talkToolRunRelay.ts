/**
 * Run a relay tool call (`relay_steer`): check every argument the owner's steer carries, hand it to the page's relay,
 * and record the owner's triage ruling on the pass it names. The rest of `runTalkTool`'s dispatch is
 * `./talkToolRun.ts`'s; every effect is a seam, so a test passes plain fakes.
 */
import { teamFixAskOf } from "../../lib/discussFirst";
import { noteTriageRuling } from "../../lib/triageWalk";
import type { TriageFront } from "../../lib/triageWalkTypes";
import { withRecordUnread } from "../../lib/voiceRecordQueue";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";
import { alsoAnsweredBy, candidateRulingOf, checkInVerdictOf, relayOutwardOf, triageRulingOf } from "./talkToolRunArgs";
import type { ToolRan, ToolSeams } from "./talkToolRunTypes";

/** What the page's relay is handed for one call. */
type RelayInput = Parameters<ToolSeams["relay"]>[0];

/** A relay call checked: what the relay is handed, with what recording the ruling after it needs. */
interface RelayCall {
  readonly input: RelayInput;
  readonly front: TriageFront;
  readonly unread: Parameters<typeof withRecordUnread>[0]["unread"];
}

/**
 * Every argument of a relay call checked, in the order the model is told of them: the words to relay first, then each
 * optional verdict, then the judgement of the open card, then the other cards it also answers.
 *
 * @param args the tool call's arguments
 * @param answerId the model's answer the call was made in, which the owner's triage ruling binds to
 * @param seams what the call reaches
 * @returns what the relay is handed, or why the call is refused
 */
export function relayCallOf({
  args,
  answerId,
  seams,
}: {
  args: Record<string, unknown>;
  answerId: string | undefined;
  seams: ToolSeams;
}): { readonly call: RelayCall } | { readonly detail: string; readonly why: string } {
  const say = args["say"];
  if (typeof say !== "string" || say.trim() === "") {
    return { detail: "no words to relay", why: "say must be your reading of the owner's steer" };
  }
  const checkIn = checkInVerdictOf({ args });
  if ("why" in checkIn) {
    return { detail: "a malformed check-in verdict", why: checkIn.why };
  }
  const candidateRuling = candidateRulingOf({ args });
  if ("why" in candidateRuling) {
    return { detail: "a malformed candidate ruling", why: candidateRuling.why };
  }
  const front = seams.triage.frontOf({ answerId });
  const triageRuling = triageRulingOf({ args, front, walk: seams.triage.read() });
  if ("why" in triageRuling) {
    return { detail: "a malformed triage ruling", why: triageRuling.why };
  }
  const outward = relayOutwardOf({ args });
  if ("why" in outward) {
    return { detail: "a malformed outward act", why: outward.why };
  }
  const fix = teamFixAskOf({ args, placer: seams.placer });
  if ("why" in fix) {
    return { detail: "a malformed team fix", why: fix.why };
  }
  const answersOpenCard = args["answers_open_card"];
  if (typeof answersOpenCard !== "boolean") {
    return {
      detail: "no judgement of the open card",
      why: "answers_open_card is required: true only when the owner's words answer the card they have open, false otherwise",
    };
  }
  const also = alsoAnsweredBy({ args, seams });
  if (also.kind === "refused") {
    return { detail: "an also_answers card not served this call", why: also.why };
  }
  const input: RelayInput = {
    alsoAnswers: also.keys,
    answersOpenCard,
    candidateRuling: candidateRuling.ruling,
    checkIn: checkIn.verdict,
    fix: fix.ask,
    outward: outward.outward,
    say,
    triage: triageRuling.triage,
  };
  return { call: { front, input, unread: also.unread } };
}

/**
 * Run one relay call: refuse a malformed one with its reason, else relay the owner's steer and, when it carries their
 * triage ruling, record it on the pass.
 *
 * @param args the tool call's arguments
 * @param answerId the model's answer the call was made in (the plan call's turn), `undefined` when it named none
 * @param seams what the call reaches
 * @param refusal how `runTalkTool` answers a refused call
 * @returns what it came to
 */
export function runRelayTool({
  args,
  answerId,
  seams,
  refusal,
}: {
  args: Record<string, unknown>;
  answerId: string | undefined;
  seams: ToolSeams;
  refusal: (input: { readonly why: string; readonly detail: string }) => ToolRan;
}): ToolRan {
  const checked = relayCallOf({ answerId, args, seams });
  if (!("call" in checked)) {
    return refusal(checked);
  }
  const { front, input, unread } = checked.call;
  const ran = seams.relay(input);
  const walk = seams.triage.read();
  if (!ran.refused && input.triage !== undefined && walk !== undefined) {
    // The owner's ruling spends the card's clock, so the time-up line never follows a card they have already ruled.
    const { key, ruling } = input.triage;
    const noted = noteTriageRuling({ front, key, ruling, walk });
    seams.triage.write({ walk: noted });
    // A ruling on the card in front of the owner stops its clock; one on the card before leaves the current card's running.
    if (noted.current?.key === key && noted.current.ruled) {
      seams.triage.stopClock();
    }
  }
  // A relay naming other cards stands on the Queue read that found them current, so it names what that read could
  // not deliver.
  let answer = ran.answer;
  if (input.alsoAnswers.length > 0) {
    answer = withRecordUnread({ answer: ran.answer, capBytes: TOOL_OUTPUT_MAX, unread });
  }
  // Counted as a read, as every tool answer is: it lands right after the relay's own boundary, before any word
  // the owner says next, so it never makes a later relay heard-only — and the page's own words in it cost nothing.
  return { ...ran, answer, image: undefined, partialFailures: [], readText: true };
}
