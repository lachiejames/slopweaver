/*
 * What became of a Slack send the owner asked for on a call. After "Send it", the voice said "Got it.", and the as-me
 * gates held the reply as a draft — nothing was sent and nothing said so. These pin the one rule per source the
 * resolver applies, over that call's own thread.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { OwnerReply } from "../../../live/slack/ownerReply.js";
import { parseSlackDraftLog, skippedDraftNote } from "../../../outbound/slack/draftLog.js";
import type { ParkedSlackDraft, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import type { SlackSendFailure } from "../../../outbound/slack/sendFailureJournal.js";
import {
  DraftRegisterUnsureErrors,
  draftsOrUnsure,
  readSlackSendOutcome,
  resolveSlackSendOutcome,
  SlackSendOutcomeErrors,
} from "../../../talk/slackSendOutcome.js";

/** The channel and thread root the reply to Seth was aimed at. */
const TARGET = { channel: "C0SYN000001", threadTs: "1791351441.819519" } as const;

/** The moment the owner said "Send it". */
const SINCE = "2026-10-07T05:52:56.000Z";

/** The live read finding nothing of the owner's in the thread yet. */
const NOT_YET: OwnerReply = { kind: "not-yet", readAtIso: "2026-10-07T06:10:00.000Z" };

/** The reason the as-me gates gave for holding that reply. */
const HELD_WHY = "Lena is named but not tagged, and the text carries an em-dash";

/**
 * One as-me draft row aimed at the thread unless told otherwise.
 *
 * @returns the folded row
 */
function heldRow({
  id = "sd-e1f8af68",
  tsIso = "2026-10-07T05:53:40.000Z",
  state = "held",
  channel = TARGET.channel,
  threadTs = TARGET.threadTs,
  actor,
}: {
  id?: string;
  tsIso?: string;
  state?: SlackDraftItem["state"];
  channel?: string;
  threadTs?: string;
  actor?: "bot";
}): SlackDraftItem {
  const draft: ParkedSlackDraft = {
    advisory: [],
    channel,
    digest: `digest-${id}`,
    form: "{}",
    id,
    mentions: [],
    payload: { form: "plain", text: "Thanks Seth", unfurl_links: false, unfurl_media: false },
    shape: "thread",
    threadTs,
    tsIso,
    why: HELD_WHY,
    ...(actor === undefined ? {} : { actor }),
  };
  return { draft, id, state };
}

/** A refusal journalled against the thread. */
function failure({ atIso, error }: { atIso: string; error: string }): SlackSendFailure {
  return { atIso, channel: TARGET.channel, error, threadTs: TARGET.threadTs };
}

describe("resolveSlackSendOutcome", () => {
  it("reads the held reply the call left, with the gate's own reason", () => {
    expect(
      resolveSlackSendOutcome({ drafts: [heldRow({})], failures: [], reply: NOT_YET, sinceIso: SINCE, target: TARGET }),
    ).toEqual({ atIso: "2026-10-07T05:53:40.000Z", state: "held", why: HELD_WHY });
  });

  it("says sent off a message of the owner's in the thread over a failure or a spent hold, but never over a waiting hold", () => {
    const replied: OwnerReply = {
      atIso: "2026-10-07T06:01:00.000Z",
      kind: "replied",
      permalink: "https://acme.slack.com/archives/C0SYN000001/p1791352860000100",
      ts: "1791352860.000100",
    };
    const refused = failure({ atIso: "2026-10-07T05:54:00.000Z", error: "refused" });
    const sent = { atIso: replied.atIso, permalink: replied.permalink, state: "sent" };
    expect([
      resolveSlackSendOutcome({ drafts: [], failures: [refused], reply: replied, sinceIso: SINCE, target: TARGET }),
      resolveSlackSendOutcome({
        drafts: [heldRow({ state: "released" }), heldRow({ id: "sd-00000001", tsIso: "2026-10-07T05:50:00.000Z" })],
        failures: [],
        reply: replied,
        sinceIso: SINCE,
        target: TARGET,
      }),
      // The send the owner asked for is parked and still waiting, so the message is one they typed themselves.
      resolveSlackSendOutcome({
        drafts: [heldRow({})],
        failures: [refused],
        reply: replied,
        sinceIso: SINCE,
        target: TARGET,
      }),
    ]).toEqual([sent, sent, { atIso: "2026-10-07T05:53:40.000Z", state: "held", why: HELD_WHY }]);
  });

  it("never reads an unreadable thread as not sent yet", () => {
    expect([
      resolveSlackSendOutcome({
        drafts: [heldRow({})],
        failures: [],
        reply: { kind: "could-not-check", why: "no owner id" },
        sinceIso: SINCE,
        target: TARGET,
      }),
      resolveSlackSendOutcome({ drafts: [], failures: [], reply: NOT_YET, sinceIso: SINCE, target: undefined }),
    ]).toEqual([
      { state: "could-not-check", why: "no owner id" },
      { state: "could-not-check", why: "the thread could not be read" },
    ]);
  });

  it("has the newer of a hold and a failure win, since a refusal the chair then parked is the hold", () => {
    const refusedFirst = failure({ atIso: "2026-10-07T05:53:10.000Z", error: "as-me gate: Lena is named untagged" });
    const refusedLast = failure({ atIso: "2026-10-07T05:54:30.000Z", error: "channel_not_found" });
    const refusedAtTheHold = failure({ atIso: "2026-10-07T05:53:40.000Z", error: "channel_not_found" });
    expect([
      resolveSlackSendOutcome({
        drafts: [heldRow({})],
        failures: [refusedFirst],
        reply: NOT_YET,
        sinceIso: SINCE,
        target: TARGET,
      }),
      resolveSlackSendOutcome({
        drafts: [heldRow({})],
        failures: [refusedFirst, refusedLast],
        reply: NOT_YET,
        sinceIso: SINCE,
        target: TARGET,
      }),
      // Only a NEWER hold overrides a failure, so a tie is the failure.
      resolveSlackSendOutcome({
        drafts: [heldRow({})],
        failures: [refusedAtTheHold],
        reply: NOT_YET,
        sinceIso: SINCE,
        target: TARGET,
      }),
    ]).toEqual([
      { atIso: "2026-10-07T05:53:40.000Z", state: "held", why: HELD_WHY },
      { atIso: "2026-10-07T05:54:30.000Z", error: "channel_not_found", state: "failed" },
      { atIso: "2026-10-07T05:53:40.000Z", error: "channel_not_found", state: "failed" },
    ]);
  });

  it("is not sent yet over a hold from before the owner asked, a released or bot row, or another thread's", () => {
    const drafts = [
      heldRow({ id: "sd-00000001", tsIso: "2026-10-07T05:50:00.000Z" }),
      heldRow({ id: "sd-00000002", state: "released" }),
      heldRow({ actor: "bot", id: "sd-00000003" }),
      heldRow({ id: "sd-00000004", threadTs: "1791351000.000100" }),
      heldRow({ channel: "C0SYNELSEWHERE", id: "sd-00000005" }),
    ];
    const earlier = failure({ atIso: "2026-10-07T05:50:00.000Z", error: "refused before the owner asked" });
    expect(
      resolveSlackSendOutcome({ drafts, failures: [earlier], reply: NOT_YET, sinceIso: SINCE, target: TARGET }),
    ).toEqual({ readAtIso: "2026-10-07T06:10:00.000Z", state: "not-sent-yet" });
  });

  it("counts a top-level hold or failure in a DM, where the owner answers outside threads, and never in a channel", () => {
    const dm = { channel: "D777", threadTs: "1785114600.000300" };
    const topLevelHold: SlackDraftItem = {
      ...heldRow({ channel: "D777" }),
      draft: { ...heldRow({ channel: "D777" }).draft, shape: "top-level", threadTs: undefined },
    };
    const topLevelFailure: SlackSendFailure = {
      atIso: "2026-10-07T05:54:30.000Z",
      channel: "D777",
      error: "x",
      threadTs: null,
    };
    const inChannel: SlackDraftItem = {
      ...heldRow({}),
      draft: { ...heldRow({}).draft, shape: "top-level", threadTs: undefined },
    };
    expect([
      resolveSlackSendOutcome({ drafts: [topLevelHold], failures: [], reply: NOT_YET, sinceIso: SINCE, target: dm }),
      resolveSlackSendOutcome({ drafts: [], failures: [topLevelFailure], reply: NOT_YET, sinceIso: SINCE, target: dm }),
      resolveSlackSendOutcome({ drafts: [inChannel], failures: [], reply: NOT_YET, sinceIso: SINCE, target: TARGET }),
    ]).toEqual([
      { atIso: "2026-10-07T05:53:40.000Z", state: "held", why: HELD_WHY },
      { atIso: "2026-10-07T05:54:30.000Z", error: "x", state: "failed" },
      { readAtIso: "2026-10-07T06:10:00.000Z", state: "not-sent-yet" },
    ]);
  });

  it("compares a hold's instant, never its text: an offset spelling before the owner asked is not their send's hold", () => {
    expect(
      resolveSlackSendOutcome({
        drafts: [heldRow({ tsIso: "2026-10-07T06:00:00.000+11:00" })],
        failures: [],
        reply: NOT_YET,
        sinceIso: SINCE,
        target: TARGET,
      }),
    ).toEqual({ readAtIso: "2026-10-07T06:10:00.000Z", state: "not-sent-yet" });
  });

  it("cannot check over this thread's hold whose instant Date.parse would guess at, never filtering it out as old", () => {
    expect(
      resolveSlackSendOutcome({
        drafts: [heldRow({ tsIso: "0" })],
        failures: [],
        reply: NOT_YET,
        sinceIso: SINCE,
        target: TARGET,
      }),
    ).toEqual({
      state: "could-not-check",
      why: 'held draft sd-e1f8af68 carries no instant ("0"), so whether it holds this send cannot be told',
    });
  });
});

describe("draftsOrUnsure", () => {
  it("refuses a register with a torn line, which may be any row's newest event, and folds a clean one", () => {
    const torn = parseSlackDraftLog({ lines: ['{"kind":"released","id":"sd-x"'] });
    expect(torn.skipped.length).toBe(1);
    expect([
      unwrapErr(draftsOrUnsure({ log: torn })),
      unwrap(draftsOrUnsure({ log: parseSlackDraftLog({ lines: [] }) })),
    ]).toEqual([DraftRegisterUnsureErrors.linesPassedOver({ note: skippedDraftNote({ skipped: torn.skipped })! }), []]);
  });

  it("refuses a register whose release Date.parse would guess the instant of, since it folds the hold out of held", () => {
    const { draft } = heldRow({});
    const parked = { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso } as const;
    const release = ({ tsIso }: { tsIso: string }) =>
      ({ channel: TARGET.channel, id: draft.id, kind: "released", ts: "1791351500.000100", tsIso }) as const;
    const cleanRelease = release({ tsIso: "2026-10-07T05:55:00.000Z" });
    const undated = unwrapErr(draftsOrUnsure({ log: { events: [parked, release({ tsIso: "0" })], skipped: [] } }));
    expect([
      undated.code,
      undated.message,
      unwrap(draftsOrUnsure({ log: { events: [parked, cleanRelease], skipped: [] } })).map((item) => item.state),
    ]).toEqual([
      "DRAFTS_UNDATED",
      "the draft register has rows with no strict instant, so no hold can be ruled out: sd-e1f8af68 (released)",
      ["released"],
    ]);
  });
});

describe("readSlackSendOutcome", () => {
  it("refuses a --since that is not an instant before reading anything", async () => {
    const unread = new Error("the thread is never read for a malformed --since");
    const read = await readSlackSendOutcome({
      deps: {
        api: { history: () => Promise.reject(unread), replies: () => Promise.reject(unread) },
        drafts: () => ok([]),
        failures: () => ok([]),
        nowMs: () => 0,
        ownerUserId: "U0OWNER",
      },
      sinceIso: "when they said send it",
      url: "https://acme.slack.com/archives/C0SYN000001/p1791351441819519",
    });
    expect(unwrapErr(read)).toEqual(SlackSendOutcomeErrors.sinceNotInstant({ since: "when they said send it" }));
    expect(unwrapErr(read).message).toBe('--since "when they said send it" is not an ISO instant to the millisecond');
  });

  it("refuses a --since Date.parse would guess at — a bare number, or finer than a millisecond — before reading", async () => {
    const unread = new Error("the thread is never read for a --since that is not one instant");
    const deps = {
      api: { history: () => Promise.reject(unread), replies: () => Promise.reject(unread) },
      drafts: () => ok([]),
      failures: () => ok([]),
      nowMs: () => 0,
      ownerUserId: "U0OWNER",
    };
    const url = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";
    const reads = await Promise.all(
      ["0", "2026-10-07T05:52:56.000900Z"].map((sinceIso) => readSlackSendOutcome({ deps, sinceIso, url })),
    );
    expect(reads.map((read) => unwrapErr(read).code)).toEqual(["SINCE_NOT_INSTANT", "SINCE_NOT_INSTANT"]);
  });
});
