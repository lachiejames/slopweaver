import { describe, expect, it } from "vitest";
import {
  channelSteerIsVoid,
  channelsNamedIn,
  draftChannelReading,
  draftChannelRoster,
} from "../../../../outbound/slack/draftChannelSteer.js";
import { foldSlackDrafts } from "../../../../outbound/slack/draftFold.js";
import { parseSlackDraftLog } from "../../../../outbound/slack/draftLog.js";
import {
  DRAFT_STEER_HEARD_MAX_CHARS,
  type DraftChannelSteer,
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../outbound/slack/draftRegister.js";
import { draftAncestorIds } from "../../../../outbound/slack/draftSpent.js";
import {
  channelSteerRefusal,
  latestChannelSteer,
  unmetChannelSteer,
} from "../../../../outbound/slack/draftSteerGate.js";

const LAUNCH = { id: "C0SYN000001", name: "proj-launch-room" };
const ALERTS = { id: "C0SYN000006", name: "dev-alerts" };
const GENERAL = { id: "C0SYNGENERAL01", name: "general" };
const ENGINEERING = { id: "C0SYN000002", name: "dev-team" };
const DESIGN = { id: "C0SYN000017", name: "team-design" };

/** The owner's words on a call as the relay recorded them: the permalink welds to "think". */
const PERMALINK_HEARD =
  "Um, I want you to make sure you've read this full thing and help me, uh, thinkhttps://acme.slack.com/archives/C0SYN000002/p1792377707078429?thread_ts=1792372775.307839&cid=C0SYN000002 through it.";

/** One held row in a channel, optionally re-cutting earlier rows. */
function parked({
  channel,
  id,
  recuts,
}: {
  channel: { id: string; name: string };
  id: string;
  recuts?: readonly string[];
}): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: channel.id,
    mentions: [],
    payload: { form: "plain" as const, text: "GGGG-1809 is a Vanta P1", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    channelName: channel.name,
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"GGGG-1809 is a Vanta P1"}]}',
    id,
    shape: "top-level",
    tsIso: "2026-10-12T00:10:00.000Z",
    why: "the incident's draft",
    ...(recuts === undefined ? {} : { recuts }),
  };
}

/** The parked event of one row. */
function parkedEvent({ draft }: { draft: ParkedSlackDraft }): SlackDraftEvent {
  return { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso };
}

/** The owner's steer on the draft held for #proj-launch-room, as the relay records it. */
const STEER: DraftChannelSteer = {
  anchor: "talk:a0000054-0000-4000-8000-000000000057",
  channels: [ALERTS],
  from: LAUNCH,
  heard: "Let's send this to Dev alerts instead",
  tsIso: "2026-10-12T00:16:00.000Z",
};

/** Every row the events fold to, through the real log parser. */
function foldedOf({ events }: { events: readonly SlackDraftEvent[] }): ReturnType<typeof foldSlackDrafts> {
  const lines = events.map((event) => slackDraftEventLine({ event }));
  const log = parseSlackDraftLog({ lines });
  expect(log.skipped).toEqual([]);
  return foldSlackDrafts({ events: log.events });
}

describe("channelsNamedIn", () => {
  const roster = [LAUNCH, ALERTS, GENERAL];

  it("reads a spoken 'Dev alerts' as #dev-alerts, the incident's own words", () => {
    expect(channelsNamedIn({ roster, words: "Let's send this to Dev alerts instead" })).toEqual([ALERTS]);
  });

  it("reads a written #dev-alerts and an 'dev-alerts channel' alike", () => {
    expect(channelsNamedIn({ roster, words: "post it in #dev-alerts" })).toEqual([ALERTS]);
    expect(channelsNamedIn({ roster, words: "the dev-alerts channel please" })).toEqual([ALERTS]);
  });

  it("does not read a one-word channel out of ordinary speech", () => {
    expect(channelsNamedIn({ roster, words: "in general this looks fine" })).toEqual([]);
  });

  it("reads a one-word channel written #general or said 'general channel', never #generally", () => {
    expect(channelsNamedIn({ roster, words: "send to #general" })).toEqual([GENERAL]);
    expect(channelsNamedIn({ roster, words: "the general channel" })).toEqual([GENERAL]);
    expect(channelsNamedIn({ roster, words: "#generally fine" })).toEqual([]);
  });

  it("does not read 'the launch channel' as the launch room channel, whose name is three words", () => {
    expect(channelsNamedIn({ roster, words: "it's gone into the launch channel" })).toEqual([]);
  });

  it("reads a typed <#C…> mention by the channel's id, never an id inside a longer token", () => {
    expect(channelsNamedIn({ roster, words: "Move sd-359bafb2 to <#C0SYN000006>" })).toEqual([ALERTS]);
    expect(channelsNamedIn({ roster, words: "ref XC0SYN000006 only" })).toEqual([]);
  });

  it("reads no channel out of a pasted permalink, welded to the word ahead", () => {
    const named = channelsNamedIn({ roster: [ENGINEERING, DESIGN], words: PERMALINK_HEARD });
    expect(named).toEqual([]);
  });

  it("reads no channel out of a URL path, scheme-less Slack host or www link, and keeps a <url|label>'s label", () => {
    expect(channelsNamedIn({ roster, words: "see https://github.com/acme/dev-alerts/pull/1" })).toEqual([]);
    expect(channelsNamedIn({ roster, words: "acme.slack.com/archives/C0SYN000006/p1" })).toEqual([]);
    expect(channelsNamedIn({ roster, words: "www.example.com/dev-alerts" })).toEqual([]);
    expect(channelsNamedIn({ roster, words: "ssh://example.test/archives/C0SYN000006/x (Codex r2-01)" })).toEqual([]);
    expect(channelsNamedIn({ roster, words: "<https://example.com/x|dev alerts> it is" })).toEqual([ALERTS]);
  });

  it("still reads a channel named beside a pasted link, the word ahead of a welded one included", () => {
    expect(
      channelsNamedIn({
        roster,
        words: "send it to dev-alertshttps://acme.slack.com/archives/C0SYN000001/p1",
      }),
    ).toEqual([ALERTS]);
    expect(channelsNamedIn({ roster, words: "<#C0SYN000006> not https://x.slack.com/archives/C0SYN000001" })).toEqual([
      ALERTS,
    ]);
  });

  it("reads a channel named before a pasted link a full stop welded to", () => {
    expect(channelsNamedIn({ roster, words: "Send it to Dev alerts.https://example.test/x" })).toEqual([ALERTS]);
    expect(channelsNamedIn({ roster, words: "Send it to general channel.https://example.test/x" })).toEqual([GENERAL]);
  });

  it("reads a channel whose one-word qualifier is an unknown link's scheme", () => {
    expect(channelsNamedIn({ roster, words: "Send it to general channel://example.test/x" })).toEqual([GENERAL]);
  });

  it("reads a channel whose full stop welds to a scheme-less Slack link", () => {
    const words = "Send it to Dev alerts.acme.slack.com/archives/C0SYN000001/p1";
    expect(channelsNamedIn({ roster, words })).toEqual([ALERTS]);
  });
});

describe("draftChannelRoster", () => {
  it("names each channel once, by the first row the newest-first fold carries", () => {
    const items = foldedOf({
      events: [
        parkedEvent({ draft: parked({ channel: LAUNCH, id: "sd-11111111" }) }),
        parkedEvent({ draft: parked({ channel: ALERTS, id: "sd-22222222" }) }),
        parkedEvent({ draft: parked({ channel: LAUNCH, id: "sd-33333333" }) }),
      ],
    });
    const ids = draftChannelRoster({ items }).map((channel) => channel.id);
    expect(ids.toSorted()).toEqual([ALERTS.id, LAUNCH.id].toSorted());
  });

  it("keeps an id no row named under the id, so a typed <#C…> still names it", () => {
    const items = foldedOf({
      events: [
        parkedEvent({ draft: parked({ channel: LAUNCH, id: "sd-11111111" }) }),
        parkedEvent({ draft: parked({ channel: { id: ALERTS.id, name: "" }, id: "sd-22222222" }) }),
      ],
    });
    const roster = draftChannelRoster({ items });
    expect(channelsNamedIn({ roster, words: "Move this to <#C0SYN000006>" })).toEqual([
      { id: ALERTS.id, name: ALERTS.id },
    ]);
  });

  it("prefers a recorded name over the bare id when any row names the channel", () => {
    const items = foldedOf({
      events: [
        parkedEvent({ draft: parked({ channel: ALERTS, id: "sd-11111111" }) }),
        parkedEvent({ draft: parked({ channel: { id: ALERTS.id, name: "" }, id: "sd-22222222" }) }),
      ],
    });
    expect(draftChannelRoster({ items })).toEqual([ALERTS]);
  });
});

describe("draftChannelReading", () => {
  it("is unmoved when the words name only the row's own channel", () => {
    expect(draftChannelReading({ current: LAUNCH.id, named: [LAUNCH] })).toEqual({ kind: "unmoved" });
  });

  it("keeps every other channel named as the set the release may go to", () => {
    expect(draftChannelReading({ current: LAUNCH.id, named: [LAUNCH, ALERTS, GENERAL] })).toEqual({
      channels: [ALERTS, GENERAL],
      kind: "steered",
    });
  });
});

describe("the steered register event", () => {
  const original = parked({ channel: LAUNCH, id: "sd-359bafb2" });

  it("round-trips through the log and folds onto the held row", () => {
    const items = foldedOf({
      events: [parkedEvent({ draft: original }), { id: original.id, kind: "steered", ...STEER }],
    });
    expect(items.find((item) => item.id === original.id)!.steer).toEqual(STEER);
  });

  it("is passed over, hiding nothing silently, when its heard words exceed the bound", () => {
    const long = { ...STEER, heard: "x".repeat(DRAFT_STEER_HEARD_MAX_CHARS + 1) };
    const lines = [parkedEvent({ draft: original }), { id: original.id, kind: "steered" as const, ...long }].map(
      (event) => slackDraftEventLine({ event }),
    );
    expect(parseSlackDraftLog({ lines }).skipped.map((line) => line.id)).toEqual([original.id]);
  });

  it("is passed over when its anchor is not a talk relay's", () => {
    const lines = [
      slackDraftEventLine({ event: parkedEvent({ draft: original }) }),
      slackDraftEventLine({ event: { id: original.id, kind: "steered", ...STEER, anchor: "slack:123" } }),
    ];
    expect(parseSlackDraftLog({ lines }).skipped.map((line) => line.kind)).toEqual(["steered"]);
  });

  it("is passed over when its anchor is not exactly a relay's talk:<v4 turn id>", () => {
    const lines = [
      slackDraftEventLine({ event: parkedEvent({ draft: original }) }),
      slackDraftEventLine({ event: { id: original.id, kind: "steered", ...STEER, anchor: "talk:not-a-uuid" } }),
    ];
    expect(parseSlackDraftLog({ lines }).skipped.map((line) => line.kind)).toEqual(["steered"]);
  });

  it("is passed over when its draft id is blank", () => {
    const lines = [
      slackDraftEventLine({ event: { id: " ", kind: "steered", ...STEER } }),
      slackDraftEventLine({ event: { id: "​", kind: "steered", ...STEER } }),
    ];
    expect(parseSlackDraftLog({ lines }).skipped.map((line) => line.kind)).toEqual(["steered", "steered"]);
  });

  it("does not stick to a row that is no longer held", () => {
    const items = foldedOf({
      events: [
        parkedEvent({ draft: original }),
        { id: original.id, kind: "dropped", note: "gone", tsIso: "2026-10-12T00:15:00.000Z" },
        { id: original.id, kind: "steered", ...STEER },
      ],
    });
    expect(items.find((item) => item.id === original.id)!.steer).toBeUndefined();
  });
});

describe("the channel-steer release gate", () => {
  const original = parked({ channel: LAUNCH, id: "sd-359bafb2" });
  const sameChannel = parked({ channel: LAUNCH, id: "sd-dd932464", recuts: [original.id] });
  const intoAlerts = parked({ channel: ALERTS, id: "sd-70e1a6b4", recuts: [sameChannel.id] });
  const items = foldedOf({
    events: [
      parkedEvent({ draft: original }),
      { id: original.id, kind: "steered", ...STEER },
      parkedEvent({ draft: sameChannel }),
      parkedEvent({ draft: intoAlerts }),
    ],
  });
  const row = ({ id }: { id: string }): (typeof items)[number] => items.find((item) => item.id === id)!;

  it("walks a re-cut back to the row that was steered", () => {
    expect(draftAncestorIds({ item: row({ id: intoAlerts.id }), items })).toEqual([sameChannel.id, original.id]);
  });

  it("refuses the same-channel re-cut, naming the hatch and the re-cut into #dev-alerts", () => {
    const lines = channelSteerRefusal({ hatchOpen: false, item: row({ id: sameChannel.id }), items });
    expect(lines[0]).toContain("sd-dd932464 goes to #proj-launch-room, but at 2026-10-12T00:16:00.000Z");
    expect(lines[0]).toContain("named #dev-alerts for it");
    expect(lines.some((line) => line.includes("channel-steered-draft"))).toBe(true);
    expect(lines.at(-1)).toBe(
      "Re-cut it into #dev-alerts: slopweaver slack draft record <the same flags> --channel C0SYN000006 --supersedes sd-dd932464",
    );
  });

  it("refuses the original row too", () => {
    expect(unmetChannelSteer({ item: row({ id: original.id }), items })).toEqual(STEER);
  });

  it("lets the re-cut into #dev-alerts go", () => {
    expect(channelSteerRefusal({ hatchOpen: false, item: row({ id: intoAlerts.id }), items })).toEqual([]);
  });

  it("lets the same-channel cut go only while the journalled grant is open", () => {
    expect(channelSteerRefusal({ hatchOpen: true, item: row({ id: sameChannel.id }), items })).toEqual([]);
  });

  it("follows a later word that takes the steer back", () => {
    const back: DraftChannelSteer = {
      ...STEER,
      channels: [LAUNCH],
      from: ALERTS,
      heard: "Actually keep it in proj launch room",
      tsIso: "2026-10-12T00:20:00.000Z",
    };
    const later = foldedOf({
      events: [
        parkedEvent({ draft: original }),
        { id: original.id, kind: "steered", ...STEER },
        parkedEvent({ draft: sameChannel }),
        { id: sameChannel.id, kind: "steered", ...back },
      ],
    });
    const recut = later.find((item) => item.id === sameChannel.id)!;
    expect(latestChannelSteer({ item: recut, items: later })).toEqual(back);
    expect(unmetChannelSteer({ item: recut, items: later })).toBeUndefined();
  });

  it("orders steers by instant, so an offset that sorts later as text does not win", () => {
    const earlier: DraftChannelSteer = { ...STEER, tsIso: "2026-10-12T01:00:00+01:00" };
    const newer: DraftChannelSteer = {
      ...STEER,
      channels: [GENERAL],
      from: ALERTS,
      heard: "Put it in #general",
      tsIso: "2026-10-12T00:30:00Z",
    };
    const offsets = foldedOf({
      events: [
        parkedEvent({ draft: original }),
        { id: original.id, kind: "steered", ...earlier },
        parkedEvent({ draft: sameChannel }),
        { id: sameChannel.id, kind: "steered", ...newer },
      ],
    });
    const recut = offsets.find((item) => item.id === sameChannel.id)!;
    // The offset steer survives the fold, so the comparison below is the one that decides.
    expect(offsets.find((item) => item.id === original.id)!.steer).toEqual(earlier);
    expect(latestChannelSteer({ item: recut, items: offsets })).toEqual(newer);
  });

  it("keeps the newer steer when a retried relay appends an older one after it", () => {
    const newer: DraftChannelSteer = { ...STEER, tsIso: "2026-10-12T00:20:00.000Z" };
    const retried: DraftChannelSteer = {
      ...STEER,
      anchor: "talk:a0000001-0000-4000-8000-000000000001",
      channels: [GENERAL],
      heard: "Put it in #general",
    };
    // A live steer, so the instant is what passes it over rather than the void rule.
    expect(channelSteerIsVoid({ steer: retried })).toBe(false);
    const replayed = foldedOf({
      events: [
        parkedEvent({ draft: original }),
        { id: original.id, kind: "steered", ...newer },
        { id: original.id, kind: "steered", ...retried },
      ],
    });
    expect(replayed.find((item) => item.id === original.id)!.steer).toEqual(newer);
  });
});

describe("a void steer, whole words naming its channel only inside a URL", () => {
  const held = parked({ channel: DESIGN, id: "sd-a46ae90d" });
  const recut = parked({ channel: DESIGN, id: "sd-cc84fa96", recuts: [held.id] });
  /** The permalink event exactly as the relay appended it. */
  const PERMALINK: DraftChannelSteer = {
    anchor: "talk:a0000040-0000-4000-8000-000000000043",
    channels: [ENGINEERING],
    from: DESIGN,
    heard: PERMALINK_HEARD,
    tsIso: "2026-10-19T02:44:14.826Z",
  };

  it("is void for the permalink steer, and live for the steer actually given", () => {
    expect(channelSteerIsVoid({ steer: PERMALINK })).toBe(true);
    expect(channelSteerIsVoid({ steer: STEER })).toBe(false);
  });

  it("is void for a scheme-less or enterprise-grid permalink, and for none but a Slack permalink", () => {
    const bare: DraftChannelSteer = { ...PERMALINK, heard: "read acme.slack.com/archives/C0SYN000002/p1 now" };
    const grid: DraftChannelSteer = {
      ...PERMALINK,
      heard: "read https://acme.enterprise.slack.com/archives/C0SYN000002/p1?cid=C0SYN000002",
    };
    const ssh: DraftChannelSteer = {
      ...PERMALINK,
      heard: "Please read ssh://example.test/archives/C0SYN000002/message",
    };
    expect(channelSteerIsVoid({ steer: bare })).toBe(true);
    expect(channelSteerIsVoid({ steer: grid })).toBe(true);
    expect(channelSteerIsVoid({ steer: ssh })).toBe(false);
  });

  it("stays in force when its channel's id follows a Markdown link that was closed", () => {
    const markdown: DraftChannelSteer = {
      ...PERMALINK,
      heard: "Read [this](https://acme.slack.com/archives/COTHER/p1),channel=C0SYN000002",
    };
    expect(channelSteerIsVoid({ steer: markdown })).toBe(false);
  });

  it("never reaches the row, so the re-cut releases into #team-design unrefused", () => {
    const items = foldedOf({
      events: [
        parkedEvent({ draft: held }),
        { id: held.id, kind: "steered", ...PERMALINK },
        parkedEvent({ draft: recut }),
      ],
    });
    const row = items.find((item) => item.id === recut.id)!;
    expect(items.find((item) => item.id === held.id)!.steer).toBeUndefined();
    expect(channelSteerRefusal({ hatchOpen: false, item: row, items })).toEqual([]);
  });

  it("does not displace an earlier steer given on the same row", () => {
    const given: DraftChannelSteer = { ...STEER, from: DESIGN, tsIso: "2026-10-19T02:40:00.000Z" };
    const items = foldedOf({
      events: [
        parkedEvent({ draft: held }),
        { id: held.id, kind: "steered", ...given },
        { id: held.id, kind: "steered", ...PERMALINK },
      ],
    });
    expect(items.find((item) => item.id === held.id)!.steer).toEqual(given);
  });

  it("stays in force when its words were cut at the bound, since the name may sit past the cut", () => {
    const cut: DraftChannelSteer = { ...PERMALINK, heard: `${PERMALINK_HEARD.slice(0, 200)}…` };
    // The cut words still carry the permalink's id, so only the cut is what keeps this one in force.
    expect(cut.heard).toContain("archives/C0SYN000002/");
    expect(channelSteerIsVoid({ steer: cut })).toBe(false);
  });

  it("stays in force when its words name its channel neither inside a URL nor outside one", () => {
    const welded: DraftChannelSteer = { ...STEER, heard: "Send it to dev-alertszoommtg://zoom.us/join/123" };
    expect(channelSteerIsVoid({ steer: welded })).toBe(false);
  });

  it("stays in force when a full stop welds to a pasted link after the name", () => {
    const alerts: DraftChannelSteer = {
      ...STEER,
      channels: [ALERTS],
      heard: "Send it to Dev alerts.https://example.test/x",
    };
    const general: DraftChannelSteer = {
      ...STEER,
      channels: [GENERAL],
      heard: "Send it to general channel.https://example.test/x",
    };
    expect(channelSteerIsVoid({ steer: alerts })).toBe(false);
    expect(channelSteerIsVoid({ steer: general })).toBe(false);
  });

  it("stays in force when an unknown link's scheme is the word naming its channel", () => {
    const general: DraftChannelSteer = {
      ...STEER,
      channels: [GENERAL],
      heard: "Send it to general channel://example.test/x",
    };
    expect(channelSteerIsVoid({ steer: general })).toBe(false);
  });

  it("stays in force when a channel mention follows a quoted link's closing quote", () => {
    const quoted: DraftChannelSteer = { ...STEER, channels: [GENERAL], heard: 'Read "https://example.test/x"#general' };
    expect(channelSteerIsVoid({ steer: quoted })).toBe(false);
  });

  it("stays in force when its channel's name sits anywhere, a welded scheme-less link or a URL path included", () => {
    const welded: DraftChannelSteer = {
      ...STEER,
      channels: [ALERTS],
      heard: "Send it to Dev alerts.acme.slack.com/archives/COTHER/p1",
    };
    const path: DraftChannelSteer = {
      ...STEER,
      channels: [ALERTS],
      heard: "see https://github.com/acme/dev-alerts/pull/1",
    };
    expect(channelSteerIsVoid({ steer: welded })).toBe(false);
    expect(channelSteerIsVoid({ steer: path })).toBe(false);
  });

  it("stays in force when its channel's id sits anywhere but a link's path or query", () => {
    expect(channelSteerIsVoid({ steer: { ...PERMALINK, heard: `${PERMALINK_HEARD} C0SYN000002` } })).toBe(false);
  });

  it("stays in force when its channel's id follows an = typed outside any link", () => {
    expect(channelSteerIsVoid({ steer: { ...PERMALINK, heard: "Move sd-a46ae90d to channel=C0SYN000002" } })).toBe(
      false,
    );
  });

  it("keeps a one-word take-back and a typed <#C…> steer in force", () => {
    expect(channelSteerIsVoid({ steer: { ...STEER, channels: [GENERAL], heard: "back to #general" } })).toBe(false);
    expect(channelSteerIsVoid({ steer: { ...STEER, heard: "Move it to <#C0SYN000006>" } })).toBe(false);
  });
});
