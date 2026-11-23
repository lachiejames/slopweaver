/*
 * The postmortem card's pure halves: the form check, the headline's budget, the reply's placement, the revision
 * fold, the row the supervisor registers, and which resolved incidents are candidates.
 */
import { describe, expect, it } from "vitest";

import type { HandRow } from "../../../hand/row.js";
import { buildHandStep, WHAT_CAP } from "../../../hand/step.js";
import {
  askDraftMisplaced,
  checkedPostmortemCard,
  nextPostmortemRevision,
  postmortemQuestion,
  postmortemStepDraft,
} from "../../../incident/postmortem.js";
import { postmortemCandidates } from "../../../incident/postmortemCandidates.js";
import { checkedPostmortemForm, type IncidentPostmortemForm } from "../../../incident/postmortemForm.js";
import { postmortemAskText, postmortemRegisterFlags, postmortemRowSlug } from "../../../incident/postmortemRow.js";
import { unwrap } from "../../../lib/result.js";
import type { OrgIncident } from "../../../orgHealth/types.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";

const CHANNEL_ID = "C0SYN000004";
const ROW = "postmortem-c0syn000004";
const FACILITATOR = "U0SYNSMITH1234";

/** A whole form, every field valid. */
const FORM = {
  askDraft: "sd-1234abcd",
  channel: { id: CHANNEL_ID, name: "inc-2026-09-23-payment-checkout-regression", reference: "INC-98" },
  cites: ["https://app.incident.io/acme/incidents/98", "https://app.datadoghq.com/rum/explorer"],
  lean: "Yes — the room will decide the Stripe pin, and you own that client.",
  meaning: "412 customers could not pay at checkout for five hours",
  meeting: { atIso: "2026-09-25T04:00Z", runBy: { name: "John Smith", slackId: FACILITATOR }, state: "scheduled" },
  proof: "inc-98-briefing",
  quotes: [
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790130678000100",
      text: "Postmortem Thursday.",
      who: "John Smith",
    },
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790128559861079",
      text: "The pin needs a talk.",
      who: "Jonah Yates",
    },
  ],
  row: ROW,
  stakeholders: ["John Smith (facilitator)", "Jonah Yates"],
  stillReal: "slopweaver incident postmortems listed INC-98 at 01:00Z",
};

/** The form, checked. */
function form(over: Record<string, unknown> = {}): IncidentPostmortemForm {
  return unwrap(checkedPostmortemForm({ value: { ...FORM, ...over } }));
}

/** The refusal a form earns. */
function refusal(over: Record<string, unknown>): string {
  const checked = checkedPostmortemForm({ value: { ...FORM, ...over } });
  expect(checked.isErr()).toBe(true);
  return checked._unsafeUnwrapErr().message;
}

describe("checkedPostmortemForm", () => {
  it("accepts a whole form, the meeting scheduled", () => {
    expect(form().meeting).toEqual({
      atIso: "2026-09-25T04:00Z",
      runBy: { name: "John Smith", slackId: FACILITATOR },
      state: "scheduled",
    });
  });

  it("accepts a meeting not yet scheduled, which carries no time", () => {
    expect(form({ meeting: { runBy: FORM.meeting.runBy, state: "not-yet-scheduled" } }).meeting).toEqual({
      runBy: { name: "John Smith", slackId: FACILITATOR },
      state: "not-yet-scheduled",
    });
  });

  it.each([
    [{ shot: {} }, 'incident postmortem form: form carries an unknown key "shot"'],
    [
      { quotes: [FORM.quotes[0]] },
      "incident postmortem form: quotes carries 1 and the card needs 2 to 3 verbatim lines from the channel",
    ],
    [
      { channel: { ...FORM.channel, id: `C${"A".repeat(21)}` } },
      "incident postmortem form: channel.id is a Slack channel id (C… or G…, at most 21 characters)",
    ],
    [
      { channel: { ...FORM.channel, reference: "34" } },
      "incident postmortem form: channel.reference is incident.io's own reference, INC-<n> — the headline names the incident by it",
    ],
    [
      { row: "incident-c0syn000004" },
      `incident postmortem form: row is ${ROW}, the postmortem row for channel ${CHANNEL_ID} — register it with \`slopweaver handover register\` as \`slopweaver incident postmortems\` prints`,
    ],
    [
      { meeting: { ...FORM.meeting, atIso: "Thursday" } },
      "incident postmortem form: meeting.atIso is the scheduled instant in UTC, read off the invite or the channel",
    ],
    [
      { meeting: { ...FORM.meeting, atIso: `2026-09-25T04:00:00.${"0".repeat(300)}Z` } },
      "incident postmortem form: meeting.atIso is the scheduled instant in UTC, read off the invite or the channel",
    ],
    [
      { meeting: { runBy: { name: "John Smith", slackId: "john.smith" }, state: "not-yet-scheduled" } },
      "incident postmortem form: meeting.runBy.slackId is a Slack member id (U…) — the parked reply must tag this person",
    ],
    [
      { cites: ["https://github.com/acme/acme-admin/pull/1"] },
      'incident postmortem form: cites opens on "https://github.com/acme/acme-admin/pull/1" — the incident\'s own incident.io page comes first, so the card leads with the incident',
    ],
    [
      { cites: ["https://app.incident.io/acme/incidents/97"] },
      "incident postmortem form: cites opens on incident 97's page and the card is about INC-98",
    ],
    [
      { stakeholders: [] },
      "incident postmortem form: stakeholders is a list of 1 to 8 names — who will be in the room",
    ],
    [{ askDraft: "draft-1" }, "incident postmortem form: askDraft"],
  ])("refuses %j", (over, message) => {
    expect(refusal(over)).toContain(message);
  });

  it("re-homes a shared field's refusal so it names this form", () => {
    expect(refusal({ meaning: "x".repeat(63) })).toContain("incident postmortem form: meaning ");
  });

  it("refuses stakeholders that together overrun the one detail line they share", () => {
    expect(refusal({ stakeholders: Array.from({ length: 8 }, () => "A".repeat(60)) })).toBe(
      'incident postmortem form: stakeholders make a 507-character "In the room:" line and the card\'s cap is 320 — name fewer, or shorter',
    );
  });

  it("refuses a cite `hand post` would refuse, by its own check", () => {
    const long = `https://example.com/${"a".repeat(2030)}`;

    expect(refusal({ cites: [FORM.cites[0], long] })).toBe(
      `incident postmortem form: cites names "${long}", which is not an https:// address, a localhost console route nor a local page — the only addresses a card draws as a chip`,
    );
  });

  it("refuses, as the card it composes, a form whose fields each pass but whose card `hand post` would refuse", () => {
    const checked = checkedPostmortemCard({
      consoleBase: "http://127.0.0.1:4321",
      value: { ...FORM, lean: Array.from({ length: 31 }, () => "yes").join(" ") },
    });

    expect(checked._unsafeUnwrapErr().message).toContain(
      "incident postmortem form: form composes a card `hand post` would refuse: ",
    );
  });

  it("passes the whole form as the card it composes", () => {
    expect(unwrap(checkedPostmortemCard({ consoleBase: "http://127.0.0.1:4321", value: FORM })).channel.reference).toBe(
      "INC-98",
    );
  });

  it("refuses a two-sentence meaning, which would open a headline `hand post` refuses", () => {
    expect(refusal({ meaning: "Customers could not pay. They abandoned checkout" })).toBe(
      "incident postmortem form: meaning is one sentence — it opens the card's headline, which `hand post` refuses at a second",
    );
  });
});

describe("postmortemQuestion", () => {
  it("fits the step's what cap at the longest meaning and reference the form admits", () => {
    const what = postmortemQuestion({ meaning: "m".repeat(62), reference: "INC-999999" });

    expect(what.length).toBe(WHAT_CAP);
  });

  it("builds into a step every posting rule passes", () => {
    const draft = postmortemStepDraft({
      consoleBase: "http://127.0.0.1:4321",
      form: form(),
      nowIso: "2026-09-24T01:10:00.000Z",
      postedBy: "supervisor",
      revision: { id: "pm-c0syn000004-r1" },
    });

    expect(unwrap(buildHandStep({ draft })).details).toEqual([
      "Briefing: http://127.0.0.1:4321/view?src=%2Fapi%2Fpage%2Finc-98-briefing%2Findex.html&back=%2Fqueue",
      "Meeting: 2026-09-25T04:00Z, run by John Smith",
      "In the room: John Smith (facilitator), Jonah Yates",
      "Reply for #inc-2026-09-23-payment-checkout-regression: sd-1234abcd",
    ]);
  });
});

/** The register's fold of the reply, held, in the owner's voice, as the form needs it — overridable per case. */
function item({
  state = "held",
  over = {},
}: { state?: SlackDraftItem["state"]; over?: Record<string, unknown> } = {}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel: CHANNEL_ID,
      digest: "d",
      form: "{}",
      id: FORM.askDraft,
      mentions: [{ key: "john.smith", kind: "person", target: FACILITATOR }],
      payload: { form: "plain", text: "can I sit in?", unfurl_links: false, unfurl_media: false },
      row: ROW,
      shape: "top-level",
      tsIso: "2026-09-24T01:00:00.000Z",
      why: "the ask",
      ...over,
    },
    id: FORM.askDraft,
    state,
  } satisfies SlackDraftItem;
}

describe("askDraftMisplaced", () => {
  it("passes the reply this card is about", () => {
    expect(askDraftMisplaced({ form: form(), item: item(), skipped: [] })).toBe(undefined);
  });

  it.each([
    ["names another draft, which a hand-edited line can misattribute", "sd-ffff0000", item()],
    ["names no draft, its id lost", undefined, item()],
    ["names the reply, rather than reading it as no draft", FORM.askDraft, undefined],
  ])("refuses beside an unreadable register line that %s", (_case, id, found) => {
    const skipped = [{ id, kind: undefined, line: 7 }];

    expect(askDraftMisplaced({ form: form(), item: found, skipped })!.message).toBe(
      `incident postmortem: the ask ${FORM.askDraft} cannot be vouched for while line 7 of the draft register will not read — which draft that line records, and what, is unknown, so repair it first`,
    );
  });

  it.each([
    [undefined, "is not in the draft register — park it with `slopweaver slack draft record` first"],
    [item({ state: "released" }), "is released, so there is nothing left for the owner's yes to send"],
    [item({ over: { actor: "bot" } }), "is parked as the bot — asking to join a meeting goes out in the owner's name"],
    [item({ over: { channel: "C0OTHER" } }), `posts to C0OTHER, not the incident channel ${CHANNEL_ID}`],
    [item({ over: { mentions: [] } }), `does not tag John Smith (${FACILITATOR}), who runs the postmortem`],
    [item({ over: { row: undefined } }), `names no board row — park it with \`--row ${ROW}\``],
    [item({ over: { row: "incident-c0syn000004" } }), `was raised by incident-c0syn000004, not ${ROW}`],
  ])("refuses a reply that %#", (found, why) => {
    expect(askDraftMisplaced({ form: form(), item: found, skipped: [] })!.message).toBe(
      `incident postmortem: the ask ${FORM.askDraft} ${why}`,
    );
  });
});

/** A posted hand row under `id`. */
function posted({ id }: { id: string }): HandRow {
  const step = unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "supervisor",
        postedIso: "2026-09-24T01:10:00.000Z",
        unblocks: "the postmortem card",
        what: "Read the briefing",
        witness: "slopweaver slack draft show sd-1234abcd",
      },
    }),
  );
  return { kind: "posted", step };
}

describe("nextPostmortemRevision", () => {
  it("numbers past the highest posting and supersedes the open one, ignoring the incident note's ids", () => {
    const rows = [posted({ id: "pm-c0syn000004-r1" }), posted({ id: "inc-c0syn000004-r4" })];

    expect(unwrap(nextPostmortemRevision({ channelId: CHANNEL_ID, rows }))).toEqual({
      id: "pm-c0syn000004-r2",
      supersedes: "pm-c0syn000004-r1",
    });
  });

  it("numbers past a revision too long for a number exactly, never in scientific notation", () => {
    const rows = [posted({ id: `pm-c0syn000004-r${"9".repeat(34)}` })];

    expect(unwrap(nextPostmortemRevision({ channelId: CHANNEL_ID, rows })).id).toBe(
      `pm-c0syn000004-r1${"0".repeat(34)}`,
    );
  });

  it("refuses when two revisions are open", () => {
    const rows = [posted({ id: "pm-c0syn000004-r1" }), posted({ id: "pm-c0syn000004-r2" })];

    expect(nextPostmortemRevision({ channelId: CHANNEL_ID, rows })._unsafeUnwrapErr().code).toBe(
      "POSTMORTEM_REVISIONS_OPEN",
    );
  });
});

const INCIDENT = {
  channelId: CHANNEL_ID,
  homepageUrl: "https://app.incident.io/acme/incidents/98",
  ref: "INC-98",
  title: 'The "checkout" regression',
};

describe("the postmortem row", () => {
  it("is keyed by the channel, never under incident-", () => {
    expect(postmortemRowSlug({ channelId: CHANNEL_ID })).toBe(ROW);
  });

  it("registers a p2 dispatch row in the organisation's workspace, the title kept as written", () => {
    expect(postmortemRegisterFlags({ incident: INCIDENT })).toEqual([
      "--ask",
      postmortemAskText({ incident: INCIDENT }),
      "--dispatch",
      "--slug",
      ROW,
      "--priority",
      "p2",
      "--tag",
      "context=work",
      "--workspace",
      "team",
      "--workspace-because",
      "a postmortem for INC-98, an incident on the organisation's incident channel",
    ]);
    expect(postmortemAskText({ incident: INCIDENT })).toContain('INC-98 (The "checkout" regression)');
  });
});

/** An incident the snapshot keeps, resolved and Major unless a case says otherwise. */
function incident(over: Partial<OrgIncident> = {}): OrgIncident {
  return {
    channelId: CHANNEL_ID,
    declaredIso: "2026-09-23T01:00:00.000Z",
    homepageUrl: INCIDENT.homepageUrl,
    phase: "resolved",
    phaseChangedIso: "2026-09-23T06:00:00.000Z",
    phaseProvenance: "update",
    ref: "INC-98",
    severity: "Major",
    status: "Closed",
    title: "Payment checkout regression",
    ...over,
  };
}

describe("postmortemCandidates", () => {
  it("lists a resolved, non-Minor incident with its row and register flags", () => {
    const read = postmortemCandidates({ incidents: [incident()], registered: new Set(), rows: [] });

    expect(read.held).toEqual([]);
    expect(
      read.candidates.map((candidate) => [candidate.ref, candidate.row, candidate.resolvedIso, candidate.registered]),
    ).toEqual([["INC-98", ROW, "2026-09-23T06:00:00.000Z", false]]);
    expect(read.candidates[0]!.registerFlags.slice(2, 5)).toEqual(["--dispatch", "--slug", ROW]);
  });

  it("still lists one whose row is registered but carded nowhere, marked registered", () => {
    const read = postmortemCandidates({ incidents: [incident()], registered: new Set([ROW]), rows: [] });

    expect(read.candidates.map((candidate) => [candidate.row, candidate.registered])).toEqual([[ROW, true]]);
  });

  it("leaves out a live incident, a Minor one, and one whose channel already had a card", () => {
    const read = postmortemCandidates({
      incidents: [
        incident({ channelId: "C0LIVE", phase: "monitoring", ref: "INC-80" }),
        incident({ channelId: "C0MINOR", ref: "INC-81", severity: "Minor" }),
        incident(),
      ],
      registered: new Set(),
      rows: [posted({ id: "pm-c0syn000004-r1" })],
    });

    expect(read).toEqual({ candidates: [], held: [] });
  });

  it("holds an incident naming no channel, and two sharing one, with the reason", () => {
    const read = postmortemCandidates({
      incidents: [
        incident({ channelId: undefined, ref: "INC-90" }),
        incident({ channelId: "C0SHARED", ref: "INC-91" }),
        incident({ channelId: "C0SHARED", ref: "INC-92" }),
      ],
      registered: new Set(),
      rows: [],
    });

    expect(read.candidates).toEqual([]);
    expect(read.held.map((error) => error.code)).toEqual(["POSTMORTEM_CHANNEL_MISSING", "POSTMORTEM_CHANNEL_SHARED"]);
  });

  it("holds an incident whose snapshot channel is no Slack channel id, rather than print a slug register refuses", () => {
    const read = postmortemCandidates({
      incidents: [incident({ channelId: "C123456/evil", ref: "INC-93" })],
      registered: new Set(),
      rows: [],
    });

    expect(read.candidates).toEqual([]);
    expect(read.held.map((error) => error.message)).toEqual([
      'incident postmortems: INC-93 is resolved and not Minor, but the snapshot\'s channel "C123456/evil" is no Slack channel id (C… or G…, at most 21 characters) — read the incident page for its channel before registering',
    ]);
  });

  it("holds a channel id past 21 characters, whose card id could outgrow hand's cap at a later revision", () => {
    const long = `C${"A".repeat(21)}`;
    const read = postmortemCandidates({
      incidents: [incident({ channelId: long, ref: "INC-94" })],
      registered: new Set(),
      rows: [],
    });

    expect(read.candidates).toEqual([]);
    expect(read.held.map((error) => error.code)).toEqual(["POSTMORTEM_CHANNEL_MALFORMED"]);
  });

  it("leaves out a channel whose card was settled, the settling alone in the register", () => {
    const read = postmortemCandidates({
      incidents: [incident()],
      registered: new Set(),
      rows: [
        {
          bySession: "supervisor",
          did: "declined",
          id: "pm-c0syn000004-r1",
          kind: "settled",
          settledIso: "2026-09-24T01:05:00.000Z",
        },
      ],
    });

    expect(read).toEqual({ candidates: [], held: [] });
  });

  it("orders the newest resolution first", () => {
    const read = postmortemCandidates({
      incidents: [
        incident({ channelId: "C0OLDER", phaseChangedIso: "2026-09-20T00:00:00.000Z", ref: "INC-70" }),
        incident({ channelId: "C0NEWER", phaseChangedIso: "2026-09-22T00:00:00.000Z", ref: "INC-71" }),
      ],
      registered: new Set(),
      rows: [],
    });

    expect(read.candidates.map((candidate) => candidate.ref)).toEqual(["INC-71", "INC-70"]);
  });
});
