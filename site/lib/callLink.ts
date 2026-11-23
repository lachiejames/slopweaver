/**
 * Whether a live console call's link to OpenAI is still there, read the moment it changes rather than when the SDK
 * finally gives up on it. A dropped Wi-Fi link must be known quickly, or the owner cannot tell whether the voice is
 * there or just taking time to respond.
 *
 * The OpenAI SDK ends a call only on the peer connection's `failed` state (`openai/lib/webrtc/connection.mjs`), which a
 * browser reaches about 30 seconds after the network goes. Until then the call looked live — the same as a slow reply.
 * So the page reads the two signals that move at once: the peer going `disconnected`, and the browser going offline.
 *
 * A loss is announced the moment it is read, but the call is HELD for {@link LINK_HEAL_MS} before it is torn down:
 * releasing a call stops the plan child running the owner's Codex consultation (`releasePlanCall`), and a link that comes back
 * inside the window — a Wi-Fi blip — loses nothing. Past the window the call ends as a drop, and the reconnect takes
 * it from there (`./callReconnect.ts`).
 *
 * Nothing here reads how long a reply has taken. A link that is connected and online is never lost, however quiet the
 * call has gone: a slow reply is never a drop.
 */

/** The peer connection states this reads — `RTCPeerConnectionState`, named so a test needs no browser. */
export type PeerState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

/**
 * How long a lost link is held before the call is ended as a drop. A judgement, not a measurement: long enough for a
 * link whose path came straight back to resume on its own, short enough that a link that will not costs little before
 * the reconnect starts — and the owner has heard the loss from its first moment either way.
 */
export const LINK_HEAL_MS = 6_000;

/**
 * Why the link counts as lost now, or nothing while it holds.
 *
 * @param peerState the peer connection's state
 * @param online whether the browser says it has a network
 * @returns the plain reason the link is lost, or `undefined` while it is connected and online
 */
export function linkLostWhy({ peerState, online }: { peerState: PeerState; online: boolean }): string | undefined {
  if (!online) {
    return "this machine went offline; the network dropped";
  }
  if (peerState === "disconnected" || peerState === "failed") {
    return "the audio link to OpenAI stopped answering; the network path dropped";
  }
  return undefined;
}

/** Run `run` after `ms`; the returned function cancels it. The page passes `window.setTimeout`; a test, a plain fake. */
export type LinkSchedule = (timer: { ms: number; run: () => void }) => () => void;

/**
 * One live call's link, told each time a signal moves. Lost: says so once and starts the heal window. Back inside it:
 * says so and forgets the window. Still lost at its end: hands the reason over once, to end the call as a drop.
 */
export class LinkWatch {
  private cancel: (() => void) | undefined = undefined;
  private disposed = false;
  private readonly onExpired: (expired: { why: string }) => void;
  private readonly onHealed: () => void;
  private readonly onLost: (lost: { why: string }) => void;
  private readonly schedule: LinkSchedule;

  constructor({
    onLost,
    onHealed,
    onExpired,
    schedule,
  }: {
    onLost: (lost: { why: string }) => void;
    onHealed: () => void;
    onExpired: (expired: { why: string }) => void;
    schedule: LinkSchedule;
  }) {
    this.onExpired = onExpired;
    this.onHealed = onHealed;
    this.onLost = onLost;
    this.schedule = schedule;
  }

  /**
   * A signal moved: read the link again.
   *
   * @param peerState the peer connection's state now
   * @param online whether the browser has a network now
   */
  read({ peerState, online }: { peerState: PeerState; online: boolean }): void {
    if (this.disposed) {
      return;
    }
    const why = linkLostWhy({ online, peerState });
    const lost = this.cancel !== undefined;
    if (why !== undefined && !lost) {
      this.cancel = this.schedule({
        ms: LINK_HEAL_MS,
        run: () => {
          this.cancel = undefined;
          this.disposed = true;
          this.onExpired({ why });
        },
      });
      this.onLost({ why });
      return;
    }
    if (why === undefined && lost) {
      this.cancel?.();
      this.cancel = undefined;
      this.onHealed();
    }
  }

  /** The call is ending: forget any window, and read nothing more. */
  dispose(): void {
    this.disposed = true;
    this.cancel?.();
    this.cancel = undefined;
  }
}
