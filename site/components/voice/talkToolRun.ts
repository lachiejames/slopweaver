/**
 * Run one tool call the voice made, whoever pays for the call it came from: dispatch by name, and turn every
 * failure into an answer the model can say out loud. What happens to the answer — a `function_call_output` on the
 * channel, or a post to a plan call's answer route — is `VoiceProvider.tsx`'s. Its own file so that one stays
 * under the line cap.
 */
import { walkResolved } from "../../lib/cardWalk";
import { ownerMinutesOf } from "../../lib/clockMinutesGuard";
import { fileImageOf } from "../../lib/fileImage";
import { heardOpenCardsOff, OPEN_CARDS_OFF_REFUSAL } from "../../lib/openCardsOffGuard";
import { PAGE_READ_MAX_BYTES, pageRead, pageReadOn } from "../../lib/pageVoice";
import { resolvedPageView } from "../../lib/publishedPageVoice";
import { talkToolFor } from "../../lib/talkTools";
import { heardTriageAsked } from "../../lib/triageAskGuard";
import { trackedCardReads, withCardsUnread } from "../../lib/voiceRecordQueue";
import { STAGE_TOGGLE_ORDER } from "../../lib/voiceStage";
import { setupFailureOf, TOOL_OUTPUT_MAX } from "../live/talkSession";
import { boundedCardSeams } from "./boundedCardSeams";
import { stepCardWalk, walkBefore } from "./cardWalkStep";
import { runDraftEditStart, runDraftWrite } from "./draftEditRun";
import { runFocusEnd, runFocusQuiet, runFocusSet } from "./focusRun";
import { runMeetingSkip } from "./meetingSkipRun";
import { runOpenCard, runReadCard } from "./openCardRun";
import { openCardsSettingNote } from "./openCardsSettingNote";
import { argsOf } from "./talkToolCalls";
import { stageSettingChangeOf } from "./talkToolRunArgs";
import { runRelayTool } from "./talkToolRunRelay";
import type { ToolRan, ToolSeams } from "./talkToolRunTypes";
import { runTriageClock, runTriageEnd } from "./triageClockRun";
import { runTriageNext } from "./triageRun";

export { lookSurfaceOf } from "./talkToolRunScreen";

/** The tools that read the Queue's cards, each reading the record fresh before it answers. */
const QUEUE_TOOLS: ReadonlySet<string> = new Set([
  "action_items",
  "read_card",
  "open_card",
  "triage_next",
  "triage_end",
]);

/**
 * Run one tool call. A refusal is an ANSWER, because a call that gets no answer leaves the session waiting while
 * one that gets a reason can say it out loud.
 *
 * @param name the tool the model called
 * @param rawArguments its arguments, as the JSON text the model wrote
 * @param requestId the tool call's stable token — the plan call's token it is answered under — which a write keyed
 *   by request (`offer_copy`'s running-list add) carries so a retry of the same call never adds twice
 * @param seams what the tools reach
 * @param answerId the model's answer the call was made in (the plan call's turn), `undefined` when it named none
 * @returns what it came to
 */
export async function runTalkTool({
  name,
  rawArguments,
  requestId,
  seams: given,
  answerId,
}: {
  name: string;
  rawArguments: string;
  requestId: string;
  seams: ToolSeams;
  answerId: string | undefined;
}): Promise<ToolRan> {
  const tool = talkToolFor({ name });
  const args = argsOf({ rawArguments });
  const refusal = ({ why, detail }: { why: string; detail: string }): ToolRan => ({
    answer: { refused: why },
    detail,
    image: undefined,
    partialFailures: [],
    readText: false,
    refused: true,
  });
  let seams = given;
  try {
    if (tool === undefined) {
      return refusal({ detail: `no tool named ${name}`, why: `no tool named ${name}` });
    }
    if (args === undefined) {
      return refusal({ detail: "arguments were not a JSON object", why: "the arguments were not a JSON object" });
    }
    // A Queue tool reads the record, fresh, never the page's copy; so does a
    // relay checking `also_answers` against the cards on the owner's Queue now.
    if (QUEUE_TOOLS.has(tool.name) || (tool.does === "relay" && args["also_answers"] !== undefined)) {
      // Everything the tool waits on after the record is held inside THIS call's deadline (`./boundedCardSeams.ts`).
      const call = await given.readQueueRecord();
      seams = { ...given, ...boundedCardSeams({ seams: given, within: call.within }), undrawnWhy: call.undrawnWhy };
    }
    if (tool.name === "action_items") {
      const items = seams.actionItems();
      // Replaced whole, never merged: a card an earlier answer listed and this one dropped is not one the owner was served.
      seams.servedCards.write({ keys: items.itemNames.map((item) => item.key) });
      const detail = `${String(items.items.length)} shown, ${String(items.unread.length)} source(s) unread`;
      return { answer: items, detail, image: undefined, partialFailures: [], readText: true, refused: false };
    }
    if (tool.name === "read_card") {
      const reads = trackedCardReads({ cards: seams.cards });
      const { walk, ...ran } = await runReadCard({ args, seams: { ...seams, cards: reads.cards } });
      const nowIso = new Date().toISOString();
      seams.cardWalk.write({ walk: walkResolved({ cardKey: walk?.cardKey, nowIso, walk: seams.cardWalk.read() }) });
      return { ...withCardsUnread({ capBytes: TOOL_OUTPUT_MAX, ran, unreadSeen: reads.unreadSeen }), image: undefined };
    }
    if (tool.name === "open_card") {
      // A card other than the triage card puts the pass aside: its time-up line would land on what the owner is now
      // reading. The pass itself stands; the next triage_next starts the next clock.
      const triageCard = seams.triage.read()?.current?.key;
      if (triageCard !== undefined && args["key"] !== triageCard) {
        seams.triage.stopClock();
      }
      // The card the owner has open is read BEFORE the console moves: moving on from it takes it off their Queue.
      const before = walkBefore({ walk: seams.cardWalk });
      // Every source unread at any card read the tool takes is named beside a card it found.
      const reads = trackedCardReads({ cards: seams.cards });
      const { walk, ...ran } = await runOpenCard({ args, seams: { ...seams, cards: reads.cards } });
      const comeBack = args["come_back_to_previous"];
      stepCardWalk({
        before,
        comeBack,
        nowIso: new Date().toISOString(),
        ran: { walk },
        requestId,
        walk: seams.cardWalk,
      });
      return { ...withCardsUnread({ capBytes: TOOL_OUTPUT_MAX, ran, unreadSeen: reads.unreadSeen }), image: undefined };
    }
    if (tool.name === "triage_next") {
      const minutes = ownerMinutesOf({ args, log: seams.gateLog() });
      if (minutes.kind === "refused") {
        return refusal({ detail: "a clock length the owner did not name", why: minutes.why });
      }
      const triageAsked = (): boolean => heardTriageAsked({ log: seams.gateLog() });
      // The next card in a pass is moving on exactly as `open_card` is: the walk steps the same way.
      const before = walkBefore({ walk: seams.cardWalk });
      const { walk, ...ran } = await runTriageNext({ minutes: minutes.minutes, seams: { ...seams, triageAsked } });
      const nowIso = new Date().toISOString();
      stepCardWalk({ before, comeBack: undefined, nowIso, ran: { walk }, requestId, walk: seams.cardWalk });
      return { ...ran, image: undefined };
    }
    if (tool.name === "triage_end") {
      return { ...runTriageEnd({ seams }), image: undefined };
    }
    if (tool.name === "triage_clock") {
      const state = args["state"];
      if (state !== "paused" && state !== "running") {
        return refusal({ detail: "not a clock state", why: "state must be paused or running" });
      }
      const minutes = ownerMinutesOf({ args, log: seams.gateLog() });
      if (minutes.kind === "refused") {
        return refusal({ detail: "a clock length the owner did not name", why: minutes.why });
      }
      if (state === "paused" && minutes.minutes !== undefined) {
        return refusal({ detail: "a length on a pause", why: "minutes goes only with state running" });
      }
      return { ...runTriageClock({ minutes: minutes.minutes, seams, state }), image: undefined };
    }
    if (tool.name === "read_page") {
      const now = await resolvedPageView({ readBriefing: seams.readBriefing, view: seams.view() });
      // A read on past a cut names the window it continues, and is refused once the page has moved (`pageReadWindow.ts`).
      // Any of its three fields makes the call a read on, so one missing `from` is refused rather than read afresh: a
      // fresh read under an old window's `reading` would close that window's cut.
      const readsOn = ["path", "reading", "from"].some((key) => args[key] !== undefined);
      if (readsOn) {
        const on = pageReadOn({ args, maxBytes: PAGE_READ_MAX_BYTES, view: now });
        if ("refused" in on) {
          return refusal({ detail: "read on refused", why: on.refused });
        }
        const detail = `${now.title}, bytes ${String(on.start)} on of ${String(on.size)}`;
        return { answer: on, detail, image: undefined, partialFailures: [], readText: true, refused: false };
      }
      const answer = pageRead({ maxBytes: PAGE_READ_MAX_BYTES, view: now });
      const detail = `${now.title}${now.open === undefined ? "" : `, ${now.open} open`}`;
      return { answer, detail, image: undefined, partialFailures: [], readText: true, refused: false };
    }
    if (tool.name === "read_screen") {
      const shot = await seams.screenShot();
      return {
        answer: shot.answer,
        detail: shot.detail,
        image: shot.output,
        partialFailures: [],
        readText: true,
        refused: shot.output === undefined,
      };
    }
    if (tool.name === "focus_screen") {
      const ran = await seams.screenFocus({ args });
      // Counted as no read: the answer is the page's and the desktop app's own words, with no third-party text.
      return { ...ran, image: undefined, partialFailures: [], readText: false };
    }
    if (tool.name === "offer_copy") {
      const ran = await seams.offerCopy({ args, requestId });
      // Counted as no read: the message is the model's own words, already in the conversation, and the answer is the
      // page's fixed words about where it went — never the list's other items, which only `running_list` reads.
      return { ...ran, image: undefined, partialFailures: [], readText: false };
    }
    if (tool.name === "set_stage_setting") {
      const change = stageSettingChangeOf({ args });
      if (change === undefined) {
        return refusal({
          detail: "not a stage setting",
          why: `setting must be one of ${STAGE_TOGGLE_ORDER.join(", ")}, and state on or off`,
        });
      }
      // A complaint about the card in hand skips that card; only the owner's own general ask turns the switch off.
      if (change.setting === "openCards" && change.state === "off" && !heardOpenCardsOff({ log: seams.gateLog() })) {
        return refusal({
          detail: "openCards off refused: the owner's words named one card",
          why: OPEN_CARDS_OFF_REFUSAL,
        });
      }
      seams.stageSetting(change);
      const answer = { applies: "now", setting: change.setting, state: change.state };
      // Counted as no read: the answer is the page's own acknowledgement, with no third-party text in it.
      return {
        answer:
          change.setting === "openCards" ? { ...answer, note: openCardsSettingNote({ state: change.state }) } : answer,
        detail: `${change.setting} ${change.state}`,
        image: undefined,
        partialFailures: [],
        readText: false,
        refused: false,
      };
    }
    // Counted as no read, all three: the answer is the page's own acknowledgement, with no third-party text in it.
    if (tool.name === "focus_set") {
      return { ...runFocusSet({ args, seams: seams.focus }), image: undefined, partialFailures: [], readText: false };
    }
    if (tool.name === "focus_end") {
      return { ...runFocusEnd({ seams: seams.focus }), image: undefined, partialFailures: [], readText: false };
    }
    if (tool.name === "focus_quiet") {
      return { ...runFocusQuiet({ seams: seams.focus }), image: undefined, partialFailures: [], readText: false };
    }
    // No read either: the titles it answers with came off a calendar read the model already made.
    if (tool.name === "meeting_skip") {
      const ran = runMeetingSkip({ args, seams: seams.meetingSkip });
      return { ...ran, image: undefined, partialFailures: [], readText: false };
    }
    // Counted as reads, all three: start hands the model the draft's words, and a write's refusal carries the verb's.
    if (tool.name === "draft_edit_start") {
      return {
        ...runDraftEditStart({ args, seams: seams.draftEdit }),
        image: undefined,
        partialFailures: [],
        readText: true,
      };
    }
    if (tool.name === "draft_edit" || tool.name === "draft_restore") {
      const mode = tool.name === "draft_edit" ? "revise" : "restore";
      const ran = await runDraftWrite({ args, mode, seams: seams.draftEdit });
      return { ...ran, image: undefined, partialFailures: [], readText: true };
    }
    if (tool.does === "relay") {
      return runRelayTool({ answerId, args, refusal, seams });
    }
    if (tool.where === "verb") {
      const ran = await seams.verb({ args, name });
      if (tool.name === "file_read" && !ran.refused) {
        // A picture is handed over as one, never as base64 text the model cannot see.
        // Counted as a read like any file: pixels are third-party content too.
        const picture = fileImageOf({ payload: ran.answer });
        if (picture.kind === "refused") {
          return { ...refusal({ detail: picture.why, why: picture.why }), readText: true };
        }
        if (picture.kind === "image") {
          const shot = await seams.fileImage({ image: picture.image });
          return {
            answer: shot.answer,
            detail: shot.detail,
            image: shot.output,
            partialFailures: [],
            readText: true,
            refused: shot.output === undefined,
          };
        }
      }
      // Counted refused or not: a refusal can carry the verb's own stderr, and the gate does not judge text. The
      // route's own argument refusal (a missing path) is counted too — the page cannot tell it from the verb's
      // output, and over-counting only shuts a relay made with nothing new said by the owner.
      return { ...ran, image: undefined, partialFailures: [], readText: true };
    }
    return refusal({ detail: `no tool named ${name}`, why: `no tool named ${name}` });
  } catch (cause) {
    // A tool that rejects — a frame the encoder refused, a verb route that fell over — is still answered: the
    // model hears why, instead of waiting on a call that never returns.
    // Its message is text the page did not write — a route's or a verb's — so the gate counts it as a read.
    const why = setupFailureOf({ cause });
    return { ...refusal({ detail: why, why: `${name} failed: ${why}` }), readText: true };
  }
}
