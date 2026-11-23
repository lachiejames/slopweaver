import { describe, expect, it } from "vitest";

import {
  ageWords,
  appKeyOf,
  FRONT_APP_BAND_POLL_MS,
  type FrontAppBandSample,
  focusedFrontAppBand,
  frontAppBandOf,
  type MessengerRead,
  messengerBand,
  messengerReadsOf,
  pageKeyOf,
  toneOfApp,
} from "../../lib/messengerBand";

const NOW_ISO = "2026-11-09T04:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const QUEUE = { path: "/queue", title: "Queue" };
const CARD_TITLE = "Is the CI ratchet card superseded?";
const SLACK_KEY = "com.tinyspeck.slackmacgap";

const slack: FrontAppBandSample = {
  app: "Slack",
  appKey: SLACK_KEY,
  bundleId: SLACK_KEY,
  place: "front",
  sampledAtIso: NOW_ISO,
  title: null,
};

const secondsAgo = ({ seconds }: { seconds: number }): string => new Date(NOW_MS - seconds * 1000).toISOString();

const band = (over: Partial<Parameters<typeof messengerBand>[0]> = {}): ReturnType<typeof messengerBand> =>
  messengerBand({
    canLook: true,
    front: undefined,
    nowMs: NOW_MS,
    openCard: undefined,
    page: QUEUE,
    reads: [],
    ...over,
  });

describe("messengerBand: the approved moments", () => {
  it("names an open card nothing has read", () => {
    expect(band({ openCard: { key: "card-1", title: CARD_TITLE } })).toEqual({
      eyebrow: "Queue · card",
      kind: "card",
      sight: { fill: "half", words: "Can read this card · hasn't yet" },
      title: CARD_TITLE,
      tone: "slopweaver",
    });
  });

  it("credits a published page read two minutes ago", () => {
    const title = "A help drawer on every page, in place of the Docs site";
    const path = "/view?src=help-drawer";
    const reads: MessengerRead[] = [{ atIso: secondsAgo({ seconds: 120 }), kind: "page", open: undefined, path }];
    expect(band({ page: { path, title }, reads })).toEqual({
      eyebrow: "Page",
      kind: "page",
      sight: { fill: "full", words: "Read this page 2 min ago" },
      title,
      tone: "slopweaver",
    });
  });

  it("keeps a long card title whole for the clamp and the hover", () => {
    const title = "A very long card title ".repeat(10).trim();
    const drawn = band({ openCard: { key: "card-1", title } });
    expect(drawn.title).toBe(title);
    expect(drawn.sight.words).toBe("Can read this card · hasn't yet");
  });

  it("offers a look at Slack when nothing has been read", () => {
    expect(band({ front: slack })).toEqual({
      eyebrow: "App in front",
      kind: "app",
      sight: { fill: "half", words: "Can look when you ask · hasn't looked" },
      title: "Slack",
      tone: "slack",
    });
  });

  it("says name only where no look can be taken", () => {
    expect(band({ canLook: false, front: slack }).sight).toEqual({ fill: "none", words: "Name only" });
  });

  it("claims a thread read and not the rest of Slack, however the thread was found", () => {
    const reads: MessengerRead[] = [
      { atIso: secondsAgo({ seconds: 40 }), kind: "slack-channel" },
      { atIso: secondsAgo({ seconds: 30 }), kind: "slack-thread" },
    ];
    expect(band({ front: slack, reads }).sight).toEqual({
      fill: "half",
      words: "Read the thread · not the rest of Slack",
    });
  });

  it("keeps the pasted thread's claim where no look can be taken", () => {
    const reads: MessengerRead[] = [{ atIso: secondsAgo({ seconds: 30 }), kind: "slack-thread" }];
    expect(band({ canLook: false, front: slack, reads }).sight.fill).toBe("half");
  });

  it("composes Chrome's title on a call", () => {
    const front: FrontAppBandSample = {
      app: "Chrome",
      appKey: "com.google.Chrome",
      bundleId: "com.google.Chrome",
      place: "front",
      sampledAtIso: NOW_ISO,
      title: "Pull requests",
    };
    expect(band({ front })).toEqual({
      eyebrow: "App in front",
      kind: "app",
      sight: { fill: "half", words: "Can look when you ask · hasn't looked" },
      title: "Chrome · Pull requests",
      tone: "chrome",
    });
  });

  it("never calls the application left for the messenger the one in front", () => {
    expect(band({ front: { ...slack, place: "before-messenger" } })).toEqual({
      eyebrow: "Last app before messenger",
      kind: "app",
      sight: { fill: "half", words: "Can look when you ask · hasn't looked" },
      title: "Slack",
      tone: "slack",
    });
  });

  it("credits a look right after it was taken", () => {
    const reads: MessengerRead[] = [{ appKey: SLACK_KEY, atIso: secondsAgo({ seconds: 8 }), kind: "screen" }];
    expect(band({ front: slack, reads }).sight).toEqual({ fill: "full", words: "Looked at your screen 8 seconds ago" });
  });

  it("says both when a look and a thread read were taken", () => {
    const reads: MessengerRead[] = [
      { appKey: SLACK_KEY, atIso: secondsAgo({ seconds: 8 }), kind: "screen" },
      { atIso: secondsAgo({ seconds: 3 }), kind: "slack-channel" },
      { atIso: NOW_ISO, kind: "slack-thread" },
    ];
    expect(band({ front: slack, reads }).sight).toEqual({
      fill: "full",
      words: "Looked at your screen 8 seconds ago · read the thread",
    });
  });

  it("says both when a look found the thread through its channel alone", () => {
    const reads: MessengerRead[] = [
      { appKey: SLACK_KEY, atIso: secondsAgo({ seconds: 8 }), kind: "screen" },
      { atIso: NOW_ISO, kind: "slack-channel" },
    ];
    expect(band({ front: slack, reads }).sight.words).toBe("Looked at your screen 8 seconds ago · read the channel");
  });

  it("claims a channel's newest messages and not the rest of Slack", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, kind: "slack-channel" }];
    expect(band({ front: slack, reads }).sight).toEqual({
      fill: "half",
      words: "Read a channel's newest messages · not the rest of Slack",
    });
  });

  it("claims no Slack read on a look at another application", () => {
    const front: FrontAppBandSample = {
      ...slack,
      app: "Preview",
      appKey: "com.apple.Preview",
      bundleId: "com.apple.Preview",
    };
    const reads: MessengerRead[] = [
      { appKey: "com.apple.Preview", atIso: secondsAgo({ seconds: 8 }), kind: "screen" },
      { atIso: NOW_ISO, kind: "slack-thread" },
    ];
    expect(band({ front, reads }).sight.words).toBe("Looked at your screen 8 seconds ago");
  });

  it("gives no credit for a look at a different application", () => {
    const reads: MessengerRead[] = [{ appKey: "com.apple.Preview", atIso: secondsAgo({ seconds: 8 }), kind: "screen" }];
    expect(band({ front: slack, reads }).sight.words).toBe("Can look when you ask · hasn't looked");
  });

  it("draws an untitled unknown application under a shell that can look", () => {
    const front: FrontAppBandSample = {
      app: "Preview",
      appKey: "com.apple.Preview",
      bundleId: "com.apple.Preview",
      place: "front",
      sampledAtIso: NOW_ISO,
      title: null,
    };
    expect(band({ front })).toEqual({
      eyebrow: "App in front",
      kind: "app",
      sight: { fill: "half", words: "Can look when you ask · hasn't looked" },
      title: "Preview",
      tone: "other",
    });
  });

  it("draws an untitled unknown application under a shell that cannot", () => {
    const front: FrontAppBandSample = {
      app: "Preview",
      appKey: "com.apple.Preview",
      bundleId: "com.apple.Preview",
      place: "front",
      sampledAtIso: NOW_ISO,
      title: null,
    };
    expect(band({ canLook: false, front }).sight).toEqual({ fill: "none", words: "Name only" });
  });

  it("reads a page with no card as read just now", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, kind: "page", open: undefined, path: "/queue" }];
    expect(band({ reads })).toEqual({
      eyebrow: "Queue",
      kind: "page",
      sight: { fill: "full", words: "Read this page just now" },
      title: "Queue",
      tone: "slopweaver",
    });
  });
});

describe("messengerBand: what counts as read", () => {
  it("counts a page read taken with that card open as reading the card", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, kind: "page", open: "card-1", path: "/queue" }];
    expect(band({ openCard: { key: "card-1", title: CARD_TITLE }, reads }).sight.words).toBe("Read this card just now");
  });

  it("does not count another card's read", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, key: "card-2", kind: "card" }];
    expect(band({ openCard: { key: "card-1", title: CARD_TITLE }, reads }).sight.words).toBe(
      "Can read this card · hasn't yet",
    );
  });

  it("matches a page read whichever window named it", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, kind: "page", open: "card-1", path: "/queue?open=card-1" }];
    expect(band({ reads }).sight.words).toBe("Read this page just now");
  });

  it("does not count another page's read", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, kind: "page", open: undefined, path: "/alignment" }];
    expect(band({ reads }).sight.words).toBe("Can read this page · hasn't yet");
  });

  it("tells two published pages apart", () => {
    const reads: MessengerRead[] = [{ atIso: NOW_ISO, kind: "page", open: undefined, path: "/view?src=one" }];
    expect(band({ page: { path: "/view?src=two", title: "Two" }, reads }).sight.words).toBe(
      "Can read this page · hasn't yet",
    );
  });

  it("falls back to the page when an open card has no title", () => {
    expect(band({ openCard: { key: "card-1", title: undefined } }).kind).toBe("page");
  });

  it("uses the latest of several reads", () => {
    const reads: MessengerRead[] = [
      { atIso: secondsAgo({ seconds: 600 }), kind: "page", open: undefined, path: "/queue" },
      { atIso: secondsAgo({ seconds: 10 }), kind: "page", open: undefined, path: "/queue" },
    ];
    expect(band({ reads }).sight.words).toBe("Read this page 10 seconds ago");
  });

  it("lets the application in front win over an open card", () => {
    expect(band({ front: slack, openCard: { key: "card-1", title: CARD_TITLE } }).kind).toBe("app");
  });
});

describe("the band's parts", () => {
  it.each([
    [0, "just now"],
    [4, "just now"],
    [5, "5 seconds ago"],
    [59, "59 seconds ago"],
    [60, "1 min ago"],
    [3599, "59 min ago"],
    [3600, "1 hr ago"],
    [-30, "just now"],
  ])("words an age of %i seconds", (seconds, words) => {
    expect(ageWords({ atIso: secondsAgo({ seconds }), nowMs: NOW_MS })).toBe(words);
  });

  it.each([
    ["Slack", SLACK_KEY, "slack"],
    ["Google Chrome", "com.google.Chrome.canary", "chrome"],
    ["cmux", "com.cmuxterm.app", "cmux"],
    ["Slopweaver", "app.slopweaver.desktop", "slopweaver"],
    ["Preview", "com.apple.Preview", "other"],
    ["Slack", null, "slack"],
    ["Chrome", null, "chrome"],
    ["Notes", null, "other"],
  ])("tones %s with bundle %s", (app, bundleId, tone) => {
    expect(toneOfApp({ app, bundleId })).toBe(tone);
  });

  it("keys an application by bundle id, then by its lowercased name", () => {
    expect(appKeyOf({ app: "Slack", bundleId: SLACK_KEY })).toBe(SLACK_KEY);
    expect(appKeyOf({ app: "Slack", bundleId: null })).toBe("name:slack");
  });

  it("drops a window title that repeats the application's name", () => {
    expect(band({ front: { ...slack, title: "slack" } }).title).toBe("Slack");
    expect(band({ front: { ...slack, title: "   " } }).title).toBe("Slack");
  });

  it.each([
    ["/queue", "/queue"],
    ["/queue?open=abc&by=x&back=y", "/queue"],
    ["/view?src=abc", "/view?src=abc"],
    ["/x?b=2&a=1&open=c", "/x?a=1&b=2"],
  ])("keys %s", (path, key) => {
    expect(pageKeyOf({ path })).toBe(key);
  });

  it("reads only lines that settled with something established", () => {
    expect(
      messengerReadsOf({
        lines: [
          {},
          { settledAtIso: NOW_ISO },
          { knowledge: { kind: "slack-thread" } },
          { knowledge: { kind: "slack-thread" }, settledAtIso: NOW_ISO },
        ],
      }),
    ).toEqual([{ atIso: NOW_ISO, kind: "slack-thread" }]);
  });
});

describe("frontAppBandOf", () => {
  const sampledAtIso = NOW_ISO;
  const slackApp = { app: "Slack", bundleId: SLACK_KEY, kind: "app", title: "general" };
  const slackSample = { app: "Slack", appKey: SLACK_KEY, bundleId: SLACK_KEY, sampledAtIso, title: "general" };

  it("reads an application sample", () => {
    expect(frontAppBandOf({ messengerFocused: false, sampledAtIso, value: slackApp })).toEqual({
      ...slackSample,
      place: "front",
    });
  });

  it("reads the shell's kept application as the last one before the messenger", () => {
    expect(frontAppBandOf({ messengerFocused: true, sampledAtIso, value: { ...slackApp, kind: "behind" } })).toEqual({
      ...slackSample,
      place: "before-messenger",
    });
  });

  it("takes an older shell's application read while the messenger is focused as the one before it", () => {
    expect(frontAppBandOf({ messengerFocused: true, sampledAtIso, value: slackApp })).toEqual({
      ...slackSample,
      place: "before-messenger",
    });
  });

  it("relabels the drawn application the instant the messenger takes the focus", () => {
    expect(focusedFrontAppBand({ front: slack })).toEqual({ ...slack, place: "before-messenger" });
    expect(band({ front: focusedFrontAppBand({ front: slack }) }).eyebrow).toBe("Last app before messenger");
  });

  it("leaves nothing drawn, or an application already before the messenger, as it is", () => {
    const before: FrontAppBandSample = { ...slack, place: "before-messenger" };
    expect(focusedFrontAppBand({ front: undefined })).toBeUndefined();
    expect(focusedFrontAppBand({ front: before })).toBe(before);
  });

  it("reads every two seconds, never the drift watch's fifteen", () => {
    expect(FRONT_APP_BAND_POLL_MS).toBe(2_000);
  });

  it.each([
    ["the console in front", { kind: "console" }],
    ["a kind it does not know", { app: "Slack", bundleId: null, kind: "window", title: null }],
    ["a reason", { why: "the screen is locked" }],
    ["nothing", undefined],
    ["an empty name", { app: "", bundleId: null, kind: "app", title: null }],
    ["an over-long name", { app: "x".repeat(61), bundleId: null, kind: "app", title: null }],
    ["an over-long title", { app: "Slack", bundleId: null, kind: "app", title: "x".repeat(201) }],
    ["an over-long bundle", { app: "Slack", bundleId: "x".repeat(201), kind: "app", title: null }],
    ["a number for a title", { app: "Slack", bundleId: null, kind: "app", title: 3 }],
  ])("draws the page or card for %s", (_label, value) => {
    expect(frontAppBandOf({ messengerFocused: false, sampledAtIso, value })).toBeUndefined();
  });
});
