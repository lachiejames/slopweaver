/*
 * The pure fakes the Gmail fetch test files share: the two crawl windows, one message fixture and a recording
 * `GmailApi` seam whose every mailbox mutation throws. Nothing here touches disk. It moved here when
 * `fetch.test.ts` was split by behaviour.
 */
import { err, ok } from "#lib/result.js";

import type { GmailApi, GmailHistoryPage } from "../../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";

export const WINDOW = { since: "2026-08-01", until: "2026-08-28" };
export const EPOCH_WINDOW = { since: "1970-01-01", until: "2026-08-28" };

/** A base64url MIME body, exactly as Gmail encodes one. */
function b64({ text }: { text: string }): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** One Gmail message fixture, addressable by id. */
function message({ id }: { id: string }): GmailMessage {
  return {
    id,
    internalDate: "1754042400000",
    labelIds: ["CATEGORY_PERSONAL"],
    payload: {
      body: { data: b64({ text: `body ${id}` }) },
      headers: [{ name: "From", value: `s-${id}@example.test` }],
      mimeType: "text/plain",
    },
    threadId: `t-${id}`,
  };
}

/** Every mailbox mutation seam, each one throwing, in the order the fake has always declared them. */
function mutationSeams(): Pick<
  GmailApi,
  "createDraft" | "getAttachment" | "getDraft" | "sendDraft" | "listLabels" | "modifyMessage" | "modifyThread"
> {
  const notForIngest = async (): Promise<never> => {
    throw new Error("a corpus fetch must never call a mailbox mutation seam");
  };
  return {
    // Every write seam throws rather than answers, and that IS the assertion: a corpus fetch that
    // reached one would fail loudly here instead of quietly changing someone's mailbox. Ingest reads.
    createDraft: notForIngest,
    getAttachment: notForIngest,
    getDraft: notForIngest,
    sendDraft: notForIngest,
    listLabels: notForIngest,
    modifyMessage: notForIngest,
    modifyThread: notForIngest,
  };
}

/**
 * A recording fake seam. Every member is a plain function returning a Result and every call is appended to
 * `calls`, so an ordering assertion reads the real sequence rather than a mock's expectations.
 *
 * @returns the fake, its mutation seams spread first so its key order is the in-file helper's
 */
export function fakeApi({
  pages = [],
  history = [],
  historyError,
  profileHistoryId = "profile-anchor",
  calls = [],
}: {
  pages?: readonly { ids: readonly string[]; next: string | undefined }[];
  // A page's `historyId` takes the seam's own declared type, so the fake can hand over every page the real
  // `listHistory` can: one that omits the anchor included. It is never narrower or wider than that contract.
  history?: readonly { ids: readonly string[]; historyId: GmailHistoryPage["historyId"]; next: string | undefined }[];
  historyError?: ReturnType<typeof GmailErrors.historyExpired> | ReturnType<typeof GmailErrors.apiFailed>;
  profileHistoryId?: string | undefined;
  calls?: string[];
}): GmailApi {
  let listPage = 0;
  let historyPage = 0;
  return {
    ...mutationSeams(),
    getMessage: async ({ id }) => {
      calls.push(`get:${id}`);
      return id === "boom" ? err(GmailErrors.apiFailed({ message: "unreadable" })) : ok(message({ id }));
    },
    getProfile: async () => {
      calls.push("profile");
      return ok({ emailAddress: "me@example.test", historyId: profileHistoryId, messagesTotal: 7 });
    },
    getThread: async () => ok([]),
    listHistory: async () => {
      calls.push("history");
      if (historyError !== undefined) {
        return err(historyError);
      }
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the fake repeats its last history page, and a caller reaching listHistory always passes one; a guard would change what an empty list serves
      const page = history[Math.min(historyPage, history.length - 1)]!;
      historyPage += 1;
      return ok({
        added: page.ids.map((id) => ({ id, threadId: `t-${id}` })),
        historyId: page.historyId,
        nextPageToken: page.next,
      });
    },
    listMessageIds: async () => {
      calls.push("list");
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the fake repeats its last listing page, and a caller reaching listMessageIds always passes one; a guard would change what an empty list serves
      const page = pages[Math.min(listPage, pages.length - 1)]!;
      listPage += 1;
      return ok({
        ids: [...page.ids],
        nextPageToken: page.next,
        resultSizeEstimate: page.ids.length,
        threadIds: page.ids.map((id) => `t-${id}`),
      });
    },
  };
}
