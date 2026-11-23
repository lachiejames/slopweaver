/**
 * `tickRecordApprovedDrafts.ts`'s read, round-tripped through a real register file: a line this build cannot read
 * that names an approved row must not hide it from the gate (the review's counterexample, verbatim),
 * and the refusal must say no verb here can reach it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { slackDraftLogPath } from "../../../../../admit/slackDraftStore.js";
import {
  approvedDraftRefusalLines,
  readApprovedDraftsLive,
} from "../../../../../cli/commands/supervisor/tickRecordApprovedDrafts.js";
import { judgeApprovedDrafts } from "../../../../../supervisor/approvedDraftGate.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../../../talk/cardLandingStore.js";

const PARKED =
  '{"schemaVersion":1,"id":"sd-11112222","kind":"parked","tsIso":"2026-10-07T05:55:00.000Z","draft":{"advisory":[],' +
  '"approval":{"anchor":"talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt","atIso":"2026-10-07T05:52:59.000Z",' +
  '"heard":"Send it"},"channel":"C0123456789","digest":"0123456789abcdef0123456789abcdef","form":"{}","id":"sd-11112222",' +
  '"mentions":[],"payload":{"form":"plain","text":"sounds good","unfurl_links":false,"unfurl_media":false},' +
  '"shape":"top-level","tsIso":"2026-10-07T05:55:00.000Z","why":"reply to Seth"}}';
const UNKNOWN_EVENT = '{"schemaVersion":1,"id":"sd-11112222","kind":"bogus","tsIso":"2026-10-07T06:00:00.000Z"}';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home whose draft register holds exactly these lines. */
function homeWith({ lines }: { lines: readonly string[] }): string {
  const home = mkdtempSync(join(tmpdir(), "approved-drafts-"));
  homes.push(home);
  const path = slackDraftLogPath({ home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return home;
}

describe("readApprovedDraftsLive", () => {
  it("keeps an approved row an unreadable line names, so the gate still refuses it", () => {
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, UNKNOWN_EVENT] }) });
    const verdict = judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" });

    expect(verdict.kind).toBe("refused");
    expect(verdict).toMatchObject({ skippedLines: 1, unreadApproved: [], unsureIds: ["sd-11112222"] });
  });

  it("refuses an approved parked line this build cannot validate, off its id and instant alone", () => {
    const newerShape = PARKED.replace('"advisory":[],', '"actor":"me","advisory":[],');
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [newerShape] }) });
    const verdict = judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" });

    expect(verdict).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 1,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("counts an unreadable approved line spent once a readable drop names it", () => {
    const newerShape = PARKED.replace('"advisory":[],', '"actor":"me","advisory":[],');
    const dropped =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"dropped","tsIso":"2026-10-07T06:00:00.000Z","note":"sent by hand"}';
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [newerShape, dropped] }) });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({ kind: "clean" });
  });

  it("spends nothing with a drop written BEFORE the unreadable approved line", () => {
    const newerShape = PARKED.replace('"advisory":[],', '"actor":"me","advisory":[],');
    const earlierDrop =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"dropped","tsIso":"2026-10-07T05:50:00.000Z","note":"old row"}';
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [earlierDrop, newerShape] }) });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toMatchObject({
      kind: "refused",
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
    });
  });

  it("still owes an approved park that a later park under the same id hides from the fold", () => {
    const reparked = PARKED.replace(/"approval":\{[^}]*\},/, "").replaceAll(
      "2026-10-07T05:55:00.000Z",
      "2026-10-07T06:10:00.000Z",
    );
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, reparked] }) });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes a pre-tick approved park that a later approved park under the same id replaces", () => {
    const later = PARKED.replaceAll("2026-10-07T05:55:00.000Z", "2026-10-07T13:00:01.000Z").replaceAll(
      "sounds good",
      "second",
    );
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, later] }) });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("owes a pre-tick approved park appended after a post-tick one, both hidden by a last unapproved park", () => {
    const at = ({ iso }: { iso: string }): string => PARKED.replaceAll("2026-10-07T05:55:00.000Z", iso);
    const unapproved = at({ iso: "2026-10-07T13:00:02.000Z" }).replace(/"approval":\{[^}]*\},/, "");
    const read = readApprovedDraftsLive({
      home: homeWith({
        lines: [at({ iso: "2026-10-07T13:00:01.000Z" }), at({ iso: "2026-10-07T12:59:59.000Z" }), unapproved],
      }),
    });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T12:59:59.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("still owes an earlier approved park after a release spends the later one under the same id", () => {
    const at = ({ iso, text }: { iso: string; text: string }): string =>
      PARKED.replaceAll("2026-10-07T05:55:00.000Z", iso).replaceAll("sounds good", text);
    const released =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"released","tsIso":"2026-10-07T12:02:00.000Z",' +
      '"channel":"C0123456789","ts":"1791374520.000100"}';
    const read = readApprovedDraftsLive({
      home: homeWith({
        lines: [
          at({ iso: "2026-10-07T12:00:00.000Z", text: "first" }),
          at({ iso: "2026-10-07T12:01:00.000Z", text: "second" }),
          released,
        ],
      }),
    });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T12:00:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("lets a drop after a release land on the released park, never on an earlier approved one", () => {
    const unapproved = PARKED.replace(/"approval":\{[^}]*\},/, "").replaceAll(
      "2026-10-07T05:55:00.000Z",
      "2026-10-07T12:01:00.000Z",
    );
    const released =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"released","tsIso":"2026-10-07T12:02:00.000Z",' +
      '"channel":"C0123456789","ts":"1791374520.000100"}';
    const dropped =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"dropped","tsIso":"2026-10-07T12:03:00.000Z","note":"re-cut"}';
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, unapproved, released, dropped] }) });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 0,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("spends nothing with a release after an unreadable line that is not a park", () => {
    const released =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"released","tsIso":"2026-10-07T06:10:00.000Z",' +
      '"channel":"C0123456789","ts":"1791374520.000100"}';
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, UNKNOWN_EVENT, released] }) });

    expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual({
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 1,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    });
  });

  it("spends nothing with a release after a line that is not JSON at all, named or not", () => {
    const released =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"released","tsIso":"2026-10-07T06:10:00.000Z",' +
      '"channel":"C0123456789","ts":"1791374520.000100"}';
    const named = '{"schemaVersion":1,"id":"sd-11112222","kind":"bogus"';
    const owed = {
      drafts: [],
      kind: "refused",
      landings: [],
      skippedLines: 1,
      unreadApproved: [{ id: "sd-11112222", tsIso: "2026-10-07T05:55:00.000Z" }],
      unreadableLandings: [],
      unsureIds: [],
    };

    // A line that is not JSON touches every row, whatever id a text match recovers from it.
    const decoy = '{"schemaVersion":1,"id": "sd-11112222","kind":"bogus","decoy":{"id":"sd-99990000"}';
    for (const broken of [named, "not json", decoy]) {
      const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, broken, released] }) });

      expect(judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" })).toEqual(owed);
    }
  });

  it("does not name a row twice when the fold already shows it held and approved", () => {
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED] }) });

    expect(read).toMatchObject({ skippedLines: 0, unreadApproved: [], unsureIds: [] });
  });

  it("reads an absent register as no rows", () => {
    const home = mkdtempSync(join(tmpdir(), "approved-drafts-"));
    homes.push(home);

    expect(readApprovedDraftsLive({ home })).toEqual({
      items: [],
      answers: new Map(),
      kind: "read",
      landings: { bound: [], unreadable: [] },
      skippedLines: 0,
      unreadApproved: [],
      unsureIds: [],
    });
  });
});

describe("readApprovedDraftsLive — the owner's words on a draft's card, read off the real ledger", () => {
  const UNAPPROVED = PARKED.replace(/"approval":\{[^}]*\},/, "");
  const landing = ({ cardKey }: { cardKey: string }): CardLandedRow => ({
    anchor: "talk-call:f9e9277d#12",
    atIso: "2026-10-07T06:00:00.000Z",
    cardKey,
    decidedIso: "2026-10-07T06:00:00.000Z",
    kind: "landed",
    source: "transcript",
    words: "Yes, send it today",
    workSlug: "organisation-hunt-2026-10-07",
  });

  it("refuses a landing on a draft's own card until a session judges it, printing the approve line", () => {
    const home = homeWith({ lines: [UNAPPROVED] });
    expect(appendCardLanding({ home, row: landing({ cardKey: "post:sd-11112222" }) }).isOk()).toBe(true);
    const verdict = judgeApprovedDrafts({
      read: readApprovedDraftsLive({ home }),
      startedIso: "2026-10-07T13:00:00.000Z",
    });

    expect(verdict).toMatchObject({ drafts: [], kind: "refused", unreadableLandings: [] });
    const lines = approvedDraftRefusalLines({
      answers: new Map(),
      verdict: verdict as Exclude<typeof verdict, { kind: "clean" }>,
    });
    expect(lines).toContain("    yes: slopweaver slack draft approve sd-11112222 --anchor talk-call:f9e9277d#12");
  });

  it("is clean once `slack draft approve` binds the owner's yes after the landing and the release spends it", () => {
    const approved =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"approved","tsIso":"2026-10-07T06:05:00.000Z","approval":' +
      '{"anchor":"talk-call:f9e9277d#12","atIso":"2026-10-07T06:00:00.000Z","heard":"Yes, send it today"}}';
    const held =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"held","tsIso":"2026-10-07T06:06:00.000Z",' +
      '"reason":"no-fleet-slot","why":"every slot is busy"}';
    const home = homeWith({ lines: [UNAPPROVED, approved, held] });
    expect(appendCardLanding({ home, row: landing({ cardKey: "post:sd-11112222" }) }).isOk()).toBe(true);

    expect(
      judgeApprovedDrafts({ read: readApprovedDraftsLive({ home }), startedIso: "2026-10-07T13:00:00.000Z" }),
    ).toEqual({ kind: "clean" });
  });

  it("still owes the approval itself when the yes is bound but neither sent nor held", () => {
    const approved =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"approved","tsIso":"2026-10-07T06:05:00.000Z","approval":' +
      '{"anchor":"talk-call:f9e9277d#12","atIso":"2026-10-07T06:00:00.000Z","heard":"Yes, send it today"}}';
    const home = homeWith({ lines: [UNAPPROVED, approved] });
    expect(appendCardLanding({ home, row: landing({ cardKey: "post:sd-11112222" }) }).isOk()).toBe(true);
    const verdict = judgeApprovedDrafts({
      read: readApprovedDraftsLive({ home }),
      startedIso: "2026-10-07T13:00:00.000Z",
    });

    expect(verdict).toMatchObject({ kind: "refused", landings: [] });
    expect((verdict as Extract<typeof verdict, { kind: "refused" }>).drafts.map((item) => item.id)).toEqual([
      "sd-11112222",
    ]);
  });

  it("owes the owner's yes a transcript landed after a moot drop it outran, naming re-record and restore", () => {
    const dropped =
      '{"schemaVersion":1,"id":"sd-11112222","kind":"dropped","tsIso":"2026-10-07T06:02:00.000Z","note":"moot: Seth answered"}';
    const home = homeWith({ lines: [UNAPPROVED, dropped] });
    const late = { ...landing({ cardKey: "post:sd-11112222" }), atIso: "2026-10-07T06:10:00.000Z" };
    expect(appendCardLanding({ home, row: late }).isOk()).toBe(true);
    const verdict = judgeApprovedDrafts({
      read: readApprovedDraftsLive({ home }),
      startedIso: "2026-10-07T13:00:00.000Z",
    });
    const lines = approvedDraftRefusalLines({
      answers: new Map(),
      verdict: verdict as Exclude<typeof verdict, { kind: "clean" }>,
    });

    expect(verdict).toMatchObject({ drafts: [], kind: "refused", unreadableLandings: [] });
    expect(lines).toContain(
      "    on sd-11112222, DROPPED 2026-10-07T06:02:00.000Z (moot: Seth answered) before these words were landed, so the drop never weighed them",
    );
    expect(lines).toContain(
      "    yes: re-record its exact words with slopweaver slack draft record … --approved talk-call:f9e9277d#12, which owes the send",
    );
    expect(lines).toContain(
      '    not: slopweaver talk restore --card post:sd-11112222 --anchor "<where you decided>" --why "<why the drop stands>"',
    );
  });

  it("binds nothing for a landing on an ask whose doc is gone — there is no card left for an id to sit on", () => {
    const home = homeWith({ lines: [UNAPPROVED] });
    expect(appendCardLanding({ home, row: landing({ cardKey: "ask:organisation-hunt-2026-10-07" }) }).isOk()).toBe(
      true,
    );

    expect(
      judgeApprovedDrafts({ read: readApprovedDraftsLive({ home }), startedIso: "2026-10-07T13:00:00.000Z" }),
    ).toEqual({ kind: "clean" });
  });
});

describe("approvedDraftRefusalLines on an unsure row", () => {
  it("names the row and the rebuild, never a release command it cannot run", () => {
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [PARKED, UNKNOWN_EVENT] }) });
    const verdict = judgeApprovedDrafts({ read, startedIso: "2026-10-07T13:00:00.000Z" });
    const lines = approvedDraftRefusalLines({
      answers: new Map(),
      verdict: verdict as Exclude<typeof verdict, { kind: "clean" }>,
    });

    expect(lines).toContain(
      '  sd-11112222 recorded 2026-10-07T05:55:00.000Z, approved at talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt "Send it"',
    );
    expect(lines).toContain(
      "    STATE UNKNOWN: a register line this build cannot read names it, so no verb here can release or drop it. " +
        "Rebuild this seat on current main (`slopweaver dev build`) so the line reads, then re-run this.",
    );
  });

  it("owes a meaning-change row a hold of an unknown reason hides from the Queue, saying why", () => {
    const changed = PARKED.replace(/"approval":\{[^}]*\},/u, '"meaningChanged":"thread moved",').replaceAll(
      "sd-11112222",
      "sd-bbbb2222",
    );
    const future =
      '{"schemaVersion":2,"kind":"held","id":"sd-bbbb2222","tsIso":"2026-10-08T03:00:00.000Z","reason":"future-block",' +
      '"why":"blocked"}';
    const read = readApprovedDraftsLive({ home: homeWith({ lines: [changed, future] }) });
    const verdict = judgeApprovedDrafts({ read, startedIso: "2026-10-08T04:00:00.000Z" });
    const lines = approvedDraftRefusalLines({
      answers: new Map(),
      verdict: verdict as Exclude<typeof verdict, { kind: "clean" }>,
    });

    expect(verdict.kind).toBe("refused");
    expect(lines).toContain(
      '  sd-bbbb2222 recorded 2026-10-07T05:55:00.000Z, its meaning changed, waiting on the owner\'s word: "thread moved"',
    );
    expect(lines).toContain(
      "    STATE UNKNOWN: a register line this build cannot read names it, so no verb here can release or drop it. " +
        "Rebuild this seat on current main (`slopweaver dev build`) so the line reads, then re-run this.",
    );
  });
});
