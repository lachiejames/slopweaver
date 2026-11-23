/**
 * What a parking seat's checkpoint copies of its unsent words — the open question's drafted action and its row's
 * held Slack drafts — over a register parsed from lines built inline.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slackDraftLogPath } from "../../../admit/slackDraftStore.js";
import type { AskAction } from "../../../handover/askAction.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { draftsMissingFrom, parkedDraftsOf } from "../../../handover/parkDrafts.js";
import { readParkedDrafts } from "../../../handover/parkDraftsRead.js";
import { PARK_DRAFT_MAX_CHARS, type ParkedDraft } from "../../../handover/parkedEvent.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  slackDraftEventLine,
} from "../../../outbound/slack/draftRegister.js";

const SLUG = "a-doc";
const STARTED: RunEvent = { atIso: "2026-10-09T11:00:00.000Z", branch: SLUG, docHash: "h", kind: "started" };

const SLACK_ACTION: AskAction = {
  actor: "me",
  body: "<@U01ARI> the switch-over is ready for review.",
  destinations: [
    { channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "the channel sees it" },
  ],
  followUps: ["one approval and it lands tonight."],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

/** A question journalled with the action named. */
function asked({ action }: { action: AskAction }): RunEvent {
  return { action, atIso: "2026-10-09T11:30:00.000Z", kind: "question", question: "Post it?" };
}

/** A held Slack draft on the row named, with the plain text named. */
function draftLine({ id, row, text }: { id: string; row: string | undefined; text: string }): string {
  const base = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0ISO",
    channelName: "iso-27001",
    form: '{"kind":"one-card","lines":[]}',
    id,
    mentions: [],
    payload: { form: "plain" as const, text, unfurl_links: true, unfurl_media: true },
    ...(row === undefined ? {} : { row }),
    shape: "top-level" as const,
    tsIso: "2026-10-09T11:40:00.000Z",
    why: "a reply the owner has not sent",
  };
  const draft = { ...base, digest: parkedDraftDigest({ draft: base }) } as ParkedSlackDraft;
  return slackDraftEventLine({ event: { draft, id, kind: "parked", tsIso: draft.tsIso } });
}

describe("parkedDraftsOf", () => {
  it("copies the open question's every message, then each held draft on this row only", () => {
    const log = parseSlackDraftLog({
      lines: [
        draftLine({ id: "sd-11111111", row: SLUG, text: "mine" }),
        draftLine({ id: "sd-22222222", row: "another-row", text: "not mine" }),
        draftLine({ id: "sd-33333333", row: undefined, text: "no row" }),
      ],
    });
    const drafts = unwrap(parkedDraftsOf({ events: [STARTED, asked({ action: SLACK_ACTION })], log, slug: SLUG }));
    expect(drafts).toEqual([
      {
        kind: "ask-action",
        text: "<@U01ARI> the switch-over is ready for review.\n\none approval and it lands tonight.",
      },
      { id: "sd-11111111", kind: "slack-draft", text: "mine" },
    ]);
  });

  it("copies a mail action as its subject and body", () => {
    const mail: AskAction = {
      actor: "me",
      form: { bcc: [], body: "Hi Ada,\n\nAttached.", cc: [], subject: "The audit pack", to: ["ada@example.com"] },
      from: "owner@example.com",
      kind: "mail",
      version: 2,
    };
    const drafts = unwrap(
      parkedDraftsOf({
        events: [STARTED, asked({ action: mail })],
        log: parseSlackDraftLog({ lines: [] }),
        slug: SLUG,
      }),
    );
    expect(drafts).toEqual([{ kind: "ask-action", text: "Subject: The audit pack\n\nHi Ada,\n\nAttached." }]);
  });

  it("holds nothing when no question is open and no draft names the row", () => {
    expect(unwrap(parkedDraftsOf({ events: [STARTED], log: parseSlackDraftLog({ lines: [] }), slug: SLUG }))).toEqual(
      [],
    );
  });

  it("cuts an oversized draft at the cap, keeping its start", () => {
    const log = parseSlackDraftLog({
      lines: [draftLine({ id: "sd-44444444", row: SLUG, text: `START${"x".repeat(PARK_DRAFT_MAX_CHARS)}` })],
    });
    const [only] = unwrap(parkedDraftsOf({ events: [STARTED], log, slug: SLUG }));
    expect(only!.text).toHaveLength(PARK_DRAFT_MAX_CHARS);
    expect(only!.text.startsWith("START")).toBe(true);
  });

  it("refuses a register with a line it could not read, since that line may be this row's draft", () => {
    const log = parseSlackDraftLog({ lines: ["{not json"] });
    expect(log.skipped.length).toBe(1);
    expect(unwrapErr(parkedDraftsOf({ events: [STARTED], log, slug: SLUG }))).toEqual([
      "the Slack draft register has 1 line(s) this build could not read (1), so this row's held drafts cannot be called complete",
    ]);
  });
});

describe("draftsMissingFrom", () => {
  const slack: ParkedDraft = { id: "sd-1", kind: "slack-draft", text: "a reply" };
  const carded: ParkedDraft = { kind: "ask-action", text: "the card message" };

  it("names every held draft when the checkpoint is older than the field", () => {
    expect(draftsMissingFrom({ held: [carded, slack], recorded: undefined })).toEqual([carded, slack]);
  });

  it("names a held Slack draft the checkpoint lacks by id, even when its text matches one it has", () => {
    const sameText: ParkedDraft = { id: "sd-2", kind: "slack-draft", text: "a reply" };
    expect(draftsMissingFrom({ held: [slack, sameText], recorded: [slack] })).toEqual([sameText]);
  });

  it("names a held Slack draft whose text changed since the park, though its id matches", () => {
    const rewritten: ParkedDraft = { id: "sd-1", kind: "slack-draft", text: "a reply, rewritten" };
    expect(draftsMissingFrom({ held: [rewritten], recorded: [slack] })).toEqual([rewritten]);
  });

  it("names an open question whose message changed since the park", () => {
    const edited: ParkedDraft = { kind: "ask-action", text: "the card message, edited" };
    expect(draftsMissingFrom({ held: [edited], recorded: [carded] })).toEqual([edited]);
  });

  it("names nothing when the checkpoint carries every held draft, or nothing is held", () => {
    expect(draftsMissingFrom({ held: [carded, slack], recorded: [slack, carded] })).toEqual([]);
    expect(draftsMissingFrom({ held: [], recorded: undefined })).toEqual([]);
  });
});

describe("readParkedDrafts", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "park-drafts-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a home with no register as holding no drafts", () => {
    expect(unwrap(readParkedDrafts({ events: [STARTED], home, slug: SLUG }))).toEqual([]);
  });

  it("reads this row's held draft back off the register on disk", () => {
    mkdirSync(dirname(slackDraftLogPath({ home })), { recursive: true });
    writeFileSync(slackDraftLogPath({ home }), `${draftLine({ id: "sd-11111111", row: SLUG, text: "mine" })}\n`);
    expect(unwrap(readParkedDrafts({ events: [STARTED], home, slug: SLUG }))).toEqual([
      { id: "sd-11111111", kind: "slack-draft", text: "mine" },
    ]);
  });
});
