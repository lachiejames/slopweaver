/**
 * One once-only fixed sentence the plan call has the voice SPEAK unasked — a meeting starting (`PlanCall.announceMeeting`),
 * a drift from what the owner said they would do, a stray off ISO in work hours, or a steered deliverable at risk
 * (`./talkPlanWindowNotices.ts`) — in the order
 * each needs: already said, then the floor, then claimed BEFORE the write,
 * since one that timed out may still have been spoken and none is ever said twice, then its herald chime and the lead
 * before the voice speaks (`./talkPlanAnnounce.ts`). Its own file so `./talkPlanCall.ts`
 * stays under the line cap; the call keeps the flags and the ledgers.
 */
import type { AnnounceCue } from "./announceCue";
import type { DriftNotice } from "./driftNotice";
import type { IsoNudgeNotice } from "./isoNudgeNotice";
import { type MeetingNotice, meetingStarted } from "./meetingDue";
import type { MeetingLedger } from "./meetingLedger";
import type { SteerRiskNotice } from "./steerRiskNotice";
import { driftClaimId, isoNudgeClaimId, steerRiskClaimId, type TalkNoticeLedger } from "./talkNoticeLedger";
import { fateOf, type RpcOutcome } from "./talkPlanProtocol";
import { driftSpeech, isoNudgeSpeech, meetingSpeech, steerRiskSpeech } from "./talkPlanWords";

/**
 * One scripted line's own half: its claim in the ledger, whether it was claimed already, its words, and why it is said,
 * which the call's provenance keeps (`./talkVoiceProvenance.ts`).
 */
interface ScriptedLine {
  readonly claim: () => void;
  readonly claimed: boolean;
  /** The chime rung just before it (`./announceCue.ts`). */
  readonly herald: AnnounceCue;
  readonly text: string;
  readonly what: string;
  readonly why: string;
}

/**
 * A meeting's line: claimed by its notice in the meetings ledger, worded by whether it has started.
 *
 * @param notice the meeting, as the server read it
 * @param nowMs the instant judged at
 * @param meetings the ledger shared by every call of this server
 * @returns the line, and whether the meeting has started — from then on the line cuts in
 */
export function meetingLine({
  notice,
  nowMs,
  meetings,
}: {
  notice: MeetingNotice;
  nowMs: number;
  meetings: MeetingLedger;
}): ScriptedLine & { readonly started: boolean } {
  const started = meetingStarted({ notice, nowMs });
  return {
    claim: () => {
      meetings.claim({ notice, nowMs });
    },
    claimed: meetings.has({ noticeId: notice.noticeId }),
    herald: "reminder",
    started,
    text: meetingSpeech({ started, title: notice.title }),
    what: "the meeting line",
    why: started
      ? "a meeting on the owner's calendar started while they were on this call"
      : "a meeting on the owner's calendar is about to start",
  };
}

/**
 * A drift's line: claimed under its drift claim id in the window-notice ledger, naming the owner's plan and the application.
 *
 * @param notice the drift, bounded by the route
 * @param notices the ledger shared by every call of this server
 * @returns the line
 */
export function driftLine({ notice, notices }: { notice: DriftNotice; notices: TalkNoticeLedger }): ScriptedLine {
  const claimId = driftClaimId({ noticeId: notice.noticeId });
  return {
    claim: () => {
      notices.claim({ claimId });
    },
    claimed: notices.has({ claimId }),
    herald: "focus",
    text: driftSpeech({ app: notice.app, minutes: notice.minutes, plan: notice.plan }),
    what: "the drift line",
    why: "the page saw the owner's front window stay on an application their stated plan does not name, which they asked to hear about",
  };
}

/**
 * An ISO nudge's line: claimed under its ISO claim id in the window-notice ledger, naming the one card waiting. One
 * under an hour after the last nudge this server claimed reads as claimed already, whatever its id, so the page counts
 * it told and the hour holds even for a page that lost its watch.
 *
 * @param notice the nudge, bounded by the route
 * @param notices the ledger shared by every call of this server
 * @param nowMs the instant it would be claimed at
 * @returns the line
 */
export function isoNudgeLine({
  notice,
  notices,
  nowMs,
}: {
  notice: IsoNudgeNotice;
  notices: TalkNoticeLedger;
  nowMs: number;
}): ScriptedLine {
  const claimId = isoNudgeClaimId({ noticeId: notice.noticeId });
  return {
    claim: () => {
      notices.claim({ claimId });
      notices.isoNudgeClaimedAt({ nowMs });
    },
    claimed: notices.has({ claimId }) || notices.isoNudgeTooSoon({ nowMs }),
    herald: "focus",
    text: isoNudgeSpeech({ again: notice.again, item: notice.item.subject, minutes: notice.minutes }),
    what: "the ISO nudge",
    why: "the page saw the owner off ISO work in work hours while an ISO card waits on them, which they asked to hear about",
  };
}

/**
 * A steer-risk line: claimed under the note's step id in the window-notice ledger, saying the note's own words unless
 * they could be heard as the deliverable done ({@link steerRiskSpeech}).
 *
 * @param notice the steer note, as the server read it
 * @param notices the ledger shared by every call of this server
 * @returns the line
 */
export function steerRiskLine({
  notice,
  notices,
}: {
  notice: SteerRiskNotice;
  notices: TalkNoticeLedger;
}): ScriptedLine {
  const claimId = steerRiskClaimId({ stepId: notice.stepId });
  return {
    claim: () => {
      notices.claim({ claimId });
    },
    claimed: notices.has({ claimId }),
    herald: "attention",
    text: steerRiskSpeech({ what: notice.what, why: notice.why }),
    what: "the steer-risk line",
    why: "a deliverable the owner explicitly steered is at risk, which they ruled reaches them by voice the minute it is known",
  };
}

/** How one scripted line landed: said now, claimed already, refused before anything was written, or failed. */
export type ScriptedLineOutcome =
  | { readonly kind: "said" }
  | { readonly kind: "already" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Say one scripted line once.
 *
 * @param claimed whether any call of this server already claimed it
 * @param refusal why the floor will not take it now, `undefined` when it will
 * @param claim records the claim in the ledger shared by every call of this server
 * @param herald the chime the page rings just before it
 * @param text the sentence `thread/realtime/appendSpeech` speaks
 * @param what the line, as a failure names it ("the meeting line")
 * @param why what set it off, which the call's provenance keeps beside the sentence
 * @param setBusy holds the call's flag for this kind of line while the write is in flight, so the floor refuses others
 * @param ring tells the page to ring the herald and waits out its lead (`./talkPlanAnnounce.ts`)
 * @param speak writes the sentence into the session
 * @param onSaid what the call does once the session took it
 * @returns how it landed
 */
export async function sayScriptedLine({
  claimed,
  refusal,
  claim,
  herald,
  text,
  what,
  why,
  setBusy,
  ring,
  speak,
  onSaid,
}: {
  claimed: boolean;
  refusal: string | undefined;
  claim: () => void;
  herald: AnnounceCue;
  text: string;
  what: string;
  why: string;
  setBusy: (input: { readonly busy: boolean }) => void;
  ring: (input: { readonly cue: AnnounceCue }) => Promise<void>;
  speak: (input: { readonly text: string; readonly why: string }) => Promise<RpcOutcome>;
  onSaid: () => void;
}): Promise<ScriptedLineOutcome> {
  if (claimed) {
    return { kind: "already" };
  }
  if (refusal !== undefined) {
    return { kind: "refused", reason: refusal };
  }
  setBusy({ busy: true });
  claim();
  try {
    await ring({ cue: herald });
    const spoke = await speak({ text, why });
    if (spoke.kind !== "result") {
      return { kind: "failed", reason: `the voice did not say ${what}: ${fateOf({ outcome: spoke })}` };
    }
    onSaid();
    return { kind: "said" };
  } finally {
    setBusy({ busy: false });
  }
}
