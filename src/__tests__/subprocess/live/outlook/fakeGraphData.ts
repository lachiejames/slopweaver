/**
 * What `fakeGraphServer.ts` answers with: the identity platform's token set, the seeded mailbox, its folders,
 * categories and one attachment, and the drafts a create or a `createReply` adds. Pure data and builders — the
 * server owns the routing, the request log and the sockets.
 *
 * Every value is SYNTHETIC — `example.test` addresses, invented subjects, tokens named `at-N` and `rt-N`.
 */
import type { GraphMessage } from "../../../../live/outlook/graphWire.js";
import { FAKE_OUTLOOK_ACCOUNT, wireFolder, wireMessage } from "../../../fakeOutlookMailbox.js";
import { parseOwnJson } from "../../../parseOwnJson.js";

/** The tenant id Microsoft issues personal-account tokens under, as `authority.ts` pins it. */
const CONSUMERS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** The synthetic account's object id. */
const ACCOUNT_OID = "00000000-0000-0000-0000-00000000a11c";

/** The master category list, served over two pages so a name on the second is only found by following the link. */
export const CATEGORY_PAGES = [
  [{ color: "preset0", displayName: "Waiting on", id: "cat-waiting" }],
  [{ color: "preset1", displayName: "Done", id: "cat-done" }],
] as const;

/** The top-level folders, over two pages; the Inbox has one child, and one folder is hidden as Outlook hides some. */
export const TOP_FOLDER_PAGES = [
  [
    wireFolder({
      id: "folder-inbox",
      over: { childFolderCount: 1, displayName: "Inbox", totalItemCount: 3, unreadItemCount: 2 },
    }),
    wireFolder({ id: "folder-sent", over: { displayName: "Sent Items", totalItemCount: 4 } }),
  ],
  [
    wireFolder({ id: "folder-archive", over: { displayName: "Archive", totalItemCount: 5 } }),
    wireFolder({ id: "folder-hidden", over: { displayName: "Hidden Synthetic", isHidden: true } }),
  ],
] as const;

/** `/me` as Graph answers it for the synthetic personal account, which carries no `mail`. */
export const ME = {
  displayName: "Owner Synthetic",
  id: ACCOUNT_OID,
  mail: null,
  userPrincipalName: FAKE_OUTLOOK_ACCOUNT,
} as const;

/** The well-known Archive folder, as `/me/mailFolders/archive` answers it when the mailbox has one. */
export const ARCHIVE_FOLDER = wireFolder({ id: "folder-archive", over: { displayName: "Archive" } });

/** The Inbox's one child folder. */
export const INBOX_CHILD = wireFolder({
  id: "folder-receipts",
  over: { displayName: "Receipts", parentFolderId: "folder-inbox", totalItemCount: 1 },
});

/** The one file every message carries, and its bytes. */
export const ATTACHMENT = {
  "@odata.type": "#microsoft.graph.fileAttachment",
  contentType: "text/plain",
  id: "att-1",
  isInline: false,
  lastModifiedDateTime: "2026-10-01T09:00:00Z",
  name: "notes.txt",
  size: 22,
} as const;

/** The synthetic attachment's bytes, exactly {@link ATTACHMENT}'s `size` long. */
export const ATTACHMENT_TEXT = "synthetic notes, 22 B.";

/** Base64url of a UTF-8 string, as JWT segments and `client_info` are encoded. */
function base64url({ text }: { text: string }): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** An unsigned ID token carrying the claims MSAL reads; MSAL Node decodes it and never verifies a signature. */
function idToken({ clientId }: { clientId: string }): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    aud: clientId,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    iss: `https://login.microsoftonline.com/${CONSUMERS_TENANT}/v2.0`,
    name: "Owner Synthetic",
    nbf: nowSeconds,
    oid: ACCOUNT_OID,
    preferred_username: FAKE_OUTLOOK_ACCOUNT,
    sub: "subject-synthetic",
    tid: CONSUMERS_TENANT,
    ver: "2.0",
  };
  return `${base64url({ text: '{"alg":"none","typ":"JWT"}' })}.${base64url({ text: JSON.stringify(claims) })}.`;
}

/**
 * The token endpoint's answer: an authorization code or a refresh token in, a rotated token set out. Counts the
 * set issued and records a presented refresh token on `state`.
 *
 * @param form the token request's form body
 * @param state the server's issue count and the refresh tokens presented so far
 * @returns the token set's JSON body
 */
export function tokenSet({
  form,
  state,
}: {
  form: URLSearchParams;
  state: { issued: number; refreshTokensPresented: string[] };
}): Record<string, unknown> {
  const grantType = form.get("grant_type");
  const presented = form.get("refresh_token");
  if (grantType === "refresh_token" && presented !== null) {
    state.refreshTokensPresented.push(presented);
  }
  state.issued += 1;
  // MSAL always sends its client id on a token request; the fake asserts that rather than inventing one.
  const clientId = form.get("client_id")!;
  return {
    access_token: `at-${String(state.issued)}`,
    client_info: base64url({ text: JSON.stringify({ uid: ACCOUNT_OID, utid: CONSUMERS_TENANT }) }),
    // Under MSAL's five-minute refresh offset, so every later process refreshes and rotates.
    expires_in: 60,
    ext_expires_in: 60,
    id_token: idToken({ clientId }),
    refresh_token: `rt-${String(state.issued)}`,
    scope: form.get("scope"),
    token_type: "Bearer",
  };
}

/**
 * The three messages every fake mailbox starts with: two in one conversation, one alone carrying {@link ATTACHMENT}.
 *
 * @returns the seeded mailbox, keyed by message id
 */
export function seedMessages(): Map<string, GraphMessage> {
  const seeded = [
    wireMessage({ id: "m-1", over: { conversationId: "conv-a", receivedDateTime: "2026-10-03T09:00:00Z" } }),
    wireMessage({ id: "m-2", over: { conversationId: "conv-a", receivedDateTime: "2026-10-02T09:00:00Z" } }),
    wireMessage({
      id: "m-3",
      over: { conversationId: "conv-b", hasAttachments: true, receivedDateTime: "2026-10-01T09:00:00Z" },
    }),
  ];
  return new Map(seeded.map((message) => [message.id, message]));
}

/**
 * A new draft from a create payload, added to the mailbox.
 *
 * @param body the create request's JSON body
 * @returns the stored draft
 */
export function createDraft({ body, messages }: { body: string; messages: Map<string, GraphMessage> }): GraphMessage {
  const id = `draft-${String(messages.size + 1)}`;
  const draft = wireMessage({
    id,
    over: { ...parseOwnJson<Partial<GraphMessage>>({ text: body }), isDraft: true, parentFolderId: "folder-drafts" },
  });
  messages.set(id, draft);
  return draft;
}

/**
 * A reply draft in the parent's conversation, addressed back to its sender, as `createReply` makes one.
 *
 * @param parent the message being replied to
 * @returns the stored reply draft
 */
export function createReplyDraft({
  messages,
  parent,
}: {
  messages: Map<string, GraphMessage>;
  parent: GraphMessage;
}): GraphMessage {
  const id = `draft-${String(messages.size + 1)}`;
  const draft = wireMessage({
    id,
    over: {
      conversationId: parent.conversationId,
      from: { emailAddress: { address: FAKE_OUTLOOK_ACCOUNT, name: "Owner Synthetic" } },
      isDraft: true,
      parentFolderId: "folder-drafts",
      subject: `RE: ${String(parent.subject)}`,
      toRecipients: parent.from == null ? [] : [parent.from],
    },
  });
  messages.set(id, draft);
  return draft;
}
