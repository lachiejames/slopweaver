/**
 * The browser half of a console call's link: the peer and network listeners a live call's {@link LinkWatch} reads, the
 * `online` listener that makes a waiting reconnect attempt the moment the network is back, and the quiet connecting cue
 * that repeats while the call is lost or coming back. A dropped call must be known quickly, and the connecting sound
 * repeats until the call succeeds.
 *
 * The decisions are `site/lib/callLink.ts`'s, `site/lib/callReconnect.ts`'s and `site/lib/callDropCue.ts`'s, each
 * tested there; this file only binds them to `window` and the peer connection, for `VoiceProvider.tsx`.
 */
import { useEffect, useState } from "react";

import {
  type CallDropCue,
  CONNECTING_CUE_EVERY_MS,
  CONNECTING_CUE_FIRST_MS,
  playCallBackCue,
  playCallConnectingCue,
} from "../../lib/callDropCue";
import { type LinkSchedule, LinkWatch } from "../../lib/callLink";
import { LINK_LOST_WORDS, NETWORK_WAIT_WORDS, ReconnectWait, reconnectStepWords } from "../../lib/callReconnect";
import type { VoiceLink } from "../../lib/voiceActivity";

/**
 * A {@link LinkSchedule} on the page's own clock.
 *
 * @returns what cancels the timer
 */
export const windowSchedule: LinkSchedule = ({ ms, run }) => {
  const timer = window.setTimeout(run, ms);
  return () => {
    window.clearTimeout(timer);
  };
};

/**
 * Watch a live call's link: lost, the drop cue plays and the orb reads reconnecting with "connection lost" at once
 * while the call is held; back inside the heal window, the back cue plays and the call carries on; still lost at its
 * end, the call ends as a drop and the reconnect takes over.
 *
 * @param peer the live call's peer connection
 * @param current whether the call is still the running one — every reading is checked against it
 * @param dropCue the page's drop cue, told of the loss and of the heal
 * @param show what the orb shows: its line, and the call's link
 * @param end the call's stop, given why the link was lost when the heal window ends
 * @returns what stops the watch — its window and every listener
 */
export function watchCallLink({
  peer,
  current,
  dropCue,
  show,
  end,
}: {
  peer: RTCPeerConnection;
  current: () => boolean;
  dropCue: CallDropCue;
  show: (shown: { step: string | undefined; link: VoiceLink }) => void;
  end: (ending: { why: string }) => void;
}): () => void {
  const watch = new LinkWatch({
    onExpired: ({ why }) => {
      if (current()) {
        end({ why });
      }
    },
    onHealed: () => {
      if (current()) {
        dropCue.healed();
        show({ link: "live", step: undefined });
        playCallBackCue();
      }
    },
    onLost: () => {
      if (current()) {
        dropCue.lost();
        show({ link: "reconnecting", step: LINK_LOST_WORDS });
      }
    },
    schedule: windowSchedule,
  });
  const read = (): void => {
    watch.read({ online: navigator.onLine, peerState: peer.connectionState });
  };
  peer.addEventListener("connectionstatechange", read);
  window.addEventListener("offline", read);
  window.addEventListener("online", read);
  // A link already lost by the time the call went live is lost now.
  read();
  return () => {
    watch.dispose();
    peer.removeEventListener("connectionstatechange", read);
    window.removeEventListener("offline", read);
    window.removeEventListener("online", read);
  };
}

/**
 * The page's reconnect wait, made once: an attempt falling due names itself on the orb and re-opens the call; one
 * parked offline says it is waiting for the network.
 *
 * @param reopen what makes an attempt — the provider's own reconnecting start, read when the attempt falls due
 * @param setStep the orb's line
 * @returns the wait, on the page's clock and the browser's network
 */
export function useReconnectWait({
  reopen,
  setStep,
}: {
  reopen: { readonly current: () => void };
  setStep: (step: string | undefined) => void;
}): ReconnectWait {
  const [wait] = useState(
    () =>
      new ReconnectWait({
        attempt: ({ attempt }) => {
          setStep(reconnectStepWords({ attempt }));
          reopen.current();
        },
        online: () => navigator.onLine,
        parked: () => {
          setStep(NETWORK_WAIT_WORDS);
        },
        schedule: windowSchedule,
      }),
  );
  return wait;
}

/**
 * Make a waiting reconnect attempt the moment the browser's network is back.
 *
 * @param wait the page's reconnect wait
 */
export function useNetworkBack({ wait }: { wait: ReconnectWait }): void {
  useEffect(() => {
    const back = (): void => {
      wait.networkBack();
    };
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("online", back);
    };
  }, [wait]);
}

/**
 * Repeat the quiet connecting cue while the call is lost or coming back, the first once the drop cue has finished,
 * until it is live again or the owner ends it.
 *
 * @param link where the call's connection is
 */
export function useConnectingCue({ link }: { link: VoiceLink }): void {
  useEffect(() => {
    if (link !== "reconnecting") {
      return undefined;
    }
    let timer = 0;
    const tick = (): void => {
      playCallConnectingCue();
      timer = window.setTimeout(tick, CONNECTING_CUE_EVERY_MS);
    };
    timer = window.setTimeout(tick, CONNECTING_CUE_FIRST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [link]);
}
