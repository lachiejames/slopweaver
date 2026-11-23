/**
 * The page's {@link QuietRollover}, wired to `VoiceProvider`'s call refs: the console's 90-minute limit becomes a call
 * rolled over in a pause, which the owner never hears (`site/lib/callRollover.ts` says why, and what a failed one does). Its
 * own file so `VoiceProvider.tsx` stays under the line cap.
 */
import { type RefObject, useState } from "react";

import { type CallDropCue, playCallDropCue } from "../../lib/callDropCue";
import type { ReconnectChain } from "../../lib/callReconnect";
import { QuietRollover } from "../../lib/callRollover";
import type { ToolLine } from "./voiceContext";

/** What a rollover does to the page's call, set once `start` and `releaseCall` exist. */
export interface RollOn {
  /** Release the old call, writing `why` as its end — no cue, no reconnect, share and mute kept. */
  readonly release: (input: { readonly why: string }) => void;
  /** Open the successor, minted to wait silently. */
  readonly open: () => void;
}

/** What {@link RollOn} does until `VoiceProvider` points it at the call: nothing, since no call is up yet. */
export const ROLL_NOWHERE: RollOn = { open: () => undefined, release: () => undefined };

/**
 * Hold the page's rollover. A successor that fails becomes the first failed attempt of a reconnect for the call it
 * replaced — journalled onto that call by `callEndOutcome` — and the drop cue sounds, since the owner must not believe a call
 * that is not there is listening.
 *
 * @param chain the page's reconnect in progress, started here when a successor fails
 * @param dropCue the page's drop cue, told the old call ended without a drop
 * @param rollOn what releases the old call and opens its successor, pointed at `releaseCall` and `start` once they exist
 * @param journal writes a line onto the call file the page holds now, as a `rollover` tool line
 * @returns the rollover
 */
export function useQuietRollover({
  chain,
  dropCue,
  rollOn,
  journal,
}: {
  chain: { current: ReconnectChain | undefined };
  dropCue: RefObject<CallDropCue>;
  rollOn: { readonly current: RollOn };
  journal: (input: { line: ToolLine }) => void;
}): QuietRollover {
  const [rollover] = useState(
    () =>
      new QuietRollover({
        seams: {
          dropped: ({ previousCallId }) => {
            chain.current = { droppedCallId: previousCallId, failed: 0, liveAtMs: undefined };
            playCallDropCue();
          },
          journal: ({ detail }) => {
            journal({ line: { detail, ms: undefined, name: "rollover", refused: false, usage: undefined } });
          },
          now: () => performance.now(),
          open: () => {
            rollOn.current.open();
          },
          release: (input) => {
            rollOn.current.release(input);
          },
          silence: () => {
            dropCue.current.ended({ ownerEnding: true, why: undefined });
          },
        },
      }),
  );
  return rollover;
}
