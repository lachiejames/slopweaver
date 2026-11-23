/*
 * A failed Talk session start names its reason, not the SDK's wrapper.
 *
 * It sits under `site/__tests__/unit/` because a file under `src/` may not import one outside it (TS6059).
 *
 * ## The failure it holds down
 *
 * When the offer route answers a stated refusal, the tab must not show "Could not establish the WebRTC
 * connection." — the fixed message of the `WebRTCError` the SDK wraps every SDP-callback
 * throw in. Each case below builds that wrapper with the SDK's own class, so a change to how the SDK nests
 * its cause reddens here rather than on the owner's screen.
 */
import { OpenAILiveWebRTC, WebRTCError } from "openai/live/webrtc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectionStopWhy, setupFailureOf } from "../../components/live/talkSession";
import { OFFER_ANSWER_BOUND_MS, PAGE_SETUP_TIMEOUT_MS } from "../../lib/talkOffer";

const REFUSAL = "the ChatGPT plan refused this call: usage limit reached";

describe("setupFailureOf", () => {
  it("shows the refusal the SDP callback threw, not the wrapper's fixed sentence", () => {
    const wrapped = new WebRTCError(
      "signaling_failed",
      "signaling",
      "Could not establish the WebRTC connection.",
      new Error(REFUSAL),
    );
    expect(setupFailureOf({ cause: wrapped })).toBe(REFUSAL);
  });

  it("says a bare transport failure as what broke, not which class noticed", () => {
    const bare = new WebRTCError("transport_failed", "transport", "The WebRTC peer connection ended.");
    expect(setupFailureOf({ cause: bare })).toBe(
      "the audio link between this machine and OpenAI failed; the network path did not hold",
    );
  });

  it("says a setup timeout in plain words", () => {
    const late = new WebRTCError("timeout", "transport", "WebRTC setup timed out.");
    expect(setupFailureOf({ cause: late })).toBe("OpenAI did not finish connecting the call in time");
  });

  it("stops at an error that is not the SDK wrapper, keeping its author's words over its own cause", () => {
    const unreached = new Error("the console server did not answer the mint: TypeError: Failed to fetch", {
      cause: new TypeError("Failed to fetch"),
    });
    const wrapped = new WebRTCError(
      "signaling_failed",
      "signaling",
      "Could not establish the WebRTC connection.",
      unreached,
    );
    expect(setupFailureOf({ cause: wrapped })).toBe(
      "the console server did not answer the mint: TypeError: Failed to fetch",
    );
  });

  it("keeps the wrapper's own message when its cause has nothing to say", () => {
    const silent = new WebRTCError(
      "negotiation_failed",
      "answer",
      "Could not establish the WebRTC connection.",
      // An empty message is this case's whole subject: a cause that says nothing must not replace the wrapper.
      // oxlint-disable-next-line error-message
      new Error(""),
    );
    expect(setupFailureOf({ cause: silent })).toBe("Could not establish the WebRTC connection.");
  });

  it("reads a string cause, which an abort reason may be", () => {
    const aborted = new WebRTCError("aborted", "signaling", "WebRTC setup was cancelled.", "the owner pressed Stop");
    expect(setupFailureOf({ cause: aborted })).toBe("the owner pressed Stop");
  });

  it("stringifies a thrown value that is not an Error", () => {
    expect(setupFailureOf({ cause: 42 })).toBe("42");
  });
});

describe("connectionStopWhy", () => {
  const failedTransport = new WebRTCError("transport_failed", "transport", "The WebRTC peer connection ended.");

  it("leaves a close during setup to connect's rejection, which carries the reason", () => {
    expect(connectionStopWhy({ event: { reason: "failed", type: "closed" }, settingUp: true })).toBeUndefined();
  });

  it("leaves a fatal error during setup to connect's rejection too", () => {
    const event = { error: failedTransport, fatal: true, type: "error" } as const;
    expect(connectionStopWhy({ event, settingUp: true })).toBeUndefined();
  });

  it("says a live call's transport failure in plain words", () => {
    const event = { error: failedTransport, fatal: true, type: "error" } as const;
    expect(connectionStopWhy({ event, settingUp: false })).toBe(
      "the audio link between this machine and OpenAI failed; the network path did not hold",
    );
  });

  it("says OpenAI ended a live call when the far side closed it", () => {
    expect(connectionStopWhy({ event: { reason: "remote", type: "closed" }, settingUp: false })).toBe(
      "OpenAI ended the call",
    );
  });

  it("stops nothing on the owner's own hang-up", () => {
    expect(connectionStopWhy({ event: { reason: "local", type: "closed" }, settingUp: false })).toBeUndefined();
  });

  it("stops nothing on a non-fatal diagnostic", () => {
    const event = { error: failedTransport, fatal: false, type: "error" } as const;
    expect(connectionStopWhy({ event, settingUp: false })).toBeUndefined();
  });
});

/** An event target that remembers nothing: the SDK only needs to attach and detach listeners. */
const inert = { addEventListener: (): void => undefined, removeEventListener: (): void => undefined };

/** The least peer the SDK's constructor and offer can run over; it never connects, which is the point. */
class FakePeer {
  readonly addEventListener = inert.addEventListener;
  readonly removeEventListener = inert.removeEventListener;
  readonly connectionState = "new";
  readonly localDescription = { sdp: "v=0" };
  createDataChannel(): object {
    return { ...inert, close: (): void => undefined, readyState: "connecting", send: (): void => undefined };
  }
  async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    return { sdp: "v=0", type: "offer" };
  }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(): Promise<void> {}
  close(): void {}
}

describe("a mint refusal through the real SDK", () => {
  const host = globalThis as { RTCPeerConnection?: unknown };
  afterEach(() => {
    delete host.RTCPeerConnection;
  });

  it("emits closed BEFORE connect rejects, so only a handler that waits for the rejection shows the refusal", async () => {
    host.RTCPeerConnection = FakePeer;
    const conn = new OpenAILiveWebRTC();
    const order: string[] = [];
    const shown: string[] = [];
    const settingUp = true;
    conn.onConnectionEvent((event) => {
      order.push(event.type);
      const why = connectionStopWhy({ event, settingUp });
      if (why !== undefined) shown.push(why);
    });
    const exchangeSdp = async (): Promise<string> => {
      throw new Error(REFUSAL);
    };
    await conn.connect({ exchangeSdp }).catch((cause: unknown) => {
      order.push("rejected");
      shown.push(setupFailureOf({ cause }));
    });
    expect(order).toEqual(["state.changed", "closed", "rejected"]);
    expect(shown).toEqual([REFUSAL]);
  });
});

describe("a plan that is slow to refuse", () => {
  const host = globalThis as { RTCPeerConnection?: unknown };
  afterEach(() => {
    vi.useRealTimers();
    delete host.RTCPeerConnection;
  });

  /** What the page shows when the route answers a refusal forty seconds after the press. */
  async function shownAfterSlowRefusal({ timeoutMs }: { timeoutMs: number | undefined }): Promise<string> {
    vi.useFakeTimers();
    host.RTCPeerConnection = FakePeer;
    const conn = new OpenAILiveWebRTC();
    const exchangeSdp = async (): Promise<string> =>
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(REFUSAL));
        }, 40_000);
      });
    const options = timeoutMs === undefined ? { exchangeSdp } : { exchangeSdp, timeoutMs };
    const shown = conn.connect(options).then(
      () => "connected",
      (cause: unknown) => setupFailureOf({ cause }),
    );
    await vi.advanceTimersByTimeAsync(40_000);
    return shown;
  }

  it("shows the plan's refusal when the page waits out the route", async () => {
    expect(await shownAfterSlowRefusal({ timeoutMs: PAGE_SETUP_TIMEOUT_MS })).toBe(REFUSAL);
  });

  it("reads as OpenAI's timeout under the SDK's own default, which is the defect", async () => {
    expect(await shownAfterSlowRefusal({ timeoutMs: undefined })).toBe(
      "OpenAI did not finish connecting the call in time",
    );
  });

  it("waits past every bound the route keeps", () => {
    expect(OFFER_ANSWER_BOUND_MS).toBe(150_000);
    expect(PAGE_SETUP_TIMEOUT_MS).toBe(165_000);
  });
});
