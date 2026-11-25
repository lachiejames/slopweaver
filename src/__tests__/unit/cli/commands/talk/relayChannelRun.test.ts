import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendSlackDraftEvent, readSlackDraftLines } from "../../../../../admit/slackDraftStore.js";
import { slackLifecycleErrorLines } from "../../../../../cli/commands/slack/lifecycleErrors.js";
import { rowMovedBeforeSend } from "../../../../../cli/commands/slack/releaseRow.js";
import {
  appendRelaySteer,
  appendSteerLead,
  readRelayChannelPlan,
  rowSteerLead,
} from "../../../../../cli/commands/talk/relayChannelRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import { STILL_SPEAKING_HOLD, TAIL_UNSTATED_HOLD } from "../../../../../talk/relayCutHold.js";
import { storeAnnotatedShot } from "../../../../annotatedShotFixture.js";

const LAUNCH = { id: "C0SYN000001", name: "proj-launch-room" };
const ALERTS = { id: "C0SYN000006", name: "dev-alerts" };
const SECURITY = { id: "C0SYN000007", name: "sec-review" };
const ANCHOR = "talk:a0000054-0000-4000-8000-000000000057";
const SAID_AT = "2026-10-12T00:16:00.000Z";

/**
 * One held row in a channel, optionally re-cutting earlier rows. A first message in a channel, so it carries the link
 * and the annotated screenshot (stored under `home`) a release owes, and only the steer decides whether it moves.
 */
function parked({
  channel,
  home,
  id,
  recuts,
}: {
  channel: { id: string; name: string };
  home: string;
  id: string;
  recuts?: readonly string[];
}): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: channel.id,
    media: [storeAnnotatedShot({ home })],
    mentions: [],
    payload: {
      form: "plain" as const,
      text: "<https://linear.app/acme/issue/GGGG-1809|GGGG-1809> is a Vanta P1",
      unfurl_links: false,
      unfurl_media: false,
    },
  };
  return {
    ...content,
    advisory: [],
    channelName: channel.name,
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"GGGG-1809 is a Vanta P1"}]}',
    id,
    kind: "message",
    shape: "top-level",
    tsIso: "2026-10-12T00:10:00.000Z",
    why: "the incident's draft",
    ...(recuts === undefined ? {} : { recuts }),
  };
}

/** Park one row in the temp home's register. */
function park({ draft, home }: { draft: ParkedSlackDraft; home: string }): void {
  unwrap(appendSlackDraftEvent({ event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso }, home }));
}

describe("a relay naming #dev-alerts against a draft held for the launch channel", () => {
  let home = "";
  let dir = "";
  let original: ParkedSlackDraft;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "relay-steer-"));
    dir = join(home, "handovers");
    mkdirSync(dir, { recursive: true });
    original = parked({ channel: LAUNCH, home, id: "sd-359bafb2" });
    park({ draft: original, home });
    // An earlier row parked for #dev-alerts is what lets the register name that channel.
    park({ draft: parked({ channel: ALERTS, home, id: "sd-aaaaaaaa" }), home });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const steerRelay = {
    about: "post:sd-359bafb2",
    anchor: ANCHOR,
    heard: "Okay, this one is the Vanta P1. Let's send this to Dev alerts instead",
    words: "",
  };

  it("plans the exact steer, and a lead the row and the chair's line open on", () => {
    const { disposition, plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    expect(disposition).toEqual({ kind: "land" });
    expect(plan.steer).toEqual({
      draftId: original.id,
      event: {
        anchor: ANCHOR,
        channels: [ALERTS],
        from: LAUNCH,
        heard: "Let's send this to Dev alerts instead",
        id: original.id,
        kind: "steered",
        tsIso: SAID_AT,
      },
    });
    expect(plan.lead).toBe(
      "CHANNEL: the owner moved sd-359bafb2 to #dev-alerts: re-cut it there, a release into #proj-launch-room is refused",
    );
  });

  it("steers from the voice's reading when no transcript was attached, as the card check does", () => {
    const draft = { ...steerRelay, heard: "", words: "Move this to dev-alerts" };
    const { plan } = readRelayChannelPlan({ dir, draft, home, nowIso: SAID_AT });
    expect(plan.steer).toEqual({
      draftId: original.id,
      event: {
        anchor: ANCHOR,
        channels: [ALERTS],
        from: LAUNCH,
        heard: "Move this to dev-alerts",
        id: original.id,
        kind: "steered",
        tsIso: SAID_AT,
      },
    });
  });

  it("appends the steer once, then refuses the original and the same-channel re-cut, and lets the #dev-alerts re-cut go", () => {
    const { plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    expect(appendRelaySteer({ home, steer: plan.steer! })).toEqual({ kind: "appended" });
    expect(appendRelaySteer({ home, steer: plan.steer! })).toEqual({ kind: "already" });

    const deps = { doorEnv: () => ({}), readDraftLog: () => readSlackDraftLines({ home }) };
    const refusedOriginal = rowMovedBeforeSend({ deps, draft: original, home })!;
    expect(refusedOriginal.code).toBe("UPSTREAM_REFUSED");

    const sameChannel = parked({ channel: LAUNCH, home, id: "sd-dd932464", recuts: [original.id] });
    park({ draft: sameChannel, home });
    const refused = rowMovedBeforeSend({ deps, draft: sameChannel, home })!;
    expect(slackLifecycleErrorLines({ error: refused })).toContain(
      "Re-cut it into #dev-alerts: slopweaver slack draft record <the same flags> --channel C0SYN000006 --supersedes sd-dd932464",
    );

    const intoAlerts = parked({ channel: ALERTS, home, id: "sd-70e1a6b4", recuts: [sameChannel.id] });
    park({ draft: intoAlerts, home });
    expect(rowMovedBeforeSend({ deps, draft: intoAlerts, home })).toBeUndefined();
  });

  it("records the owner's take-back to a re-cut's own channel, so the latest word wins over the ancestor's steer", () => {
    const { plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    expect(appendRelaySteer({ home, steer: plan.steer! })).toEqual({ kind: "appended" });
    const sameChannel = parked({ channel: LAUNCH, home, id: "sd-dd932464", recuts: [original.id] });
    park({ draft: sameChannel, home });

    const takeBack = {
      about: `post:${sameChannel.id}`,
      anchor: "talk:a0000054-0000-4000-8000-000000000058",
      heard: "Actually, keep it in #proj-launch-room",
      words: "",
    };
    const back = readRelayChannelPlan({ dir, draft: takeBack, home, nowIso: "2026-10-12T00:20:00.000Z" }).plan;
    expect(back.steer!.event.channels).toEqual([LAUNCH]);
    expect(back.lead).toBe(
      "CHANNEL: the owner took sd-dd932464 back to #proj-launch-room: the earlier steer off it no longer holds",
    );
    expect(appendRelaySteer({ home, steer: back.steer! })).toEqual({ kind: "appended" });

    const deps = { doorEnv: () => ({}), readDraftLog: () => readSlackDraftLines({ home }) };
    expect(rowMovedBeforeSend({ deps, draft: sameChannel, home })).toBeUndefined();
  });

  // A take-back on words cut short lifted the earlier steer's refusal.
  it("records no take-back from a held relay, so the earlier steer still refuses, and says so in place of its lead", () => {
    const { plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    expect(appendSteerLead({ hold: undefined, home, plan })).toBe(plan.lead);
    const sameChannel = parked({ channel: LAUNCH, home, id: "sd-dd932464", recuts: [original.id] });
    park({ draft: sameChannel, home });
    const takeBack = {
      about: `post:${sameChannel.id}`,
      anchor: "talk:a0000054-0000-4000-8000-000000000058",
      heard: "Actually, keep it in #proj-launch-room",
      words: "",
    };
    const back = readRelayChannelPlan({ dir, draft: takeBack, home, nowIso: "2026-10-12T00:20:00.000Z" }).plan;
    expect(appendSteerLead({ hold: STILL_SPEAKING_HOLD, home, plan: back })).toBe(
      `CHANNEL: the take-back on sd-dd932464 was NOT recorded, so any earlier steer still refuses (${STILL_SPEAKING_HOLD})`,
    );
    const deps = { doorEnv: () => ({}), readDraftLog: () => readSlackDraftLines({ home }) };
    expect(rowMovedBeforeSend({ deps, draft: sameChannel, home })!.code).toBe("UPSTREAM_REFUSED");
  });

  // The launch-channel send was a steer at the cut END of the owner's words, so a held relay still records one.
  it("still records a held relay's steer off the row's channel, so the release into the old channel is refused", () => {
    const { plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    expect(appendSteerLead({ hold: TAIL_UNSTATED_HOLD, home, plan })).toBe(plan.lead);
    const deps = { doorEnv: () => ({}), readDraftLog: () => readSlackDraftLines({ home }) };
    expect(rowMovedBeforeSend({ deps, draft: original, home })!.code).toBe("UPSTREAM_REFUSED");
  });

  // The row's summary is written BEFORE the steer, off the plan's own lead.
  it("opens the row on the same lead as the chair: the held take-back's, a whole one's own, an away-steer's own", () => {
    const awayRead = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    const away = awayRead.plan;
    const sameChannel = parked({ channel: LAUNCH, home, id: "sd-dd932464", recuts: [original.id] });
    park({ draft: sameChannel, home });
    appendSteerLead({ hold: undefined, home, plan: away });
    const takeBack = {
      about: `post:${sameChannel.id}`,
      anchor: "talk:a0000054-0000-4000-8000-000000000059",
      heard: "Actually, keep it in #proj-launch-room",
      words: "",
    };
    const backRead = readRelayChannelPlan({ dir, draft: takeBack, home, nowIso: "2026-10-12T00:20:00.000Z" });
    const back = backRead.plan;
    expect(back.lead).toContain("the earlier steer off it no longer holds");
    expect([
      rowSteerLead({ governing: backRead.governing, hold: STILL_SPEAKING_HOLD, plan: back }),
      rowSteerLead({ governing: backRead.governing, hold: undefined, plan: back }),
      rowSteerLead({ governing: awayRead.governing, hold: TAIL_UNSTATED_HOLD, plan: away }),
    ]).toEqual([
      `CHANNEL: the take-back on sd-dd932464 was NOT recorded, so any earlier steer still refuses (${STILL_SPEAKING_HOLD})`,
      back.lead,
      away.lead,
    ]);
  });

  // The newest steer wins, so a cut steer to a THIRD channel would replace a whole one.
  it("records no held steer to a channel the governing steer refuses, so a re-cut there is still refused", () => {
    park({ draft: parked({ channel: SECURITY, home, id: "sd-bbbbbbbb" }), home });
    appendSteerLead({
      hold: undefined,
      home,
      plan: readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT }).plan,
    });
    const third = {
      ...steerRelay,
      anchor: "talk:a0000054-0000-4000-8000-000000000060",
      heard: "Send it to #sec-review",
    };
    const read = readRelayChannelPlan({ dir, draft: third, home, nowIso: "2026-10-12T00:20:00.000Z" });
    const notRecorded = `CHANNEL: the steer on sd-359bafb2 was NOT recorded, so the owner's earlier word for #dev-alerts still governs (${STILL_SPEAKING_HOLD})`;
    expect(read.plan.steer!.event.channels).toEqual([SECURITY]);
    expect([
      rowSteerLead({ governing: read.governing, hold: STILL_SPEAKING_HOLD, plan: read.plan }),
      appendSteerLead({ hold: STILL_SPEAKING_HOLD, home, plan: read.plan }),
    ]).toEqual([notRecorded, notRecorded]);
    const intoSecurity = parked({ channel: SECURITY, home, id: "sd-70e1a6b5", recuts: [original.id] });
    park({ draft: intoSecurity, home });
    const deps = { doorEnv: () => ({}), readDraftLog: () => readSlackDraftLines({ home }) };
    expect(rowMovedBeforeSend({ deps, draft: intoSecurity, home })!.code).toBe("UPSTREAM_REFUSED");
    expect(appendSteerLead({ hold: undefined, home, plan: read.plan })).toBe(read.plan.lead);
    expect(rowMovedBeforeSend({ deps, draft: intoSecurity, home })).toBeUndefined();
  });

  it("steers off the own channel when the owner's words name it beside another, fail-closed, never into it", () => {
    const both = { ...steerRelay, heard: "Move it from #proj-launch-room to #dev-alerts" };
    const { plan } = readRelayChannelPlan({ dir, draft: both, home, nowIso: SAID_AT });
    expect(plan.steer!.event.channels).toEqual([ALERTS]);
  });

  it("records nothing when the owner names a row's own channel and no steer holds it off that channel", () => {
    const own = { ...steerRelay, heard: "Keep it in #proj-launch-room" };
    const { plan } = readRelayChannelPlan({ dir, draft: own, home, nowIso: SAID_AT });
    expect(plan.steer).toBeUndefined();
  });

  it("refuses a re-cut whose ancestor's steer line will not read, rather than send it unsteered", () => {
    const sameChannel = parked({ channel: LAUNCH, home, id: "sd-dd932464", recuts: [original.id] });
    park({ draft: sameChannel, home });
    const unreadable = JSON.stringify({
      anchor: "talk:not-a-uuid",
      channels: [ALERTS],
      from: LAUNCH,
      heard: "Let's send this to Dev alerts instead",
      id: original.id,
      kind: "steered",
      tsIso: SAID_AT,
    });
    const deps = { doorEnv: () => ({}), readDraftLog: () => [...readSlackDraftLines({ home }), unreadable] };
    const refused = rowMovedBeforeSend({ deps, draft: sameChannel, home })!;
    expect(slackLifecycleErrorLines({ error: refused }).join("\n")).toContain("sd-359bafb2");
  });

  it("withholds the owner's incident words from an open ask card that never mentions either channel", () => {
    const slug = "land-acme-acme-admin-17376-b9ed88b";
    writeFileSync(
      join(dir, `${slug}.md`),
      "---\nslug: land-acme-acme-admin-17376-b9ed88b\n---\nLand acme-admin #17376.\n",
    );
    const { disposition, plan } = readRelayChannelPlan({
      dir,
      draft: {
        about: `ask:${slug}`,
        anchor: "talk:talk-60b2496c0000",
        heard: "Public mix-up. This was meant to go into Dev alerts, but it's gone into the launch channel",
        words: "",
      },
      home,
      nowIso: "2026-10-12T00:44:00.000Z",
    });
    expect(disposition).toEqual({
      kind: "withheld",
      why: `the owner's words name #dev-alerts, and ask:${slug} mentions none of them`,
    });
    expect(plan.steer).toBeUndefined();
    expect(plan.lead).toBe(
      `CHANNEL: not landed on ask:${slug}: the owner's words name #dev-alerts, and ask:${slug} mentions none of them; the owner named #dev-alerts; no held draft is on screen, so none was steered — place it`,
    );
  });

  // A relay naming nothing landed on a dispatch row whose `doneWhen:` entries were quoted strings, and the
  // close's approved-draft gate, reading that row with `readExactDoc`, refused the chair's close on it twice.
  it("lands a relay naming nothing on no ask whose front matter the close's gate cannot read, and names why", () => {
    const slug = "acme-codex-host-gaps";
    const path = join(dir, `${slug}.md`);
    writeFileSync(path, `---\nslug: ${slug}\nstatus: ready\ndoneWhen:\n  - "present: src/a.ts#one"\n---\nWork.\n`);
    const { disposition, plan } = readRelayChannelPlan({
      dir,
      draft: {
        about: `ask:${slug}`,
        anchor: "talk:talk-52e0c5d00000",
        heard: "Yeah, that makes more sense",
        words: "",
      },
      home,
      nowIso: SAID_AT,
    });
    const why =
      `ask:${slug} would not read, so the relay lands on no card ` +
      `(${path}: its front-matter has 1 problem(s): doneWhen[0] is not a \`kind: value\` entry)`;
    expect(disposition).toEqual({ kind: "withheld", why });
    expect(plan.lead).toBe(`CHANNEL: not landed on ask:${slug}: ${why}`);
  });

  // `ask:.foo` passes the card-key grammar but no doc can carry it, and the close's gate reads such a
  // landing as unreadable (`landedCardReads.ts`'s `askTexts`), so it lands on no card either.
  it("lands a relay naming nothing on no ask whose key no doc can carry", () => {
    const { disposition } = readRelayChannelPlan({
      dir,
      draft: { about: "ask:.foo", anchor: "talk:talk-52e0c5d00000", heard: "Yeah, that makes more sense", words: "" },
      home,
      nowIso: SAID_AT,
    });
    expect(disposition).toEqual({
      kind: "withheld",
      why: "ask:.foo would not read, so the relay lands on no card (ask:.foo is not a slug a doc can carry)",
    });
  });

  it("still lands a relay naming nothing on an ask whose front matter reads", () => {
    const slug = "acme-codex-host-gaps";
    writeFileSync(
      join(dir, `${slug}.md`),
      `---\nslug: ${slug}\nstatus: ready\ndoneWhen:\n  - present: src/a.ts#one\n---\n`,
    );
    const { disposition } = readRelayChannelPlan({
      dir,
      draft: {
        about: `ask:${slug}`,
        anchor: "talk:talk-52e0c5d00000",
        heard: "Yeah, that makes more sense",
        words: "",
      },
      home,
      nowIso: SAID_AT,
    });
    expect(disposition).toEqual({ kind: "land" });
  });

  it("keeps the whole withheld card key inside the chair line's cut, for the longest slug a card can carry", () => {
    const long = "a".repeat(160);
    writeFileSync(join(dir, `${long}.md`), `---\nslug: ${long}\n---\nUnrelated task.\n`);
    const { plan } = readRelayChannelPlan({
      dir,
      draft: { about: `ask:${long}`, anchor: "talk:talk-60b2496c0000", heard: "Send this to #dev-alerts", words: "" },
      home,
      nowIso: "2026-10-12T00:44:00.000Z",
    });
    // `supervisorDelivery.ts` keeps the first 238 characters of a lead over its 240 cap.
    const opening = `CHANNEL: not landed on ask:${long}:`;
    expect(plan.lead!.slice(0, opening.length)).toBe(opening);
    expect(opening.length).toBeLessThan(238);
  });

  it("lands words naming a channel on an ask card whose doc names it", () => {
    const slug = "post-the-p1-to-dev-alerts";
    writeFileSync(join(dir, `${slug}.md`), "---\nslug: post-the-p1-to-dev-alerts\n---\nPost it in #dev-alerts.\n");
    const { disposition } = readRelayChannelPlan({
      dir,
      draft: { about: `ask:${slug}`, anchor: "talk:talk-111111111111", heard: "yes, dev alerts", words: "" },
      home,
      nowIso: SAID_AT,
    });
    expect(disposition).toEqual({ kind: "land" });
  });

  it("steers the draft the owner names, never the other draft whose card is open", () => {
    const named = parked({ channel: LAUNCH, home, id: "sd-22222222" });
    park({ draft: named, home });
    const { disposition, plan } = readRelayChannelPlan({
      dir,
      draft: { ...steerRelay, heard: "Move sd-22222222 to Dev alerts." },
      home,
      nowIso: SAID_AT,
    });
    expect(disposition).toEqual({
      kind: "withheld",
      why: "the owner's words name sd-22222222, not sd-359bafb2, the draft on screen",
    });
    expect([plan.steer!.draftId, plan.steer!.event.id]).toEqual([named.id, named.id]);
  });

  it("steers neither draft when the owner names two, and says so", () => {
    park({ draft: parked({ channel: LAUNCH, home, id: "sd-22222222" }), home });
    const { plan } = readRelayChannelPlan({
      dir,
      draft: { ...steerRelay, heard: "Move sd-359bafb2 and sd-22222222 to Dev alerts." },
      home,
      nowIso: SAID_AT,
    });
    expect(plan.steer).toBeUndefined();
    expect(plan.lead).toBe(
      "CHANNEL: the owner named #dev-alerts; sd-359bafb2 and sd-22222222 are more than one draft, so none was steered — place it",
    );
  });

  it("refuses to append once the row is no longer held", () => {
    const { plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    unwrap(
      appendSlackDraftEvent({
        event: { id: original.id, kind: "dropped", note: "gone", tsIso: "2026-10-12T00:17:00.000Z" },
        home,
      }),
    );
    expect(appendRelaySteer({ home, steer: plan.steer! })).toEqual({
      kind: "refused",
      why: "sd-359bafb2 is no longer held",
    });
  });

  it("opens the lead on a failed append, so the chair line's cut of a long lead keeps it", () => {
    const { plan } = readRelayChannelPlan({ dir, draft: steerRelay, home, nowIso: SAID_AT });
    unwrap(
      appendSlackDraftEvent({
        event: { id: original.id, kind: "dropped", note: "gone", tsIso: "2026-10-12T00:17:00.000Z" },
        home,
      }),
    );
    const longLead = { ...plan, lead: `${plan.lead!} ${"x".repeat(300)}` };
    const notice =
      "CHANNEL: the steer on sd-359bafb2 was NOT recorded, so nothing refuses the old channel (sd-359bafb2 is no longer held)";
    expect(appendSteerLead({ hold: undefined, home, plan: longLead })!.slice(0, notice.length)).toBe(notice);
  });
});
