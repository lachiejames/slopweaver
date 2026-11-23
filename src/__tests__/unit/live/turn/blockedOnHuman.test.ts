/**
 * The pure half of BLOCKED ON THE OWNER — the words the card and the thread carry, the permalink token
 * the briefing gate matches on, and which asks are standing against the owner.
 */
import { describe, expect, it } from "vitest";
import { type AskLifecycle, type BlockedOnHumanEvent, type UnblockedEvent } from "../../../../live/ask/lifecycle.js";
import {
  blockedAsks,
  blockedCardDetail,
  blockedStepText,
  resumedCardDetail,
  slackPermalinkToken,
} from "../../../../live/turn/blockedOnHuman.js";

const BASE = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

/** Words that would make the card read as a failure — the rail the owner set. */
const FAILURE_WORDS = ["fail", "error", "sorry", "unable", "cannot", "broke", "problem"];

/** A blocked event with the fields these assertions vary. */
function blockedEvent({
  need = "sign-in",
  tsIso = "2026-09-07T00:20:00.000Z",
  what = "sign in to Google Cloud locally",
}: {
  need?: BlockedOnHumanEvent["need"];
  tsIso?: string;
  what?: string;
} = {}): BlockedOnHumanEvent {
  return { ...BASE, kind: "blocked-on-human", need, stepText: blockedStepText({ what }), tsIso, what };
}

/** One folded ask, with only the fields `blockedAsks` reads. */
function foldedAsk({
  blocked,
  lastEvent,
  messageTs = BASE.messageTs,
}: {
  blocked?: BlockedOnHumanEvent | undefined;
  lastEvent: AskLifecycle["lastEvent"];
  messageTs?: string;
}): AskLifecycle {
  return {
    capturedIso: "2026-09-07T00:05:00.000Z",
    channel: BASE.channel,
    lastEvent,
    messageTs,
    state: lastEvent.kind,
    surface: "channel",
    threadTs: BASE.threadTs,
    userId: "U_ASKER",
    ...(blocked === undefined ? {} : { blockedOnHuman: blocked }),
  };
}

const AN_UNBLOCK: UnblockedEvent = {
  ...BASE,
  kind: "unblocked",
  lifted: { need: "sign-in", what: "sign in to Google Cloud locally" },
  note: "signed in",
  tsIso: "2026-09-07T09:00:00.000Z",
};

describe("the words a blocked turn shows", () => {
  it("names the work on the step, and the owner under it", () => {
    expect(blockedStepText({ what: "sign in to Google Cloud locally" })).toBe(
      "Waiting on the owner: sign in to Google Cloud locally",
    );
    expect(blockedCardDetail({ need: "sign-in" })).toBe(
      "waiting on the owner to sign in — picking straight back up once it is",
    );
    expect(blockedCardDetail({ need: "risky-approval" })).toBe(
      "waiting on the owner's go-ahead — picking straight back up once it is",
    );
    expect(blockedCardDetail({ need: "ruling" })).toBe(
      "waiting on the owner to approve this one — picking straight back up once it is",
    );
    expect(blockedCardDetail({ need: "other" })).toBe("waiting on the owner — picking straight back up once it is");
  });

  it("never reads as a failure, on any need", () => {
    const lines = [
      blockedStepText({ what: "sign in to Google Cloud locally" }),
      blockedCardDetail({ need: "sign-in" }),
      blockedCardDetail({ need: "risky-approval" }),
      blockedCardDetail({ need: "ruling" }),
      blockedCardDetail({ need: "other" }),
      resumedCardDetail({ note: "signed in" }),
    ].join(" ");
    expect(FAILURE_WORDS.filter((word) => lines.toLowerCase().includes(word))).toEqual([]);
  });

  it("says what the owner did on the resumed step", () => {
    expect(resumedCardDetail({ note: "signed in to Google Cloud" })).toBe(
      "The owner did it — signed in to Google Cloud · picking up from here",
    );
  });

  it("composes the permalink token a briefing card has to carry", () => {
    expect(slackPermalinkToken({ messageTs: "1785000000.000100" })).toBe("p1785000000000100");
  });
});

describe("which asks are standing against the owner", () => {
  it("reports a waiting ask off the fold's outstanding block", () => {
    const blocked = blockedEvent({});
    const rows = blockedAsks({ folded: new Map([["k", foldedAsk({ blocked, lastEvent: blocked })]]) });
    expect(rows.length).toBe(1);
    expect(rows[0]!.standing).toBe("waiting");
    expect(rows[0]!.blocked.what).toBe("sign in to Google Cloud locally");
    expect(rows[0]!.clearedNote).toBeUndefined();
  });

  it("still reports it as waiting once the turn has written a later event", () => {
    const blocked = blockedEvent({});
    const later: AskLifecycle["lastEvent"] = {
      ...BASE,
      kind: "checklist-posted",
      tsIso: "2026-09-07T00:30:00.000Z",
      turnId: "turn-1",
      workingTs: "1785000000.000150",
    };
    const rows = blockedAsks({ folded: new Map([["k", foldedAsk({ blocked, lastEvent: later })]]) });
    expect(rows[0]!.standing).toBe("waiting");
  });

  it("reports an unblocked ask as owed a resume, naming what the owner was asked for", () => {
    const rows = blockedAsks({ folded: new Map([["k", foldedAsk({ lastEvent: AN_UNBLOCK })]]) });
    expect(rows[0]!.standing).toBe("ready-to-resume");
    expect(rows[0]!.blocked.need).toBe("sign-in");
    expect(rows[0]!.blocked.what).toBe("sign in to Google Cloud locally");
    expect(rows[0]!.clearedNote).toBe("signed in");
  });

  it("drops a resumed ask the moment a dispatch supersedes the unblock", () => {
    const dispatched: AskLifecycle["lastEvent"] = {
      ...BASE,
      decision: {
        confidence: "high",
        needs: [],
        rationale: "resuming",
        response: "respond",
        schemaVersion: 1,
        tier: "fresh-visible-session",
        truthMode: "none",
      },
      kind: "dispatched",
      leaseExpiresAt: "2026-09-07T11:00:00.000Z",
      tier: "fresh-visible-session",
      tsIso: "2026-09-07T09:05:00.000Z",
    };
    expect(blockedAsks({ folded: new Map([["k", foldedAsk({ lastEvent: dispatched })]]) })).toEqual([]);
  });

  it("orders oldest block first, and by nothing else", () => {
    const older = blockedEvent({ tsIso: "2026-09-01T00:00:00.000Z", what: "the old one" });
    const newer = blockedEvent({ need: "risky-approval", tsIso: "2026-09-07T00:00:00.000Z", what: "the new one" });
    const rows = blockedAsks({
      folded: new Map([
        ["b", foldedAsk({ blocked: newer, lastEvent: newer, messageTs: "1785000000.000200" })],
        ["a", foldedAsk({ blocked: older, lastEvent: older })],
      ]),
    });
    expect(rows.map((row) => row.blocked.what)).toEqual(["the old one", "the new one"]);
  });
});
