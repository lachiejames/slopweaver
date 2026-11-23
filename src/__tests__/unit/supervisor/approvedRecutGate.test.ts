/**
 * A re-cut inheriting the owner's approval, composed end to end: the register lines the verbs write, read back and folded,
 * bound to the landings, judged by the tick gate. A re-cut judges no words, so it stands on the boundary and the
 * blocking hold of the row it came from: a landing past that boundary stays owed, and a stated
 * block stays the reason the owner reads rather than becoming a bare send obligation.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { inheritedDraftApproval } from "../../../outbound/slack/draftApproval.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import {
  type DraftApproval,
  type SlackDraftEvent,
  type SlackDraftItem,
  slackDraftEventLine,
} from "../../../outbound/slack/draftRegister.js";
import { judgeApprovedDrafts } from "../../../supervisor/approvedDraftGate.js";
import { draftLandingBindings } from "../../../supervisor/draftLandingBinding.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { draftItem, landed } from "./draftItemFixture.js";

const PARENT = "sd-11112222";
const CHILD = "sd-33334444";
const TICK = "2026-10-08T01:00:00.000Z";

const APPROVAL: DraftApproval = {
  anchor: "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt",
  atIso: "2026-10-08T00:05:00.000Z",
  heard: "Send it",
};

/** The register after `slack draft record --supersedes PARENT`: the events so far, the inheriting park, its drop. */
function recut({ events }: { events: readonly SlackDraftEvent[] }): readonly SlackDraftItem[] {
  const parent = readBack({ events }).find((one) => one.id === PARENT)!;
  const carried = unwrap(inheritedDraftApproval({ fresh: undefined, meaningChanged: undefined, superseded: [parent] }));
  const { draft } = draftItem({ id: CHILD, tsIso: "2026-10-08T00:40:00.000Z" });
  const note = `superseded by ${CHILD} (recorded with --supersedes)`;
  return readBack({
    events: [
      ...events,
      { draft: { ...draft, ...carried, recuts: [PARENT] }, id: CHILD, kind: "parked", tsIso: draft.tsIso },
      { id: PARENT, kind: "dropped", note, tsIso: "2026-10-08T00:40:01.000Z" },
    ],
  });
}

/** Fold the events the way every verb does: written as register lines, then read back. */
function readBack({ events }: { events: readonly SlackDraftEvent[] }): readonly SlackDraftItem[] {
  const log = parseSlackDraftLog({ lines: events.map((event) => slackDraftEventLine({ event })) });
  expect(log.skipped).toEqual([]);
  return foldSlackDraftLog({ log });
}

/** Judge one tick over the folded rows and these landing rows, in ledger order. */
function judge({ items, landingRows }: { items: readonly SlackDraftItem[]; landingRows: readonly CardLandedRow[] }) {
  const landings = draftLandingBindings({ cards: [], items, landingRows, skipped: [] });
  return judgeApprovedDrafts({
    read: { answers: new Map(), items, kind: "read", landings, skippedLines: 0, unreadApproved: [], unsureIds: [] },
    startedIso: TICK,
  });
}

describe("a re-cut inheriting the owner's approval", () => {
  const { draft } = draftItem({ id: PARENT, tsIso: "2026-10-08T00:10:00.000Z" });
  const parked: SlackDraftEvent = { draft, id: PARENT, kind: "parked", tsIso: draft.tsIso };

  it("keeps a landing past the approval's boundary owed, however late the re-cut parked", () => {
    const approved: SlackDraftEvent = {
      approval: APPROVAL,
      id: PARENT,
      kind: "approved",
      landingsRead: 1,
      tsIso: "2026-10-08T00:20:00.000Z",
    };
    const seen = { ...landed({ cardKey: `post:${PARENT}`, decidedIso: "2026-10-08T00:05:00.000Z" }), anchor: "talk:1" };
    const later = landed({ cardKey: `post:${PARENT}`, decidedIso: "2026-10-08T00:25:00.000Z" });
    const items = recut({ events: [parked, approved] });
    const child = items.find((one) => one.id === CHILD)!;

    expect([child.judgedIso, child.judgedLandings]).toEqual(["2026-10-08T00:20:00.000Z", 1]);
    expect(judge({ items, landingRows: [seen, later] })).toEqual({
      drafts: [child],
      kind: "refused",
      landings: [{ item: child, landing: later, ledgerRow: 1, namedId: PARENT }],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("carries a blocking hold onto the re-cut, so the reason stays the owner's to read rather than a bare send", () => {
    const approvedPark: SlackDraftEvent = { ...parked, draft: { ...draft, approval: APPROVAL } };
    const held: SlackDraftEvent = {
      id: PARENT,
      kind: "held",
      landingsRead: 0,
      reason: "no-fleet-slot",
      tsIso: "2026-10-08T00:20:00.000Z",
      why: "every seat is busy",
    };
    const items = recut({ events: [approvedPark, held] });
    const child = items.find((one) => one.id === CHILD)!;

    expect(child.hold).toEqual({
      atIso: "2026-10-08T00:20:00.000Z",
      reason: "no-fleet-slot",
      why: "every seat is busy",
    });
    expect(judge({ items, landingRows: [] })).toEqual({ kind: "clean" });
  });
});
