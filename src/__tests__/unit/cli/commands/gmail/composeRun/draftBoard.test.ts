/*
 * `runGmailDraft --board`: it drafts a board row's recorded mail exactly once, lets one of two overlapping presses
 * through, keeps or releases its claim by whether Gmail may have stored the draft, and stores nothing when the
 * sender or the row's state no longer matches the preview. The board fixtures live here because only this file
 * reads a run journal.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { GmailComposeDeps } from "../../../../../../cli/commands/gmail/composeRun.js";
import { runGmailDraft } from "../../../../../../cli/commands/gmail/composeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { MailAskAction } from "../../../../../../handover/askAction.js";
import { ledgerLine } from "../../../../../../handover/ledger.js";
import { mailActionDigest } from "../../../../../../handover/mailActionPreview.js";
import { err, ok } from "../../../../../../lib/result.js";
import { GmailErrors } from "../../../../../../live/gmail/errors.js";
import { GmailWriteRefusedError } from "../../../../../../outbound/gmail/writePrivacy.js";
import { depsFor, draftPlanFixture, recorder, withHome } from "./harness.js";

/** The board row the `--board` cases draft from. */
const BOARD_SLUG = "iso-compliance-mail";

/** The mail that row offers — from the account the fake plan binds, so a clean press drafts it. */
const BOARD_MAIL: MailAskAction = {
  actor: "me",
  form: { bcc: [], body: "the body", cc: [], subject: "a subject", to: ["someone@example.com"] },
  from: "owner@example.test",
  kind: "mail",
  version: 2,
};

/** Write the row's run journal into a home, its open question offering this mail. */
function boardJournal({ home, mail }: { home: string; mail: MailAskAction }): void {
  mkdirSync(join(home, "runs"), { recursive: true });
  const lines = [
    ledgerLine({ event: { atIso: "2026-09-23T03:00:00.000Z", branch: "b", docHash: "h", kind: "started" } }),
    ledgerLine({ event: { action: mail, atIso: "2026-09-23T03:10:00.000Z", kind: "question", question: "Draft it?" } }),
  ];
  writeFileSync(join(home, "runs", `${BOARD_SLUG}.jsonl`), lines.join(""));
}

/** The `--board` request for this home, with the digest the row's mail really has. */
function boardArgs({ home, mail }: { home: string; mail: MailAskAction }): Parameters<typeof runGmailDraft>[0]["args"] {
  return {
    board: { expect: mailActionDigest({ action: mail, slug: BOARD_SLUG }), slug: BOARD_SLUG },
    dryRun: false,
    formSource: undefined,
    home,
    json: false,
    replyToId: undefined,
  };
}

describe("runGmailDraft --board", () => {
  it("drafts the row's recorded mail as the form, once, and refuses a second press of the same mail", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const forms: string[] = [];
        const deps: GmailComposeDeps = {
          ...depsFor({ home, recorded }),
          planDraft: async ({ formJson }) => {
            forms.push(formJson);
            return ok(draftPlanFixture());
          },
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps })).toBe(EXIT_OK);
        expect(forms.map((one) => JSON.parse(one) as unknown)).toEqual([BOARD_MAIL.form]);
        expect(recorded.stored).toHaveLength(1);
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps })).toBe(EXIT_ERROR);
        expect(recorded.stored).toHaveLength(1);
        expect(recorded.diagnostics.join("\n")).toContain("was already drafted as d-created");
      },
    });
  });

  it("plans a row's recorded reply as a reply to that message, and a new mail as no reply at all", async () => {
    await withHome({
      run: async ({ home }) => {
        const reply: MailAskAction = { ...BOARD_MAIL, replyTo: { messageId: "1a10eb75732e663a" } };
        boardJournal({ home, mail: reply });
        const targets: (string | undefined)[] = [];
        const deps: GmailComposeDeps = {
          ...depsFor({ home, recorded: recorder() }),
          planDraft: async ({ replyToId }) => {
            targets.push(replyToId);
            return ok(draftPlanFixture());
          },
        };
        expect(await runGmailDraft({ args: { ...boardArgs({ home, mail: reply }), dryRun: true }, deps })).toBe(
          EXIT_OK,
        );
        boardJournal({ home, mail: BOARD_MAIL });
        const fresh = { ...boardArgs({ home, mail: BOARD_MAIL }), dryRun: true };
        expect(await runGmailDraft({ args: fresh, deps })).toBe(EXIT_OK);
        expect(targets).toEqual(["1a10eb75732e663a", undefined]);
      },
    });
  });

  it("stores nothing when the bound account is not the sender the preview drew", async () => {
    await withHome({
      run: async ({ home }) => {
        const mail = { ...BOARD_MAIL, from: "someone-else@example.test" };
        boardJournal({ home, mail });
        const recorded = recorder();
        const code = await runGmailDraft({ args: boardArgs({ home, mail }), deps: depsFor({ home, recorded }) });
        expect(code).toBe(EXIT_ERROR);
        expect(recorded.stored).toEqual([]);
        expect(recorded.diagnostics.join("\n")).toContain("the previewed mail is from someone-else@example.test");
      },
    });
  });

  it("lets exactly one of two OVERLAPPING presses reach Gmail, refusing the other while the first is in flight", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        let finish: () => void = () => undefined;
        const gmailAnswers = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const base = depsFor({ home, recorded });
        const deps: GmailComposeDeps = {
          ...base,
          applyDraft: async (args) => {
            await gmailAnswers;
            return base.applyDraft(args);
          },
        };
        const first = runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps });
        const second = runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps });
        expect(await second).toBe(EXIT_ERROR);
        finish();
        expect(await first).toBe(EXIT_OK);
        expect(recorded.stored).toHaveLength(1);
        expect(recorded.diagnostics.join("\n")).toContain("is being drafted right now by process");
      },
    });
  });

  it("releases the claim on a failure that stored nothing for certain, so the next press drafts", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const base = depsFor({ home, recorded });
        const failing: GmailComposeDeps = {
          ...base,
          applyDraft: async () => err(GmailErrors.invalidAddress({ message: "gmail refused the address" })),
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: failing })).toBe(EXIT_ERROR);
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: base })).toBe(EXIT_OK);
        expect(recorded.stored).toHaveLength(1);
      },
    });
  });

  it("KEEPS the claim on an API failure, which may have come after Gmail stored the draft", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const base = depsFor({ home, recorded });
        const lost: GmailComposeDeps = {
          ...base,
          applyDraft: async () => err(GmailErrors.apiFailed({ message: "ECONNRESET" })),
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: lost })).toBe(EXIT_ERROR);
        const next: GmailComposeDeps = { ...base, pidAlive: () => false };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: next })).toBe(EXIT_ERROR);
        expect(recorded.stored).toEqual([]);
        expect(recorded.diagnostics.join("\n")).toContain("ended without a receipt");
      },
    });
  });

  it("RELEASES the claim when the write guard refused before the wire, so the next press drafts", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const base = depsFor({ home, recorded });
        const refusal = new GmailWriteRefusedError("gmail drafts.create refused before sending");
        const refused: GmailComposeDeps = {
          ...base,
          applyDraft: async () => err(GmailErrors.apiFailed({ cause: { cause: refusal }, message: refusal.message })),
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: refused })).toBe(EXIT_ERROR);
        expect(recorded.stored).toEqual([]);
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: base })).toBe(EXIT_OK);
        expect(recorded.stored.length).toBe(1);
      },
    });
  });

  it("KEEPS the claim on a reply Gmail filed outside its thread, since that draft now exists", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const base = depsFor({ home, recorded });
        const detached: GmailComposeDeps = {
          ...base,
          applyDraft: async () =>
            err(GmailErrors.replyDetached({ draftId: "d-stray", expected: "t-9", threadId: "t-new" })),
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: detached })).toBe(EXIT_ERROR);
        const next: GmailComposeDeps = { ...base, pidAlive: () => false };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps: next })).toBe(EXIT_ERROR);
        expect(recorded.stored).toEqual([]);
        expect(recorded.diagnostics.join("\n")).toContain("Gmail stored draft d-stray in thread t-new");
        expect(recorded.diagnostics.join("\n")).toContain("ended without a receipt");
      },
    });
  });

  it("asks Gmail for exactly one attempt, so a lost response is never retried into a second draft", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const attempts: boolean[] = [];
        const base = depsFor({ home, recorded });
        const deps: GmailComposeDeps = {
          ...base,
          applyDraft: async (args) => {
            attempts.push(args.once);
            return base.applyDraft(args);
          },
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps })).toBe(EXIT_OK);
        expect(attempts).toEqual([true]);
      },
    });
  });

  it("stores nothing when the row is answered while the draft is being planned", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const base = depsFor({ home, recorded });
        const deps: GmailComposeDeps = {
          ...base,
          planDraft: async (args) => {
            appendFileSync(
              join(home, "runs", `${BOARD_SLUG}.jsonl`),
              ledgerLine({ event: { answer: "no", atIso: "2026-09-23T03:20:00.000Z", kind: "answered" } }),
            );
            return base.planDraft(args);
          },
        };
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps })).toBe(EXIT_ERROR);
        expect(recorded.stored).toEqual([]);
        expect(recorded.diagnostics.join("\n")).toContain("is not waiting on the owner");
      },
    });
  });

  it("stores nothing on a dry run, and writes no receipt a later press would trip on", async () => {
    await withHome({
      run: async ({ home }) => {
        boardJournal({ home, mail: BOARD_MAIL });
        const recorded = recorder();
        const deps = depsFor({ home, recorded });
        const dry = { ...boardArgs({ home, mail: BOARD_MAIL }), dryRun: true };
        expect(await runGmailDraft({ args: dry, deps })).toBe(EXIT_OK);
        expect(recorded.stored).toEqual([]);
        expect(await runGmailDraft({ args: boardArgs({ home, mail: BOARD_MAIL }), deps })).toBe(EXIT_OK);
        expect(recorded.stored).toHaveLength(1);
      },
    });
  });
});
