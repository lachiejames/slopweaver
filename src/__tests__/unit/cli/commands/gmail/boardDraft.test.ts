/**
 * Unit: `gmail draft --board` over a throwaway home — the board row's mail is the form, a changed mail is
 * refused, and a second press of the same mail stores nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boardDraftSource,
  boardMailAction,
  boardSenderMismatch,
  draftedBefore,
  recordDrafted,
} from "../../../../../cli/commands/gmail/boardDraft.js";
import { parseGmailDraftArgs } from "../../../../../cli/commands/gmail/composeCore.js";
import { readComposeForm } from "../../../../../cli/commands/gmail/composeDeps.js";
import type { MailAskAction } from "../../../../../handover/askAction.js";
import { ledgerLine, type RunEvent } from "../../../../../handover/ledger.js";
import { mailActionDigest } from "../../../../../handover/mailActionPreview.js";
import { unwrap } from "../../../../../lib/result.js";

const SLUG = "iso-compliance-mail";

const MAIL: MailAskAction = {
  actor: "me",
  form: { bcc: [], body: "Hi both,\n\nTen items.", cc: [], subject: "Ten items", to: ["felix@vendor.test"] },
  from: "ada@example.test",
  kind: "mail",
  version: 2,
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "board-draft-"));
  mkdirSync(join(home, "runs"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write a run journal whose open question carries this action. */
function journal({ events }: { events: readonly RunEvent[] }): void {
  writeFileSync(join(home, "runs", `${SLUG}.jsonl`), events.map((event) => ledgerLine({ event })).join(""));
}

const STARTED: RunEvent = { atIso: "2026-09-23T03:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
const ASKED: RunEvent = {
  action: MAIL,
  atIso: "2026-09-23T03:10:00.000Z",
  kind: "question",
  question: "Create this mail as a Gmail draft?",
};

describe("boardMailAction", () => {
  it("answers the row's mail when the digest is the one previewed", () => {
    journal({ events: [STARTED, ASKED] });
    const previewed = mailActionDigest({ action: MAIL, slug: SLUG });
    expect(unwrap(boardMailAction({ expect: previewed, home, slug: SLUG }))).toEqual(MAIL);
  });

  it("refuses when the row now holds a different mail than the preview", () => {
    journal({ events: [STARTED, ASKED] });
    const read = boardMailAction({ expect: "0000000000000000", home, slug: SLUG });
    expect(read._unsafeUnwrapErr().code).toBe("DIGEST_MOVED");
  });

  it("refuses a row whose ask was answered", () => {
    const answered: RunEvent = { answer: "done", atIso: "2026-09-23T03:20:00.000Z", kind: "answered" };
    journal({ events: [STARTED, ASKED, answered] });
    const read = boardMailAction({ expect: "0000000000000000", home, slug: SLUG });
    expect(read._unsafeUnwrapErr().code).toBe("NOT_WAITING");
  });

  it("refuses a row whose open ask offers no mail", () => {
    journal({ events: [STARTED, { atIso: ASKED.atIso, kind: "question", question: "Which way?" }] });
    const read = boardMailAction({ expect: "0000000000000000", home, slug: SLUG });
    expect(read._unsafeUnwrapErr().code).toBe("NO_MAIL_ACTION");
  });
});

describe("the draft receipt", () => {
  it("is absent until a draft is recorded, then names it", () => {
    expect(draftedBefore({ digest: "3f9a2c7e1b4d5006", home, slug: SLUG })).toBe(undefined);
    unwrap(
      recordDrafted({
        atIso: "2026-09-23T03:30:00.000Z",
        digest: "3f9a2c7e1b4d5006",
        draftId: "r-1",
        home,
        slug: SLUG,
      }),
    );
    expect(draftedBefore({ digest: "3f9a2c7e1b4d5006", home, slug: SLUG })).toBe("r-1");
    expect(draftedBefore({ digest: "1111111111111111", home, slug: SLUG })).toBe(undefined);
  });
});

describe("parseGmailDraftArgs --board", () => {
  it("reads the board pair", () => {
    const args = unwrap(parseGmailDraftArgs({ rest: ["--board", SLUG, "--expect", "3f9a2c7e1b4d5006"] }));
    expect(args.board).toEqual({ expect: "3f9a2c7e1b4d5006", slug: SLUG });
    expect(args.formSource).toBe(undefined);
  });

  it("refuses --board beside --form, and --board with no --expect", () => {
    const both = parseGmailDraftArgs({ rest: ["--board", SLUG, "--expect", "3f9a2c7e1b4d5006", "--form", "{}"] });
    expect(both._unsafeUnwrapErr().code).toBe("BOARD_ARGS_INVALID");
    expect(both._unsafeUnwrapErr().message).toContain("--board and --form both name the message");
    const bare = parseGmailDraftArgs({ rest: ["--board", SLUG] });
    expect(bare._unsafeUnwrapErr().code).toBe("BOARD_ARGS_INVALID");
    expect(bare._unsafeUnwrapErr().message).toContain("--board needs --expect <digest>");
  });

  it("refuses --reply-to beside --board, since the row's own recorded target is the only one drafted", () => {
    const read = parseGmailDraftArgs({
      rest: ["--board", SLUG, "--expect", "3f9a2c7e1b4d5006", "--reply-to", "1a10eb75732e663a"],
    });
    expect(read._unsafeUnwrapErr().code).toBe("BOARD_ARGS_INVALID");
    expect(read._unsafeUnwrapErr().message).toContain("a reply only when the row recorded one");
  });

  it("refuses a digest that is not sixteen hex characters", () => {
    const read = parseGmailDraftArgs({ rest: ["--board", SLUG, "--expect", "NOTHEX"] });
    expect(read._unsafeUnwrapErr().code).toBe("BOARD_ARGS_INVALID");
    expect(read._unsafeUnwrapErr().message).toContain("is not a mail digest");
  });
});

describe("boardDraftSource", () => {
  it("hands the row's form over as the JSON the plan reads", () => {
    journal({ events: [STARTED, ASKED] });
    const previewed = mailActionDigest({ action: MAIL, slug: SLUG });
    const source = unwrap(boardDraftSource({ expect: previewed, home, slug: SLUG }));
    expect(JSON.parse(source.formJson)).toEqual(MAIL.form);
    expect(source.digest).toBe(previewed);
  });

  it("refuses a mail an earlier press already drafted, naming that draft", () => {
    journal({ events: [STARTED, ASKED] });
    const previewed = mailActionDigest({ action: MAIL, slug: SLUG });
    unwrap(recordDrafted({ atIso: "2026-09-23T03:30:00.000Z", digest: previewed, draftId: "r-7", home, slug: SLUG }));
    const refused = boardDraftSource({ expect: previewed, home, slug: SLUG })._unsafeUnwrapErr();
    expect(refused.code).toBe("ALREADY_DRAFTED");
    expect(refused.message).toContain("already drafted as r-7");
  });
});

describe("boardSenderMismatch", () => {
  it("accepts the same address in another case", () => {
    expect(boardSenderMismatch({ bound: "Ada@Example.test", recorded: "ada@example.test" })).toBe(undefined);
  });

  it("refuses a different mailbox, naming both", () => {
    const refused = boardSenderMismatch({ bound: "other@example.test", recorded: "ada@example.test" })!;
    expect(refused.code).toBe("SENDER_MISMATCH");
    expect(refused.message).toContain("from ada@example.test, but the bound Gmail account is other@example.test");
  });
});

describe("readComposeForm", () => {
  it("reads a well-formed form", () => {
    expect(unwrap(readComposeForm({ json: JSON.stringify(MAIL.form) }))).toEqual(MAIL.form);
  });

  it("refuses an unknown key with every problem listed", () => {
    const refused = readComposeForm({
      json: '{"to":["a@example.test"],"cc":[],"bcc":[],"subject":"s","body":"b","too":[]}',
    });
    expect(refused._unsafeUnwrapErr().message).toContain("the compose form was refused");
  });
});
