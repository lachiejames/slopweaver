/**
 * `approvedDraftGate.ts` — a tick is refused while a held draft the owner already approved, recorded before the tick began,
 * is unsent with no hold; and while the owner's words landed on a draft's card before the tick began with no judgement of
 * them recorded since. A row recorded mid-tick is the next tick's, and an unparseable instant is owed rather than
 * passed.
 */
import { describe, expect, it } from "vitest";

import type { DraftApproval } from "../../../outbound/slack/draftRegister.js";
import { judgeApprovedDrafts } from "../../../supervisor/approvedDraftGate.js";
import type { DraftLandingBindings } from "../../../supervisor/draftLandingBinding.js";
import type { AnswerContext } from "../../../talk/answerContext.js";
import { draftItem as item, KNOCK, landed } from "./draftItemFixture.js";

const STARTED = "2026-10-07T13:00:00.000Z";

const APPROVAL: DraftApproval = {
  anchor: "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt",
  atIso: "2026-10-07T05:52:59.000Z",
  heard: "Send it",
};

const NO_LANDINGS: DraftLandingBindings = { bound: [], unreadable: [] };

const NO_ANSWERS: ReadonlyMap<string, AnswerContext> = new Map();

const OWED = item({ approval: APPROVAL, id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" });

describe("judgeApprovedDrafts", () => {
  it("is clean when no held row carries the owner's approval", () => {
    const verdict = judgeApprovedDrafts({
      read: {
        items: [
          item({ id: "sd-aaaa0000", tsIso: "2026-10-07T05:55:00.000Z" }),
          item({ approval: APPROVAL, id: "sd-bbbb0000", state: "released", tsIso: "2026-10-07T05:55:00.000Z" }),
        ],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("refuses a held approved row recorded before the tick, carrying the skipped count", () => {
    const verdict = judgeApprovedDrafts({
      read: {
        items: [OWED],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 2,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({
      drafts: [OWED],
      kind: "refused",
      landings: [],
      skippedLines: 2,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still refuses an approved row a passed-over line names, marking it unsure", () => {
    const verdict = judgeApprovedDrafts({
      read: {
        items: [OWED],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 1,
        unreadApproved: [],
        unsureIds: ["sd-11112222", "sd-99990000"],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({
      drafts: [OWED],
      kind: "refused",
      landings: [],
      skippedLines: 1,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: ["sd-11112222"],
    });
  });

  it("owes a held row carrying the owner's word that a passed-over line names, since the Queue hides it", () => {
    const changed = item({ id: "sd-bbbb2222", meaningChanged: "thread moved", tsIso: "2026-10-07T05:55:00.000Z" });
    const setDown = item({
      hold: {
        atIso: "2026-10-07T06:00:00.000Z",
        reason: "thread-moved",
        setDown: { approval: APPROVAL, atIso: "2026-10-07T05:58:00.000Z", why: "they meant the other" },
        why: "the thread moved",
      },
      id: "sd-cccc3333",
      tsIso: "2026-10-07T05:55:00.000Z",
    });
    const blocked = item({
      approval: APPROVAL,
      hold: { atIso: "2026-10-07T06:00:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
      id: "sd-dddd4444",
      tsIso: "2026-10-07T05:55:00.000Z",
    });
    // A later row's skipped line still owes it: the line's own instant is unknown.
    const plain = item({ id: "sd-eeee5555", tsIso: "2026-10-07T13:30:00.000Z" });
    const rows = [changed, setDown, blocked, plain];
    const readOf = ({ unsureIds }: { unsureIds: readonly string[] }) =>
      ({
        items: rows,
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 4,
        unreadApproved: [],
        unsureIds,
      }) as const;

    expect(
      judgeApprovedDrafts({ read: readOf({ unsureIds: rows.map((row) => row.id) }), startedIso: STARTED }),
    ).toEqual({
      drafts: [changed, setDown, blocked],
      kind: "refused",
      landings: [],
      skippedLines: 4,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: ["sd-bbbb2222", "sd-cccc3333", "sd-dddd4444"],
    });
    expect(judgeApprovedDrafts({ read: readOf({ unsureIds: [] }), startedIso: STARTED })).toEqual({ kind: "clean" });
  });

  it("leaves a row recorded after the tick began to the next tick", () => {
    const late = item({ approval: APPROVAL, id: "sd-33334444", tsIso: "2026-10-07T13:00:01.000Z" });
    const verdict = judgeApprovedDrafts({
      read: {
        items: [late],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("dates an approval recorded by `slack draft approve` from that judgement, not the park", () => {
    const approvedMidTick = item({
      approval: APPROVAL,
      id: "sd-33335555",
      judgedIso: "2026-10-07T13:00:01.000Z",
      tsIso: "2026-10-07T05:55:00.000Z",
    });
    const verdict = judgeApprovedDrafts({
      read: {
        items: [approvedMidTick],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("passes an approved row a session held with a named reason, since the Queue card says why", () => {
    const held = item({
      approval: APPROVAL,
      hold: { atIso: "2026-10-07T06:00:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
      id: "sd-77778888",
      judgedIso: "2026-10-07T06:00:00.000Z",
      tsIso: "2026-10-07T05:55:00.000Z",
    });
    const verdict = judgeApprovedDrafts({
      read: {
        items: [held],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("owes a row whose own instant does not parse", () => {
    const malformed = item({ approval: APPROVAL, id: "sd-55556666", tsIso: "not a time" });
    const verdict = judgeApprovedDrafts({
      read: {
        items: [malformed],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: STARTED,
    });

    expect(verdict).toEqual({
      drafts: [malformed],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("passes an unreadable register through", () => {
    const verdict = judgeApprovedDrafts({ read: { kind: "unreadable", why: "EACCES" }, startedIso: STARTED });

    expect(verdict).toEqual({ kind: "unreadable", why: "EACCES" });
  });

  it("is unreadable when the tick's own start does not parse", () => {
    const verdict = judgeApprovedDrafts({
      read: {
        items: [OWED],
        answers: NO_ANSWERS,
        kind: "read",
        landings: NO_LANDINGS,
        skippedLines: 0,
        unreadApproved: [],
        unsureIds: [],
      },
      startedIso: "soon",
    });

    expect(verdict).toEqual({
      kind: "unreadable",
      why: "the tick's start soon does not parse, so no deadline can be judged",
    });
  });
});

describe("judgeApprovedDrafts — the owner's words on a draft's card owe a judgement", () => {
  const TICK = "2026-10-08T01:00:00.000Z";
  const DECIDED = "2026-10-08T00:16:54.000Z";
  const LANDING = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: DECIDED });
  const UNJUDGED = item({ id: "sd-c57b4ade", tsIso: "2026-10-08T00:30:00.000Z" });

  const read = ({ bindings, unsureIds = [] }: { bindings: DraftLandingBindings; unsureIds?: readonly string[] }) =>
    ({
      items: bindings.bound.map((one) => one.item),
      answers: NO_ANSWERS,
      kind: "read",
      landings: bindings,
      skippedLines: 0,
      unreadApproved: [],
      unsureIds,
    }) as const;

  it("refuses the shape where their yes landed on the card, the live cut was never judged", () => {
    const bound = { item: UNJUDGED, landing: LANDING, namedId: "sd-e8de7674" };
    const verdict = judgeApprovedDrafts({
      read: read({ bindings: { bound: [bound], unreadable: [] }, unsureIds: ["sd-c57b4ade"] }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: ["sd-c57b4ade"],
    });
  });

  it("passes a landing the row was judged at or after — approved or held, either way said", () => {
    const judged = item({
      hold: { atIso: DECIDED, reason: "not-owner-yes", why: "they said yes to the other option" },
      id: "sd-c57b4ade",
      judgedIso: DECIDED,
      tsIso: "2026-10-08T00:30:00.000Z",
    });
    const verdict = judgeApprovedDrafts({
      read: read({ bindings: { bound: [{ item: judged, landing: LANDING, namedId: "sd-c57b4ade" }], unreadable: [] } }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("orders a counted judgement by the landing ledger, not by instants", () => {
    // Judged at 00:20 having read 3 ledger rows; the owner's words were decided at 00:16:54 but written at row 3, after it.
    const judged = {
      ...item({
        hold: { atIso: "2026-10-08T00:20:00.000Z", reason: "not-owner-yes", why: "they said yes to the other option" },
        id: "sd-c57b4ade",
        judgedIso: "2026-10-08T00:20:00.000Z",
        tsIso: "2026-10-08T00:05:00.000Z",
      }),
      judgedLandings: 3,
    };
    const late = { item: judged, landing: LANDING, ledgerRow: 3, namedId: "sd-c57b4ade" };
    const seen = { ...late, ledgerRow: 2 };

    expect(
      judgeApprovedDrafts({ read: read({ bindings: { bound: [late], unreadable: [] } }), startedIso: TICK }),
    ).toEqual({
      drafts: [],
      kind: "refused",
      landings: [late],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
    expect(
      judgeApprovedDrafts({ read: read({ bindings: { bound: [seen], unreadable: [] } }), startedIso: TICK }),
    ).toEqual({ kind: "clean" });
  });

  it("owes a post landing that outran its draft's drop until the owner's words are re-recorded as approved", () => {
    const post = landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED });
    // Held not-owner-yes over OTHER words before the drop: that judgement predates these words and answers nothing.
    const dropped = item({
      hold: { atIso: "2026-10-08T00:17:00.000Z", reason: "not-owner-yes", why: "an earlier 'not yet'" },
      id: "sd-11112222",
      judgedIso: "2026-10-08T00:17:00.000Z",
      outcome: "moot: Seth answered",
      resolvedIso: "2026-10-08T00:18:00.000Z",
      state: "dropped",
      tsIso: "2026-10-08T00:10:00.000Z",
    });
    const bound = { item: dropped, landing: post, namedId: "sd-11112222" };
    const reRecorded = item({
      approval: KNOCK,
      id: "sd-99990000",
      judgedIso: "2026-10-08T00:40:00.000Z",
      tsIso: "2026-10-08T00:40:00.000Z",
    });
    const owed = judgeApprovedDrafts({
      read: read({ bindings: { bound: [bound], unreadable: [] } }),
      startedIso: TICK,
    });
    const takenUp = judgeApprovedDrafts({
      read: { ...read({ bindings: { bound: [bound], unreadable: [] } }), items: [dropped, reRecorded] },
      startedIso: TICK,
    });

    expect(owed).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
    expect(takenUp).toEqual({
      drafts: [reRecorded],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes a dropped draft's landing that grew past the rows its released re-record's approval counted", () => {
    const post = landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED });
    const dropped = item({
      id: "sd-11112222",
      outcome: "moot: Seth answered",
      resolvedIso: "2026-10-08T00:18:00.000Z",
      state: "dropped",
      tsIso: "2026-10-08T00:10:00.000Z",
    });
    // Re-recorded `--approved` at the owner's partial "yes" (ledger row 0), counting 1 row, then released.
    const parked = item({
      approval: KNOCK,
      id: "sd-99990000",
      judgedIso: "2026-10-08T00:40:00.000Z",
      tsIso: "2026-10-08T00:40:00.000Z",
    });
    const released = { ...parked, judgedLandings: 1, state: "released" as const };
    const partial = { item: dropped, landing: post, ledgerRow: 0, namedId: "sd-11112222" };
    const grown = { ...partial, ledgerRow: 1 };
    const verdictOn = ({ bound }: { bound: typeof partial }) =>
      judgeApprovedDrafts({
        read: { ...read({ bindings: { bound: [bound], unreadable: [] } }), items: [dropped, released] },
        startedIso: TICK,
      });

    expect(verdictOn({ bound: partial })).toEqual({ kind: "clean" });
    expect(verdictOn({ bound: grown })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [grown],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes a dropped draft's landing when only ANOTHER draft was approved at the same anchor", () => {
    const post = landed({ cardKey: "post:sd-11112222", decidedIso: DECIDED });
    const dropped = item({
      id: "sd-11112222",
      outcome: "moot: Seth answered",
      resolvedIso: "2026-10-08T00:18:00.000Z",
      state: "dropped",
      tsIso: "2026-10-08T00:10:00.000Z",
    });
    const bound = { item: dropped, landing: post, namedId: "sd-11112222" };
    // One "send both" landed on both cards; B was approved at it and released, and A's words are a different message.
    const parked = item({ approval: KNOCK, id: "sd-99990000", tsIso: "2026-10-08T00:12:00.000Z" });
    const other = { ...parked, draft: { ...parked.draft, digest: "a-different-message" }, state: "released" as const };
    const verdict = judgeApprovedDrafts({
      read: { ...read({ bindings: { bound: [bound], unreadable: [] } }), items: [dropped, other] },
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes a landing a send-blocking hold answered without the owner's approval on the row", () => {
    const blocked = item({
      hold: { atIso: "2026-10-08T00:20:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
      id: "sd-c57b4ade",
      judgedIso: "2026-10-08T00:20:00.000Z",
      tsIso: "2026-10-08T00:05:00.000Z",
    });
    const approvedThenBlocked = item({
      approval: KNOCK,
      hold: { atIso: "2026-10-08T00:20:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
      id: "sd-e8de7674",
      judgedIso: "2026-10-08T00:20:00.000Z",
      tsIso: "2026-10-08T00:05:00.000Z",
    });
    const bound = { item: blocked, landing: LANDING, namedId: "sd-c57b4ade" };
    const verdict = judgeApprovedDrafts({
      read: read({
        bindings: {
          bound: [bound, { item: approvedThenBlocked, landing: LANDING, namedId: "sd-e8de7674" }],
          unreadable: [],
        },
      }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes a landing a blocking hold re-dated over an older change of meaning", () => {
    const stale = item({
      hold: { atIso: "2026-10-08T00:20:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
      id: "sd-c57b4ade",
      judgedIso: "2026-10-08T00:20:00.000Z",
      meaningChanged: "old change",
      tsIso: "2026-10-08T00:00:00.000Z",
    });
    const fresh = item({
      hold: { atIso: "2026-10-08T00:20:00.000Z", reason: "meaning-changed", why: "the ask moved" },
      id: "sd-e8de7674",
      judgedIso: "2026-10-08T00:20:00.000Z",
      meaningChanged: "the ask moved",
      tsIso: "2026-10-08T00:00:00.000Z",
    });
    const bound = { item: stale, landing: LANDING, namedId: "sd-c57b4ade" };
    const verdict = judgeApprovedDrafts({
      read: read({
        bindings: { bound: [bound, { item: fresh, landing: LANDING, namedId: "sd-e8de7674" }], unreadable: [] },
      }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes a landing when the row's only judgement predates the owner's words", () => {
    const stale = item({ id: "sd-c57b4ade", judgedIso: "2026-10-08T00:10:00.000Z", tsIso: "2026-10-08T00:05:00.000Z" });
    const bound = { item: stale, landing: LANDING, namedId: "sd-c57b4ade" };
    const verdict = judgeApprovedDrafts({
      read: read({ bindings: { bound: [bound], unreadable: [] } }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("owes a landing whose row's judgement instant does not parse", () => {
    const malformed = item({ id: "sd-c57b4ade", judgedIso: "later", tsIso: "2026-10-08T00:30:00.000Z" });
    const bound = { item: malformed, landing: LANDING, namedId: "sd-c57b4ade" };
    const verdict = judgeApprovedDrafts({
      read: read({ bindings: { bound: [bound], unreadable: [] } }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [bound],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("leaves words the owner said after the tick began to the next tick", () => {
    const late = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T01:00:01.000Z" });
    const verdict = judgeApprovedDrafts({
      read: read({
        bindings: {
          bound: [{ item: UNJUDGED, landing: late, namedId: "sd-c57b4ade" }],
          unreadable: [{ landing: late, ledgerRow: 0, why: "unreadable" }],
        },
      }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("refuses on a landed card whose drafts could not be read, rather than passing it as naming none", () => {
    const unreadable = { landing: LANDING, ledgerRow: 0, why: "the ask's journal has 2 unreadable lines" };
    const verdict = judgeApprovedDrafts({
      read: read({ bindings: { bound: [], unreadable: [unreadable] } }),
      startedIso: TICK,
    });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [],
      unreadableLandings: [unreadable],
      unsureIds: [],
    });
  });
});
