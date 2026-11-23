/*
 * A live call's link is read lost the moment the peer goes disconnected or the browser goes offline, announced at once,
 * and held for a heal window before the call is ended as a drop, so the owner learns quickly that the voice has dropped
 * rather than wondering whether it is just slow to respond. A link that is connected and online is never lost, however long the call has gone quiet.
 */
import { describe, expect, it } from "vitest";

import { LINK_HEAL_MS, LinkWatch, linkLostWhy, type PeerState } from "../../lib/callLink";

const OFFLINE = "this machine went offline; the network dropped";
const PATH = "the audio link to OpenAI stopped answering; the network path dropped";

/**
 * A watch over a recording of what it said, and a schedule that holds its one timer for the test to fire.
 *
 * @returns the watch, what it said in order, and the pending timer's wait and run, if one is pending
 */
function recorded(): {
  watch: LinkWatch;
  said: string[];
  pending: { timer: { ms: number; run: () => void } | undefined };
} {
  const said: string[] = [];
  const pending: { timer: { ms: number; run: () => void } | undefined } = { timer: undefined };
  const watch = new LinkWatch({
    onExpired: ({ why }) => {
      said.push(`expired: ${why}`);
    },
    onHealed: () => {
      said.push("healed");
    },
    onLost: ({ why }) => {
      said.push(`lost: ${why}`);
    },
    schedule: (timer) => {
      pending.timer = timer;
      return () => {
        pending.timer = undefined;
      };
    },
  });
  return { pending, said, watch };
}

describe("linkLostWhy", () => {
  it("is lost when the browser is offline, whatever the peer says", () => {
    expect(linkLostWhy({ online: false, peerState: "connected" })).toBe(OFFLINE);
  });

  it("is lost when the peer is disconnected or failed", () => {
    const states: readonly PeerState[] = ["disconnected", "failed"];
    expect(states.map((peerState) => linkLostWhy({ online: true, peerState }))).toEqual([PATH, PATH]);
  });

  // `closed` is the SDK's own end of the call, which `connectionStopWhy` already reports.
  it("holds while the peer is connected, connecting, new or closed and the browser is online", () => {
    const states: readonly PeerState[] = ["connected", "connecting", "new", "closed"];
    expect(states.map((peerState) => linkLostWhy({ online: true, peerState }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("LinkWatch", () => {
  it("says nothing across a long quiet call whose link holds — a slow reply is never a drop", () => {
    const { watch, said, pending } = recorded();
    for (let reading = 0; reading < 200; reading += 1) {
      watch.read({ online: true, peerState: "connected" });
    }
    expect(said).toEqual([]);
    expect(pending.timer).toBe(undefined);
  });

  it("says a loss once, at once, and starts the heal window", () => {
    const { watch, said, pending } = recorded();
    watch.read({ online: true, peerState: "disconnected" });
    watch.read({ online: false, peerState: "disconnected" });
    expect(said).toEqual([`lost: ${PATH}`]);
    expect(pending.timer!.ms).toBe(LINK_HEAL_MS);
  });

  it("says the link is back inside the window and forgets it, so nothing expires", () => {
    const { watch, said, pending } = recorded();
    watch.read({ online: false, peerState: "connected" });
    watch.read({ online: true, peerState: "connected" });
    expect(said).toEqual([`lost: ${OFFLINE}`, "healed"]);
    expect(pending.timer).toBe(undefined);
  });

  it("hands the loss over once when the window ends, and reads nothing after", () => {
    const { watch, said, pending } = recorded();
    watch.read({ online: true, peerState: "disconnected" });
    pending.timer!.run();
    watch.read({ online: true, peerState: "connected" });
    watch.read({ online: false, peerState: "failed" });
    expect(said).toEqual([`lost: ${PATH}`, `expired: ${PATH}`]);
  });

  it("says a second loss after a heal, with a fresh window", () => {
    const { watch, said, pending } = recorded();
    watch.read({ online: true, peerState: "disconnected" });
    watch.read({ online: true, peerState: "connected" });
    watch.read({ online: false, peerState: "connected" });
    expect(said).toEqual([`lost: ${PATH}`, "healed", `lost: ${OFFLINE}`]);
    expect(pending.timer!.ms).toBe(LINK_HEAL_MS);
  });

  it("is silent once disposed: the call ended, so its window and every later reading are forgotten", () => {
    const { watch, said, pending } = recorded();
    watch.read({ online: true, peerState: "disconnected" });
    watch.dispose();
    watch.read({ online: true, peerState: "connected" });
    watch.read({ online: false, peerState: "failed" });
    expect(said).toEqual([`lost: ${PATH}`]);
    expect(pending.timer).toBe(undefined);
  });
});
