/*
 * The CONSUMER half of the `slack draft list --json` contract: the console's reader draws every row of the golden
 * the verb's own test pins (`src/__tests__/unit/cli/commands/slack/draftListContract.test.ts`).
 *
 * Every queue card naming a draft once read NOT MEASURED: four held drafts carried the
 * `rich_text_quote` the quote renderer began recording, and this reader refuses the WHOLE register over
 * one element it cannot draw. The producer test keys its golden off `@slack/types`' own unions and the shipped
 * as-me renderer over synthetic rows, so a new element reaches this file as a golden row — and fails here until the
 * reader draws it, rather than on a card. The golden is READ, never imported: `site/` is its own Yarn project, and
 * its CI job installs nothing the verb's graph needs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { receiptsLine } from "../../components/live/draftReceipts";
import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import { type DraftLine, type DraftRun } from "../../components/live/readSlackDraftsRuns";
import { postJudgementLine } from "../../lib/postJudgement";

/** The golden the producer test writes. */
const GOLDEN = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/contract/slack-draft-list.json", import.meta.url),
);

/** The text every block fixture wraps, as the reader draws it. */
const TEXT: DraftRun = { bold: false, code: false, italic: false, kind: "text", text: "quoted words" };

/** One line of plain runs, neither framed nor listed. */
function plain({ runs }: { runs: readonly DraftRun[] }): DraftLine {
  return { frame: undefined, marker: undefined, runs };
}

/** Every golden row, by id, and the lines the card must draw for it. */
const EXPECTED: Readonly<Record<string, readonly DraftLine[]>> = {
  "block-rich_text_list": [{ frame: undefined, marker: "•", runs: [TEXT] }],
  "block-rich_text_preformatted": [{ frame: "code", marker: undefined, runs: [TEXT] }],
  "block-rich_text_quote": [{ frame: "quote", marker: undefined, runs: [TEXT] }],
  "block-rich_text_section": [plain({ runs: [TEXT] })],
  "inline-every-element": [
    plain({
      runs: [
        { kind: "broadcast", range: "here" },
        { channelId: "C0SYN000001", kind: "channel" },
        { kind: "color", value: "#1d9bd1" },
        { kind: "date", label: "Sun 27 Sep", timestamp: 1_790_431_200 },
        { kind: "emoji", name: "pray", skinTone: undefined, unicode: undefined },
        { kind: "link", label: "ACME-101", url: "https://linear.app/acme/issue/ACME-101" },
        { kind: "team", teamId: "T0SYN000001" },
        TEXT,
        { kind: "user", userId: "U0SYN000001" },
        { groupId: "S0SYN000001", handle: undefined, kind: "usergroup" },
      ],
    }),
  ],
  // A nested one-list: the sub-point one level in, with Slack's second glyph.
  "nested-list": [
    // The lead's own run, then the list-lead gap the one-list renderer always appends to it.
    plain({
      runs: [
        { ...TEXT, text: "lead" },
        { ...TEXT, text: "\n\n" },
      ],
    }),
    { frame: undefined, marker: "•", runs: [{ ...TEXT, text: "headline" }] },
    { frame: undefined, indent: 1, marker: "◦", runs: [{ ...TEXT, text: "sub-point" }] },
  ],
  "sd-00000001": [
    { frame: "quote", marker: undefined, runs: [{ ...TEXT, text: "can you check the changelog too" }] },
    plain({ runs: [{ ...TEXT, text: "checked the changelog side, thanks for sorting it 🙏" }] }),
  ],
  // A first message in a channel carrying no screenshot: sent back unseen.
  "first-message-bare": [plain({ runs: [TEXT] })],
  "held-approved-blocked": [plain({ runs: [TEXT] })],
  "held-meaning-changed": [plain({ runs: [TEXT] })],
  "held-set-down-blocked": [plain({ runs: [TEXT] })],
  "held-changed-blocked": [plain({ runs: [TEXT] })],
  "receipts-attached": [
    plain({ runs: [{ kind: "link", label: "ACME-101", url: "https://linear.app/acme/issue/ACME-101" }] }),
  ],
  "receipts-codex-drops": [
    plain({ runs: [{ kind: "link", label: "ACME-101", url: "https://linear.app/acme/issue/ACME-101" }] }),
  ],
  "receipts-self-evident": [plain({ runs: [TEXT] })],
  "receipts-tried": [plain({ runs: [TEXT] })],
  "thread-reply": [plain({ runs: [TEXT] })],
  "thread-why-top-level": [plain({ runs: [TEXT] })],
  // A bot finding card: its author row and Details label as the mrkdwn Slack draws them, around the content.
  "bot-finding": [
    plain({ runs: [{ ...TEXT, text: ":robot_face:  *acme-bot*" }] }),
    plain({ runs: [TEXT] }),
    plain({ runs: [{ ...TEXT, text: "*Details*" }] }),
  ],
};

describe("the console reads every row slack draft list --json prints", () => {
  const drafts = readParkedDrafts(JSON.parse(readFileSync(GOLDEN, "utf8")));

  it("reads the register whole, with a row for every expectation and no other", () => {
    expect(Object.keys(EXPECTED).length).toBeGreaterThan(0);
    expect(drafts!.map((draft) => draft.id).toSorted()).toEqual(Object.keys(EXPECTED).toSorted());
  });

  it("draws each row's exact lines — quote, code block, list, and every inline element", () => {
    expect(Object.fromEntries(drafts!.map((draft) => [draft.id, draft.lines]))).toEqual(EXPECTED);
  });

  it("reads the thread a reply goes under, and the reply verb the register chose for it", () => {
    const reply = drafts!.find((draft) => draft.id === "thread-reply")!;
    expect([reply.thread, reply.release]).toEqual([
      {
        parentText: "build cache is cold",
        parentUserId: "U0SYN000001",
        permalink: "https://acme.slack.com/archives/C0SYN000001/p1789407961767649",
        ts: "1789407961.767649",
      },
      {
        command: "slopweaver slack reply --as me --draft thread-reply --approve 6e1175e94259c84bd39a9c9156a1d554",
        kind: "send",
      },
    ]);
  });

  it("reads a top-level row whose why says thread reply as one to re-record, never one to send", () => {
    const misplaced = drafts!.find((draft) => draft.id === "thread-why-top-level")!;
    expect([misplaced.thread, misplaced.release!.kind]).toEqual([undefined, "re-record"]);
  });

  it("reads a bot finding as the bot's, with its wrapper's fallback and the --as bot release", () => {
    const bot = drafts!.find((draft) => draft.id === "bot-finding")!;
    expect([bot.actor, bot.fallback, bot.release]).toEqual([
      "bot",
      "quoted words",
      {
        command: "slopweaver slack post --as bot --draft bot-finding --approve 6e1175e94259c84bd39a9c9156a1d554",
        kind: "send",
      },
    ]);
  });

  it("reads a judged row's approval, change of meaning and hold, and nothing on a row nobody judged", () => {
    const judgementOf = ({ id }: { id: string }) => drafts!.find((draft) => draft.id === id)!.judgement;
    expect([
      judgementOf({ id: "held-approved-blocked" }),
      judgementOf({ id: "held-meaning-changed" }),
      judgementOf({ id: "thread-reply" }),
    ]).toEqual([
      {
        approval: { anchor: "talk-call:c0000001#12", heard: "Go ahead and send it" },
        hold: { atIso: "2026-10-08T02:00:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
        judgedIso: "2026-10-08T02:00:00.000Z",
        meaningChanged: undefined,
      },
      {
        approval: undefined,
        hold: { atIso: "2026-10-08T02:01:00.000Z", reason: "meaning-changed", why: "the thread moved on" },
        judgedIso: "2026-10-08T02:01:00.000Z",
        meaningChanged: "the thread moved on",
      },
      { approval: undefined, hold: undefined, judgedIso: undefined, meaningChanged: undefined },
    ]);
  });

  it("leads a card blocked after its yes was set down with both reasons, folded hold over hold", () => {
    const lineOf = ({ id }: { id: string }) =>
      postJudgementLine({ judgement: drafts!.find((draft) => draft.id === id)!.judgement });
    expect([lineOf({ id: "held-set-down-blocked" }), lineOf({ id: "held-changed-blocked" })]).toEqual([
      'NOT SENT (no-fleet-slot): every seat is busy Your yes "Go ahead and send it" was set down earlier: the requested date changed',
      "NOT SENT (no-fleet-slot): every seat is busy Its meaning changed since your yes, so it waits on your word again: the requested date changed",
    ]);
  });

  it("reads each row's receipts into the line its Queue card leads with, and a row naming none as none", () => {
    const lineOf = ({ id }: { id: string }) => {
      const draft = drafts!.find((one) => one.id === id)!;
      return receiptsLine({ bump: draft.act === "bump", receipts: draft.receipts });
    };
    expect(
      ["receipts-attached", "receipts-self-evident", "receipts-tried", "thread-reply"].map((id) => lineOf({ id })),
    ).toEqual([
      "Receipts: 1 link",
      "No receipt needed: the message is the question itself",
      "No receipt. Tried: the dashboard share link 403s outside the org",
      "No receipts named",
    ]);
  });

  it("reads the list's verdict that Codex's B drops A's receipt, and no verdict where B keeps or is absent", () => {
    const dropsOf = ({ id }: { id: string }) =>
      drafts!.find((draft) => draft.id === id)!.comparison?.codexDropsReceipts;
    expect([dropsOf({ id: "receipts-codex-drops" }), dropsOf({ id: "receipts-attached" })]).toEqual([true, undefined]);
  });

  it("reads a first message's annotated receipt, and what a bare one lacks, off the rows", () => {
    const rowOf = ({ id }: { id: string }) => drafts!.find((draft) => draft.id === id)!;
    expect([
      rowOf({ id: "inline-every-element" }).leadingReceipt,
      rowOf({ id: "first-message-bare" }).proofMissing,
      rowOf({ id: "first-message-bare" }).leadingReceipt,
    ]).toEqual([
      { notes: ["the failing control"], sha256: "1".repeat(64) },
      ["screenshot", "link", "annotation"],
      undefined,
    ]);
  });

  it("reads a row with no priorAsk as declaring nothing, never as `none`", () => {
    expect(drafts!.map((draft) => draft.priorAsk)).toEqual(drafts!.map(() => undefined));
  });

  it("names the roster the verb resolved", () => {
    expect([...drafts![0].people.entries()]).toEqual([
      [
        "U0SYN000001",
        {
          deactivated: false,
          firstNameUnique: true,
          handle: "person.one",
          name: "Person One",
          nameUnique: true,
          org: {
            department: "Imaginary Systems",
            orgUnit: "/Staff",
            title: { source: "google-admin", value: "Imaginary Systems Specialist" },
            vantaGroups: ["Synthetic group", "Everyone"],
            vantaStatus: "CURRENT",
          },
          title: "Software Engineer",
        },
      ],
    ]);
  });
});

/**
 * The golden's `block-rich_text_section` row alone, with its draft's `priorAsk` set to the one given — an `undefined`
 * one reads exactly as an absent field does.
 */
function goldenWith({ priorAsk }: { priorAsk: unknown }): unknown {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as {
    items: { id: string; draft: Record<string, unknown> }[];
  };
  const item = golden.items.find((row) => row.id === "block-rich_text_section")!;
  return { ...golden, items: [{ ...item, draft: { ...item.draft, priorAsk } }] };
}

const SHA = "a".repeat(64);
const SHA_TWO = "b".repeat(64);

/** A well-formed earlier ask carrying proof, which each malformed case breaks one field of. */
const PRIOR: Record<string, unknown> = {
  answerCount: 5,
  answers: [
    { text: "no, the pool is sized per tenant", ts: "1789407961.767649", userId: "U0SYN000001" },
    { text: "agree with Person One", ts: "1789408000.000100" },
  ],
  changed: "pool saturation fell from 92% to 40% after the resize",
  kind: "prior",
  ours: { text: "should we raise the pool size?", ts: "1789400000.000200", userId: "U0SYN000002" },
  permalink: "https://acme.slack.com/archives/C0SYN000001/p1789400000000200",
  proof: [
    { bytes: 2048, name: "saturation-before.png", sha256: SHA },
    { bytes: 4096, name: "saturation-after.png", sha256: SHA_TWO },
  ],
  readThroughTs: "1789408000.000100",
};

describe("the console reads a parked draft's priorAsk", () => {
  it("reads an earlier ask with its replies and proof into the exact shape the card draws", () => {
    const drafts = readParkedDrafts(goldenWith({ priorAsk: PRIOR }));
    expect(drafts![0].priorAsk).toEqual({
      answerCount: 5,
      answers: [
        { text: "no, the pool is sized per tenant", ts: "1789407961.767649", userId: "U0SYN000001" },
        { text: "agree with Person One", ts: "1789408000.000100", userId: undefined },
      ],
      changed: "pool saturation fell from 92% to 40% after the resize",
      kind: "prior",
      notAnswered: undefined,
      ours: { text: "should we raise the pool size?", ts: "1789400000.000200", userId: "U0SYN000002" },
      permalink: "https://acme.slack.com/archives/C0SYN000001/p1789400000000200",
      proof: [
        { bytes: 2048, name: "saturation-before.png", sha256: SHA },
        { bytes: 4096, name: "saturation-after.png", sha256: SHA_TWO },
      ],
      readThroughTs: "1789408000.000100",
    });
  });

  it("reads a `not answered` claim with no proof as an empty proof list", () => {
    const { changed: _changed, proof: _proof, ...rest } = PRIOR;
    const drafts = readParkedDrafts(
      goldenWith({ priorAsk: { ...rest, notAnswered: "they answered a different pool" } }),
    );
    expect(drafts![0].priorAsk).toEqual({
      answerCount: 5,
      answers: [
        { text: "no, the pool is sized per tenant", ts: "1789407961.767649", userId: "U0SYN000001" },
        { text: "agree with Person One", ts: "1789408000.000100", userId: undefined },
      ],
      changed: undefined,
      kind: "prior",
      notAnswered: "they answered a different pool",
      ours: { text: "should we raise the pool size?", ts: "1789400000.000200", userId: "U0SYN000002" },
      permalink: "https://acme.slack.com/archives/C0SYN000001/p1789400000000200",
      proof: [],
      readThroughTs: "1789408000.000100",
    });
  });

  it("reads `none` as the declaration that it was never asked before", () => {
    const drafts = readParkedDrafts(goldenWith({ priorAsk: { kind: "none" } }));
    expect(drafts![0].priorAsk).toEqual({ kind: "none" });
  });

  it("reads a row with the field absent as undefined", () => {
    const drafts = readParkedDrafts(goldenWith({ priorAsk: undefined }));
    expect(drafts![0].priorAsk).toBeUndefined();
  });

  const { ours: _ours, ...withoutOurs } = PRIOR;
  const { answerCount: _count, ...withoutCount } = PRIOR;
  const MALFORMED: Readonly<Record<string, unknown>> = {
    "a `prior` missing `ours`": withoutOurs,
    "a `prior` missing `answerCount`": withoutCount,
    "an answerCount below the answers kept": { ...PRIOR, answerCount: 1 },
    "more answers than the register keeps": {
      ...PRIOR,
      answerCount: 4,
      answers: Array.from({ length: 4 }, () => ({ text: "x", ts: "1789407961.767649" })),
    },
    "a non-https permalink": { ...PRIOR, permalink: "http://acme.slack.com/archives/C1/p1" },
    "an answer whose ts is not a Slack ts": { ...PRIOR, answers: [{ text: "x", ts: "yesterday" }] },
    "a proof entry with a bad digest": { ...PRIOR, proof: [{ bytes: 1, name: "a.png", sha256: "nope" }] },
    "a changed that is not text": { ...PRIOR, changed: 7 },
    "a none carrying another field": { kind: "none", changed: "x" },
    "a kind this build does not know": { ...PRIOR, kind: "earlier" },
    "a priorAsk that is not an object": "prior",
  };

  it("reads every malformed priorAsk below as an unreadable register, never a card without its proof", () => {
    expect(Object.keys(MALFORMED).length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(
        Object.entries(MALFORMED).map(([name, priorAsk]) => [name, readParkedDrafts(goldenWith({ priorAsk }))]),
      ),
    ).toEqual(Object.fromEntries(Object.keys(MALFORMED).map((name) => [name, undefined])));
  });
});
