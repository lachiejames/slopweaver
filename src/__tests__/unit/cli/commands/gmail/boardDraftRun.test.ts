/**
 * Unit: the board half of `gmail draft` — where the form comes from, and the claim a store runs under. The
 * store step is a plain callback, so no mailbox and no door are involved.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boardDraftsDir } from "../../../../../cli/commands/gmail/boardDraft.js";
import { draftSource, draftUnderClaim } from "../../../../../cli/commands/gmail/boardDraftRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { MailAskAction } from "../../../../../handover/askAction.js";
import { ledgerLine } from "../../../../../handover/ledger.js";
import { mailActionDigest } from "../../../../../handover/mailActionPreview.js";

const SLUG = "mail-row";
const MAIL: MailAskAction = {
  actor: "me",
  form: { bcc: [], body: "the body", cc: [], subject: "a subject", to: ["someone@example.com"] },
  from: "owner@example.test",
  kind: "mail",
  version: 2,
};
const DIGEST = mailActionDigest({ action: MAIL, slug: SLUG });

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "board-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the row's journal: started, then a question offering the mail, then optionally an answer. */
function journal({ answered }: { answered: boolean }): void {
  mkdirSync(join(home, "runs"), { recursive: true });
  const lines = [
    ledgerLine({ event: { atIso: "2026-09-23T03:00:00.000Z", branch: "b", docHash: "h", kind: "started" } }),
    ledgerLine({ event: { action: MAIL, atIso: "2026-09-23T03:10:00.000Z", kind: "question", question: "Draft it?" } }),
  ];
  if (answered) {
    lines.push(ledgerLine({ event: { answer: "no", atIso: "2026-09-23T03:20:00.000Z", kind: "answered" } }));
  }
  writeFileSync(join(home, "runs", `${SLUG}.jsonl`), lines.join(""));
}

const claimFile = (): string => join(boardDraftsDir({ home }), `${SLUG}.${DIGEST}.claim`);

describe("draftSource", () => {
  it("takes --form's text as the form, with no board row", async () => {
    const args = { board: undefined, dryRun: false, formSource: '{"to":[]}', home, json: false, replyToId: undefined };
    const source = await draftSource({ args, deps: { readStdin: async () => "stdin" }, home });
    expect(source._unsafeUnwrap()).toStrictEqual({ board: undefined, formJson: '{"to":[]}', replyToId: undefined });
  });

  it("carries --reply-to through for a --form draft", async () => {
    const args = {
      board: undefined,
      dryRun: false,
      formSource: "{}",
      home,
      json: false,
      replyToId: "1a10eb75732e663a",
    };
    const source = await draftSource({ args, deps: { readStdin: async () => "stdin" }, home });
    expect(source._unsafeUnwrap().replyToId).toBe("1a10eb75732e663a");
  });

  it("takes a board row's reply target off the row, never off the invocation", async () => {
    const reply: MailAskAction = { ...MAIL, replyTo: { messageId: "1a10eb75732e663a" } };
    mkdirSync(join(home, "runs"), { recursive: true });
    const lines = [
      ledgerLine({ event: { atIso: "2026-09-23T03:00:00.000Z", branch: "b", docHash: "h", kind: "started" } }),
      ledgerLine({ event: { action: reply, atIso: "2026-09-23T03:10:00.000Z", kind: "question", question: "Reply?" } }),
    ];
    writeFileSync(join(home, "runs", `${SLUG}.jsonl`), lines.join(""));
    const args = {
      board: { expect: mailActionDigest({ action: reply, slug: SLUG }), slug: SLUG },
      dryRun: false,
      formSource: undefined,
      home,
      json: false,
      replyToId: undefined,
    };
    const source = await draftSource({ args, deps: { readStdin: async () => "stdin" }, home });
    expect(source._unsafeUnwrap().replyToId).toBe("1a10eb75732e663a");
  });

  it("takes the board row's recorded mail as the form", async () => {
    journal({ answered: false });
    const args = {
      board: { expect: DIGEST, slug: SLUG },
      dryRun: false,
      formSource: undefined,
      home,
      json: false,
      replyToId: undefined,
    };
    const source = await draftSource({ args, deps: { readStdin: async () => "stdin" }, home });
    expect(JSON.parse(source._unsafeUnwrap().formJson)).toEqual(MAIL.form);
    expect(source._unsafeUnwrap().replyToId).toBe(undefined);
  });
});

describe("draftUnderClaim", () => {
  const board = { action: MAIL, digest: DIGEST, formJson: JSON.stringify(MAIL.form), slug: SLUG };

  it("runs the store under the claim and releases it after", async () => {
    journal({ answered: false });
    const heldDuringStore: boolean[] = [];
    const code = await draftUnderClaim({
      board,
      deps: { pidAlive: () => true, writeDiagnostic: () => undefined },
      home,
      store: async () => {
        heldDuringStore.push(existsSync(claimFile()));
        return { exit: EXIT_OK, keepClaim: false };
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(heldDuringStore).toEqual([true]);
    expect(existsSync(claimFile())).toBe(false);
  });

  it("never runs the store for a row no longer waiting, and releases the claim it took", async () => {
    journal({ answered: true });
    const diagnostics: string[] = [];
    let stores = 0;
    const code = await draftUnderClaim({
      board,
      deps: { pidAlive: () => true, writeDiagnostic: (line) => diagnostics.push(line) },
      home,
      store: async () => {
        stores += 1;
        return { exit: EXIT_OK, keepClaim: false };
      },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(stores).toBe(0);
    expect(diagnostics.join("\n")).toContain("is not waiting on the owner");
    expect(existsSync(claimFile())).toBe(false);
  });

  it("keeps the claim when the store says the draft may exist without a receipt", async () => {
    journal({ answered: false });
    await draftUnderClaim({
      board,
      deps: { pidAlive: () => true, writeDiagnostic: () => undefined },
      home,
      store: async () => ({ exit: EXIT_ERROR, keepClaim: true }),
    });
    expect(existsSync(claimFile())).toBe(true);
  });
});
