/**
 * `spend forward`'s shell against a plain fake mailbox and a fake draft call: one draft per receipt across runs, a dry
 * run that stores nothing, and an API failure that keeps its claim. `home` is a real `mkdtempSync` directory because
 * the draft routes through `throughDoor`, which journals under it, and the claim lives there. Values are invented.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { draftLink } from "../../../../../cli/commands/spend/forwardReport.js";
import { runSpendForward, type SpendForwardDeps } from "../../../../../cli/commands/spend/forwardRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { GmailDraft } from "../../../../../live/gmail/api.js";
import { type GmailError, GmailErrors } from "../../../../../live/gmail/errors.js";
import type { ParsedGmailMessage } from "../../../../../live/gmail/parse.js";
import { SpendMerchantErrors } from "../../../../../spend/merchants/errors.js";
import { SpendForwardErrors } from "../../../../../spend/tasks/forwardErrors.js";
import { type FullMessage, REMINDER_QUERY, type TasksMailbox } from "../../../../../spend/tasks/read.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { FIXTURE_MERCHANTS } from "../../../spend/merchantFixture.js";

/** An invented reminder naming one Anthropic and one OpenAI charge. */
const REMINDER_BODY = [
  "You have 2 tasks to complete",
  "2 card expenses to submit",
  "Transaction date 4 Mar",
  "Anthropic",
  "120.00 AUD",
  "Transaction date 4 Mar",
  "OpenAI",
  "9.99 USD",
  "View incomplete expenses",
].join("\n");

const ANTHROPIC_QUERY =
  '(from:(anthropic.com) OR "anthropic.com") has:attachment -to:receipts@expenses.airwallex.com ' +
  "after:2027/03/02 before:2027/03/19";
const OPENAI_QUERY =
  '(from:(openai.com) OR "openai.com") has:attachment -to:receipts@expenses.airwallex.com ' +
  "after:2027/03/02 before:2027/03/19";

const PULLED = "/home/live/gmail/attachments/r1/2-Receipt-0001.pdf";
const PDF = new Uint8Array(Buffer.from("%PDF-1.7\ninvented\n", "latin1"));

/** A parsed message with only what the verb reads filled in. */
function parsed({ id, body, sentAtIso }: { id: string; body: string; sentAtIso: string }): ParsedGmailMessage {
  return {
    attachments: [],
    body,
    bodyFormat: "text",
    cc: [],
    from: "Vendor Billing <billing@mail.anthropic.com>",
    htmlLinks: [],
    id,
    labelIds: ["INBOX"],
    sentAtIso,
    snippet: undefined,
    subject: "Your receipt #0001",
    threadId: id,
    to: ["owner@example.test"],
  };
}

/** A fake mailbox holding one reminder and, unless `receipt` is false, the Anthropic receipt with its PDF. */
function mailbox({ reminder = true, receipt = true }: { reminder?: boolean; receipt?: boolean } = {}): TasksMailbox {
  const messages: Record<string, FullMessage> = {
    r1: {
      message: parsed({ body: "Amount paid A$120.00", id: "r1", sentAtIso: "2027-03-04T02:00:00.000Z" }),
      parts: [
        { attachmentId: "t1", filename: "Receipt-0001.pdf", mimeType: "application/pdf", partId: "2", sizeBytes: 18 },
      ],
    },
    top: { message: parsed({ body: REMINDER_BODY, id: "top", sentAtIso: "2027-03-06T07:30:00.000Z" }), parts: [] },
  };
  const searches: Record<string, readonly { id: string; sentAtIso: string }[]> = {};
  if (reminder) {
    searches[REMINDER_QUERY] = [{ id: "top", sentAtIso: "2027-03-06T07:30:00.000Z" }];
  }
  if (receipt) {
    searches[ANTHROPIC_QUERY] = [{ id: "r1", sentAtIso: "2027-03-04T02:00:00.000Z" }];
  }
  return {
    account: "owner@example.test",
    readFull: async ({ id }) => {
      const message = messages[id];
      if (message === undefined) {
        return err({ message: `no message ${id}` });
      }
      return ok(message);
    },
    savePart: async () => ok(PULLED),
    search: async ({ query }) => {
      const hits = searches[query];
      if (hits === undefined) {
        return ok([]);
      }
      return ok(hits);
    },
  };
}

/** The deps over a fake draft call answering `answer`, and what each edge received. */
function harness({
  box = mailbox(),
  answer = ok({ id: "d-1", message: { id: "m-1", threadId: "t-1" } }),
  alive = true,
  doorLedger = memoryDoorLedger().port,
}: {
  box?: TasksMailbox;
  answer?: Result<GmailDraft, GmailError>;
  alive?: boolean;
  doorLedger?: DoorLedgerPort;
}) {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const drafted: { raw: string; once: boolean | undefined }[] = [];
  const bound: string[] = [];
  const deps: SpendForwardDeps = {
    defaultHome: () => "/home/unused",
    doorLedger,
    drafts: ({ home }) => {
      bound.push(home);
      return ok({
        createDraft: async ({ raw, once }) => {
          drafted.push({ once, raw });
          return answer;
        },
      });
    },
    mailbox: () => ok(box),
    nowIso: () => "2027-03-06T08:00:00.000Z",
    pid: 4242,
    pidAlive: () => alive,
    readBytes: ({ path }) => {
      if (path !== PULLED) {
        return err({ message: `no file ${path}` });
      }
      return ok(PDF);
    },
    readMerchants: async () => ok({ merchants: FIXTURE_MERCHANTS, schemaVersion: 1 }),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { bound, deps, diagnostics, drafted, out };
}

const HEADER = "spend forward: owner@example.test — drafts only, to receipts@expenses.airwallex.com; nothing is sent";
const OPENAI_LINE =
  "- OpenAI 9.99 USD (2027-03-04): nothing to forward — no matching invoice mail in owner@example.test " +
  `(searched: ${OPENAI_QUERY})`;

const homes: string[] = [];

/** A throwaway home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-spend-forward-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("runSpendForward", () => {
  it("drafts the matched receipt's forward once, and a second run names that draft instead of another", async () => {
    const home = freshHome();
    const first = harness({});
    expect(await runSpendForward({ deps: first.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(first.out).toEqual([
      [
        HEADER,
        "- Anthropic 120.00 AUD (2027-03-04): forward drafted to receipts@expenses.airwallex.com — draft d-1 " +
          "https://mail.google.com/mail/u/0/#drafts?compose=m-1 — NOT sent: they press Send",
        OPENAI_LINE,
      ].join("\n"),
    ]);
    expect(first.drafted.map((call) => call.once)).toEqual([true]);
    const message = Buffer.from(first.drafted[0]!.raw, "base64url").toString("utf8");
    expect(message.split("\r\n").slice(0, 3)).toEqual([
      "From: owner@example.test",
      "To: receipts@expenses.airwallex.com",
      "Subject: Your receipt #0001",
    ]);
    const second = harness({});
    expect(await runSpendForward({ deps: second.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(second.out[0]!.split("\n")[1]).toBe(
      "- Anthropic 120.00 AUD (2027-03-04): drafted by an earlier run — draft d-1 " +
        "https://mail.google.com/mail/u/0/#drafts?compose=m-1 (not re-checked: sent or deleted since reads the same)",
    );
    expect(second.drafted).toEqual([]);
  });

  it("stores nothing on a dry run and binds no draft call", async () => {
    const home = freshHome();
    const run = harness({});
    expect(await runSpendForward({ deps: run.deps, rest: ["--dry-run", "--home", home] })).toBe(EXIT_OK);
    expect(run.out).toEqual([
      [
        HEADER,
        "- Anthropic 120.00 AUD (2027-03-04): would draft a forward of https://mail.google.com/mail/u/0/#all/r1 with " +
          "1 file(s) to receipts@expenses.airwallex.com (dry run: nothing stored)",
        OPENAI_LINE,
      ].join("\n"),
    ]);
    expect(run.bound).toEqual([]);
    expect(run.drafted).toEqual([]);
  });

  it("exits 3 when no reminder is in the inbox, and when no expense has a receipt to forward", async () => {
    const home = freshHome();
    const none = harness({ box: mailbox({ reminder: false }) });
    expect(await runSpendForward({ deps: none.deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(none.out).toEqual([
      "spend forward: no Airwallex task reminder in the inbox of owner@example.test — nothing to do",
    ]);
    const unmatched = harness({ box: mailbox({ receipt: false }) });
    expect(await runSpendForward({ deps: unmatched.deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(unmatched.drafted).toEqual([]);
  });

  it("keeps the claim when Gmail fails, so the next run reports it rather than drafting twice", async () => {
    const home = freshHome();
    const failing = harness({ answer: err(GmailErrors.apiFailed({ message: "socket hang up" })) });
    expect(await runSpendForward({ deps: failing.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(failing.drafted.length).toBe(1);
    expect(readdirSync(stateHomePaths({ home }).spendForwards)).toEqual(["r1.json"]);
    const inFlight = harness({ alive: true });
    expect(await runSpendForward({ deps: inFlight.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(inFlight.out[0]!.split("\n")[1]).toBe(
      `- Anthropic 120.00 AUD (2027-03-04): NOT drafted — ${SpendForwardErrors.inFlight({ pid: 4242, receiptId: "r1" }).message}`,
    );
    const abandoned = harness({ alive: false });
    expect(await runSpendForward({ deps: abandoned.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    const path = join(stateHomePaths({ home }).spendForwards, "r1.json");
    expect(abandoned.out[0]!.split("\n")[1]).toBe(
      `- Anthropic 120.00 AUD (2027-03-04): NOT drafted — ${SpendForwardErrors.claimAbandoned({ path, pid: 4242 }).message}`,
    );
    expect([...inFlight.drafted, ...abandoned.drafted]).toEqual([]);
  });

  it("refuses before binding the mailbox or claiming anything when the register cannot be read", async () => {
    const home = freshHome();
    const refusal = SpendMerchantErrors.invalid({ issues: ["duplicate slug acme"] });
    const run = harness({});
    let bound = 0;
    const deps: SpendForwardDeps = {
      ...run.deps,
      mailbox: () => {
        bound += 1;
        return ok(mailbox());
      },
      readMerchants: async () => err(refusal),
    };
    expect(await runSpendForward({ deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual([`spend forward: ${refusal.message}`]);
    expect([bound, run.bound.length, run.drafted.length]).toEqual([0, 0, 0]);
  });

  it("links a draft only when Gmail returned its message id", () => {
    expect(draftLink({ messageId: "m-1" })).toBe("https://mail.google.com/mail/u/0/#drafts?compose=m-1");
    expect(draftLink({ messageId: undefined })).toBeUndefined();
  });

  it("releases the claim when the draft is refused before it reaches Gmail", async () => {
    const home = freshHome();
    const refused = harness({ answer: err(GmailErrors.composeFormRefused({ problems: ["to: invented refusal"] })) });
    expect(await runSpendForward({ deps: refused.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(readdirSync(stateHomePaths({ home }).spendForwards)).toEqual([]);
  });

  it("drafts nothing, releases the claim and says the store was the reason when the door cannot record", async () => {
    const home = freshHome();
    const down = harness({ doorLedger: unreachableDoorLedger() });
    expect(await runSpendForward({ deps: down.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(down.drafted).toEqual([]);
    expect(down.out[0]!).toContain("the door could not record the draft, so it was not stored");
    expect(readdirSync(stateHomePaths({ home }).spendForwards)).toEqual([]);
  });
});
