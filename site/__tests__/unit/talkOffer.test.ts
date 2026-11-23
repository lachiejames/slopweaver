/*
 * The offer's answer: the plan call when it opens, and otherwise the refusal shown plainly in its own words — nothing
 * else minted, nothing paid around it — with an ambiguous outcome saying to try again.
 */
import { describe, expect, it } from "vitest";

import { cutMarked, offerArgvOf, offerResultOf, REFUSAL_SHOWN_MAX_CHARS, type TalkMinted } from "../../lib/talkOffer";

const MINTED: TalkMinted = {
  backendModel: "b",
  callId: "call-1",
  model: "m",
  ok: true,
  packed: true,
  sdp: "v=0",
  threadId: "t-1",
  tools: ["read_page"],
  voice: "sol",
  writers: [],
};

describe("offerArgvOf", () => {
  it("marks a reconnect and a rollover on the verb, and leaves the owner's press bare", () => {
    expect(
      (["fresh", "reconnect", "rollover"] as const).map((mode) =>
        offerArgvOf({ mode, voice: "sol", wanted: "voice" }).join(" "),
      ),
    ).toEqual([
      "talk offer --voice sol --json",
      "talk offer --voice sol --json --reconnect",
      "talk offer --voice sol --json --rollover",
    ]);
  });

  it("marks the desktop test instance's call, and only that one, so its reminder never reads the owner's calls", () => {
    expect(
      (["fresh", "reconnect"] as const).map((mode) =>
        offerArgvOf({ mode, voice: "sol", wanted: "e2e-voice" }).join(" "),
      ),
    ).toEqual([
      "talk offer --voice sol --json --test-instance e2e",
      "talk offer --voice sol --json --reconnect --test-instance e2e",
    ]);
  });
});

describe("offerResultOf", () => {
  it("answers with the plan call when the plan opens", () => {
    expect(offerResultOf({ leg: { kind: "open", minted: MINTED } })).toEqual(MINTED);
  });

  it("shows a definitive refusal in its own words, with nothing else minted", () => {
    expect(offerResultOf({ leg: { kind: "refused", reason: "Codex is not signed in" } })).toEqual({
      notMinted: "the call could not start: Codex is not signed in",
      ok: false,
    });
  });

  it("never pins an app-server killed before it answered on the plan", () => {
    const reason = "the app-server did not initialize: the app-server exited (signal SIGTERM)";
    expect(offerResultOf({ leg: { kind: "refused", reason } })).toEqual({
      notMinted: `the call could not start: ${reason}`,
      ok: false,
    });
  });

  it("says to try again on an ambiguous outcome, since a plan session may still be open", () => {
    expect(offerResultOf({ leg: { kind: "ambiguous", reason: "no answer SDP arrived" } })).toEqual({
      notMinted: "no answer SDP arrived; the plan may still have a session open, so try again",
      ok: false,
    });
  });

  it("never calls a composer killed mid-call the plan's refusal, and says to press again", () => {
    // A console rebuild signalled `talk offer` and /talk read "the ChatGPT plan refused".
    expect(
      offerResultOf({
        leg: {
          kind: "uncomposed",
          reason: "slopweaver talk offer --voice <voice> --json was killed by SIGTERM before it answered",
          stopped: true,
        },
      }),
    ).toEqual({
      notMinted:
        "the call was never put to the ChatGPT plan: slopweaver talk offer --voice <voice> --json was killed by " +
        "SIGTERM before it answered; nothing reached the plan, so press again",
      ok: false,
    });
  });

  it("starts a new sentence after a stopped composer's reason that already ends one, never `.;`", () => {
    expect(
      offerResultOf({ leg: { kind: "uncomposed", reason: "so it has to be inside one.", stopped: true } }),
    ).toEqual({
      notMinted:
        "the call was never put to the ChatGPT plan: so it has to be inside one. Nothing reached the plan, so press again",
      ok: false,
    });
  });

  it("says a composer that exited with its own answer never reached the plan, without promising a retry", () => {
    expect(
      offerResultOf({
        leg: { kind: "uncomposed", reason: "talk offer: no vendored codex executable", stopped: false },
      }),
    ).toEqual({
      notMinted: "the call was never put to the ChatGPT plan: talk offer: no vendored codex executable",
      ok: false,
    });
  });

  it("cuts a refusal of megabytes to what a page shows, saying where", () => {
    expect(offerResultOf({ leg: { kind: "refused", reason: "x".repeat(70_000) } })).toEqual({
      notMinted: `the call could not start: ${"x".repeat(REFUSAL_SHOWN_MAX_CHARS)}… (cut at 2000 characters)`,
      ok: false,
    });
  });
});

describe("cutMarked", () => {
  it("counts characters, not UTF-16 units: an emoji at the edge is kept whole or cut whole, never split", () => {
    expect([
      cutMarked({ max: 3, text: "ab😀" }),
      cutMarked({ max: 2, text: "ab😀" }),
      cutMarked({ max: 3, text: "a😀bc" }),
    ]).toEqual(["ab😀", "ab… (cut at 2 characters)", "a😀b… (cut at 3 characters)"]);
  });
});
