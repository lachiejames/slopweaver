/**
 * A judgement landing on a parked row: an approval, a hold and a Codex comparison each fold onto the row through
 * the log, and a judgement whose instant or digest does not bind is never read as one.
 */
import { describe, expect, it } from "vitest";

import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import { NOT_OWNER_YES_REASON } from "../../../../../outbound/slack/draftHoldReasons.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../../outbound/slack/draftLog.js";
import {
  parkedDraftDigest,
  type SlackDraftEvent,
  type SlackDraftItem,
  slackDraftEventLine,
} from "../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";
import { draft } from "./fixtures.js";

/** The persisted hold reason for a hold that is not the owner's yes, spelled out so a renamed code fails here. */
const NOT_YES = "not-owner-yes" as const;

describe("approved and held — a judgement of the owner's words lands on the row", () => {
  const APPROVAL = { anchor: "talk-call:f9e9277d#12", atIso: "2026-10-08T00:16:54.000Z", heard: "Yes, send it today" };
  const PARK = { draft: draft(), id: "sd-11111111", kind: "parked" as const, tsIso: "2026-09-23T00:00:00.000Z" };
  const APPROVED = {
    approval: APPROVAL,
    id: "sd-11111111",
    kind: "approved" as const,
    tsIso: "2026-10-08T00:20:00.000Z",
  };
  const LATE = "2026-10-08T02:00:00.000Z";

  /** Round-trip events through the log, so the parse and the fold are both under test. */
  const folded = ({ events }: { events: readonly SlackDraftEvent[] }): SlackDraftItem => {
    const lines = events.map((event) => slackDraftEventLine({ event }));
    return foldSlackDrafts({ events: parseSlackDraftLog({ lines }).events })[0]!;
  };

  it("binds an approval to an unjudged row and stamps when it was recorded", () => {
    const row = folded({ events: [PARK, APPROVED] });
    expect(row.draft.approval).toEqual(APPROVAL);
    expect(row.judgedIso).toBe("2026-10-08T00:20:00.000Z");
    expect(row.hold).toBe(undefined);
  });

  it("stamps a park carrying an approval as judged at the park, and leaves a bare park unjudged", () => {
    const approvedPark = { ...PARK, draft: draft({ over: { approval: APPROVAL } }) };
    expect(folded({ events: [approvedPark] }).judgedIso).toBe("2026-09-23T00:00:00.000Z");
    expect("judgedIso" in folded({ events: [PARK] })).toBe(false);
  });

  it("keeps the approval under a hold that is not about the owner's words, so the row reads approved but blocked", () => {
    const held = {
      ...APPROVED,
      kind: "held" as const,
      reason: "no-fleet-slot" as const,
      tsIso: "2026-10-08T02:00:00.000Z",
      why: "every slot is busy",
    };
    const { approval: _approval, ...heldEvent } = held;
    const row = folded({ events: [PARK, APPROVED, heldEvent] });
    expect(row.draft.approval).toEqual(APPROVAL);
    expect(row.hold).toEqual({ atIso: "2026-10-08T02:00:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" });
    // A blocking hold judges none of the owner's words, so the row keeps the instant of the yes it sits over.
    expect(row.judgedIso).toBe(APPROVED.tsIso);
  });

  it("sets the approval down on a hold that is not the owner's yes, and on meaning-changed carries the why as the change", () => {
    const hold = ({ reason }: { reason: typeof NOT_YES | "meaning-changed" }): SlackDraftEvent => ({
      id: "sd-11111111",
      kind: "held",
      reason,
      tsIso: "2026-10-08T02:00:00.000Z",
      why: "the thread moved on",
    });
    const notYes = folded({ events: [PARK, APPROVED, hold({ reason: NOT_YES })] });
    expect("approval" in notYes.draft).toBe(false);
    expect(notYes.hold!.reason).toBe(NOT_YES);
    const changed = folded({ events: [PARK, APPROVED, hold({ reason: "meaning-changed" })] });
    expect("approval" in changed.draft).toBe(false);
    expect(changed.draft.meaningChanged).toBe("the thread moved on");
  });

  it("lifts a hold and a change of meaning when a later yes arrives, since that yes owes a send again", () => {
    const changedPark = { ...PARK, draft: draft({ over: { meaningChanged: "the ask moved" } }) };
    const held: SlackDraftEvent = {
      id: "sd-11111111",
      kind: "held",
      reason: "thread-moved",
      tsIso: "2026-10-08T00:10:00.000Z",
      why: "a reply",
    };
    const row = folded({ events: [changedPark, held, APPROVED] });
    expect(row.draft.approval).toEqual(APPROVAL);
    expect("meaningChanged" in row.draft).toBe(false);
    expect(row.hold).toBe(undefined);
  });

  it("never revives a spent row", () => {
    const dropped: SlackDraftEvent = {
      id: "sd-11111111",
      kind: "dropped",
      note: "superseded",
      tsIso: "2026-10-08T00:15:00.000Z",
    };
    const row = folded({ events: [PARK, dropped, APPROVED] });
    expect(row.state).toBe("dropped");
    expect("approval" in row.draft).toBe(false);
  });

  it("reads the set-down hold as written, setting the approval down", () => {
    const heldLine = JSON.stringify({
      id: "sd-11111111",
      kind: "held",
      reason: NOT_OWNER_YES_REASON,
      schemaVersion: 1,
      tsIso: LATE,
      why: "not a yes",
    });
    const lines = [PARK, APPROVED].map((event) => slackDraftEventLine({ event })).concat(heldLine);
    const row = foldSlackDrafts({ events: parseSlackDraftLog({ lines }).events })[0]!;
    expect(row.hold!.reason).toBe("not-owner-yes");
    expect("approval" in row.draft).toBe(false);
  });

  it("does not read a hold whose reason is outside the set or whose why is blank", () => {
    const lines = [
      slackDraftEventLine({ event: PARK }),
      JSON.stringify({
        id: "sd-11111111",
        kind: "held",
        reason: "busy",
        schemaVersion: 1,
        tsIso: "2026-10-08T02:00:00.000Z",
        why: "w",
      }),
      JSON.stringify({
        id: "sd-11111111",
        kind: "held",
        reason: "no-fleet-slot",
        schemaVersion: 1,
        tsIso: "2026-10-08T02:00:00.000Z",
        why: " ",
      }),
    ];
    const log = parseSlackDraftLog({ lines });
    expect(log.events.map((event) => event.kind)).toEqual(["parked"]);
    expect(log.skipped.map((line) => line.line)).toEqual([2, 3]);
  });

  it("does not read a judgement whose own instant does not parse, so the row never reads approved off it", () => {
    const lines = [
      slackDraftEventLine({ event: PARK }),
      JSON.stringify({ ...APPROVED, schemaVersion: 1, tsIso: "definitely-not-an-instant" }),
    ];
    const log = parseSlackDraftLog({ lines });
    expect(log.events.map((event) => event.kind)).toEqual(["parked"]);
    expect(log.skipped).toEqual([{ id: "sd-11111111", kind: "approved", line: 2 }]);
    expect(foldSlackDraftLog({ log })).toEqual([]);
  });

  it("does not read an approved park whose own instant does not parse, while a bare one still reads", () => {
    const judged = { ...PARK, draft: { ...PARK.draft, approval: APPROVAL }, schemaVersion: 1, tsIso: "not-an-instant" };
    const bare = { ...PARK, id: "sd-22222222", schemaVersion: 1, tsIso: "not-an-instant" };
    const log = parseSlackDraftLog({ lines: [JSON.stringify(judged), JSON.stringify(bare)] });

    expect(log.events.map((event) => [event.kind, event.id])).toEqual([["parked", "sd-22222222"]]);
    expect(log.skipped).toEqual([{ id: "sd-11111111", kind: "parked", line: 1 }]);
  });

  it("does not read an approved park whose DRAFT's instant does not parse behind a valid line instant", () => {
    const judged = { ...PARK, draft: { ...PARK.draft, approval: APPROVAL, tsIso: "not-an-instant" }, schemaVersion: 1 };
    const bare = { ...PARK, draft: { ...PARK.draft, id: "sd-22222222", tsIso: "not-an-instant" }, id: "sd-22222222" };
    const log = parseSlackDraftLog({ lines: [JSON.stringify(judged), JSON.stringify({ ...bare, schemaVersion: 1 })] });

    expect(log.events.map((event) => [event.kind, event.id])).toEqual([["parked", "sd-22222222"]]);
    expect(log.skipped).toEqual([{ id: "sd-11111111", kind: "parked", line: 1 }]);
  });
});

describe("compared — a Codex draft's digest is bound to its own words", () => {
  const row = draft({ over: { comparison: { state: "pending" } } });
  const PARK = { draft: row, id: row.id, kind: "parked" as const, tsIso: "2026-09-23T00:00:00.000Z" };
  const richOf = ({ text }: { text: string }): SlackDripMessagePayload => ({
    blocks: [{ elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" }],
    form: "rich",
    text,
    unfurl_links: true,
    unfurl_media: true,
  });
  const B = richOf({ text: "B shown on Queue" });
  const C = richOf({ text: "C sent to Slack" });
  const { authorId, channel } = row;
  const mintedFor = ({ payload }: { payload: SlackDripMessagePayload }): string =>
    parkedDraftDigest({ draft: { authorId, channel, mentions: [], payload } });
  const compared = ({ digest }: { digest: string }): SlackDraftEvent => ({
    id: row.id,
    kind: "compared",
    outcome: {
      candidate: { advisory: [], digest, form: '{"kind":"drip","messages":[]}', mentions: [], payload: B },
      elapsedMs: 1,
      requestedModel: "gpt-test",
      state: "ready",
    },
    tsIso: "2026-09-23T00:01:00.000Z",
  });
  const folded = ({ events }: { events: readonly SlackDraftEvent[] }): SlackDraftItem => {
    const lines = events.map((event) => slackDraftEventLine({ event }));
    return foldSlackDrafts({ events: parseSlackDraftLog({ lines }).events })[0]!;
  };

  it("takes a candidate whose digest its own words mint", () => {
    expect(folded({ events: [PARK, compared({ digest: mintedFor({ payload: B }) })] }).comparison!.state).toBe("ready");
  });

  it("reads a candidate carrying another message's digest as refused, so the card keeps A alone", () => {
    const forged = folded({ events: [PARK, compared({ digest: mintedFor({ payload: C }) })] });
    expect(forged.comparison).toEqual({
      atIso: "2026-09-23T00:01:00.000Z",
      reasons: ["the Codex draft's digest does not bind its own words, so the line was not written by a pass"],
      stage: "admission",
      state: "refused",
    });
  });
});
