import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { ParsedGmailMessage } from "../../../../live/gmail/parse.js";
import {
  type FullMessage,
  REMINDER_QUERY,
  REMINDER_SENDERS,
  REMINDER_SUBJECTS,
  readTasks,
  type TasksMailbox,
} from "../../../../spend/tasks/read.js";
import { renderTaskReading } from "../../../../spend/tasks/render.js";
import { FIXTURE_MERCHANTS } from "../merchantFixture.js";

/** An invented reminder body naming one Anthropic and one OpenAI charge. */
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

/** A parsed message with only what `readTasks` reads filled in. */
function parsed({ id, body, sentAtIso }: { id: string; body: string; sentAtIso: string }): ParsedGmailMessage {
  return {
    attachments: [],
    body,
    bodyFormat: "text",
    cc: [],
    from: undefined,
    htmlLinks: [],
    id,
    labelIds: [],
    sentAtIso,
    snippet: undefined,
    subject: "Your receipt",
    threadId: id,
    to: [],
  };
}

/**
 * A plain fake mailbox: each query answers the ids listed for it, each id its message, and every save a path it
 * records — a seam, not a mock.
 */
function fakeMailbox({
  searches,
  messages,
}: {
  searches: Readonly<Record<string, readonly { id: string; sentAtIso: string }[]>>;
  messages: Readonly<Record<string, FullMessage>>;
}): { mailbox: TasksMailbox; saved: string[]; queries: string[] } {
  const saved: string[] = [];
  const queries: string[] = [];
  const mailbox: TasksMailbox = {
    account: "owner@example.test",
    readFull: async ({ id }) => {
      const message = messages[id];
      if (message === undefined) {
        return err({ message: `no message ${id}` });
      }
      return ok(message);
    },
    savePart: async ({ messageId, partId }) => {
      const path = `/home/live/gmail/attachments/${messageId}/${partId}-Receipt.pdf`;
      saved.push(path);
      return ok(path);
    },
    search: async ({ query }) => {
      queries.push(query);
      const hits = searches[query];
      if (hits === undefined) {
        return ok([]);
      }
      return ok(hits);
    },
  };
  return { mailbox, queries, saved };
}

const ANTHROPIC_QUERY =
  '(from:(anthropic.com) OR "anthropic.com") has:attachment -to:receipts@expenses.airwallex.com ' +
  "after:2027/03/02 before:2027/03/19";

describe("REMINDER_QUERY", () => {
  it("ORs both sender addresses and both subject shapes, inbox only", () => {
    expect(REMINDER_QUERY).toBe(
      "{from:support@info.airwallex.com from:no-reply@info.airwallex.com} in:inbox " +
        '{subject:"You have 1 task to complete" subject:"tasks to complete"}',
    );
  });

  it.each(REMINDER_SENDERS)("names the sender %s", (sender) => {
    expect(REMINDER_QUERY).toContain(`from:${sender}`);
  });

  it.each(REMINDER_SUBJECTS)("names the subject shape %s", (subject) => {
    expect(REMINDER_QUERY).toContain(`subject:"${subject}"`);
  });
});

describe("readTasks", () => {
  it("reads the newest reminder, pulls the receipt naming the amount, and says so where none was found", async () => {
    const { mailbox, saved } = fakeMailbox({
      messages: {
        old: { message: parsed({ body: REMINDER_BODY, id: "old", sentAtIso: "2027-03-05T07:30:00.000Z" }), parts: [] },
        r1: {
          message: parsed({ body: "Amount paid A$120.00", id: "r1", sentAtIso: "2027-03-04T02:00:00.000Z" }),
          parts: [
            {
              attachmentId: "t1",
              filename: "Receipt-0001.pdf",
              mimeType: "application/pdf",
              partId: "2",
              sizeBytes: 10,
            },
            { attachmentId: "t2", filename: "logo.png", mimeType: "image/png", partId: "3", sizeBytes: 10 },
          ],
        },
        top: { message: parsed({ body: REMINDER_BODY, id: "top", sentAtIso: "2027-03-06T07:30:00.000Z" }), parts: [] },
      },
      searches: {
        [ANTHROPIC_QUERY]: [{ id: "r1", sentAtIso: "2027-03-04T02:00:00.000Z" }],
        [REMINDER_QUERY]: [
          { id: "old", sentAtIso: "2027-03-05T07:30:00.000Z" },
          { id: "top", sentAtIso: "2027-03-06T07:30:00.000Z" },
        ],
      },
    });
    const reading = unwrap(await readTasks({ mailbox, merchants: FIXTURE_MERCHANTS }));
    expect(saved).toEqual(["/home/live/gmail/attachments/r1/2-Receipt.pdf"]);
    expect(renderTaskReading({ reading }).split("\n")).toEqual([
      "spend tasks: owner@example.test",
      "reminder 2027-03-06: 2 task(s), 2 card expense(s) — https://mail.google.com/mail/u/0/#all/top",
      "  superseded by it: 1 older reminder(s) still in the inbox — https://mail.google.com/mail/u/0/#all/old",
      "- upload Anthropic 120.00 AUD (2027-03-04) into Airwallex now — invoice " +
        "/home/live/gmail/attachments/r1/2-Receipt.pdf (receipt https://mail.google.com/mail/u/0/#all/r1)",
      "- upload OpenAI 9.99 USD (2027-03-04) into Airwallex now — no matching invoice mail in owner@example.test " +
        '(searched: (from:(openai.com) OR "openai.com") has:attachment -to:receipts@expenses.airwallex.com ' +
        "after:2027/03/02 before:2027/03/19)",
    ]);
  });

  it("searches no receipt for an expense whose merchant the install has not registered, and says how to", async () => {
    const { mailbox, queries } = fakeMailbox({
      messages: {
        top: { message: parsed({ body: REMINDER_BODY, id: "top", sentAtIso: "2027-03-06T07:30:00.000Z" }), parts: [] },
      },
      searches: { [REMINDER_QUERY]: [{ id: "top", sentAtIso: "2027-03-06T07:30:00.000Z" }] },
    });
    const reading = unwrap(await readTasks({ mailbox, merchants: [] }));
    expect(queries).toEqual([REMINDER_QUERY]);
    expect(renderTaskReading({ reading }).split("\n").slice(2)).toEqual([
      "- upload Anthropic 120.00 AUD (2027-03-04) into Airwallex now — Anthropic is not a registered merchant with a " +
        "receipt domain, so no invoice was searched for (`slopweaver spend merchants set` registers one)",
      "- upload OpenAI 9.99 USD (2027-03-04) into Airwallex now — OpenAI is not a registered merchant with a " +
        "receipt domain, so no invoice was searched for (`slopweaver spend merchants set` registers one)",
    ]);
  });

  it("answers no-reminder for an inbox holding none, and searches nothing else", async () => {
    const { mailbox, queries } = fakeMailbox({ messages: {}, searches: {} });
    const reading = unwrap(await readTasks({ mailbox, merchants: FIXTURE_MERCHANTS }));
    expect(reading).toEqual({ account: "owner@example.test", kind: "no-reminder", query: REMINDER_QUERY });
    expect(queries).toEqual([REMINDER_QUERY]);
    expect(renderTaskReading({ reading })).toBe(
      `spend tasks: no Airwallex task reminder in the inbox of owner@example.test (searched: ${REMINDER_QUERY})`,
    );
  });

  it("names the step a failed door read stopped at", async () => {
    const { mailbox } = fakeMailbox({
      messages: {},
      searches: { [REMINDER_QUERY]: [{ id: "gone", sentAtIso: "2027-03-06T07:30:00.000Z" }] },
    });
    const error = unwrapErr(await readTasks({ mailbox, merchants: FIXTURE_MERCHANTS }));
    expect(error.code).toBe("MAILBOX_READ_FAILED");
    expect(error.message).toBe("reminder gone: no message gone");
  });
});
