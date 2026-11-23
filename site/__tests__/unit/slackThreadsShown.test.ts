/*
 * The record of the Slack threads one call put on the owner's screen. The console must not open the same thread over
 * and over, and a read of a thread other than the one on screen says so.
 */
import { describe, expect, it } from "vitest";

import {
  alreadyShownAnswer,
  alreadyShownWhy,
  NO_THREADS_SHOWN,
  noteThreadShown,
  otherThreadNotice,
  shownBefore,
  threadShownKey,
} from "../../lib/slackThreadsShown";

const ROOT_X = "https://acme.slack.com/archives/C0SYNENGINEER/p1759730000123456";
const REPLY_X =
  "https://acme.slack.com/archives/C0SYNENGINEER/p1759730900654321?thread_ts=1759730000.123456&cid=C0SYNENGINEER";
const ROOT_Y = "https://acme.slack.com/archives/C0SYNOBSERVE1/p1759720000111111";
const SAME_TS_OTHER_CHANNEL = "https://acme.slack.com/archives/C0SYNOBSERVE1/p1759730000123456";
const SAME_CHANNEL_OTHER_WORKSPACE = "https://beta.slack.com/archives/C0SYNENGINEER/p1759730000123456";
const NOT_SLACK = "https://github.com/acme/acme-admin/pull/17564";

const AT_FIRST = "2026-10-06T07:54:22.000Z";
const AT_SECOND = "2026-10-06T07:55:01.000Z";

describe("threadShownKey", () => {
  it("keys a root's link and a reply's link to one thread, and nothing for a link that is not Slack", () => {
    expect(threadShownKey({ link: ROOT_X })).toBe("acme/C0SYNENGINEER:1759730000.123456");
    expect(threadShownKey({ link: ` ${REPLY_X} ` })).toBe("acme/C0SYNENGINEER:1759730000.123456");
    expect(threadShownKey({ link: SAME_TS_OTHER_CHANNEL })).toBe("acme/C0SYNOBSERVE1:1759730000.123456");
    expect(threadShownKey({ link: NOT_SLACK })).toBeUndefined();
  });

  it("keys the same channel and ts in another workspace as another thread", () => {
    expect(threadShownKey({ link: SAME_CHANNEL_OTHER_WORKSPACE })).toBe("beta/C0SYNENGINEER:1759730000.123456");
    const shown = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });
    expect(shownBefore({ shown, url: SAME_CHANNEL_OTHER_WORKSPACE })).toBe(false);
    expect(alreadyShownAnswer({ shown, url: SAME_CHANNEL_OTHER_WORKSPACE })).toBeUndefined();
  });

  it("keys a host spelled in capitals as the same thread, since a host is case-insensitive", () => {
    const upper = "HTTPS://ACME.Slack.com/archives/C0SYNENGINEER/p1759730000123456";
    expect(threadShownKey({ link: upper })).toBe("acme/C0SYNENGINEER:1759730000.123456");
    const shown = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });
    expect(alreadyShownAnswer({ shown, url: upper })!.openedAtIso).toBe(AT_FIRST);
  });

  it("keys an escaped thread_ts, an escaped path, a trailing slash and a fragment as the thread they name", () => {
    const spellings = [
      "https://acme.slack.com/archives/C0SYNENGINEER/p1759730900654321?thread_ts=1759730000%2E123456&cid=C0SYNENGINEER",
      "https://acme.slack.com/archives/C0SYNENGINEER/p%31759730000123456",
      "https://acme.slack.com/archives/C0SYNENGINEER/p1759730000123456/",
      "https://acme.slack.com/archives/C0SYNENGINEER/p1759730000123456#top",
    ];
    expect(spellings.map((link) => threadShownKey({ link }))).toEqual([
      "acme/C0SYNENGINEER:1759730000.123456",
      "acme/C0SYNENGINEER:1759730000.123456",
      "acme/C0SYNENGINEER:1759730000.123456",
      "acme/C0SYNENGINEER:1759730000.123456",
    ]);
  });

  it("keys nothing for a link that is not https on a Slack workspace", () => {
    const links = [
      "http://acme.slack.com/archives/C0SYNENGINEER/p1759730000123456",
      "https://acme.slack.com.evil.example/archives/C0SYNENGINEER/p1759730000123456",
      "not a link",
    ];
    expect(links.map((link) => threadShownKey({ link }))).toEqual([undefined, undefined, undefined]);
  });

  it("keys a bare reply permalink, which names no root, by its own ts: the stated limit, not a root lookup", () => {
    expect(threadShownKey({ link: "https://acme.slack.com/archives/C0SYNENGINEER/p1759730900654321" })).toBe(
      "acme/C0SYNENGINEER:1759730900.654321",
    );
  });
});

describe("noteThreadShown", () => {
  it("records a thread once, its latest opening last", () => {
    const once = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });
    expect(once).toEqual({ threads: [{ atIso: AT_FIRST, key: "acme/C0SYNENGINEER:1759730000.123456", url: ROOT_X }] });
    const twice = noteThreadShown({ atIso: AT_SECOND, shown: once, url: ROOT_Y });
    const back = noteThreadShown({ atIso: "2026-10-06T07:56:00.000Z", shown: twice, url: REPLY_X });
    expect(back.threads.map((thread) => [thread.key, thread.atIso])).toEqual([
      ["acme/C0SYNOBSERVE1:1759720000.111111", AT_SECOND],
      ["acme/C0SYNENGINEER:1759730000.123456", "2026-10-06T07:56:00.000Z"],
    ]);
  });

  it("leaves the record alone for a link that is not a Slack thread", () => {
    const once = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });
    expect(noteThreadShown({ atIso: AT_SECOND, shown: once, url: NOT_SLACK })).toBe(once);
  });
});

describe("shownBefore and alreadyShownAnswer", () => {
  const shownX = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });

  it("answers already-open for the thread in front of the owner, by its root's link or a reply's", () => {
    expect([shownBefore({ shown: shownX, url: ROOT_X }), shownBefore({ shown: shownX, url: REPLY_X })]).toEqual([
      true,
      true,
    ]);
    expect(alreadyShownAnswer({ shown: shownX, url: REPLY_X })).toEqual({
      alreadyOnOwnerScreen: true,
      openedAtIso: AT_FIRST,
      url: ROOT_X,
      why:
        "that Slack thread is already on the owner's screen from earlier in this call, so nothing was opened again; walk them " +
        "through it (read it whole with slack_open if you have not), and never open it again",
    });
  });

  it("lets a thread open that this call never showed: none yet, the same ts in another channel, or not Slack", () => {
    expect([
      shownBefore({ shown: NO_THREADS_SHOWN, url: ROOT_X }),
      shownBefore({ shown: shownX, url: SAME_TS_OTHER_CHANNEL }),
      shownBefore({ shown: shownX, url: NOT_SLACK }),
    ]).toEqual([false, false, false]);
    expect(alreadyShownAnswer({ shown: shownX, url: ROOT_Y })).toBeUndefined();
  });

  it("answers already-open for a thread shown earlier and since covered by another, naming its own opening", () => {
    const thenY = noteThreadShown({ atIso: AT_SECOND, shown: shownX, url: ROOT_Y });
    expect([shownBefore({ shown: thenY, url: REPLY_X }), shownBefore({ shown: thenY, url: ROOT_Y })]).toEqual([
      true,
      true,
    ]);
    expect(alreadyShownAnswer({ shown: thenY, url: REPLY_X })).toEqual({
      alreadyOnOwnerScreen: true,
      openedAtIso: AT_FIRST,
      url: ROOT_X,
      why:
        "that Slack thread is already on the owner's screen from earlier in this call, so nothing was opened again; walk them " +
        "through it (read it whole with slack_open if you have not), and never open it again",
    });
  });
});

describe("alreadyShownWhy", () => {
  it("reads the reason off an already-open answer, and nothing off a lookalike or an ordinary answer", () => {
    const shownX = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });
    const answer = alreadyShownAnswer({ shown: shownX, url: ROOT_X });
    expect(alreadyShownWhy({ answer })).toBe(answer!.why);
    expect(alreadyShownWhy({ answer: { alreadyOnOwnerScreen: true } })).toBeUndefined();
    expect(alreadyShownWhy({ answer: { alreadyOnOwnerScreen: "yes", why: "x" } })).toBeUndefined();
    expect(alreadyShownWhy({ answer: { landed: ROOT_X } })).toBeUndefined();
    expect(alreadyShownWhy({ answer: "opened" })).toBeUndefined();
  });
});

describe("otherThreadNotice", () => {
  const shownX = noteThreadShown({ atIso: AT_FIRST, shown: NO_THREADS_SHOWN, url: ROOT_X });

  it("names the thread on the owner's screen when the read is a different one", () => {
    expect(otherThreadNotice({ shown: shownX, url: ROOT_Y })).toBe(
      `this is NOT the thread on the owner's screen: the one put in front of them in this call is ${ROOT_X}, opened at ` +
        `${AT_FIRST}. Say which thread you are talking about before you talk about it, and never speak of this one ` +
        "as the one they are looking at",
    );
  });

  it("says nothing with no thread shown, for the thread on the owner's screen, or for a link that is not Slack", () => {
    expect([
      otherThreadNotice({ shown: NO_THREADS_SHOWN, url: ROOT_Y }),
      otherThreadNotice({ shown: shownX, url: REPLY_X }),
      otherThreadNotice({ shown: shownX, url: NOT_SLACK }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
