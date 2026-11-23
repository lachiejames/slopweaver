import { describe, expect, it } from "vitest";

import { type TurnPoster, TurnQueryFailure } from "../../../../../live/turn/run.js";
import { answered, COVERAGE, MENTION, PROVENANCE } from "./fixtures.js";
import { drive, type Recorded, recordingPoster } from "./harness.js";

describe("a failed turn reports the coverage it HAD read, never that it read none", () => {
  it("carries the manifest from a TurnQueryFailure into the failure card", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: async () => {
        throw new TurnQueryFailure({ coverage: COVERAGE, message: "the answer could not be grounded" });
      },
    });

    expect(answered(outcome)).toBe(false);
    const notice = log.find((entry) => entry.kind === "post-notice")!;
    expect(notice.lead).toContain("Something broke while I was answering");
  });

  it("a failure carrying coverage does NOT claim the world model was never read", async () => {
    const cards: string[] = [];
    const poster = recordingPoster({ log: [] });
    const capturing: TurnPoster = {
      ...poster,
      postNotice: async ({ card }) => {
        cards.push(JSON.stringify(card.artifact.detail));
        return { channel: "C1", ts: "1712345678.000500" };
      },
    };
    await drive({
      mention: MENTION,
      poster: capturing,
      provenance: PROVENANCE,
      query: async () => {
        throw new TurnQueryFailure({ coverage: COVERAGE, message: "the answer could not be grounded" });
      },
    });

    expect(cards[0]!).not.toContain("never read");
  });

  it("a failure with NO coverage still says so, because then it is true", async () => {
    const cards: string[] = [];
    const poster = recordingPoster({ log: [] });
    const capturing: TurnPoster = {
      ...poster,
      postNotice: async ({ card }) => {
        cards.push(JSON.stringify(card.artifact.detail));
        return { channel: "C1", ts: "1712345678.000500" };
      },
    };
    await drive({
      mention: MENTION,
      poster: capturing,
      provenance: PROVENANCE,
      query: async () => {
        throw new Error("the world model could not be read");
      },
    });

    expect(cards[0]!).toContain("never read");
  });
});
