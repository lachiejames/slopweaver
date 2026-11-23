/**
 * The page's seams for a Slack send's watch (`../../lib/slackSendWatch.ts`): the read rides the `slack_send_outcome`
 * tool route, the announcement the held plan call's `send-outcome` route — which reads the outcome again itself, so
 * what the voice is told never rests on the page's read — and time the page's own timers. Its own file
 * so `VoiceProvider.tsx` and `planWiring.ts` stay under the line cap.
 */
import type { CheckSend } from "../../lib/relayAnswer";
import type { GateEntry } from "../../lib/relayGate";
import { type SendAnnounced, type SentSlackSendOutcome, watchSlackSend } from "../../lib/slackSendWatch";
import { type PlanPost, sendOutcomePlanCall } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import type { runVerbTool } from "./talkToolCalls";
import type { ToolLine } from "./voiceContext";

/**
 * What one `send-outcome` post means to the watch: taken is told, a 409 (the floor is taken) or a lost post is tried
 * again — the server delivers a notice once, so a retry after a lost answer is never said twice — and any other
 * refusal is final.
 *
 * @param posted what the route answered
 * @returns what the watch does next
 */
export function sendAnnouncedOf({ posted }: { posted: PlanPost }): SendAnnounced {
  if (posted.kind === "taken") {
    return { kind: "delivered" };
  }
  if (posted.kind === "lost" || posted.status === 409) {
    return { kind: "retry", why: posted.why };
  }
  return { kind: "dropped", why: posted.why };
}

/**
 * Hand one send that did not go to the voice.
 *
 * @param post the `send-outcome` round trip
 * @param gateLog the relay gate's record, which takes a delivered outcome as a read
 * @returns what the watch does next
 */
export async function announceOutcome({
  post,
  gateLog,
}: {
  post: () => Promise<PlanPost>;
  gateLog: { current: GateEntry[] };
}): Promise<SendAnnounced> {
  const told = sendAnnouncedOf({ posted: await post() });
  if (told.kind === "delivered") {
    gateLog.current.push({ kind: "read", tool: "slack_send_outcome" });
  }
  return told;
}

/** How often a pending wait checks the call it belongs to is still the page's. */
export const SEND_WATCH_LIVE_CHECK_MS = 1_000;

/**
 * Run `run` once `ms` has passed, checking every {@link SEND_WATCH_LIVE_CHECK_MS} that the call is still the page's
 * and clearing itself the first tick it is not — so no wait of the watch outlives its call by more than one tick, with
 * nothing on the page having to remember to cancel it.
 *
 * @param ms how long to wait
 * @param run what to run at the end of the wait
 * @param live whether the call the watch began on is still the page's
 * @param nowMs the clock
 * @param every starts a repeating tick, returning its cancel
 * @returns a function that cancels the wait
 */
export function afterWhileLive({
  ms,
  run,
  live,
  nowMs,
  every,
}: {
  ms: number;
  run: () => void;
  live: () => boolean;
  nowMs: () => number;
  every: (input: { ms: number; tick: () => void }) => () => void;
}): () => void {
  const started = nowMs();
  let cancel: () => void = () => undefined;
  cancel = every({
    ms: Math.min(ms, SEND_WATCH_LIVE_CHECK_MS),
    tick: () => {
      if (!live()) {
        cancel();
        return;
      }
      if (nowMs() - started >= ms) {
        cancel();
        run();
      }
    },
  });
  return cancel;
}

/**
 * The watch starter a relay's hand-off calls for a Slack send the owner asked for. The watch lives as long as the plan call it
 * began on is still the page's; a call with no plan call (GPT-Live) is told nothing unasked, and says so in its log.
 *
 * @param held the plan call the page holds now
 * @param current whether the session that relayed is still the live one
 * @param read one `slack_send_outcome` round trip — `runVerbTool`
 * @param gateLog the relay gate's record: an outcome told to the voice is a read, as every tool answer is
 * @param note writes a line in the call's log
 * @param onLanded told a send went, which is never said unasked, while its call is still the page's: what grounds a
 *   "sent" the voice says later (`./voiceRecordWiring.ts`)
 * @returns the starter
 */
export function sendWatcher({
  held,
  current,
  read,
  gateLog,
  note,
  onLanded,
}: {
  held: () => HeldPlanCall | undefined;
  current: () => boolean;
  read: typeof runVerbTool;
  gateLog: { current: GateEntry[] };
  note: (input: { line: ToolLine }) => void;
  onLanded: (input: { outcome: SentSlackSendOutcome }) => void;
}): (send: CheckSend) => void {
  const line = ({ detail, refused }: { detail: string; refused: boolean }): void => {
    if (current()) {
      note({ line: { detail, ms: undefined, name: "send-outcome", refused, usage: undefined } });
    }
  };
  return (send) => {
    const on = held();
    if (on === undefined) {
      line({ detail: "not watching the Slack send: this page holds no plan call", refused: true });
      return;
    }
    const live = (): boolean => current() && held() === on;
    watchSlackSend({
      seams: {
        after: ({ ms, run }) =>
          afterWhileLive({
            every: ({ ms: tickMs, tick }) => {
              const timer = setInterval(tick, tickMs);
              return () => {
                clearInterval(timer);
              };
            },
            live,
            ms,
            nowMs: () => Date.now(),
            run,
          }),
        // The server reads the outcome itself, so only which send is posted: the page's read only times the post.
        announce: () =>
          announceOutcome({
            gateLog,
            post: () => sendOutcomePlanCall({ callId: on.callId, send }),
          }),
        landed: ({ outcome }) => {
          if (live()) {
            onLanded({ outcome });
          }
        },
        live,
        note: line,
        read: async ({ url, since }) => {
          const ran = await read({ args: { since, url }, name: "slack_send_outcome" });
          return ran.refused ? undefined : ran.answer;
        },
      },
      send,
    });
  };
}
