/**
 * The notices the page posts into a plan call — a meeting about to start, a drift off the plan, an ISO nudge —
 * as the `PlanCall` test files beside this one hand them in. Kept apart from `harness.ts`, which drives the call
 * itself: these are inputs, never machinery.
 */

import type { DriftNotice } from "../../../lib/driftNotice";
import type { IsoNudgeNotice } from "../../../lib/isoNudgeNotice";
import type { MeetingNotice } from "../../../lib/meetingDue";
import { driftSpeech } from "../../../lib/talkPlanWords";

/** A meeting starting at the instant the tests judge against. */
export const RETRO: MeetingNotice = {
  briefingSlug: null,
  calendarId: "primary",
  endIso: "2026-10-09T05:00:00.000Z",
  eventId: "evtfixture01_20261009T043000Z",
  joinUrl: "https://meet.google.com/aaa-bbbb-ccc",
  noticeId: "evtfixture01@google.com@2026-10-09T04:30:00.000Z",
  startIso: "2026-10-09T04:30:00.000Z",
  title: "Fixture team retro",
};

/** A minute before {@link RETRO} starts, and a minute after. */
export const BEFORE_RETRO_MS = Date.parse(RETRO.startIso) - 60_000;

export const AFTER_RETRO_MS = Date.parse(RETRO.startIso) + 60_000;

/** A drift, as the page posts it once Slack has held the front of the owner's screen past the dwell. */
export const DRIFT: DriftNotice = {
  app: "Slack",
  minutes: 4,
  noticeId: "5f0c2a8e-1b3d-4c6e-9a7f-2d4b6e8f0a1c",
  plan: "do the ISO access review",
};

/**
 * The speech request a drift line writes, under its RPC id.
 *
 * @returns the request as written to the child
 */
export const driftSpeechRequest = ({ id }: { id: number }): Record<string, unknown> => ({
  id,
  method: "thread/realtime/appendSpeech",
  params: { text: driftSpeech({ app: DRIFT.app, minutes: DRIFT.minutes, plan: DRIFT.plan }), threadId: "thread-1" },
});

/** An ISO nudge, as the page posts it once the owner has been off ISO in work hours past the dwell. */
export const ISO_NUDGE: IsoNudgeNotice = {
  again: false,
  item: { key: "handover:six-vanta-evidence-documents", subject: "Six Vanta evidence documents need an update" },
  minutes: 12,
  noticeId: "9a1c3e5b-7d2f-4a6c-8e0b-1f3d5a7c9e2b",
};
