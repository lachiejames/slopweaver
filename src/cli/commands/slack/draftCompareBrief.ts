/**
 * The brief a comparison pass is handed over a parked original (`./draftCompareRun.ts`), and the check that none of
 * its lines A's session wrote or chose quotes A. Split from the run so what the pass may see is read in one place.
 * Pure.
 */
import { purposeQuotesDraft } from "../../../codex/draftQuote.js";
import type { SlackDraftBrief } from "../../../codex/slackDraft.js";
import { briefHeadingLines, draftConversationLines } from "../../../codex/slackDraft.js";
import type { ParkedPriorAsk, ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import type { VoiceRuleBrief } from "../../../outbound/voice/briefStore.js";
import { voiceRuleBriefLines } from "../../../outbound/voice/composerBrief.js";

/**
 * The brief a pass is handed: where the original goes, what it is for, the conversation and their voice brief — never
 * the original's words.
 *
 * @param draft the parked original
 * @param rows the conversation rows the recording read, raw
 * @param voice their voice brief
 * @returns the brief
 */
export function draftBrief({
  draft,
  rows,
  voice,
}: {
  draft: ParkedSlackDraft;
  rows: readonly unknown[];
  voice: VoiceRuleBrief;
}): SlackDraftBrief {
  return {
    act: draft.act,
    channel: draft.channel,
    channelName: draft.channelName,
    conversation: draftConversationLines({ rows }),
    priorAsk: priorAskLine({ priorAsk: draft.priorAsk }),
    selfUserId: draft.authorId,
    threadTs: draft.threadTs,
    voiceBrief: voiceRuleBriefLines(voice),
    why: draft.why,
  };
}

/**
 * Whether a prompt line A's session wrote or chose quotes A: every line of the prompt's "Where it goes" section, built
 * by the same function the prompt uses. That is its destination, its act, its purpose and its re-ask declaration, whose
 * earlier message, change and not-answered reason the session picked too, eighth, fifteenth, twenty-ninth and
 * thirtieth passes).
 *
 * @param draft the parked row's words, destination, act, purpose and re-ask declaration
 * @returns true when a pass handed those lines would see the original's words
 */
export function authoredQuotesDraft({
  draft,
}: {
  draft: Pick<ParkedSlackDraft, "act" | "channel" | "channelName" | "payload" | "priorAsk" | "threadTs" | "why">;
}): boolean {
  const { payload } = draft;
  if (!("text" in payload)) {
    return false;
  }
  const lines = briefHeadingLines({
    brief: {
      act: draft.act,
      channel: draft.channel,
      channelName: draft.channelName,
      priorAsk: priorAskLine({ priorAsk: draft.priorAsk }),
      threadTs: draft.threadTs,
      why: draft.why,
    },
  });
  return lines.some((purpose) => purposeQuotesDraft({ purpose, words: payload.text }));
}

/** The re-ask declaration, as one line of the prompt. */
function priorAskLine({ priorAsk }: { priorAsk: ParkedPriorAsk | undefined }): string | undefined {
  if (priorAsk === undefined) {
    return undefined;
  }
  if (priorAsk.kind === "none") {
    return "no — the recording session declared this has not been asked before.";
  }
  const answers = priorAsk.answers.map((answer) => `"${answer.text}"`);
  const replies = answers.length === 0 ? "nobody replied" : `they replied ${answers.join("; ")}`;
  const changed = priorAsk.changed === undefined ? "" : ` What changed since: ${priorAsk.changed}`;
  const unanswered = priorAsk.notAnswered === undefined ? "" : ` Why that was no answer: ${priorAsk.notAnswered}`;
  return `yes, at ${priorAsk.permalink}: "${priorAsk.ours.text}" — ${replies}.${changed}${unanswered}`;
}
