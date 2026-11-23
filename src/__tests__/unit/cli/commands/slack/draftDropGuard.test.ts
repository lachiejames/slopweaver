/**
 * `draftDropGuard.ts` — a drop may not end the owner's yes, or their unjudged words on its card, in neither a send
 * nor a reason in front of them. A note leading to a cut that stands, or to where it was sent, goes through.
 */
import { describe, expect, it } from "vitest";

import { dropRefusal, type LandedDraftsRead, recutRefusal } from "../../../../../cli/commands/slack/draftDropGuard.js";
import { DraftDropErrors } from "../../../../../outbound/slack/draftDropErrors.js";
import { draftItem, KNOCK, landed } from "../../../supervisor/draftItemFixture.js";

const ID = "sd-11112222";
const RECUT = "sd-33334444";
const NONE: LandedDraftsRead = { bindings: { bound: [], unreadable: [] }, kind: "read", ledgerRows: 0, vanished: [] };
const MOOT = "moot: Seth answered";
const LANDING = landed({ cardKey: `post:${ID}`, decidedIso: "2026-10-08T00:16:54.000Z" });

/**
 * The landings read with the owner's words bound to one row.
 *
 * @param item the row the owner's words bound to
 * @returns the read
 */
function boundTo({ item }: { item: ReturnType<typeof draftItem> }): LandedDraftsRead {
  return {
    bindings: { bound: [{ item, landing: LANDING, namedId: item.id }], unreadable: [] },
    kind: "read",
    ledgerRows: 1,
    vanished: [],
  };
}

describe("dropRefusal", () => {
  it("lets a row with no yes and no landing drop on any note", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });

    expect(dropRefusal({ items: [row], landed: NONE, note: MOOT, row })).toBe(undefined);
  });

  it("refuses ending an approved row's yes on a note naming no cut and no permalink", () => {
    const row = draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" });

    expect(dropRefusal({ items: [row], landed: NONE, note: MOOT, row })).toBe(
      `${DraftDropErrors.dropSpendsYes({ dropped: ID }).message}. Nothing was dropped.`,
    );
  });

  it("refuses handing an approved row to a bare re-cut, and names the --supersedes re-record", () => {
    const row = draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const bare = draftItem({ id: RECUT, tsIso: "2026-10-08T00:20:00.000Z" });

    expect(dropRefusal({ items: [row, bare], landed: NONE, note: `re-cut as ${RECUT}`, row })).toBe(
      `${DraftDropErrors.dropShedsApproval({ dropped: ID, recut: RECUT }).message}, or re-record it with ` +
        `--supersedes ${ID} (adding --meaning-changed "<what changed>" when the words no longer carry the owner's yes). ` +
        "Nothing was dropped.",
    );
  });

  it("refuses ending the owner's unjudged words on the row's card, printing both judgements", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });

    expect(dropRefusal({ items: [row], landed: boundTo({ item: row }), note: MOOT, row })).toBe(
      `${ID} carries the owner's words from post:${ID} at ${KNOCK.anchor} ("Yes, send it today"), which no judgement has ` +
        "answered, and the drop note names neither a cut that stands nor where it was sent. Judge " +
        `them first: \`slopweaver slack draft approve ${ID} --anchor ${KNOCK.anchor}\` when they are the owner's yes, or ` +
        `\`slopweaver slack draft hold ${ID} --reason not-owner-yes --why "<what they meant>"\`, which the owner's Queue card ` +
        "prints. Nothing was dropped.",
    );
  });

  it("lets the drop through once a hold judging the words no yes answered the landing", () => {
    const row = draftItem({
      hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", why: "they meant the other draft" },
      id: ID,
      judgedIso: "2026-10-08T00:30:00.000Z",
      tsIso: "2026-10-08T00:10:00.000Z",
    });

    expect(dropRefusal({ items: [row], landed: boundTo({ item: row }), note: MOOT, row })).toBe(undefined);
  });

  it("lets an unjudged landing's row hand its words to a re-cut that stands", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const recut = draftItem({ id: RECUT, tsIso: "2026-10-08T00:20:00.000Z" });

    expect(dropRefusal({ items: [row, recut], landed: boundTo({ item: row }), note: `re-cut as ${RECUT}`, row })).toBe(
      undefined,
    );
  });

  it("refuses handing unjudged words to a held duplicate judged before they reached it", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const judged = {
      ...draftItem({
        hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", why: "the words on it were not approval" },
        id: RECUT,
        judgedIso: "2026-10-08T00:30:00.000Z",
        tsIso: "2026-10-08T00:11:00.000Z",
      }),
      judgedLandings: 1,
    };
    const landedOnRow: LandedDraftsRead = {
      bindings: { bound: [{ item: row, landing: LANDING, ledgerRow: 0, namedId: ID }], unreadable: [] },
      kind: "read",
      ledgerRows: 1,
      vanished: [],
    };

    expect(dropRefusal({ items: [row, judged], landed: landedOnRow, note: `duplicate of ${RECUT}`, row })).toContain(
      `and ${RECUT}, where the drop note hands them, was judged before they reached it`,
    );
  });

  it("fails closed on a ledger it could not read, a hold judging the words no yes on record or not", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const judged = {
      ...draftItem({
        hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", why: "no yes of the owner's stands on it" },
        id: ID,
        tsIso: "2026-10-08T00:10:00.000Z",
      }),
      judgedLandings: 4,
    };
    const unreadable: LandedDraftsRead = { kind: "unreadable", why: "ledger line 3 is torn" };
    const refusal =
      `the card landings could not be read (ledger line 3 is torn), so whether the owner's words landed on ${ID} is unknown, ` +
      "and the drop note names neither a cut that stands nor where it was sent. Repair that read (the tick refuses " +
      "on an unreadable one too). Nothing was dropped.";

    expect(dropRefusal({ items: [row], landed: unreadable, note: MOOT, row })).toBe(refusal);
    expect(dropRefusal({ items: [judged], landed: unreadable, note: MOOT, row: judged })).toBe(refusal);
  });

  it("fails closed on a landing whose card would not bind, offering the hold that weighs it", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const unbound: LandedDraftsRead = {
      bindings: { bound: [], unreadable: [{ landing: LANDING, ledgerRow: 0, why: "the card record is torn" }] },
      kind: "read",
      ledgerRows: 1,
      vanished: [],
    };

    expect(dropRefusal({ items: [row], landed: unbound, note: MOOT, row })).toBe(
      `the owner's words on post:${ID} at ${KNOCK.anchor} could not be bound (the card record is torn), so whether the owner's ` +
        `words landed on ${ID} is unknown, and the drop note names neither a cut that stands nor where it was sent. ` +
        "Repair that read (the tick refuses on an unreadable one too), or once you have seen those words record that " +
        `no yes of the owner's stands on it: \`slopweaver slack draft hold ${ID} --reason not-owner-yes --why "<what you saw>"\`. ` +
        "Nothing was dropped.",
    );
  });

  it("lets a hold judging the words no yes cover only the unbindable landings it counted, never a later yes", () => {
    // The hold read 2 ledger rows; the owner's words at row 1 were weighed by it, their words at row 2 landed after it.
    const held = {
      ...draftItem({
        hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", why: "not yet" },
        id: ID,
        judgedIso: "2026-10-08T00:30:00.000Z",
        tsIso: "2026-10-08T00:10:00.000Z",
      }),
      judgedLandings: 2,
    };
    const ask = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T00:40:00.000Z" });
    const at = ({ ledgerRow }: { ledgerRow: number }): LandedDraftsRead => ({
      bindings: { bound: [], unreadable: [{ landing: ask, ledgerRow, why: "the ask's journal is torn" }] },
      kind: "read",
      ledgerRows: 3,
      vanished: [],
    });
    const { judgedLandings: _counted, ...uncounted } = held;

    expect(dropRefusal({ items: [held], landed: at({ ledgerRow: 1 }), note: MOOT, row: held })).toBe(undefined);
    expect(dropRefusal({ items: [held], landed: at({ ledgerRow: 2 }), note: MOOT, row: held })).toContain(
      `the owner's words on ask:organisation-hunt-2026-10-07 at ${KNOCK.anchor} could not be bound (the ask's journal is torn)`,
    );
    expect(dropRefusal({ items: [uncounted], landed: at({ ledgerRow: 1 }), note: MOOT, row: uncounted })).toContain(
      "could not be bound (the ask's journal is torn)",
    );
  });

  describe("a hold judging the words no yes that set down a yes the owner recorded", () => {
    const setDown = { approval: KNOCK, atIso: "2026-10-08T00:30:00.000Z", why: "they meant the other draft" };
    const held = draftItem({
      hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", setDown, why: "they meant the other draft" },
      id: ID,
      judgedIso: "2026-10-08T00:30:00.000Z",
      tsIso: "2026-10-08T00:10:00.000Z",
    });
    const spoke = ({ decidedIso, item }: { decidedIso: string; item: typeof held }): LandedDraftsRead => ({
      bindings: {
        bound: [{ item, landing: landed({ cardKey: `post:${ID}`, decidedIso }), namedId: ID }],
        unreadable: [],
      },
      kind: "read",
      ledgerRows: 1,
      vanished: [],
    });

    it("refuses the drop until a word of the owner's lands on the card after it and is judged, naming the yes and reason", () => {
      // Their later word is itself judged: held again as no yes at 00:45, which keeps the set-down yes on the row.
      const rejudged = { ...held, judgedIso: "2026-10-08T00:45:00.000Z" };

      expect(dropRefusal({ items: [held], landed: NONE, note: MOOT, row: held })).toBe(
        `${ID} carried the owner's yes at ${KNOCK.anchor} ("Yes, send it today"), which a not-owner-yes hold set down at ` +
          `2026-10-08T00:30:00.000Z ("they meant the other draft"), and no word of the owner's has landed on its card since. ` +
          `A drop now would leave it unsent with that reason never in front of them. Leave ${ID} held: its Queue ` +
          "card leads with the reason, and once their answer lands, judge it and drop. Nothing was dropped.",
      );
      expect(
        dropRefusal({
          items: [held],
          landed: spoke({ decidedIso: "2026-10-08T00:20:00.000Z", item: held }),
          note: MOOT,
          row: held,
        }),
      ).toContain("no word of the owner's has landed on its card since");
      expect(
        dropRefusal({
          items: [rejudged],
          landed: spoke({ decidedIso: "2026-10-08T00:40:00.000Z", item: rejudged }),
          note: MOOT,
          row: rejudged,
        }),
      ).toBe(undefined);
    });

    it("still refuses once a later blocking hold replaced the one judging the words no yes", () => {
      const blocked = draftItem({
        hold: { atIso: "2026-10-08T00:35:00.000Z", reason: "no-fleet-slot", setDown, why: "every seat is busy" },
        id: ID,
        judgedIso: "2026-10-08T00:35:00.000Z",
        tsIso: "2026-10-08T00:10:00.000Z",
      });

      expect(dropRefusal({ items: [blocked], landed: NONE, note: MOOT, row: blocked })).toContain(
        `${ID} carried the owner's yes at ${KNOCK.anchor} ("Yes, send it today"), which a not-owner-yes hold set down at ` +
          `2026-10-08T00:30:00.000Z ("they meant the other draft")`,
      );
    });

    it("refuses handing the words to a bare re-cut, never to one whose card leads with a change", () => {
      const bare = { ...draftItem({ id: RECUT, tsIso: "2026-10-08T00:35:00.000Z" }) };
      const changed = { ...bare, draft: { ...bare.draft, meaningChanged: "they meant another" } };
      const note = `re-cut as ${RECUT}`;

      expect(dropRefusal({ items: [held, bare], landed: NONE, note, row: held })).toContain(
        `A drop now would leave it unsent with that reason never in front of them. Leave ${ID} held`,
      );
      expect(dropRefusal({ items: [held, changed], landed: NONE, note, row: held })).toBe(undefined);
    });

    it("refuses a bare re-cut by record, offering the routes that carry the reason", () => {
      expect(recutRefusal({ items: [held], landed: NONE, row: held })).toBe(
        `${ID} carried the owner's yes at ${KNOCK.anchor} ("Yes, send it today"), which a not-owner-yes hold set down at ` +
          `2026-10-08T00:30:00.000Z ("they meant the other draft"), and no word of the owner's has landed on its card since. ` +
          `A re-cut now would leave it unsent with that reason never in front of them. Leave ${ID} held: its Queue ` +
          "card leads with the reason, and once their answer lands, re-cut it, or re-cut now naming a fresh --approved " +
          'or --meaning-changed "<what changed>". Nothing was parked.',
      );
    });

    it("names a change of meaning the hold set down, where no yes was on the row", () => {
      const change = { atIso: "2026-10-08T00:30:00.000Z", change: "the customer withdrew it", why: "no longer needed" };
      const recut = draftItem({
        hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", setDown: change, why: "no longer needed" },
        id: RECUT,
        tsIso: "2026-10-08T00:20:00.000Z",
      });

      expect(dropRefusal({ items: [recut], landed: NONE, note: MOOT, row: recut })).toContain(
        `${RECUT} carried a change of meaning waiting on the owner's word (the customer withdrew it), which a not-owner-yes ` +
          'hold set down at 2026-10-08T00:30:00.000Z ("no longer needed")',
      );
    });

    it("follows the set-down yes through a bare re-cut recorded with --supersedes, and fails closed unread", () => {
      const recut = { ...draftItem({ id: RECUT, tsIso: "2026-10-08T00:35:00.000Z" }) };
      const lineage = { ...recut, draft: { ...recut.draft, recuts: [ID] } };
      const spent = { ...held, state: "dropped" as const };
      const unreadable: LandedDraftsRead = { kind: "unreadable", why: "ledger line 3 is torn" };

      expect(dropRefusal({ items: [spent, lineage], landed: NONE, note: MOOT, row: lineage })).toContain(
        `${ID} carried the owner's yes at ${KNOCK.anchor}`,
      );
      expect(dropRefusal({ items: [held], landed: unreadable, note: MOOT, row: held })).toContain(
        "no word of the owner's has landed on its card since",
      );
    });
  });

  it("does not consult the landings when the drop hands the words on", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const recut = draftItem({ id: RECUT, tsIso: "2026-10-08T00:20:00.000Z" });
    const unreadable: LandedDraftsRead = { kind: "unreadable", why: "ledger line 3 is torn" };

    expect(dropRefusal({ items: [row, recut], landed: unreadable, note: `re-cut as ${RECUT}`, row })).toBe(undefined);
  });

  it("fails closed on a swept card the owner's words reached after the row was parked, never on one before", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const swept = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T00:16:54.000Z" });
    const older = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T00:01:00.000Z" });
    const read = ({ landing }: { landing: typeof swept }): LandedDraftsRead => ({
      bindings: { bound: [], unreadable: [] },
      kind: "read",
      ledgerRows: 1,
      vanished: [{ landing, ledgerRow: 0 }],
    });

    expect(dropRefusal({ items: [row], landed: read({ landing: swept }), note: MOOT, row })).toContain(
      `the owner's words on ask:organisation-hunt-2026-10-07 at ${KNOCK.anchor} landed on a card whose record is gone, so ` +
        `whether the owner's words landed on ${ID} is unknown`,
    );
    expect(dropRefusal({ items: [row], landed: read({ landing: older }), note: MOOT, row })).toBe(undefined);
  });

  it("refuses a bare re-cut over the owner's words on a since-swept card, which no cut would bind", () => {
    const row = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const swept = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T00:16:54.000Z" });
    const read: LandedDraftsRead = {
      bindings: { bound: [], unreadable: [] },
      kind: "read",
      ledgerRows: 1,
      vanished: [{ landing: swept, ledgerRow: 0 }],
    };

    expect(recutRefusal({ items: [row], landed: read, row })).toBe(
      `the owner's words on ask:organisation-hunt-2026-10-07 at ${KNOCK.anchor} landed on a card whose record is gone, so ` +
        `whether the owner's words landed on ${ID} is unknown, and a re-cut carrying neither their yes nor a change of meaning ` +
        "would drop it with them unjudged. Repair that read (the tick refuses on an unreadable one too), or once you " +
        `have seen those words record that no yes of the owner's stands on it: \`slopweaver slack draft hold ${ID} --reason ` +
        'not-owner-yes --why "<what you saw>"`, or re-cut naming a fresh --approved or --meaning-changed ' +
        '"<what changed>". Nothing was parked.',
    );
    expect(recutRefusal({ items: [row], landed: NONE, row })).toBe(undefined);
  });

  it("lets a hold judging the words no yes cover a swept card's landing only when it counted that row", () => {
    const held = {
      ...draftItem({
        hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", why: "not yet" },
        id: ID,
        judgedIso: "2026-10-08T00:30:00.000Z",
        tsIso: "2026-10-08T00:10:00.000Z",
      }),
      judgedLandings: 1,
    };
    const swept = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T00:16:54.000Z" });
    const at = ({ ledgerRow }: { ledgerRow: number }): LandedDraftsRead => ({
      bindings: { bound: [], unreadable: [] },
      kind: "read",
      ledgerRows: 2,
      vanished: [{ landing: swept, ledgerRow }],
    });

    expect(dropRefusal({ items: [held], landed: at({ ledgerRow: 0 }), note: MOOT, row: held })).toBe(undefined);
    expect(dropRefusal({ items: [held], landed: at({ ledgerRow: 1 }), note: MOOT, row: held })).toContain(
      "landed on a card whose record is gone",
    );
  });

  it("refuses ending a row whose meaning changed until the owner's words land on its card since", () => {
    const changed = draftItem({
      hold: { atIso: "2026-10-08T00:12:00.000Z", reason: "meaning-changed", why: "the customer withdrew it" },
      id: ID,
      judgedIso: "2026-10-08T00:12:00.000Z",
      meaningChanged: "the customer withdrew it",
      tsIso: "2026-10-08T00:10:00.000Z",
    });
    const answered = { ...changed, judgedIso: "2026-10-08T00:20:00.000Z" };

    expect(dropRefusal({ items: [changed], landed: NONE, note: MOOT, row: changed })).toBe(
      `${ID}'s meaning changed (the customer withdrew it) and waits on the owner's word: no words of the owner's have landed on its ` +
        "card since 2026-10-08T00:12:00.000Z, so a drop now would end it with the reason never in front of them. Leave " +
        "it held — the owner's Queue card leads with the change — and judge their answer when it lands " +
        `(\`slopweaver slack draft show ${ID}\`). Nothing was dropped.`,
    );
    expect(dropRefusal({ items: [answered], landed: boundTo({ item: answered }), note: MOOT, row: answered })).toBe(
      undefined,
    );
  });

  it("orders the owner's answer to a change by the landing ledger, so one written before the change never answers it", () => {
    // The change read 3 ledger rows; the owner's words carry a later instant than the change, yet were written at row 2.
    const changed = {
      ...draftItem({
        id: ID,
        judgedIso: "2026-10-08T00:12:00.000Z",
        meaningChanged: "the customer withdrew it",
        tsIso: "2026-10-08T00:10:00.000Z",
      }),
      changedLandings: 3,
      judgedLandings: 3,
    };
    const at = ({ ledgerRow }: { ledgerRow: number }): LandedDraftsRead => ({
      bindings: { bound: [{ item: changed, landing: LANDING, ledgerRow, namedId: ID }], unreadable: [] },
      kind: "read",
      ledgerRows: 4,
      vanished: [],
    });

    expect(dropRefusal({ items: [changed], landed: at({ ledgerRow: 2 }), note: MOOT, row: changed })).toContain(
      `${ID}'s meaning changed (the customer withdrew it) and waits on the owner's word`,
    );
    expect(dropRefusal({ items: [changed], landed: at({ ledgerRow: 3 }), note: MOOT, row: changed })).toContain(
      "which no judgement has answered",
    );
  });

  it("orders the owner's word since a hold judging the words no yes by the landing ledger the hold read", () => {
    const setDown = { approval: KNOCK, atIso: "2026-10-08T00:30:00.000Z", landingsRead: 5, why: "they meant another" };
    const held = {
      ...draftItem({
        hold: { atIso: "2026-10-08T00:30:00.000Z", reason: "not-owner-yes", setDown, why: "they meant another" },
        id: ID,
        judgedIso: "2026-10-08T00:30:00.000Z",
        tsIso: "2026-10-08T00:10:00.000Z",
      }),
      judgedLandings: 5,
    };
    const late = landed({ cardKey: `post:${ID}`, decidedIso: "2026-10-08T00:30:00.001Z" });
    const at = ({ ledgerRow }: { ledgerRow: number }): LandedDraftsRead => ({
      bindings: { bound: [{ item: held, landing: late, ledgerRow, namedId: ID }], unreadable: [] },
      kind: "read",
      ledgerRows: 6,
      vanished: [],
    });

    expect(dropRefusal({ items: [held], landed: at({ ledgerRow: 4 }), note: MOOT, row: held })).toContain(
      "no word of the owner's has landed on its card since",
    );
    expect(dropRefusal({ items: [held], landed: at({ ledgerRow: 5 }), note: MOOT, row: held })).toContain(
      "which no judgement has answered",
    );
  });
});
