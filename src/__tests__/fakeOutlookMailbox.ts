/**
 * A fake Outlook mailbox behind the real `OutlookApi` seam: plain data and plain functions, no mock. The domain
 * code and the CLI shells run over it unchanged, so a test drives the whole verb and asserts what the mailbox
 * ended up holding and which writes reached it.
 *
 * Every value here is SYNTHETIC — `example.test` addresses and invented subjects. No real mail goes in a
 * fixture.
 */
import { err, ok } from "../lib/result.js";
import type { DraftPayload, OutlookApi, Page } from "../live/outlook/apiCore.js";
import { OutlookErrors } from "../live/outlook/errors.js";
import type { GraphAttachment, GraphCategory, GraphMailFolder, GraphMessage } from "../live/outlook/graphWire.js";

/** The account every fake session binds. */
export const FAKE_OUTLOOK_ACCOUNT = "owner@example.test";

/** The mutable state one fake mailbox holds, and the log of every write that reached it. */
export interface FakeMailbox {
  readonly messages: Map<string, GraphMessage>;
  readonly folders: GraphMailFolder[];
  /** Well-known name → folder id; a name absent here answers 404, as a personal mailbox with no Archive does. */
  readonly wellKnown: Record<string, string>;
  readonly categories: GraphCategory[];
  readonly attachments: Map<string, GraphAttachment[]>;
  readonly bytes: Map<string, Uint8Array>;
  /** Every write, in order: `patch <id> <json>`, `move <id> <dest>`, `draft <id>`, `send <id>`. */
  readonly writes: string[];
  /** Message ids whose patch or move the fake refuses. */
  readonly failWritesFor: Set<string>;
}

/**
 * One wire message with every field a full read selects, overridable.
 *
 * @returns the message
 */
export function wireMessage({ id, over = {} }: { id: string; over?: Partial<GraphMessage> }): GraphMessage {
  return {
    bccRecipients: [],
    body: { content: `synthetic body of ${id}`, contentType: "text" },
    bodyPreview: `synthetic preview of ${id}`,
    categories: [],
    ccRecipients: [],
    changeKey: `ck-${id}-1`,
    conversationId: "conv-1",
    from: { emailAddress: { address: "sender@example.test", name: "Sender One" } },
    hasAttachments: false,
    id,
    isDraft: false,
    isRead: false,
    parentFolderId: "folder-inbox",
    receivedDateTime: "2026-10-01T09:00:00Z",
    subject: `Synthetic subject ${id}`,
    toRecipients: [{ emailAddress: { address: FAKE_OUTLOOK_ACCOUNT } }],
    webLink: `https://outlook.example.test/${id}`,
    ...over,
  };
}

/**
 * One wire folder with every count selected.
 *
 * @returns the folder
 */
export function wireFolder({ id, over = {} }: { id: string; over?: Partial<GraphMailFolder> }): GraphMailFolder {
  return {
    childFolderCount: 0,
    displayName: id,
    id,
    isHidden: false,
    parentFolderId: "root",
    totalItemCount: 0,
    unreadItemCount: 0,
    ...over,
  };
}

/**
 * A mailbox with an Inbox and an Archive folder, two categories, and the given messages.
 *
 * @returns the fresh mailbox
 */
export function fakeMailbox({ messages = [] }: { messages?: readonly GraphMessage[] } = {}): FakeMailbox {
  return {
    attachments: new Map(),
    bytes: new Map(),
    categories: [
      { color: "preset0", displayName: "Waiting on", id: "cat-waiting" },
      { color: "preset1", displayName: "Done", id: "cat-done" },
    ],
    failWritesFor: new Set(),
    folders: [
      wireFolder({ id: "folder-inbox", over: { displayName: "Inbox", totalItemCount: 3, unreadItemCount: 2 } }),
      wireFolder({ id: "folder-archive", over: { displayName: "Archive", totalItemCount: 5, unreadItemCount: 0 } }),
    ],
    messages: new Map(messages.map((message) => [message.id, message])),
    wellKnown: { archive: "folder-archive", inbox: "folder-inbox" },
    writes: [],
  };
}

/** The one page a fake listing answers. */
function onePage<T>({ items }: { items: readonly T[] }): Page<T> {
  return { items, nextLink: undefined };
}

/**
 * The next version stamp after a write, as Graph moves `changeKey` on every change to an item.
 *
 * @returns the stamp with one more write counted
 */
export function nextChangeKey({ changeKey }: { changeKey: string | null | undefined }): string {
  return `${String(changeKey)}+`;
}

/** A draft as Graph would hold it after a create or patch. */
function draftFrom({
  id,
  payload,
  base,
}: {
  id: string;
  payload: Partial<DraftPayload>;
  base: GraphMessage;
}): GraphMessage {
  return {
    ...base,
    ...(payload.subject === undefined ? {} : { subject: payload.subject }),
    ...(payload.body === undefined ? {} : { body: payload.body }),
    ...(payload.toRecipients === undefined ? {} : { toRecipients: [...payload.toRecipients] }),
    ...(payload.ccRecipients === undefined ? {} : { ccRecipients: [...payload.ccRecipients] }),
    ...(payload.bccRecipients === undefined ? {} : { bccRecipients: [...payload.bccRecipients] }),
    changeKey: nextChangeKey({ changeKey: base.changeKey }),
    id,
    isDraft: true,
    parentFolderId: "folder-drafts",
  };
}

/**
 * The real seam over a fake mailbox. Reads answer from its state; writes change it and append to `writes`.
 *
 * @returns the seam
 */
// max-lines-exempt: one arm per `OutlookApi` method over one in-memory mailbox, so the fake's length IS the seam's method count; each arm is the smallest stand-in for its endpoint.
export function fakeOutlookApi({ mailbox }: { mailbox: FakeMailbox }): OutlookApi {
  const missing = ({ id }: { id: string }) => err(OutlookErrors.apiFailed({ message: `404 ItemNotFound: ${id}` }));
  const write = ({ id, line, change }: { id: string; line: string; change: GraphMessage }) => {
    if (mailbox.failWritesFor.has(id)) {
      return err(OutlookErrors.apiFailed({ message: `429 throttled writing ${id}` }));
    }
    const stamped = { ...change, changeKey: nextChangeKey({ changeKey: change.changeKey }) };
    mailbox.messages.set(id, stamped);
    mailbox.writes.push(line);
    return ok(stamped);
  };
  return {
    attachmentBytes: async ({ attachmentId }) => {
      const bytes = mailbox.bytes.get(attachmentId);
      return bytes === undefined ? missing({ id: attachmentId }) : ok(bytes);
    },
    conversation: async (start) => {
      const conversationId = "first" in start ? start.first.conversationId : "";
      return ok(
        onePage({
          items: [...mailbox.messages.values()].filter((message) => message.conversationId === conversationId),
        }),
      );
    },
    createDraft: async ({ payload }) => {
      const id = `draft-${String(mailbox.writes.length + 1)}`;
      const draft = draftFrom({ base: wireMessage({ id, over: { conversationId: `conv-${id}` } }), id, payload });
      mailbox.messages.set(id, draft);
      mailbox.writes.push(`draft ${id}`);
      return ok(draft);
    },
    createReply: async ({ replyTo }) => {
      const parent = mailbox.messages.get(replyTo);
      if (parent === undefined) {
        return missing({ id: replyTo });
      }
      const id = `reply-${String(mailbox.writes.length + 1)}`;
      const draft = draftFrom({
        base: { ...parent, toRecipients: parent.from == null ? [] : [parent.from] },
        id,
        payload: {},
      });
      mailbox.messages.set(id, draft);
      mailbox.writes.push(`reply ${id} to ${replyTo}`);
      return ok(draft);
    },
    getDraft: async ({ id }) => {
      const draft = mailbox.messages.get(id);
      return draft === undefined ? missing({ id }) : ok(draft);
    },
    getFolder: async ({ reference }) => {
      const id = Object.hasOwn(mailbox.wellKnown, reference) ? mailbox.wellKnown[reference] : reference;
      const folder = mailbox.folders.find((candidate) => candidate.id === id);
      if (folder === undefined) {
        return err(OutlookErrors.referenceUnresolved({ candidates: [], kind: "folder", reference }));
      }
      return ok(folder);
    },
    getMessage: async ({ id }) => {
      const message = mailbox.messages.get(id);
      return message === undefined ? missing({ id }) : ok(message);
    },
    listAttachments: async ({ messageId }) => {
      const attachments = mailbox.attachments.get(messageId);
      if (attachments === undefined) {
        return ok([]);
      }
      return ok(attachments);
    },
    listCategories: async () => ok(mailbox.categories),
    listFolders: async (start) => {
      let wanted = "root";
      if ("first" in start && start.first.parentId !== undefined) {
        wanted = start.first.parentId;
      }
      return ok(onePage({ items: mailbox.folders.filter((folder) => folder.parentFolderId === wanted) }));
    },
    listMessages: async (start) => {
      const folderId = "first" in start ? start.first.folderId : "";
      const unreadOnly = "first" in start && start.first.unreadOnly;
      const resolved = Object.hasOwn(mailbox.wellKnown, folderId) ? mailbox.wellKnown[folderId] : folderId;
      // Graph's own `$filter` + `$orderby`: unread only when asked, newest received first either way.
      const items = [...mailbox.messages.values()]
        .filter((message) => message.parentFolderId === resolved && (!unreadOnly || message.isRead === false))
        .toSorted((a, b) => String(b.receivedDateTime).localeCompare(String(a.receivedDateTime)));
      return ok(onePage({ items }));
    },
    me: async () => ok({ id: "me-1", mail: FAKE_OUTLOOK_ACCOUNT, userPrincipalName: FAKE_OUTLOOK_ACCOUNT }),
    // An initial round answers the folder whole on one page; a resumed round answers no change. Both end on a
    // delta link, as Graph's last page of a round does.
    messageDelta: async ({ start }) => {
      if ("link" in start) {
        return ok({ deltaLink: start.link, items: [], nextLink: undefined });
      }
      const { folderId } = start.first;
      const items = [...mailbox.messages.values()].filter((message) => message.parentFolderId === folderId);
      return ok({ deltaLink: `https://graph.microsoft.com/v1.0/fake-delta/${folderId}`, items, nextLink: undefined });
    },
    moveMessage: async ({ id, destinationId }) => {
      const message = mailbox.messages.get(id);
      if (message === undefined) {
        return missing({ id });
      }
      return write({ change: { ...message, parentFolderId: destinationId }, id, line: `move ${id} ${destinationId}` });
    },
    patchDraft: async ({ id, payload }) => {
      const draft = mailbox.messages.get(id);
      if (draft === undefined) {
        return missing({ id });
      }
      const patched = draftFrom({ base: draft, id, payload });
      mailbox.messages.set(id, patched);
      mailbox.writes.push(`patch-draft ${id}`);
      return ok(patched);
    },
    patchMessage: async ({ id, patch }) => {
      const message = mailbox.messages.get(id);
      if (message === undefined) {
        return missing({ id });
      }
      const change = {
        ...message,
        ...(patch.isRead === undefined ? {} : { isRead: patch.isRead }),
        ...(patch.categories === undefined ? {} : { categories: [...patch.categories] }),
      };
      return write({ change, id, line: `patch ${id} ${JSON.stringify(patch)}` });
    },
    searchMessages: async (start) => {
      const search = "first" in start ? start.first.search : "";
      const items = [...mailbox.messages.values()].filter((message) => String(message.subject).includes(search));
      return ok(onePage({ items }));
    },
    sendDraft: async ({ id }) => {
      if (!mailbox.messages.has(id)) {
        return missing({ id });
      }
      mailbox.writes.push(`send ${id}`);
      return ok(undefined);
    },
  };
}
