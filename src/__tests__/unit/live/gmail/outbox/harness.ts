/*
 * What the Gmail outbound plan/apply test files share: a minimal compose form, a stored-draft fixture, the fake
 * seam and its call record. They moved here when `outbox.test.ts` was split by behaviour.
 *
 * The seam is a plain fake — a record of what it was asked to do, and canned answers — so there is no mock
 * anywhere and every assertion is on a real returned value.
 *
 * The fake's read seams throw for anything the outbound builders have no business touching, which is itself
 * the assertion: a draft that reached `modifyMessage` would fail loudly here rather than pass quietly.
 */
import { err, ok } from "../../../../../lib/result.js";
import type { GmailApi, GmailDraft } from "../../../../../live/gmail/api.js";
import type { GmailComposeForm } from "../../../../../live/gmail/compose.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";

/** What the fake seam was asked to do. */
interface SeamCalls {
  readonly createDraft: { raw: string; threadId: string | undefined; once: boolean | undefined }[];
  readonly sendDraft: string[];
}

/**
 * A minimal valid form; each test overrides only the field it is about.
 *
 * @returns a valid compose form with the supplied overrides applied
 */
export function form(over: Partial<GmailComposeForm> = {}): GmailComposeForm {
  return { bcc: [], body: "the body", cc: [], subject: "a subject", to: ["someone@example.com"], ...over };
}

/**
 * A stored draft holding a plain text/plain message with the given headers and body.
 *
 * @returns a stored plain-text draft in thread `t-1`
 */
export function draftFixture({
  id = "d-1",
  headers,
  body = "the body",
}: {
  id?: string;
  headers: readonly { name: string; value: string }[];
  body?: string;
}): GmailDraft {
  return {
    id,
    message: {
      id: "m-1",
      payload: {
        body: { data: Buffer.from(body, "utf8").toString("base64url"), size: body.length },
        headers: [...headers],
        mimeType: "text/plain",
      },
      threadId: "t-1",
    },
  };
}

/** The thread a draft was asked to land in, or `t-created`, the new thread Gmail starts when none was named. */
function threadIdOrCreated({ threadId }: { threadId: string | undefined }): string {
  if (threadId === undefined) {
    return "t-created";
  }
  return threadId;
}

/**
 * A fake seam. Each call is a plain function returning a Result — no vi.fn anywhere.
 *
 * @returns a Gmail API fake that records each draft and send, with canned read answers
 */
export function fakeApi({
  calls,
  parent,
  draft,
  sendFails = false,
  storesInThread,
}: {
  calls: SeamCalls;
  parent?: GmailMessage | undefined;
  draft?: GmailDraft | undefined;
  sendFails?: boolean;
  /** The thread Gmail files the draft in, overriding the one asked for — how a detached reply is staged. */
  storesInThread?: string;
}): GmailApi {
  const notForOutbound = async (): Promise<never> => {
    throw new Error("an outbound builder must never call a read or label seam");
  };
  return {
    createDraft: async ({ raw, threadId, once }) => {
      calls.createDraft.push({ once, raw, threadId });
      let filed = threadIdOrCreated({ threadId });
      if (storesInThread !== undefined) {
        filed = storesInThread;
      }
      return ok({ id: "d-created", message: { id: "m-created", threadId: filed } });
    },
    getDraft: async () =>
      draft === undefined ? err(GmailErrors.apiFailed({ message: "no draft fixture" })) : ok(draft),
    getMessage: async () =>
      parent === undefined ? err(GmailErrors.apiFailed({ message: "no parent fixture" })) : ok(parent),
    getAttachment: notForOutbound,
    getProfile: notForOutbound,
    getThread: notForOutbound,
    listHistory: notForOutbound,
    listLabels: notForOutbound,
    listMessageIds: notForOutbound,
    modifyMessage: notForOutbound,
    modifyThread: notForOutbound,
    sendDraft: async ({ id }) => {
      calls.sendDraft.push(id);
      return sendFails
        ? err(GmailErrors.apiFailed({ message: "the send was refused" }))
        : ok({ id: "m-sent", labelIds: ["SENT"], threadId: "t-1" });
    },
  };
}

/**
 * A fresh call record.
 *
 * @returns a record with empty draft and send call lists
 */
export function record(): SeamCalls {
  return { createDraft: [], sendDraft: [] };
}
