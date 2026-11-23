/**
 * The plan call's two window notices and its steer-risk cut-in — the unasked lines the page's front-window sampler owes
 * (`../components/voice/useFrontWindowNotices.ts`) — said on a clear floor, once per notice across every call of this
 * server, and never both at once, since they share one busy flag. Whether a relay reached the supervisor's chat is
 * never one: the voice does not talk about whether something reached the
 * supervisor chat.
 *
 * - {@link WindowNoticeLines.announceDrift}: an application the owner did not plan for has held the front of their screen past
 *   the dwell, so the voice says one `driftSpeech` line naming their plan and that application (the plan said one
 *   thing and the screen shows another). The page's watch decides it
 *   (`./driftWatch.ts`) and posts only the bounded notice (`./driftNotice.ts`): no window title reaches this server.
 * - {@link WindowNoticeLines.announceIsoNudge}: in work hours the owner has been off ISO for a stretch while an ISO card waits on
 *   them, so the voice says one `isoNudgeSpeech` line naming that card, an observation and never an instruction (a
 *   reminder that the ISO card still has things waiting). The page's watch decides it (`./isoStrayWatch.ts`) and posts only the bounded notice (`./isoNudgeNotice.ts`).
 *
 * Each is a nudge, never a cut-in, so the page posts again while it is owed.
 *
 * One line here IS a cut-in: {@link WindowNoticeLines.announceSteerRisk}, a deliverable the owner explicitly steered now at
 * risk, said the minute its note is up: a steered deliverable at risk gets a floating note
 * AND a voice cut-in the minute it is known. It takes the floor a started meeting takes (`ownWriteRefusal`): neither
 * the owner's words, the voice's, a tool call nor a running turn holds it, only the call ending or another of this server's own
 * writes still being sent. The note is the server's own read (`talk steer-risk`); the page only paces the asks
 * (`./steerRiskWatch.ts`). It shares the one busy flag, so it never overlaps a drift line or a nudge.
 *
 * Its own file so `./talkPlanCall.ts` stays under the line cap; the call hands in its floor and its one way of saying a
 * scripted line.
 */
import type { DriftNotice } from "./driftNotice";
import type { IsoNudgeNotice } from "./isoNudgeNotice";
import type { PlanDriftOutcome, PlanIsoNudgeOutcome } from "./planCallContract";
import type { SteerRiskNotice } from "./steerRiskNotice";
import type { TalkNoticeLedger } from "./talkNoticeLedger";
import { floorRefusal, ownWriteRefusal, type PlanFloor } from "./talkPlanFloor";
import {
  driftLine,
  isoNudgeLine,
  type ScriptedLineOutcome,
  type sayScriptedLine,
  steerRiskLine,
} from "./talkPlanNotices";

/** One scripted line as the call says it: everything {@link sayScriptedLine} takes but the session write. */
type CallLine = Omit<Parameters<typeof sayScriptedLine>[0], "speak" | "onSaid" | "ring">;

/** The window notices of one plan call. */
export class WindowNoticeLines {
  private sending = false;
  private readonly notices: TalkNoticeLedger;
  private readonly floor: () => PlanFloor;
  private readonly sayLine: (line: CallLine) => Promise<ScriptedLineOutcome>;
  private readonly nowMs: () => number;

  /**
   * @param notices the ledger shared by every call of this server, so none is said twice across a rollover
   * @param floor the call's floor at the moment it is read
   * @param sayLine the call's own once-only line writer
   * @param nowMs the call's clock, which the hour between ISO nudges is held by
   */
  constructor({
    notices,
    floor,
    sayLine,
    nowMs,
  }: {
    notices: TalkNoticeLedger;
    floor: () => PlanFloor;
    sayLine: (line: CallLine) => Promise<ScriptedLineOutcome>;
    nowMs: () => number;
  }) {
    this.notices = notices;
    this.floor = floor;
    this.sayLine = sayLine;
    this.nowMs = nowMs;
  }

  /**
   * Whether a drift line's or an ISO nudge's request is unanswered: the floor's `announcingWindowNotice`.
   *
   * @returns true while one is being sent
   */
  get busy(): boolean {
    return this.sending;
  }

  /**
   * Say one drift line.
   *
   * @param notice the drift, bounded by the route
   * @returns whether the line was said, had been already, or why not
   */
  async announceDrift({ notice }: { notice: DriftNotice }): Promise<PlanDriftOutcome> {
    return this.say({ line: driftLine({ notice, notices: this.notices }) });
  }

  /**
   * Say one ISO nudge.
   *
   * @param notice the nudge, bounded by the route
   * @returns whether the line was said, had been already, or why not
   */
  async announceIsoNudge({ notice }: { notice: IsoNudgeNotice }): Promise<PlanIsoNudgeOutcome> {
    return this.say({ line: isoNudgeLine({ notice, notices: this.notices, nowMs: this.nowMs() }) });
  }

  /**
   * Cut in with one steer-risk line, while the owner talks if need be.
   *
   * @param notice the steer note, as the server read it
   * @returns whether the line was said, had been already, or why not
   */
  async announceSteerRisk({ notice }: { notice: SteerRiskNotice }): Promise<ScriptedLineOutcome> {
    const line = steerRiskLine({ notice, notices: this.notices });
    const refusal = ownWriteRefusal({ floor: this.floor() });
    return this.sayLine({ ...line, refusal, setBusy: ({ busy }) => void (this.sending = busy) });
  }

  /**
   * One window-notice line on a clear floor, waiting out a send outcome being handed over too.
   *
   * @returns how it landed
   */
  private async say({ line }: { line: ReturnType<typeof driftLine> }): Promise<ScriptedLineOutcome> {
    const floor = this.floor();
    const own = [[floor.announcing, "a send outcome or another own line is being handed over"]] as const;
    const refusal = floorRefusal({ floor, openUtterance: "hold", own, runningTurn: "hold" });
    return this.sayLine({ ...line, refusal, setBusy: ({ busy }) => void (this.sending = busy) });
  }
}
