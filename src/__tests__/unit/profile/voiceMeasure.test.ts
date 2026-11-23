/**
 * Measuring the owner's voice length register from the Slack messages they sent: which messages count, and what the cohorts
 * say about them.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { proseWordCount } from "../../../outbound/voice/proseWords.js";
import {
  measureSlackVoice,
  nearestRank,
  VOICE_MEASURE_QUALIFICATION,
  VOICE_MEASURE_SOURCE,
} from "../../../profile/voiceMeasure.js";

/** The owner's Slack user id in these tests. */
const OWNER = "U0SYNOWNER1";

/** The instant every measurement here is stamped with. */
const NOW = "2026-11-05T05:00:00.000Z";

/** One Slack record, the owner's and hand-typed unless a field says otherwise. */
function slack({
  id,
  text,
  author = OWNER,
  channel = "C0SYNCHAN01",
  kind = "message",
  raw = {},
  tsIso = "2026-11-01T00:00:00.000Z",
}: {
  id: string;
  text: string;
  author?: string;
  channel?: string;
  kind?: "message" | "comment" | "file";
  raw?: Record<string, unknown>;
  tsIso?: string;
}): CorpusRecord {
  return {
    author,
    container: `slack/${channel}`,
    kind,
    raw: { text, user: author, ...raw },
    refs: [],
    source: "slack",
    sourceId: `${channel}:${id}`,
    text: `${text}\n\nReactions: :eyes: x1`,
    tsIso,
    url: `https://acme.slack.com/archives/${channel}/p${id}`,
  };
}

/** A message of `n` words. */
function words({ n }: { n: number }): string {
  return Array.from({ length: n }, (_, index) => `w${String(index)}`).join(" ");
}

describe("proseWordCount", () => {
  it("counts whitespace tokens carrying a letter or digit, Unicode included", () => {
    expect(proseWordCount({ text: "café déjà vu 42" })).toBe(4);
    expect(proseWordCount({ text: "  one\n\ttwo  " })).toBe(2);
  });

  it("counts nothing in emoji, punctuation or whitespace alone", () => {
    expect(proseWordCount({ text: "🎉 👍 — !!" })).toBe(0);
    expect(proseWordCount({ text: "   " })).toBe(0);
    expect(proseWordCount({ text: "" })).toBe(0);
  });

  it("counts Slack markup as stored: a mention or link is one token", () => {
    expect(proseWordCount({ text: "ping <@U0SYNOTHER1> re <https://acme.example/x|the doc>" })).toBe(5);
  });
});

describe("nearestRank", () => {
  it("answers nothing for an empty list", () => {
    expect(nearestRank({ percentile: 0.5, sorted: [] })).toBe(undefined);
  });

  it("answers the only value for a list of one", () => {
    expect(nearestRank({ percentile: 0.5, sorted: [7] })).toBe(7);
    expect(nearestRank({ percentile: 0.9, sorted: [7] })).toBe(7);
  });

  it("takes the lower middle as the median of an even list, and the nearest rank above for p75 and p90", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRank({ percentile: 0.5, sorted })).toBe(5);
    expect(nearestRank({ percentile: 0.75, sorted })).toBe(8);
    expect(nearestRank({ percentile: 0.9, sorted })).toBe(9);
  });
});

describe("measureSlackVoice", () => {
  it("measures the owner's typed messages into slack/all-sent, and their DMs into slack-dm/aggregate as well", () => {
    const records = [
      slack({ id: "1", text: words({ n: 4 }) }),
      slack({ id: "2", text: words({ n: 10 }) }),
      slack({ id: "3", kind: "comment", text: words({ n: 2 }) }),
      slack({ channel: "D0SYNDMCH01", id: "4", text: words({ n: 6 }) }),
    ];
    const measured = measureSlackVoice({ nowIso: NOW, ownerUserId: OWNER, records });
    expect(measured.cohorts).toEqual([
      {
        ceilingWords: null,
        cohort: "all-sent",
        measuredAt: NOW,
        medianWords: 4,
        p75Words: 6,
        p90Words: 10,
        qualification: VOICE_MEASURE_QUALIFICATION,
        sampleCount: 4,
        source: VOICE_MEASURE_SOURCE,
        surface: "slack",
      },
      {
        ceilingWords: null,
        cohort: "aggregate",
        measuredAt: NOW,
        medianWords: 6,
        p75Words: 6,
        p90Words: 6,
        qualification: VOICE_MEASURE_QUALIFICATION,
        sampleCount: 1,
        source: VOICE_MEASURE_SOURCE,
        surface: "slack-dm",
      },
    ]);
    expect(measured.counts.eligibleAllSent).toBe(4);
    expect(measured.counts.eligibleDm).toBe(1);
  });

  it("counts raw.text only, never the assembled record text with its reactions summary", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [slack({ id: "1", text: "just three words" })],
    });
    expect(measured.cohorts.map((cohort) => cohort.medianWords)).toEqual([3]);
  });

  it("ignores another person's messages and the owner's file records", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [
        slack({ author: "U0SYNOTHER1", id: "1", text: words({ n: 40 }) }),
        slack({ id: "2", kind: "file", text: words({ n: 40 }) }),
        slack({ id: "3", text: words({ n: 5 }) }),
      ],
    });
    expect(measured.counts.ownerMessageVersions).toBe(1);
    expect(measured.cohorts.map((cohort) => cohort.sampleCount)).toEqual([1]);
  });

  it("leaves out what an app posted under the owner's name, with each reason counted apart", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [
        slack({ id: "1", raw: { bot_id: "B0SYNAPP001" }, text: words({ n: 80 }) }),
        slack({ id: "2", raw: { app_id: "A0SYNAPP001" }, text: words({ n: 80 }) }),
        slack({ id: "3", raw: { app_id: "", bot_id: "" }, text: words({ n: 3 }) }),
      ],
    });
    expect(measured.counts.excludedAppBotId).toBe(1);
    expect(measured.counts.excludedAppId).toBe(1);
    expect(measured.cohorts.map((cohort) => [cohort.sampleCount, cohort.medianWords])).toEqual([[1, 3]]);
  });

  it("keeps a message carrying no client_msg_id", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [slack({ id: "1", raw: { client_msg_id: undefined }, text: words({ n: 2 }) })],
    });
    expect(measured.counts.eligibleAllSent).toBe(1);
  });

  it("keeps a file share with words and leaves out one with none", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [
        slack({ id: "1", raw: { subtype: "file_share" }, text: words({ n: 3 }) }),
        slack({ id: "2", raw: { subtype: "file_share" }, text: "" }),
      ],
    });
    expect(measured.counts.eligibleAllSent).toBe(1);
    expect(measured.counts.excludedNoProseWords).toBe(1);
  });

  it("counts a broadcast reply once: the reply, never its top-level channel copy", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [
        slack({ id: "1", kind: "comment", raw: { subtype: "thread_broadcast" }, text: words({ n: 4 }) }),
        slack({ id: "2", raw: { subtype: "thread_broadcast" }, text: words({ n: 4 }) }),
      ],
    });
    expect(measured.counts.eligibleAllSent).toBe(1);
    expect(measured.counts.excludedBroadcastCopy).toBe(1);
  });

  it("leaves out a system subtype and a payload with no text string", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [
        slack({ id: "1", raw: { subtype: "channel_join" }, text: "has joined the channel" }),
        slack({ id: "2", raw: { text: 7 }, text: "x" }),
      ],
    });
    expect(measured.counts.excludedSubtype).toBe(1);
    expect(measured.counts.excludedNoRawText).toBe(1);
    expect(measured.cohorts).toEqual([]);
  });

  it("counts an edited message once, as the version the logical-latest view keeps", () => {
    const measured = measureSlackVoice({
      nowIso: NOW,
      ownerUserId: OWNER,
      records: [
        slack({ id: "1", text: words({ n: 2 }), tsIso: "2026-11-01T00:00:00.000Z" }),
        slack({ id: "1", text: words({ n: 9 }), tsIso: "2026-11-02T00:00:00.000Z" }),
      ],
    });
    expect(measured.counts.ownerMessageVersions).toBe(2);
    expect(measured.counts.supersededVersions).toBe(1);
    expect(measured.cohorts.map((cohort) => [cohort.sampleCount, cohort.medianWords])).toEqual([[1, 9]]);
  });

  it("writes no cohort at all for an empty population, so absence stays not measured", () => {
    const measured = measureSlackVoice({ nowIso: NOW, ownerUserId: OWNER, records: [] });
    expect(measured.cohorts).toEqual([]);
    expect(measured.counts).toEqual({
      eligibleAllSent: 0,
      eligibleDm: 0,
      excludedAppBotId: 0,
      excludedAppId: 0,
      excludedBroadcastCopy: 0,
      excludedNoProseWords: 0,
      excludedNoRawText: 0,
      excludedSubtype: 0,
      ownerMessageVersions: 0,
      supersededVersions: 0,
    });
  });
});
