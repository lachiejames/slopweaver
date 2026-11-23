/*
 * Who a Slack ask named: `askNames`, `namedAsks` and `askedReviewer` read the target off a channel tag or a
 * direct message, and `askWasAnswered` and `reviewerWhoAnswered` say whether, and by whom, it was answered.
 */
import { describe, expect, it } from "vitest";

import {
  askedReviewer,
  askNames,
  askWasAnswered,
  namedAsks,
  reviewerWhoAnswered,
} from "../../../../sessionStart/githubLeg.js";
import { BOT, BOT_IDS, mention, NAMES, OWNER, REVIEWER, review, state } from "./fixtures.js";

describe("askNames", () => {
  it("takes everybody a channel message tagged other than the poster", () => {
    expect(askNames({ botIds: BOT_IDS, mention: mention({ tagged: [REVIEWER, OWNER] }) })).toEqual([REVIEWER]);
  });

  it("drops the bot from a tag run, so tagging only the bot names nobody", () => {
    expect(askNames({ botIds: BOT_IDS, mention: mention({ tagged: [BOT] }) })).toEqual([]);
  });

  it("names a direct message's counterpart, which is how a DM asks without tagging", () => {
    const dm = mention({ counterpartId: REVIEWER, isDirectMessage: true, tagged: [] });
    expect(askNames({ botIds: BOT_IDS, mention: dm })).toEqual([REVIEWER]);
  });

  it("names nobody when a direct message carries no readable counterpart", () => {
    const dm = mention({ counterpartId: "", isDirectMessage: true, tagged: [] });
    expect(askNames({ botIds: BOT_IDS, mention: dm })).toEqual([]);
  });

  it("names nobody when the bot itself posted the direct message", () => {
    // MEASURED: fourteen of the owner's live asks were exactly this shape — the bot's own status
    // report in its DM, naming pull request numbers, counted once against each one.
    const dm = mention({ authorId: BOT, counterpartId: "", isDirectMessage: true, tagged: [] });
    expect(askNames({ botIds: BOT_IDS, mention: dm })).toEqual([]);
  });

  it("names nobody when the direct message's counterpart is the bot", () => {
    const dm = mention({ counterpartId: BOT, isDirectMessage: true, tagged: [] });
    expect(askNames({ botIds: BOT_IDS, mention: dm })).toEqual([]);
  });

  it("names nobody in a channel message that tagged only its own poster", () => {
    expect(askNames({ botIds: BOT_IDS, mention: mention({ tagged: [OWNER] }) })).toEqual([]);
  });
});

describe("namedAsks", () => {
  it("keeps an ask that named somebody", () => {
    expect(namedAsks({ botIds: BOT_IDS, state: state() })).toHaveLength(1);
  });

  it("drops a bot direct message, leaving a pull request with no ask at all", () => {
    const botDm = mention({ authorId: BOT, counterpartId: "", isDirectMessage: true, tagged: [] });
    const withBotAsk = state({
      slack: { asked: "yes", asks: [botDm], bounded: true, mentioned: "yes", mentions: [botDm], why: "" },
    });
    expect(namedAsks({ botIds: BOT_IDS, state: withBotAsk })).toEqual([]);
  });
});

describe("askedReviewer", () => {
  it("resolves the newest ask's target through the roster", () => {
    expect(askedReviewer({ botIds: BOT_IDS, namesById: NAMES, state: state() })).toBe("A Colleague");
  });

  it("falls back to the raw id rather than dropping a pull request the roster does not know", () => {
    const stranger = mention({ tagged: ["stranger-id"] });
    const withStranger = state({
      slack: { asked: "yes", asks: [stranger], bounded: true, mentioned: "yes", mentions: [stranger], why: "" },
    });
    expect(askedReviewer({ botIds: BOT_IDS, namesById: NAMES, state: withStranger })).toBe("stranger-id");
  });

  it("is undefined when no ask named anybody", () => {
    const noAsks = state({ slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" } });
    expect(askedReviewer({ botIds: BOT_IDS, namesById: NAMES, state: noAsks })).toBeUndefined();
  });
});

describe("askWasAnswered", () => {
  it("is true when an ask went out and the reviewer replied", () => {
    const answered = state({ bump: { kind: "replied", why: "they have replied, so there is nothing to chase" } });
    expect(askWasAnswered({ state: answered })).toBe(true);
  });

  it("is false while the reviewer is still silent", () => {
    expect(askWasAnswered({ state: state() })).toBe(false);
  });

  it("is false when no ask ever went out, whatever the bump verdict says", () => {
    const never = state({
      bump: { kind: "replied", why: "they have replied, so there is nothing to chase" },
      recommendation: "send-ask",
    });
    expect(askWasAnswered({ state: never })).toBe(false);
  });
});

describe("reviewerWhoAnswered", () => {
  it("names the first human who reviewed after the ask", () => {
    expect(
      reviewerWhoAnswered({
        state: state({ reviewedSinceAsk: [review({ login: "a-colleague" }), review({ login: "another" })] }),
      }),
    ).toBe("a-colleague");
  });

  it("says a reviewer rather than inventing a person when none was recorded", () => {
    expect(reviewerWhoAnswered({ state: state() })).toBe("a reviewer");
  });
});
