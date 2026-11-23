/**
 * Review asks to one person inside a day are ONE batch DM: a review ask beside one held
 * for the same person refuses unless `--supersedes` names it, and a single beside one sent them today refuses.
 */
import { describe, expect, it } from "vitest";

import type { ParkedSlackDraft, SlackDraftItem } from "../../../../outbound/slack/draftRegister.js";
import {
  pullRequestsLinked,
  reviewAskDmChannels,
  reviewAsksToPerson,
  samePersonDayRefusal,
} from "../../../../outbound/slack/draftSamePersonDay.js";

const JASPER = "U0SYN000006";
const JASPER_DM = "D0SYNJASPERDM01";
const SOMEONE_ELSE = "U0SYN000002";
/** 16:43 in Melbourne on the fixture day. */
const NOW = "2026-10-02T06:43:00.000Z";
const PR_URL = "https://github.com/acme/acme-admin/pull";

/** One review ask as the owner, top-level in a DM to Jasper by default. */
function row({
  id,
  state = "released",
  channel = JASPER,
  act = "review-ask",
  resolvedIso = "2026-10-02T03:22:43.000Z",
  tsIso = "2026-10-02T03:20:00.000Z",
  actor,
  threadTs,
}: {
  id: string;
  state?: SlackDraftItem["state"];
  channel?: string;
  act?: ParkedSlackDraft["act"];
  resolvedIso?: string;
  tsIso?: string;
  actor?: "bot";
  threadTs?: string;
}): SlackDraftItem {
  const draft: ParkedSlackDraft = {
    advisory: [],
    channel,
    digest: `digest-${id}`,
    form: "{}",
    id,
    mentions: [],
    payload: {
      form: "plain",
      text: `hey, could I grab a review on <${PR_URL}/18249|#18249>`,
      unfurl_links: false,
      unfurl_media: false,
    },
    shape: threadTs === undefined ? "top-level" : "thread",
    tsIso,
    why: "a review ask under test",
    ...(act === undefined ? {} : { act }),
    ...(actor === undefined ? {} : { actor }),
    ...(threadTs === undefined ? {} : { threadTs }),
  };
  if (state === "held") {
    return { draft, id, state };
  }
  return { draft, id, resolvedIso, state };
}

describe("pullRequestsLinked — the distinct pull requests a prepared message links", () => {
  it("counts each pull request once across the blocks and the fallback text", () => {
    const payload = {
      blocks: [
        { elements: [{ url: `${PR_URL}/18249` }, { url: `${PR_URL}/18247` }, { url: `${PR_URL}/18249/files` }] },
      ],
      text: `<${PR_URL}/18249|#18249> <${PR_URL}/18247|#18247>`,
    };
    expect(pullRequestsLinked({ payload })).toEqual(["acme/acme-admin#18249", "acme/acme-admin#18247"]);
  });

  it("answers nothing for a message linking no pull request", () => {
    expect(
      pullRequestsLinked({ payload: { text: "the 10 security ones in <https://x.slack.com/archives/C1|this>" } }),
    ).toEqual([]);
  });
});

describe("reviewAskDmChannels — the D… conversations whose member the rule needs", () => {
  it("names each held or released-today DM review ask's conversation once, never a dropped one or another act", () => {
    const items = [
      row({ channel: JASPER_DM, id: "sd-00000001" }),
      row({ channel: JASPER_DM, id: "sd-00000002", state: "held" }),
      row({ channel: "D0SYNDROPPED01", id: "sd-00000003", state: "dropped" }),
      row({ act: "bump", channel: "D0SYNBUMPONLY1", id: "sd-00000004" }),
      row({ id: "sd-00000005" }),
      row({ channel: "D0SYNHELDOLD01", id: "sd-00000006", state: "held", tsIso: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(reviewAskDmChannels({ items, nowIso: NOW })).toEqual([JASPER_DM, "D0SYNHELDOLD01"]);
  });

  it("never asks about a D… conversation whose asks all went out on an earlier day", () => {
    const items = [row({ channel: "D0SYNLASTWEEK1", id: "sd-00000001", resolvedIso: "2026-09-25T03:00:00.000Z" })];
    expect(reviewAskDmChannels({ items, nowIso: NOW })).toEqual([]);
  });
});

describe("reviewAsksToPerson — the asks a new one to this person would sit beside", () => {
  it("joins a D… row through its resolved member and keeps only today's released and every held one", () => {
    const items = [
      row({ id: "sd-0000000a" }),
      row({ channel: JASPER_DM, id: "sd-0000000b", resolvedIso: "2026-10-02T05:21:30.000Z" }),
      row({ id: "sd-0000000c", resolvedIso: "2026-10-01T05:00:00.000Z" }),
      row({ id: "sd-0000000d", state: "held", tsIso: "2026-09-20T00:00:00.000Z" }),
      row({ channel: SOMEONE_ELSE, id: "sd-0000000e" }),
      row({ act: "bump", id: "sd-0000000f" }),
      row({ actor: "bot", id: "sd-00000010" }),
      row({ id: "sd-00000011", threadTs: "1790914484.452979" }),
    ];
    const asks = reviewAsksToPerson({ dmUsers: new Map([[JASPER_DM, JASPER]]), items, member: JASPER, nowIso: NOW });
    expect(asks.sentToday.map((item) => item.id)).toEqual(["sd-0000000a", "sd-0000000b"]);
    expect(asks.held.map((item) => item.id)).toEqual(["sd-0000000d"]);
  });

  it("reads the day in Melbourne: 23:30Z on one day is already the next day there", () => {
    const items = [row({ id: "sd-00000001", resolvedIso: "2026-10-01T23:30:00.000Z" })];
    const asks = reviewAsksToPerson({ dmUsers: new Map(), items, member: JASPER, nowIso: NOW });
    expect(asks.sentToday.map((item) => item.id)).toEqual(["sd-00000001"]);
  });

  it("leaves out a D… row Slack could not resolve rather than guessing its person", () => {
    const items = [row({ channel: JASPER_DM, id: "sd-00000001" })];
    const asks = reviewAsksToPerson({ dmUsers: new Map(), items, member: JASPER, nowIso: NOW });
    expect(asks.sentToday).toEqual([]);
  });
});

describe("samePersonDayRefusal — one batch per person per day, never N singles", () => {
  const single = ["acme/acme-admin#18247"];
  const batch = ["acme/acme-admin#18249", "acme/acme-admin#18247"];

  it("passes the first ask to a person that day", () => {
    const items = [row({ id: "sd-00000001", resolvedIso: "2026-10-01T05:00:00.000Z" })];
    expect(
      samePersonDayRefusal({
        dmUsers: new Map(),
        items,
        member: JASPER,
        nowIso: NOW,
        pullRequests: single,
        supersedes: [],
      }),
    ).toEqual([]);
  });

  it("refuses a second single the same day, naming the one sent and the batch that replaces it", () => {
    const items = [row({ id: "sd-8dc15bd1" })];
    expect(
      samePersonDayRefusal({
        dmUsers: new Map(),
        items,
        member: JASPER,
        nowIso: NOW,
        pullRequests: single,
        supersedes: [],
      }),
    ).toEqual([
      `slack draft record: REFUSING a single review ask to ${JASPER} — sd-8dc15bd1 already went to them today, and a ` +
        "second boilerplate single in one day reads as less human.",
      'Compose ONE batch DM instead, opening self-aware ("actually can you just review all these lol"), with a dot ' +
        'point linking EVERY pull request still waiting on them, the ones already asked included (a {"kind":"one-list"} ' +
        "form, no rush once). A pull request that is honestly the only one left goes in tomorrow's ask, or as a reply " +
        "in the thread of the one sent.",
      "There is deliberately NO escape hatch: the batch is always composable, and the single is the thing the owner's " +
        "word removes.",
    ]);
  });

  it("passes a batch the same day, even one relisting pull requests already asked", () => {
    const items = [row({ id: "sd-8dc15bd1" })];
    expect(
      samePersonDayRefusal({
        dmUsers: new Map(),
        items,
        member: JASPER,
        nowIso: NOW,
        pullRequests: batch,
        supersedes: [],
      }),
    ).toEqual([]);
  });

  it("refuses even a batch beside one already held for them, naming the exact --supersedes", () => {
    const items = [row({ id: "sd-fa1a1ec4", state: "held" })];
    const lines = samePersonDayRefusal({
      dmUsers: new Map(),
      items,
      member: JASPER,
      nowIso: NOW,
      pullRequests: batch,
      supersedes: [],
    });
    expect(lines[0]).toBe(
      `slack draft record: REFUSING to park another review ask to ${JASPER} — sd-fa1a1ec4 is already held for them, ` +
        'and asks to one person are ONE batch DM (fold them into "actually can you just review all these lol ' +
        '<dotpoints>").',
    );
    expect(lines[1]).toContain("then record it with --supersedes sd-fa1a1ec4, which drops it");
  });

  it("passes a batch whose --supersedes names every held ask to them", () => {
    const items = [row({ id: "sd-00000001", state: "held" }), row({ id: "sd-00000002", state: "held" })];
    expect(
      samePersonDayRefusal({
        dmUsers: new Map(),
        items,
        member: JASPER,
        nowIso: NOW,
        pullRequests: batch,
        supersedes: ["sd-00000002", "sd-00000001"],
      }),
    ).toEqual([]);
  });

  it("lets an ask to somebody else park beside Jasper's", () => {
    const items = [row({ id: "sd-00000001" }), row({ id: "sd-00000002", state: "held" })];
    expect(
      samePersonDayRefusal({
        dmUsers: new Map(),
        items,
        member: SOMEONE_ELSE,
        nowIso: NOW,
        pullRequests: single,
        supersedes: [],
      }),
    ).toEqual([]);
  });

  it("passes a single the next day", () => {
    const items = [row({ id: "sd-00000001" })];
    expect(
      samePersonDayRefusal({
        dmUsers: new Map(),
        items,
        member: JASPER,
        nowIso: "2026-10-02T14:30:00.000Z",
        pullRequests: single,
        supersedes: [],
      }),
    ).toEqual([]);
  });
});
