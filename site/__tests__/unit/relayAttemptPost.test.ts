/*
 * Posting one accepted relay: the words-alone retry, the line its posts came to, the call file's journal of it, and
 * the replay of a discuss-first question's post — every post a plain fake that records what it was handed.
 */
import { describe, expect, it } from "vitest";

import {
  attemptRelay,
  type RelayPosted,
  relayJournalDetail,
  relayOutcomeLine,
  replayPut,
} from "../../components/voice/relayAttemptPost";
import type { RelayLine } from "../../components/voice/voiceContext";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";

const HEARD_ONLY: TalkRelayWire = {
  about: "ask:queue-shows-raw-user-id",
  heard: "fix the tab",
  readsAfter: ["context_pack"],
  screen: { kind: "none", reason: "screen-not-shared" },
  turnId: "a0000017-0000-4000-8000-000000000019",
};

const NO_REPORT = {
  candidateRuling: undefined,
  deliveryDetail: undefined,
  deliveryKind: undefined,
  ruling: undefined,
  slug: undefined,
};

const post = ({
  outcome,
  detail,
  wordsAloneRetry = false,
  shownOutcome,
}: {
  outcome: RelayPosted["outcome"];
  detail: string;
  wordsAloneRetry?: boolean;
  shownOutcome?: RelayLine["outcome"];
}): RelayPosted => ({ detail, outcome, report: NO_REPORT, shownOutcome, wordsAloneRetry });

const PRE_CLAIM = post({ detail: "--read-after names context_pack", outcome: "refused", wordsAloneRetry: true });
const LANDED = post({ detail: "relayed as talk-a00000170000", outcome: "relayed" });
const TIMED_OUT = post({ detail: "the relay timed out", outcome: "unknown" });

describe("attemptRelay", () => {
  const run = async ({ answers }: { answers: readonly RelayPosted[] }) => {
    const sent: TalkRelayWire[] = [];
    const retries: string[] = [];
    const result = await attemptRelay({
      hooks: {
        post: (wire) => {
          sent.push(wire);
          return Promise.resolve(answers[sent.length - 1]);
        },
        retrying: ({ why }) => {
          retries.push(why);
        },
      },
      wire: HEARD_ONLY,
    });
    return { result, retries, sent };
  };

  const ALONE: TalkRelayWire = { ...HEARD_ONLY, readsAfter: [], wordsAlone: true };

  it("posts once when the first relay lands", async () => {
    expect(await run({ answers: [LANDED] })).toEqual({
      result: { firstWhy: undefined, posted: LANDED },
      retries: [],
      sent: [HEARD_ONLY],
    });
  });

  it("retries a pre-claim refusal once with the owner's words alone, whatever the retry comes to", async () => {
    expect(await run({ answers: [PRE_CLAIM, TIMED_OUT] })).toEqual({
      result: { firstWhy: "--read-after names context_pack", posted: TIMED_OUT },
      retries: ["--read-after names context_pack"],
      sent: [HEARD_ONLY, ALONE],
    });
  });

  it("never retries a refusal the route or verb may have made after its claim, nor an unknown outcome", async () => {
    const claimed = await run({ answers: [post({ detail: "RELAY_CONFLICT", outcome: "refused" })] });
    const unknown = await run({ answers: [TIMED_OUT] });
    expect([claimed.sent, unknown.sent]).toEqual([[HEARD_ONLY], [HEARD_ONLY]]);
  });
});

describe("relayOutcomeLine", () => {
  // The first refusal a retry followed is journalled on the line, never spoken.
  it("carries the first refusal apart from whatever the retry came to, and journals the two joined", () => {
    const first = "Error: first read refusal\n    at post (relay.ts:12:5)";
    const lines = [
      relayOutcomeLine({ firstWhy: first, posted: LANDED }),
      relayOutcomeLine({ firstWhy: first, posted: post({ detail: "final picture refusal", outcome: "refused" }) }),
      relayOutcomeLine({ firstWhy: first, posted: TIMED_OUT }),
      relayOutcomeLine({ firstWhy: undefined, posted: TIMED_OUT }),
    ];
    expect(lines).toEqual([
      {
        detail: "relayed as talk-a00000170000, in the owner's words alone after the first was refused",
        firstRefusal: first,
        lineOutcome: "relayed",
      },
      { detail: "final picture refusal", firstRefusal: first, lineOutcome: "refused" },
      {
        detail: "the relay timed out, in the owner's words alone after the first was refused",
        firstRefusal: first,
        lineOutcome: "unknown",
      },
      { detail: "the relay timed out", firstRefusal: undefined, lineOutcome: "unknown" },
    ]);
    expect(lines.map((line) => relayJournalDetail({ line: { ...line, outcome: line.lineOutcome } }))).toEqual([
      `relayed as talk-a00000170000, in the owner's words alone after the first was refused: ${first}`,
      `refused twice: ${first}; then final picture refusal`,
      `the relay timed out, in the owner's words alone after the first was refused: ${first}`,
      "the relay timed out",
    ]);
  });

  it("shows the outcome the post says to show, over the one it came to", () => {
    const boardOnly = post({ detail: "on the board", outcome: "relayed", shownOutcome: "board-only" });
    expect(relayOutcomeLine({ firstWhy: undefined, posted: boardOnly })).toEqual({
      detail: "on the board",
      firstRefusal: undefined,
      lineOutcome: "board-only",
    });
  });
});

describe("replayPut", () => {
  // A replay's caught message rides apart from our sentence, so the viewer folds it.
  it("carries a replayed put's caught message apart from the line's sentence, joined only in the call file", async () => {
    const replayed = await replayPut({
      post: () => Promise.reject(new Error("fetch failed")),
      replay: HEARD_ONLY,
    });
    expect(replayed).toStrictEqual({
      said: "the question's relay posted again first, and that post failed",
      why: "fetch failed",
    });
    expect(relayJournalDetail({ line: { detail: "relayed", outcome: "relayed", replay: replayed } })).toBe(
      "relayed (the question's relay posted again first: fetch failed)",
    );
  });

  it("replays nothing when the put landed", async () => {
    expect(await replayPut({ post: () => Promise.resolve(LANDED), replay: undefined })).toBe(undefined);
  });
});
