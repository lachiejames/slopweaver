/**
 * unroutedReport — the sweep's loudest line, and the command in it.
 *
 * The owner's ask, after a tag sat carded and unanswered in a public channel for 88 minutes:
 * make a never-dispatched line the loudest thing the sweep prints, and make a re-dispatch reuse the card
 * that is already standing. These tests pin what "loudest" means as output, and pin the one property that
 * makes the command safe to paste over a real Slack message.
 */
import { describe, expect, it } from "vitest";

import type { AskLifecycle } from "../../../../live/ask/lifecycle.js";
import { unroutedSweepNotice } from "../../../../live/turn/undispatchedSweep.js";
import {
  inReviewLine,
  neverDispatchedLine,
  reRouteCommand,
  shellQuote,
  type UnroutedSubject,
} from "../../../../live/turn/unroutedReport.js";

const SUBJECT: UnroutedSubject = {
  ask: { channel: "C0SYN000001", messageTs: "1789348656.323469", threadTs: "1789348656.323469" },
  surface: "channel",
  text: "@(U0SYN000005) ranked ISO tasks for today",
  userId: "U0SYN000001",
};

/** The incident's ask, folded as the sweep sees it: carded and routed by nobody. */
function carded({ text }: { text?: string | undefined } = {}): AskLifecycle {
  return {
    capturedIso: "2026-09-14T02:12:10.938Z",
    channel: SUBJECT.ask.channel,
    lastEvent: {
      channel: SUBJECT.ask.channel,
      kind: "checklist-posted",
      messageTs: SUBJECT.ask.messageTs,
      threadTs: SUBJECT.ask.threadTs,
      tsIso: "2026-09-14T02:12:19.348Z",
      turnId: "turn-1789351938440",
      workingTs: "1789351938.864729",
    },
    messageTs: SUBJECT.ask.messageTs,
    started: { turnId: "turn-1789351938440", workingTs: "1789351938.864729" },
    state: "checklist-posted",
    surface: "channel",
    threadTs: SUBJECT.ask.threadTs,
    userId: SUBJECT.userId,
    ...(text === undefined ? {} : { text }),
  };
}

describe("shellQuote", () => {
  it("single-quotes a plain value", () => {
    expect(shellQuote({ value: "hello there" })).toBe("'hello there'");
  });

  it("neutralises the characters a Slack message routinely carries", () => {
    expect(shellQuote({ value: "run `ls` for $HOME" })).toBe("'run `ls` for $HOME'");
  });

  it("closes, escapes and reopens around an apostrophe — the one character single quotes cannot hold", () => {
    expect(shellQuote({ value: "don't" })).toBe(`'don'\\''t'`);
  });

  it("keeps an embedded newline inside the quotes", () => {
    expect(shellQuote({ value: "one\ntwo" })).toBe("'one\ntwo'");
  });
});

describe("reRouteCommand", () => {
  it("names every flag `turn brief` needs, with the question the ledger recorded", () => {
    const command = reRouteCommand({ subject: SUBJECT });
    expect(command).toBe(
      "slopweaver turn brief --channel C0SYN000001 --message-ts 1789348656.323469 " +
        "--thread-ts 1789348656.323469 --user U0SYN000001 --surface channel --mode continuous-drain " +
        "--text '@(U0SYN000005) ranked ISO tasks for today'",
    );
  });

  it("omits --turn-id/--working-ts, because `turn brief` recovers the standing card from the ledger", () => {
    const command = reRouteCommand({ subject: SUBJECT });
    expect(command.includes("--turn-id")).toBe(false);
    expect(command.includes("--working-ts")).toBe(false);
  });

  it("names --text as still owed when the ask predates the ledger recording it", () => {
    const command = reRouteCommand({ subject: { ...SUBJECT, text: undefined } });
    expect(command).toContain("--text '<the message — this ask was captured before the ledger recorded it>'");
  });

  it("carries a dm surface through rather than defaulting it", () => {
    expect(reRouteCommand({ subject: { ...SUBJECT, surface: "dm" } })).toContain("--surface dm");
  });
});

describe("neverDispatchedLine", () => {
  it("opens on the instruction, not on the state", () => {
    const line = neverDispatchedLine({ reason: "no session ever picked this up", subject: SUBJECT });
    expect(line.startsWith("NEVER-DISPATCHED — ROUTE IT NOW: C0SYN000001/1789348656.323469")).toBe(true);
  });

  it("says the recovery pass would post a SECOND card, so the reader takes it here", () => {
    const line = neverDispatchedLine({ reason: "no session ever picked this up", subject: SUBJECT });
    expect(line).toContain("SECOND card");
    expect(line).toContain("do NOT re-capture it");
  });

  it("carries the sweep's own reason verbatim", () => {
    const line = neverDispatchedLine({ reason: "it was seen 33m ago", subject: SUBJECT });
    expect(line).toContain("it was seen 33m ago");
  });
});

describe("unroutedSweepNotice", () => {
  it("fires on the incident's own ask nine minutes in, when nothing used to be said at all", () => {
    const notice = unroutedSweepNotice({ ask: carded({ text: SUBJECT.text }), nowIso: "2026-09-14T02:21:19.348Z" })!;
    expect(notice.kind).toBe("unrouted");
    expect(notice.minutes).toBe(9);
    expect(notice.text).toBe(SUBJECT.text);
    expect(notice.userId).toBe("U0SYN000001");
  });

  it("fires at zero minutes — an ask carded this second is already unrouted", () => {
    const notice = unroutedSweepNotice({ ask: carded(), nowIso: "2026-09-14T02:12:19.348Z" })!;
    expect(notice.minutes).toBe(0);
    expect(notice.text).toBe(undefined);
  });

  it("stops firing at the finalise bound, where undispatchedSweepAction takes over", () => {
    expect(unroutedSweepNotice({ ask: carded(), nowIso: "2026-09-14T02:42:19.348Z" })).toBe(undefined);
  });

  it("still fires one minute inside that bound", () => {
    expect(unroutedSweepNotice({ ask: carded(), nowIso: "2026-09-14T02:41:19.348Z" })!.minutes).toBe(29);
  });

  it("says nothing about an ask a worker already holds", () => {
    const ask: AskLifecycle = {
      ...carded(),
      activeDispatch: {
        channel: SUBJECT.ask.channel,
        decision: {
          confidence: "high",
          needs: [],
          rationale: "a live investigation is needed",
          response: "respond",
          schemaVersion: 1,
          tier: "fresh-visible-session",
          truthMode: "none",
        },
        kind: "dispatched",
        leaseExpiresAt: "2026-09-14T04:13:00.000Z",
        messageTs: SUBJECT.ask.messageTs,
        threadTs: SUBJECT.ask.threadTs,
        tier: "fresh-visible-session",
        tsIso: "2026-09-14T02:13:00.000Z",
      },
    };
    expect(unroutedSweepNotice({ ask, nowIso: "2026-09-14T02:21:19.348Z" })).toBe(undefined);
  });

  it("says nothing about an ask the sweep has already finalised", () => {
    const ask: AskLifecycle = {
      ...carded(),
      lastEvent: {
        channel: SUBJECT.ask.channel,
        kind: "dispatch-failed",
        messageTs: SUBJECT.ask.messageTs,
        reason: "no session ever picked this up",
        threadTs: SUBJECT.ask.threadTs,
        tsIso: "2026-09-14T02:45:27.414Z",
      },
      state: "dispatch-failed",
    };
    expect(unroutedSweepNotice({ ask, nowIso: "2026-09-14T02:46:00.000Z" })).toBe(undefined);
  });

  it("says nothing when the clock it is judged against is unreadable", () => {
    expect(unroutedSweepNotice({ ask: carded(), nowIso: "not-an-instant" })).toBe(undefined);
  });
});

describe("inReviewLine", () => {
  it("names the reviewer's spawn instant and the hold's own reason", () => {
    const line = inReviewLine({
      because: "an independent reviewer is mid-verdict, and its time is not the worker's to pay for",
      minutes: 33,
      spawnedAt: "2026-09-16T01:26:36.637Z",
      subject: SUBJECT,
    });
    expect(line).toBe(
      `IN REVIEW — DO NOT ROUTE: ${SUBJECT.ask.channel}/${SUBJECT.ask.messageTs} — last event 33m ago and no ` +
        "dispatch was ever recorded, but an independent reviewer is mid-verdict, and its time is not the " +
        "worker's to pay for (reviewer spawned 2026-09-16T01:26:36.637Z). A session is inside this turn; the " +
        "never-dispatched bound is HELD and nothing was settled. Do not re-brief it — that posts a second " +
        "card over the one the person is watching — and never message the reviewer.",
    );
  });

  it("carries NO turn brief command — the one line in this module whose content is do-not-act", () => {
    const line = inReviewLine({
      because: "an independent reviewer is mid-verdict, and its time is not the worker's to pay for",
      minutes: 33,
      spawnedAt: "2026-09-16T01:26:36.637Z",
      subject: SUBJECT,
    });
    expect(line).not.toContain("slopweaver turn brief");
    // The falsifiable half: the same subject DOES produce that command on the arms that want it, so the
    // absence above is a property of this line rather than of the fixture.
    expect(neverDispatchedLine({ reason: "whatever", subject: SUBJECT })).toContain("slopweaver turn brief");
  });

  it("says so plainly when the reviewer record states no spawn instant", () => {
    const line = inReviewLine({
      because: "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
      minutes: 41,
      spawnedAt: undefined,
      subject: SUBJECT,
    });
    expect(line).toContain("(a reviewer whose record states no spawn instant)");
    expect(line).not.toContain("undefined");
  });
});
