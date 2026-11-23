/**
 * `draftApproval.ts` — an approval travels with the words across a one-row re-cut, is set down only by a declared
 * change, and never crosses a merge with words the owner did not hear. Plus the register's reading of the field.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  dropLeadsTo,
  dropShedsApproval,
  heldOnApproval,
  inheritedDraftApproval,
} from "../../../../outbound/slack/draftApproval.js";
import { DraftDropErrors } from "../../../../outbound/slack/draftDropErrors.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../outbound/slack/draftLog.js";
import {
  type DraftApproval,
  parkedDraftDigest,
  type SlackDraftItem,
  slackDraftEventLine,
} from "../../../../outbound/slack/draftRegister.js";

const APPROVAL: DraftApproval = {
  anchor: "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt",
  atIso: "2026-10-07T05:52:59.000Z",
  heard: "Send it",
};

/**
 * A held row, approved or not, carrying these words — its own by default, so two rows are two messages unless one is
 * recorded as the other's re-cut (`recuts`) or carries the same words, which is what the digest binds.
 */
function row({
  id,
  approval,
  recuts,
  text = `the words of ${id}`,
}: {
  id: string;
  approval?: DraftApproval;
  recuts?: readonly string[];
  text?: string;
}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel: "C0123456789",
      digest: `digest of ${text}`,
      form: "{}",
      id,
      mentions: [],
      payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso: "2026-10-07T05:55:00.000Z",
      why: "reply to Seth",
      ...(approval === undefined ? {} : { approval }),
      ...(recuts === undefined ? {} : { recuts }),
    },
    id,
    state: "held",
  };
}

describe("inheritedDraftApproval", () => {
  it("takes a fresh approval as given", () => {
    const result = inheritedDraftApproval({ fresh: APPROVAL, meaningChanged: undefined, superseded: [] });

    expect(unwrap(result)).toEqual({ approval: APPROVAL });
  });

  it("carries the one superseded row's approval, naming where it came from", () => {
    const result = inheritedDraftApproval({
      fresh: undefined,
      meaningChanged: undefined,
      superseded: [row({ approval: APPROVAL, id: "sd-11112222" })],
    });

    expect(unwrap(result)).toEqual({ approval: { ...APPROVAL, inheritedFrom: "sd-11112222" } });
  });

  it("carries the row's judgement boundary and blocking hold, never the park instant", () => {
    const hold = { atIso: "2026-10-07T06:10:00.000Z", reason: "thread-moved", why: "Seth answered first" } as const;
    const blocked = {
      ...row({ approval: APPROVAL, id: "sd-11112222" }),
      hold,
      judgedIso: hold.atIso,
      judgedLandings: 4,
    };
    const result = inheritedDraftApproval({ fresh: undefined, meaningChanged: undefined, superseded: [blocked] });

    expect(unwrap(result)).toEqual({
      approval: { ...APPROVAL, hold, inheritedFrom: "sd-11112222", judgedIso: hold.atIso, judgedLandings: 4 },
    });
  });

  it("carries nothing when no superseded row is approved", () => {
    const result = inheritedDraftApproval({
      fresh: undefined,
      meaningChanged: undefined,
      superseded: [row({ id: "sd-11112222" }), row({ id: "sd-33334444" })],
    });

    expect(unwrap(result)).toEqual({});
  });

  it("refuses a merge where one row is approved and another is not", () => {
    const result = inheritedDraftApproval({
      fresh: undefined,
      meaningChanged: undefined,
      superseded: [row({ approval: APPROVAL, id: "sd-11112222" }), row({ id: "sd-33334444" })],
    });

    expect(unwrapErr(result).code).toBe("DRAFT_APPROVAL_INVALID");
    expect(unwrapErr(result).message).toContain(
      "this re-cut merges 2 rows and sd-11112222 carries the owner's approval",
    );
  });

  it("lets a fresh anchor stand over a merge", () => {
    const result = inheritedDraftApproval({
      fresh: APPROVAL,
      meaningChanged: undefined,
      superseded: [row({ approval: APPROVAL, id: "sd-11112222" }), row({ id: "sd-33334444" })],
    });

    expect(unwrap(result)).toEqual({ approval: APPROVAL });
  });

  it("records a declared change over an approved row, carrying no approval", () => {
    const result = inheritedDraftApproval({
      fresh: undefined,
      meaningChanged: "the thread asked for one thing",
      superseded: [row({ approval: APPROVAL, id: "sd-11112222" })],
    });

    expect(unwrap(result)).toEqual({ meaningChanged: "the thread asked for one thing" });
  });

  it("refuses a declared change with no approved row to set down", () => {
    const result = inheritedDraftApproval({
      fresh: undefined,
      meaningChanged: "reworded",
      superseded: [row({ id: "sd-11112222" })],
    });

    expect(unwrapErr(result).message).toContain(
      "no row --supersedes names carries the owner's approval, a change of meaning waiting on their word, or a " +
        "yes an approval-voiding hold set down",
    );
  });

  it("accepts a declared change over a row whose yes an approval-voiding hold set down", () => {
    const held = row({ id: "sd-11112222" });
    const setDown = { atIso: "2026-10-08T00:30:00.000Z", why: "the owner meant the other draft" };
    const waiting = { ...held, hold: { ...setDown, reason: "not-owner-yes" as const, setDown } };
    const result = inheritedDraftApproval({ fresh: undefined, meaningChanged: "reworded", superseded: [waiting] });

    expect(unwrap(result)).toEqual({ meaningChanged: "reworded" });
  });

  it("refuses a bare re-cut of a row whose change waits on the owner's word", () => {
    const changed = row({ id: "sd-11112222" });
    const waiting = { ...changed, draft: { ...changed.draft, meaningChanged: "added the date" } };
    const result = inheritedDraftApproval({ fresh: undefined, meaningChanged: undefined, superseded: [waiting] });

    expect(unwrapErr(result).message).toContain(
      '--supersedes sd-11112222: its meaning changed and waits on the owner\'s word (sd-11112222: "added the date")',
    );
    expect(unwrapErr(result).message).toContain("Re-run the same record adding --meaning-changed");
  });

  it("records a re-declared change, or the owner's fresh yes, over a row whose change waits on their word", () => {
    const changed = row({ id: "sd-11112222" });
    const waiting = { ...changed, draft: { ...changed.draft, meaningChanged: "added the date" } };

    expect(
      unwrap(inheritedDraftApproval({ fresh: undefined, meaningChanged: "added the date", superseded: [waiting] })),
    ).toEqual({ meaningChanged: "added the date" });
    expect(
      unwrap(inheritedDraftApproval({ fresh: APPROVAL, meaningChanged: undefined, superseded: [waiting] })),
    ).toEqual({ approval: APPROVAL });
  });

  it("refuses a fresh approval beside a declared change", () => {
    const result = inheritedDraftApproval({ fresh: APPROVAL, meaningChanged: "reworded", superseded: [] });

    expect(unwrapErr(result).message).toContain("cannot stand beside one");
  });
});

describe("heldOnApproval", () => {
  it("is true only for a held row carrying an approval", () => {
    const approved = row({ approval: APPROVAL, id: "sd-11112222" });

    expect(heldOnApproval({ item: approved })).toBe(true);
    expect(heldOnApproval({ item: { ...approved, state: "released" } })).toBe(false);
    expect(heldOnApproval({ item: row({ id: "sd-33334444" }) })).toBe(false);
  });
});

describe("dropShedsApproval", () => {
  const approved = row({ approval: APPROVAL, id: "sd-11112222" });
  /** A held re-cut recorded with `--supersedes sd-11112222`, carrying no yes of its own. */
  const bare = row({ id: "sd-33334444", recuts: ["sd-11112222"] });

  it("refuses a note naming an unrelated held row with its own fresh yes as the re-cut", () => {
    const unrelated = row({ approval: { ...APPROVAL, anchor: "talk-call:second#1" }, id: "sd-99990000" });
    const refused = dropShedsApproval({ items: [approved, unrelated], note: "re-cut as sd-99990000", row: approved });

    expect(refused).toEqual(DraftDropErrors.dropSpendsYes({ dropped: "sd-11112222", unlinked: "sd-99990000" }));
    expect(refused!.message).toContain(
      "The note names sd-99990000, but nothing on record makes it sd-11112222's message",
    );
  });

  it("refuses dropping an approved row as re-cut by a held row carrying no yes", () => {
    const refused = dropShedsApproval({ items: [approved, bare], note: "re-cut as sd-33334444", row: approved });

    expect(refused).toEqual(DraftDropErrors.dropShedsApproval({ dropped: "sd-11112222", recut: "sd-33334444" }));
    expect(refused!.message).toContain(
      'or hold it (`slopweaver slack draft hold sd-33334444 --reason not-owner-yes --why "<why>"`)',
    );
  });

  it("lets the drop through when the re-cut carries the yes or a declared change of meaning", () => {
    const inherited = { ...bare, draft: { ...bare.draft, approval: { ...APPROVAL, inheritedFrom: "sd-11112222" } } };
    const changed = { ...bare, draft: { ...bare.draft, meaningChanged: "added the date" } };

    expect(dropShedsApproval({ items: [approved, inherited], note: "re-cut as sd-33334444", row: approved })).toBe(
      undefined,
    );
    expect(dropShedsApproval({ items: [approved, changed], note: "re-cut as sd-33334444", row: approved })).toBe(
      undefined,
    );
  });

  it("refuses when the re-cut inherited an earlier yes than the one this row carries now", () => {
    const earlier = { ...APPROVAL, anchor: "talk-call:00000000#1", inheritedFrom: "sd-11112222" };
    const stale = { ...bare, draft: { ...bare.draft, approval: earlier } };
    const fresh = { ...bare, draft: { ...bare.draft, approval: { ...APPROVAL, anchor: "talk-call:00000000#1" } } };

    expect(dropShedsApproval({ items: [approved, stale], note: "re-cut as sd-33334444", row: approved })).toEqual(
      DraftDropErrors.dropShedsApproval({ dropped: "sd-11112222", recut: "sd-33334444" }),
    );
    expect(dropShedsApproval({ items: [approved, fresh], note: "re-cut as sd-33334444", row: approved })).toBe(
      undefined,
    );
  });

  it("refuses dropping a row whose change waits on the owner onto a cut carrying neither", () => {
    const waiting = {
      ...row({ id: "sd-55556666" }),
      draft: { ...row({ id: "sd-55556666" }).draft, meaningChanged: "added the date" },
    };
    const recut = row({ id: "sd-33334444", recuts: ["sd-55556666"] });
    const refused = dropShedsApproval({ items: [waiting, recut], note: "re-cut as sd-33334444", row: waiting });

    expect(refused).toEqual(DraftDropErrors.dropShedsChange({ dropped: "sd-55556666", recut: "sd-33334444" }));
    expect(refused!.message).toContain(
      'Hold it with the change (`slopweaver slack draft hold sd-33334444 --reason meaning-changed --why "<what changed>"`)',
    );
  });

  it("lets a changed row's drop through onto a cut carrying the change or the owner's yes", () => {
    const waiting = {
      ...row({ id: "sd-55556666" }),
      draft: { ...row({ id: "sd-55556666" }).draft, meaningChanged: "added the date" },
    };
    const recut = row({ id: "sd-33334444", recuts: ["sd-55556666"] });
    const carried = { ...recut, draft: { ...recut.draft, meaningChanged: "added the date" } };
    const yes = row({ approval: APPROVAL, id: "sd-11112222", recuts: ["sd-55556666"] });

    expect(dropShedsApproval({ items: [waiting, carried], note: "re-cut as sd-33334444", row: waiting })).toBe(
      undefined,
    );
    expect(dropShedsApproval({ items: [waiting, yes], note: "re-cut as sd-11112222", row: waiting })).toBe(undefined);
  });

  it("follows a re-cut already dropped to the bare held cut it names", () => {
    const between = {
      ...row({ id: "sd-77778888", recuts: ["sd-11112222"] }),
      outcome: "re-cut as sd-33334444",
      state: "dropped" as const,
    };
    const last = row({ id: "sd-33334444", recuts: ["sd-77778888"] });
    const refused = dropShedsApproval({
      items: [approved, between, last],
      note: "re-cut as sd-77778888",
      row: approved,
    });

    expect(refused).toEqual(DraftDropErrors.dropShedsApproval({ dropped: "sd-11112222", recut: "sd-33334444" }));
  });

  it("refuses a drop naming a released row that carried other words", () => {
    const other = { ...row({ id: "sd-33334444", text: "an unrelated reply" }), state: "released" as const };

    expect(dropShedsApproval({ items: [approved, other], note: "re-cut as sd-33334444", row: approved })).toEqual(
      DraftDropErrors.dropSpendsYes({ dropped: "sd-11112222", unlinked: "sd-33334444" }),
    );
  });

  it("refuses a drop naming a released row that only opens with the same line", () => {
    const opening = "Weekly security update for the production environment:";
    const mine = row({ approval: APPROVAL, id: "sd-11112222", text: `${opening}\nnothing to patch` });
    const twin = { ...row({ id: "sd-33334444", text: `${opening}\ntwo hosts to patch` }), state: "released" as const };

    expect(dropShedsApproval({ items: [mine, twin], note: "re-cut as sd-33334444", row: mine })).toEqual(
      DraftDropErrors.dropSpendsYes({ dropped: "sd-11112222", unlinked: "sd-33334444" }),
    );
  });

  it("counts another release as this row's send by inheritance, never by an equal anchor", () => {
    const text = "the other draft's words";
    const sameAnchor = { ...row({ approval: APPROVAL, id: "sd-33334444", text }), state: "released" as const };
    const between = {
      ...row({ approval: { ...APPROVAL, inheritedFrom: "sd-11112222" }, id: "sd-77778888" }),
      outcome: "re-cut as sd-33334444",
      state: "dropped" as const,
    };
    const inherited = {
      ...row({ approval: { ...APPROVAL, inheritedFrom: "sd-77778888" }, id: "sd-33334444", text }),
      state: "released" as const,
    };

    expect(dropShedsApproval({ items: [approved, sameAnchor], note: "re-cut as sd-33334444", row: approved })).toEqual(
      DraftDropErrors.dropSpendsYes({ dropped: "sd-11112222", unlinked: "sd-33334444" }),
    );
    expect(
      dropShedsApproval({ items: [approved, between, inherited], note: "re-cut as sd-77778888", row: approved }),
    ).toBe(undefined);
  });

  it("lets through a drop of an unapproved row, a re-cut already sent, or a sent record of where it went", () => {
    const sent = { ...bare, state: "released" as const };
    const permalink = "sent https://example.slack.com/archives/C0123456789/p1791360000000100";

    expect(
      dropShedsApproval({ items: [bare], note: "re-cut as sd-33334444", row: { ...bare, id: "sd-55556666" } }),
    ).toBe(undefined);
    expect(dropShedsApproval({ items: [approved, sent], note: "re-cut as sd-33334444", row: approved })).toBe(
      undefined,
    );
    expect(dropShedsApproval({ items: [approved], note: permalink, row: approved })).toBe(undefined);
  });

  it("refuses a drop that ends the owner's yes unsent: a moot note, or a re-cut chain ending dropped", () => {
    const spent = { ...bare, outcome: "moot", state: "dropped" as const };

    expect(dropShedsApproval({ items: [approved, bare], note: "moot: Seth answered", row: approved })).toEqual(
      DraftDropErrors.dropSpendsYes({ dropped: "sd-11112222" }),
    );
    expect(dropShedsApproval({ items: [approved, spent], note: "re-cut as sd-33334444", row: approved })!.code).toBe(
      "DRAFT_DROP_SPENDS_YES",
    );
  });
});

describe("dropLeadsTo", () => {
  const bare = row({ id: "sd-33334444", recuts: ["sd-11112222"] });
  const from = row({ id: "sd-11112222" });

  it("ends the words at a cut the note names that nothing records as this row's message", () => {
    const unrelated = row({ id: "sd-33334444" });

    expect(dropLeadsTo({ items: [from, unrelated], note: "re-cut as sd-33334444", row: from })).toEqual({
      kind: "ends",
      unlinked: unrelated,
    });
  });

  it("names the held cut, a send, or the end of the words", () => {
    expect(dropLeadsTo({ items: [from, bare], note: "re-cut as sd-33334444", row: from })).toEqual({
      cut: bare,
      kind: "held",
    });
    expect(
      dropLeadsTo({ items: [from, { ...bare, state: "released" }], note: "re-cut as sd-33334444", row: from }).kind,
    ).toBe("sent");
    expect(dropLeadsTo({ items: [from], note: "moot", row: from }).kind).toBe("ends");
  });
});

describe("the register's reading of an approval", () => {
  /** One parked line for a draft carrying these extra fields. */
  function lineOf({ extra }: { extra: Record<string, unknown> }): string {
    const { draft } = row({ id: "sd-11112222" });
    return slackDraftEventLine({
      event: { draft: { ...draft, ...extra }, id: draft.id, kind: "parked", tsIso: draft.tsIso },
    });
  }

  it("reads a whole approval back", () => {
    const log = parseSlackDraftLog({ lines: [lineOf({ extra: { approval: APPROVAL } })] });

    expect(log.skipped).toEqual([]);
    expect(foldSlackDraftLog({ log })[0]!.draft.approval).toEqual(APPROVAL);
  });

  it("passes over an approval missing the owner's words, rather than drawing the row approved", () => {
    const log = parseSlackDraftLog({ lines: [lineOf({ extra: { approval: { ...APPROVAL, heard: "" } } })] });

    expect(log.skipped).toEqual([{ id: "sd-11112222", kind: "parked", line: 1 }]);
    expect(foldSlackDraftLog({ log })).toEqual([]);
  });

  it("reads a re-cut list back, and passes over one naming no row", () => {
    const whole = parseSlackDraftLog({ lines: [lineOf({ extra: { recuts: ["sd-33334444"] } })] });
    const blank = parseSlackDraftLog({ lines: [lineOf({ extra: { recuts: [""] } })] });

    expect(foldSlackDraftLog({ log: whole })[0]!.draft.recuts).toEqual(["sd-33334444"]);
    expect(blank.skipped).toEqual([{ id: "sd-11112222", kind: "parked", line: 1 }]);
  });

  it("reads an inherited approval's carried judgement back onto the row, and passes over a guessed one", () => {
    const hold = { atIso: "2026-10-07T06:10:00.000Z", reason: "no-fleet-slot", why: "every seat is busy" } as const;
    const carried = { ...APPROVAL, hold, inheritedFrom: "sd-00000001", judgedIso: hold.atIso, judgedLandings: 4 };
    const whole = parseSlackDraftLog({ lines: [lineOf({ extra: { approval: carried } })] });
    const setDown = { ...carried, hold: { ...hold, reason: "not-owner-yes" } };
    const guessed = [setDown, { ...carried, judgedLandings: -1 }, { ...carried, judgedIso: "yesterday" }];
    const skipped = guessed.map(
      (approval) => parseSlackDraftLog({ lines: [lineOf({ extra: { approval } })] }).skipped.length,
    );
    const folded = foldSlackDraftLog({ log: whole })[0]!;

    expect([folded.judgedIso, folded.judgedLandings, folded.hold]).toEqual([hold.atIso, 4, hold]);
    expect(skipped).toEqual([1, 1, 1]);
  });

  it("reads a judged park's landing count as its judgement and change boundary, and a bare park's as nothing", () => {
    const { draft } = row({ id: "sd-11112222" });
    const changed = { ...draft, meaningChanged: "the customer withdrew it" };
    const lineFor = ({ parked }: { parked: typeof draft }) =>
      slackDraftEventLine({
        event: { draft: parked, id: parked.id, kind: "parked", landingsRead: 3, tsIso: parked.tsIso },
      });
    const [judged] = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: [lineFor({ parked: changed })] }) });
    const [bare] = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: [lineFor({ parked: draft })] }) });

    expect([judged!.judgedLandings, judged!.changedLandings]).toEqual([3, 3]);
    expect([bare!.judgedLandings, bare!.changedLandings]).toEqual([undefined, undefined]);
  });

  it("passes over a row carrying both an approval and a declared change", () => {
    const log = parseSlackDraftLog({ lines: [lineOf({ extra: { approval: APPROVAL, meaningChanged: "x" } })] });

    expect(log.skipped.length).toBe(1);
  });

  it("leaves the digest unchanged, so an approval never moves what a release binds", () => {
    const { draft } = row({ id: "sd-11112222" });
    const approved = row({ approval: APPROVAL, id: "sd-11112222" }).draft;

    expect(parkedDraftDigest({ draft: approved })).toBe(parkedDraftDigest({ draft }));
  });
});
