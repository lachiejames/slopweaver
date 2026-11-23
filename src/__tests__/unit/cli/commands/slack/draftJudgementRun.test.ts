/**
 * `slack draft approve` and `slack draft hold`, driven with the register and the owner's words as plain fakes: a
 * judgement lands on a held row only, an approval carries the owner's whole words at the anchor, and a row a line this
 * build cannot read names is refused rather than judged blind.
 */
import { describe, expect, it } from "vitest";

import { movedMessage } from "../../../../../cli/commands/slack/draftJudgementAppend.js";
import {
  dropSuperseded,
  holdKeepsApproval,
  runDraftApprove,
  runDraftDrop,
  runDraftHold,
  settledYesRefusal,
} from "../../../../../cli/commands/slack/draftJudgementRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { HisWordsErrors } from "../../../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../../../handover/hisWordsResolve.js";
import { err, ok } from "../../../../../lib/result.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../../outbound/slack/draftLog.js";
import { slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import { ApprovalRelayReadErrors } from "../../../../../talk/approvalRelayReadErrors.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { draftItem, KNOCK } from "../../../supervisor/draftItemFixture.js";
import {
  APPROVE,
  APPROVED_PARK,
  AUTHOR,
  AUTHORED_PARK,
  HOME,
  ID,
  LANDED_YES,
  LANDING,
  NOW,
  PARK,
  RELAY,
  RELEASED,
  WORDS,
  world,
} from "./draftJudgementWorld.js";

describe("runDraftApprove", () => {
  it("binds the owner's whole words at the anchor to the held row and prints the release it now owes", () => {
    const { appended, deps, printed } = world({ lines: [PARK] });

    expect(runDraftApprove({ deps, options: APPROVE })).toBe(EXIT_OK);
    expect(appended).toEqual([{ approval: LANDED_YES, id: ID, kind: "approved", landingsRead: 4, tsIso: NOW }]);
    expect(printed).toEqual([
      `approved ${ID} at ${LANDING}: "Yes, send it today"`,
      `  it now owes a send — release it: slopweaver slack post --as me --draft ${ID} --approve 0123456789abcdef0123456789abcdef`,
    ]);
  });

  it("appends inside the register lock and the call's, and releases both after", () => {
    const { deps, order } = world({ lines: [PARK] });

    runDraftApprove({ deps, options: APPROVE });

    expect(order).toEqual(["lock", "fence", "append approved", "unfence", "unlock"]);
  });

  // The fenced read is the one the count, the pick and the append are judged on, so one that
  // differs from the read naming the call, or a fence not taken, refuses before anything (a pick included) is appended.
  it("records nothing when the call cannot be held still, or its words changed between the two reads", () => {
    const fenced = world({ fenceTaken: true, lines: [PARK] });
    const moved = world({ lines: [PARK] });
    const reads: unknown[] = [];
    const later = ok({ ...WORDS, text: "Yes, send it today, but later" });
    const readOwnerWords: typeof moved.deps.readOwnerWords = (input) =>
      reads.push(input) < 2 ? moved.deps.readOwnerWords(input) : later;
    const codes = [
      [runDraftApprove({ deps: fenced.deps, options: APPROVE }), fenced.appended.length, fenced.order],
      [
        runDraftApprove({ deps: { ...moved.deps, readOwnerWords }, options: APPROVE }),
        moved.appended.length,
        moved.order,
      ],
    ];
    expect(codes).toEqual([
      [EXIT_USAGE, 0, ["lock", "unlock"]],
      [EXIT_USAGE, 0, ["lock", "fence", "unfence", "unlock"]],
    ]);
  });

  // The owner's words are read again under the fence, so a cut the call took after the first read refuses.
  it("records nothing when the anchor's words do not read as the owner's, at the first read or the fenced one", () => {
    const codes = [1, 2].map((refuseFrom) => {
      const { appended, deps } = world({ lines: [PARK] });
      const reads: unknown[] = [];
      const no = err(HisWordsErrors.notOwnerScheme({ anchor: LANDING }));
      const readOwnerWords: typeof deps.readOwnerWords = (input) =>
        reads.push(input) < refuseFrom ? deps.readOwnerWords(input) : no;
      return [runDraftApprove({ deps: { ...deps, readOwnerWords }, options: APPROVE }), reads.length, appended.length];
    });
    expect(codes.flat()).toEqual([EXIT_USAGE, 1, 0, EXIT_USAGE, 2, 0]);
  });

  it("refuses a row the register does not hold as held", () => {
    const dropped = slackDraftEventLine({ event: { id: ID, kind: "dropped", note: "re-cut", tsIso: NOW } });
    const { appended, deps } = world({ lines: [PARK, dropped] });

    expect(runDraftApprove({ deps, options: APPROVE })).toBe(EXIT_EXPECTED_EMPTY);
    expect(appended).toEqual([]);
  });

  it("refuses a row a line this build cannot read names, since its state is unknown", () => {
    const unknown = JSON.stringify({ id: ID, kind: "bogus", schemaVersion: 1, tsIso: NOW });
    const { appended, deps } = world({ lines: [PARK, unknown] });

    expect(runDraftApprove({ deps, options: APPROVE })).toBe(EXIT_ERROR);
    expect(appended).toEqual([]);
  });

  it("exits non-zero when the append fails", () => {
    const { deps } = world({ appendFails: true, lines: [PARK] });

    expect(runDraftApprove({ deps, options: APPROVE })).toBe(EXIT_ERROR);
  });

  it("exits non-zero, printing no receipt, when a release lands between its read and its append", () => {
    const { appended, deps, printed } = world({ lines: [PARK], meanwhile: [RELEASED] });

    expect(runDraftApprove({ deps, options: APPROVE })).toBe(EXIT_ERROR);
    expect(appended.length).toBe(1);
    expect(printed).toEqual([]);
  });

  it("records nothing while the card landings cannot be read, since uncounted it would answer a later-written yes", () => {
    const { appended, deps, order } = world({ lines: [PARK] });
    const blind = { ...deps, readLandedDrafts: () => ({ kind: "unreadable" as const, why: "ledger line 3 is torn" }) };

    expect(
      runDraftApprove({
        deps: blind,
        options: APPROVE,
      }),
    ).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
    expect(order).toEqual(["lock", "fence", "unfence", "unlock"]);
  });

  it("records nothing on a yes whose relay ruled needs-more-info over this very card (incident C0SYN000001, sd-ffab16e8)", () => {
    const { appended, deps, order } = world({ lines: [PARK] });
    const ruled: RawWords = {
      ...WORDS,
      context: { about: `post:${ID}`, kind: "relay", triageRuling: { label: undefined, verdict: "needs-more-info" } },
      text: "Yes, of course",
      where: "console-voice",
    };

    expect(
      runDraftApprove({
        deps: { ...deps, readOwnerWords: () => ok(ruled) },
        options: { anchor: RELAY, home: HOME, id: ID, json: false, mode: "approve" },
      }),
    ).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
    expect(order).toEqual(["lock", "unlock"]);
  });

  it("records nothing on a yes the owner took back one card later, naming the later turn", () => {
    const { appended, deps, order, printed } = world({ lines: [PARK] });
    const later = "a1b2c3d4-0000-4000-8000-000000000002";
    const takenBack = {
      ...deps,
      readApprovalLaterRelays: () =>
        ok([
          {
            about: "post:sd-4ce1d056",
            callHeard: "oh wait, no, not that one",
            cardDistance: 1 as const,
            heard: "oh wait, no, not that one",
            triageRuling: null,
            turnId: later,
            wordsWhole: true,
          },
        ]),
    };

    expect(
      runDraftApprove({
        deps: takenBack,
        options: APPROVE,
      }),
    ).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
    expect(order).toEqual(["lock", "unlock"]);
    expect(printed).toEqual([]);
  });

  it("records nothing on a yes whose call cannot say what the owner said after it", () => {
    const { appended, deps } = world({ lines: [PARK] });
    const blind = {
      ...deps,
      readApprovalLaterRelays: () => err(ApprovalRelayReadErrors.callMissing({ anchor: LANDING })),
    };

    expect(
      runDraftApprove({
        deps: blind,
        options: APPROVE,
      }),
    ).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("records nothing on a yes whose relay was about no card (incident C0SYN000001, sd-e58a0f4f)", () => {
    const { appended, deps } = world({ lines: [PARK] });
    const cardless: RawWords = {
      ...WORDS,
      context: { about: "", kind: "relay", triageRuling: null },
      text: "Just fucking send it as is. It's fine",
      where: "console-voice",
    };

    expect(
      runDraftApprove({
        deps: { ...deps, readOwnerWords: () => ok(cardless) },
        options: { anchor: RELAY, home: HOME, id: ID, json: false, mode: "approve" },
      }),
    ).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("binds a yes said over the card of the cut this row re-cuts", () => {
    const recut = slackDraftEventLine({
      event: {
        draft: { ...draftItem({ id: "sd-0a0b0c0d", tsIso: NOW }).draft, recuts: [ID] },
        id: "sd-0a0b0c0d",
        kind: "parked",
        tsIso: NOW,
      },
    });
    const { appended, deps } = world({ lines: [PARK, recut] });

    expect(
      runDraftApprove({
        deps,
        options: { anchor: LANDING, home: HOME, id: "sd-0a0b0c0d", json: false, mode: "approve" },
      }),
    ).toBe(EXIT_OK);
    expect(appended.map((event) => [event.kind, event.id])).toEqual([["approved", "sd-0a0b0c0d"]]);
  });
});

describe("runDraftHold", () => {
  it("records a blocked send on an approved row and says the approval stands", () => {
    const { appended, deps, printed } = world({ lines: [APPROVED_PARK] });
    const options = {
      home: HOME,
      id: ID,
      json: false,
      mode: "hold",
      reason: "no-fleet-slot",
      why: "every slot is busy",
    } as const;

    expect(runDraftHold({ deps, options })).toBe(EXIT_OK);
    expect(appended).toEqual([
      { id: ID, kind: "held", landingsRead: 4, reason: "no-fleet-slot", tsIso: NOW, why: "every slot is busy" },
    ]);
    expect(printed).toEqual([
      `held ${ID} (no-fleet-slot): every slot is busy`,
      "  the owner's approval stands; the Queue card shows why it is not sent, and a release still sends it",
    ]);
  });

  it("says the card waits for the owner's word when the hold sets their approval down", () => {
    const { deps, printed } = world({ lines: [APPROVED_PARK] });
    const options = {
      home: HOME,
      id: ID,
      json: false,
      mode: "hold",
      reason: "meaning-changed",
      why: "the date in it moved",
    } as const;

    expect(runDraftHold({ deps, options })).toBe(EXIT_OK);
    expect(printed[1]).toBe("  the Queue card shows the owner why, and waits for their word");
  });

  it("records the owner's words as not a yes on a row carrying none", () => {
    const { appended, deps } = world({ lines: [PARK] });
    const options = { home: HOME, id: ID, json: false, mode: "hold", reason: "not-owner-yes", why: "a steer" } as const;

    expect(runDraftHold({ deps, options })).toBe(EXIT_OK);
    expect(appended.map((event) => event.kind)).toEqual(["held"]);
  });

  it("refuses a no-yes hold on a row carrying the owner's yes, appending nothing: a verdict they gave stays given", () => {
    const { appended, deps, printed } = world({ lines: [APPROVED_PARK] });
    const options = {
      home: HOME,
      id: ID,
      json: false,
      mode: "hold",
      reason: "not-owner-yes",
      why: "an intent to approve, not a send",
    } as const;

    expect(runDraftHold({ deps, options })).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
    expect(printed).toEqual([]);
    expect(settledYesRefusal({ approval: KNOCK, id: ID })).toContain(
      `slopweaver slack draft hold ${ID} --reason meaning-changed`,
    );
    expect(settledYesRefusal({ approval: KNOCK, id: ID })).toContain("There is deliberately NO escape hatch");
  });

  it("sets the owner's yes down when a newer word of theirs on the card says not to send it, which the yes never saw", () => {
    const { appended, deps } = world({ lines: [APPROVED_PARK] });
    const item = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: [APPROVED_PARK] }) })[0]!;
    const landing: CardLandedRow = {
      anchor: "talk-call:f9e9277d#40",
      atIso: "2026-10-08T00:18:01.000Z",
      cardKey: `post:${ID}`,
      decidedIso: "2026-10-08T00:18:00.000Z",
      kind: "landed",
      source: "transcript",
      words: "Actually hold off on that one",
      workSlug: "organisation-hunt-2026-10-07",
    };
    const spoke = {
      ...deps,
      readLandedDrafts: () => ({
        bindings: { bound: [{ item, landing, namedId: ID }], unreadable: [] },
        kind: "read" as const,
        ledgerRows: 5,
        vanished: [],
      }),
    };
    const options = {
      home: HOME,
      id: ID,
      json: false,
      mode: "hold",
      reason: "not-owner-yes",
      why: "they said hold off",
    } as const;

    expect(runDraftHold({ deps: spoke, options })).toBe(EXIT_OK);
    expect(appended.map((event) => [event.kind, event.id])).toEqual([["held", ID]]);
  });

  it("refuses a hold judging the owner's words while the card landings cannot be read, but records a blocked send uncounted", () => {
    const { appended, deps } = world({ lines: [PARK] });
    const blind = { ...deps, readLandedDrafts: () => ({ kind: "unreadable" as const, why: "ledger line 3 is torn" }) };
    const hold = { home: HOME, id: ID, json: false, mode: "hold" } as const;

    expect(
      runDraftHold({ deps: blind, options: { ...hold, reason: "not-owner-yes", why: "they meant the other" } }),
    ).toBe(EXIT_USAGE);
    expect(runDraftHold({ deps: blind, options: { ...hold, reason: "meaning-changed", why: "the date moved" } })).toBe(
      EXIT_USAGE,
    );
    expect(appended).toEqual([]);
    expect(runDraftHold({ deps: blind, options: { ...hold, reason: "slack-refused", why: "invalid_auth" } })).toBe(
      EXIT_OK,
    );
    expect(appended).toEqual([{ id: ID, kind: "held", reason: "slack-refused", tsIso: NOW, why: "invalid_auth" }]);
  });

  it("exits non-zero when a release lands between its read and its append, since the fold drops the hold", () => {
    const { deps, printed } = world({ lines: [APPROVED_PARK], meanwhile: [RELEASED] });
    const options = { home: HOME, id: ID, json: false, mode: "hold", reason: "slack-refused", why: "token" } as const;

    expect(runDraftHold({ deps, options })).toBe(EXIT_ERROR);
    expect(printed).toEqual([]);
  });

  it("exits non-zero when another hold in the same millisecond lands after it, since the register reads that one", () => {
    const other = slackDraftEventLine({
      event: { id: ID, kind: "held", reason: "thread-moved", tsIso: NOW, why: "the thread moved" },
    });
    const { deps, printed } = world({ after: [other], lines: [APPROVED_PARK] });
    const options = {
      home: HOME,
      id: ID,
      json: false,
      mode: "hold",
      reason: "no-fleet-slot",
      why: "every slot is busy",
    } as const;

    expect(runDraftHold({ deps, options })).toBe(EXIT_ERROR);
    expect(printed).toEqual([]);
  });
});

describe("runDraftDrop", () => {
  const RECUT = "sd-33334444";
  const BARE_RECUT = slackDraftEventLine({
    event: {
      draft: draftItem({ id: RECUT, tsIso: "2026-10-08T00:15:00.000Z" }).draft,
      id: RECUT,
      kind: "parked",
      tsIso: "2026-10-08T00:15:00.000Z",
    },
  });
  const options = { home: HOME, id: ID, json: false, mode: "drop", note: `re-cut as ${RECUT}` } as const;

  it("refuses to drop an approved row onto a bare held re-cut, appending nothing", async () => {
    const { appended, deps } = world({ lines: [APPROVED_PARK, BARE_RECUT] });

    expect(await runDraftDrop({ deps, options })).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("refuses a moot drop of an approved row, which would end the owner's yes unsent with no reason before them", async () => {
    const { appended, deps } = world({ lines: [APPROVED_PARK] });

    expect(await runDraftDrop({ deps, options: { ...options, note: "moot: Seth answered" } })).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("drops an unapproved row with no landing on its card, recording how many landing rows it judged", async () => {
    const { appended, deps, printed } = world({ lines: [PARK] });

    expect(await runDraftDrop({ deps, options: { ...options, note: "moot: Seth answered" } })).toBe(EXIT_OK);
    expect(appended).toEqual([{ id: ID, kind: "dropped", landingsRead: 4, note: "moot: Seth answered", tsIso: NOW }]);
    expect(printed).toEqual([`dropped ${ID}: moot: Seth answered`]);
  });

  it("reads, guards and appends inside the register lock, so no approve lands between", async () => {
    const { deps, order } = world({ lines: [PARK] });

    expect(await runDraftDrop({ deps, options: { ...options, note: "moot: Seth answered" } })).toBe(EXIT_OK);
    expect(order).toEqual(["lock", "append dropped", "unlock"]);
  });

  it("drops nothing while another verb holds the register lock", async () => {
    const { appended, deps, order } = world({ lines: [PARK], lockTaken: true });

    expect(await runDraftDrop({ deps, options: { ...options, note: "moot: Seth answered" } })).toBe(EXIT_ERROR);
    expect(appended).toEqual([]);
    expect(order).toEqual([]);
  });

  it("drops an approved row whose sent record names the message Slack holds its words at", async () => {
    const sent = { text: "sounds good", ts: "1791418800.000100", type: "message", user: AUTHOR };
    const { appended, deps } = world({ lines: [AUTHORED_PARK], slack: [sent] });
    const note = "sent https://example.slack.com/archives/C0123456789/p1791418800000100";

    expect(await runDraftDrop({ deps, options: { ...options, note } })).toBe(EXIT_OK);
    expect(appended.map((event) => event.kind)).toEqual(["dropped"]);
  });

  it("refuses a sent record Slack does not bear out: nothing there, other words, or another author", async () => {
    const note = "sent C0123456789 1791418800.000100";
    const at = { ts: "1791418800.000100", type: "message" };
    for (const slack of [
      [],
      [{ ...at, text: "another reply", user: AUTHOR }],
      [{ ...at, text: "sounds good", user: "U0SYNSOMEONE" }],
    ]) {
      const { appended, deps } = world({ lines: [AUTHORED_PARK], slack });

      expect(await runDraftDrop({ deps, options: { ...options, note } })).toBe(EXIT_USAGE);
      expect(appended).toEqual([]);
    }
  });

  it("refuses a sent record naming one message twice as two parts of a split", async () => {
    const base = draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" }).draft;
    const payload = { form: "plain", text: "ping\n\nping", unfurl_links: false, unfurl_media: false } as const;
    const doubled = slackDraftEventLine({
      event: {
        draft: { ...base, authorId: AUTHOR, payload },
        id: ID,
        kind: "parked",
        tsIso: "2026-10-08T00:10:00.000Z",
      },
    });
    const at = ({ ts }: { ts: string }) => ({ text: "ping", ts, type: "message", user: AUTHOR });
    const slack = [at({ ts: "1791418800.000100" }), at({ ts: "1791418900.000200" })];
    const twice = "sent C0123456789 1791418800.000100, C0123456789 1791418800.000100";
    const split = "sent C0123456789 1791418800.000100, C0123456789 1791418900.000200";

    const refused = world({ lines: [doubled], slack });
    expect(await runDraftDrop({ deps: refused.deps, options: { ...options, note: twice } })).toBe(EXIT_USAGE);
    expect(refused.appended).toEqual([]);
    const sent = world({ lines: [doubled], slack });
    expect(await runDraftDrop({ deps: sent.deps, options: { ...options, note: split } })).toBe(EXIT_OK);
    expect(sent.appended.map((event) => event.kind)).toEqual(["dropped"]);
  });

  it("refuses a drop straight after a hold judging the words no yes set the owner's recorded yes down, the reason never shown", async () => {
    const hold = slackDraftEventLine({
      event: { id: ID, kind: "held", reason: "not-owner-yes", tsIso: NOW, why: "they meant the other draft" },
    });
    const { appended, deps } = world({ lines: [APPROVED_PARK, hold] });

    expect(await runDraftDrop({ deps, options: { ...options, note: "moot: Seth answered" } })).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("refuses an approved row's drop whose note says it was NOT sent", async () => {
    const { appended, deps } = world({ lines: [APPROVED_PARK] });
    const note = "not sent C0123456789 1791418800.000100 — invalid_auth";

    expect(await runDraftDrop({ deps, options: { ...options, note } })).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("refuses a drop ending a row's words while the card landings cannot be read", async () => {
    const { appended, deps } = world({ lines: [PARK] });
    const blind = { ...deps, readLandedDrafts: () => ({ kind: "unreadable" as const, why: "ledger line 3 is torn" }) };

    expect(await runDraftDrop({ deps: blind, options: { ...options, note: "moot: Seth answered" } })).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });

  it("refuses a moot drop of a row the owner's unjudged words landed on", async () => {
    const { appended, deps } = world({ lines: [PARK] });
    const item = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const landing = {
      anchor: KNOCK.anchor,
      atIso: KNOCK.atIso,
      cardKey: `post:${ID}`,
      decidedIso: "2026-10-08T00:16:54.000Z",
      kind: "landed",
      source: "transcript",
      words: "Yes, send it today",
      workSlug: "organisation-hunt-2026-10-07",
    } as const;
    const landedDeps = {
      ...deps,
      readLandedDrafts: () => ({
        bindings: { bound: [{ item, landing, namedId: ID }], unreadable: [] },
        kind: "read" as const,
        ledgerRows: 1,
        vanished: [],
      }),
    };

    expect(await runDraftDrop({ deps: landedDeps, options: { ...options, note: "moot: Seth answered" } })).toBe(
      EXIT_USAGE,
    );
    expect(appended).toEqual([]);
  });

  it("exits non-zero when its re-cut is re-cut bare between its read and its append", async () => {
    const inheriting = slackDraftEventLine({
      event: {
        draft: draftItem({ approval: { ...KNOCK, inheritedFrom: ID }, id: RECUT, tsIso: "2026-10-08T00:15:00.000Z" })
          .draft,
        id: RECUT,
        kind: "parked",
        tsIso: "2026-10-08T00:15:00.000Z",
      },
    });
    const later = "sd-77770000";
    const meanwhile = [
      slackDraftEventLine({
        event: {
          draft: draftItem({ id: later, tsIso: "2026-10-08T00:18:00.000Z" }).draft,
          id: later,
          kind: "parked",
          tsIso: "2026-10-08T00:18:00.000Z",
        },
      }),
      slackDraftEventLine({ event: { id: RECUT, kind: "dropped", note: `re-cut as ${later}`, tsIso: NOW } }),
    ];
    const { appended, deps, printed } = world({ lines: [APPROVED_PARK, inheriting], meanwhile });

    expect(await runDraftDrop({ deps, options })).toBe(EXIT_ERROR);
    expect(appended.length).toBe(1);
    expect(printed).toEqual([]);
  });
});

describe("dropSuperseded", () => {
  const RECUT = "sd-55556666";
  const note = `superseded by ${RECUT} (recorded with --supersedes)`;
  const recut = slackDraftEventLine({
    event: {
      draft: draftItem({ id: RECUT, tsIso: "2026-10-08T00:15:00.000Z" }).draft,
      id: RECUT,
      kind: "parked",
      tsIso: "2026-10-08T00:15:00.000Z",
    },
  });

  it("is false when an approve landed while `record --supersedes` read, leaving the owner's yes behind its bare re-cut", () => {
    const approved = slackDraftEventLine({
      event: { approval: KNOCK, id: ID, kind: "approved", tsIso: "2026-10-08T00:14:00.000Z" },
    });
    const { appended, deps } = world({ lines: [PARK, approved, recut] });

    expect(dropSuperseded({ deps, home: HOME, id: RECUT, supersedes: [ID] })).toBe(false);
    expect(appended).toEqual([{ id: ID, kind: "dropped", note, tsIso: NOW }]);
  });

  it("is true when the superseded row carried no yes", () => {
    const { appended, deps } = world({ lines: [PARK, recut] });

    expect(dropSuperseded({ deps, home: HOME, id: RECUT, supersedes: [ID] })).toBe(true);
    expect(appended).toEqual([{ id: ID, kind: "dropped", note, tsIso: NOW }]);
  });

  it("is false, naming what stays held, when a drop cannot be written", () => {
    const { appended, deps } = world({ appendFails: true, lines: [PARK, recut] });

    expect(dropSuperseded({ deps, home: HOME, id: RECUT, supersedes: [ID] })).toBe(false);
    expect(appended).toEqual([]);
  });
});

describe("movedMessage", () => {
  const RECUT = "sd-99990000";
  const bare = draftItem({ id: RECUT, tsIso: "2026-10-08T00:15:00.000Z" });
  const approvedDropped = {
    ...draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" }),
    outcome: `superseded by ${RECUT} (recorded with --supersedes)`,
    state: "dropped" as const,
  };

  it("names the bare cut a racing re-cut left standing, and what it lacks", () => {
    expect(movedMessage({ after: [approvedDropped, bare], id: ID })).toBe(
      `${ID} moved (dropped) before this judgement landed, so the register does not read it. The cut that stands is ` +
        `${RECUT}, which carries neither the owner's yes nor a --meaning-changed. Judge that one: read it (\`slopweaver ` +
        `slack draft show ${RECUT}\`), then \`slopweaver slack draft approve ${RECUT} --anchor "<anchor of the owner's ` +
        `yes>"\` or \`slopweaver slack draft hold ${RECUT} --reason <reason> --why "<why>"\`.`,
    );
  });

  it("names the row itself, with its id, when nothing re-cut it", () => {
    const released = { ...draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" }), state: "released" as const };

    expect(movedMessage({ after: [released], id: ID })).toBe(
      `${ID} moved (released) before this judgement landed, so the register does not read it. Read it again ` +
        `(\`slopweaver slack draft show ${ID}\`) and judge it as it stands.`,
    );
  });

  it("says the row is gone when the register no longer holds it", () => {
    expect(movedMessage({ after: [], id: ID })).toContain(`${ID} is gone from the register`);
  });
});

describe("holdKeepsApproval", () => {
  it("keeps it for a blocked send and sets it down when the words no longer carry the owner's yes", () => {
    const reasons = ["not-owner-yes", "meaning-changed", "thread-moved", "no-fleet-slot", "slack-refused"] as const;

    expect(reasons.map((reason) => holdKeepsApproval({ reason }))).toEqual([false, false, true, true, true]);
  });
});
