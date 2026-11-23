/**
 * `witness help` is proved against Slack's own read of the thread, never the caller's flags alone — a peer bot's
 * `cc <@us>` opening an own watch is the first case below.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import type { WitnessHelpRequest } from "../../../../live/witness/help.js";
import { helpThreadVerdict } from "../../../../live/witness/helpThread.js";

const SELF = "U0SELF";
const ROOT = "1790662224.935389";
const HELPED_TS = "1790728680.000100";
const REQUEST: WitnessHelpRequest = {
  key: { channel: "C0OPS", messageTs: HELPED_TS, threadTs: ROOT },
  text: "anything I can do to assist?",
  userId: "U0SYNTEAMMATE",
};
const RESPONDERS = new Set(["U0LEAD", "U0SYNTEAMMATE"]);

/** A person's row in the thread. */
function person({ ts, user, text }: { ts: string; user: string; text: string }): Record<string, unknown> {
  return { text, thread_ts: ROOT, ts, type: "message", user };
}

/** The thread as Slack returns it: the root tagging the bot, then the message being helped. */
function thread({
  root = person({ text: `<@${SELF}> is the e2e fix in?`, ts: ROOT, user: "U0LEAD" }),
} = {}): readonly unknown[] {
  return [root, person({ text: REQUEST.text, ts: HELPED_TS, user: "U0SYNTEAMMATE" })];
}

/** The verdict over a thread, with the fixed responder set. */
function verdict({
  rows,
  request = REQUEST,
}: {
  rows: readonly unknown[];
  request?: WitnessHelpRequest;
}): ReturnType<typeof helpThreadVerdict> {
  return helpThreadVerdict({ admits: ({ userId }) => RESPONDERS.has(userId), request, rows, selfUserId: SELF });
}

describe("helpThreadVerdict", () => {
  it("refuses a thread where only a peer bot tagged this bot — no person asked it in", () => {
    const peerRoot = { bot_id: "B0PEER", text: `cc <@${SELF}>`, ts: ROOT, type: "message", user: "U0SYNPEERBOT" };

    expect(unwrapErr(verdict({ rows: thread({ root: peerRoot }) })).code).toBe("NO_RESPONDER_TAG");
  });

  it("refuses a thread whose only tag of the bot came from someone off the whitelist", () => {
    const stranger = person({ text: `<@${SELF}> help`, ts: ROOT, user: "U0SYNSTRANGER" });

    expect(unwrapErr(verdict({ rows: thread({ root: stranger }) })).code).toBe("NO_RESPONDER_TAG");
  });

  it("refuses a responder's tag that came AFTER the message, which asked the bot into nothing before it", () => {
    const rows = [
      person({ text: "the sync broke", ts: ROOT, user: "U0LEAD" }),
      person({ text: REQUEST.text, ts: HELPED_TS, user: "U0SYNTEAMMATE" }),
      person({ text: `<@${SELF}> look`, ts: "1790728690.000100", user: "U0LEAD" }),
    ];

    expect(unwrapErr(verdict({ rows })).code).toBe("NO_RESPONDER_TAG");
  });

  it("refuses a message the thread does not hold, and the root itself", () => {
    const elsewhere = { ...REQUEST, key: { ...REQUEST.key, messageTs: "1790728999.000100" } };
    const root = { ...REQUEST, key: { ...REQUEST.key, messageTs: ROOT }, userId: "U0LEAD" };

    expect(unwrapErr(verdict({ request: elsewhere, rows: thread() })).code).toBe("NOT_IN_THREAD");
    expect(unwrapErr(verdict({ request: root, rows: thread() })).code).toBe("NOT_IN_THREAD");
  });

  it("refuses an asker the thread contradicts, naming who Slack says wrote it", () => {
    const error = unwrapErr(verdict({ request: { ...REQUEST, userId: "U0LEAD" }, rows: thread() }));

    expect(error).toMatchObject({ actual: "U0SYNTEAMMATE", code: "AUTHOR_MISMATCH" });
  });

  it("refuses a message that tags the bot itself — that is the address path's", () => {
    const rows = [thread()[0], person({ text: `<@${SELF}> anything?`, ts: HELPED_TS, user: "U0SYNTEAMMATE" })];

    expect(unwrapErr(verdict({ rows })).code).toBe("ADDRESSED_TO_BOT");
  });

  it("passes a reply by the claimed person after a responder's tag of the bot", () => {
    expect(unwrap(verdict({ rows: thread() }))).toBe(true);
  });
});
