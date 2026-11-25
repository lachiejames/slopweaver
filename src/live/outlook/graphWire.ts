/**
 * What each Microsoft Graph endpoint the Outlook door calls is allowed to answer — one strict boundary per
 * endpoint, built from Microsoft's documented v1.0 resource shapes (`message`, `mailFolder`,
 * `outlookCategory`, `attachment` and its three derived types, `user`).
 *
 * No Outlook account exists on the machine this was written on, so no key set here was read off a live
 * answer. Two things follow, and both are deliberate:
 *
 * - **Every documented property of a resource is declared**, whether or not the door asked for it with
 *   `$select`. Graph answers only the selected properties to a GET, but a POST, a PATCH, a `createReply` and a
 *   `move` answer the WHOLE resource and accept no `$select`. Declaring the documented set once makes one
 *   schema right for both, and a property the door never reads is `unread` so its value is not trusted.
 * - **A key Microsoft adds is still refused, by name.** That is the point of a strict boundary: the first run
 *   on the owner's personal mailbox either reads cleanly or fails naming the field, which is one edit to fix.
 *   A loose read would instead let a renamed field read as absent at exit 0.
 *
 * Graph's own annotations are declared where Microsoft documents them: `@odata.context` on every top-level
 * answer, `@odata.etag` on an entity, `@odata.nextLink`/`@odata.deltaLink` on a page, `@odata.type` on every
 * attachment (the discriminant below), and `@removed` on a delta tombstone.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the door never reads. */
const unread = z.unknown().optional();

/** A string Microsoft documents as present but which a mailbox may leave null. */
const text = z.string().nullable().optional();

/** `emailAddress` — Graph omits either half on some system mail, so neither is required. */
const emailAddressWire = z.strictObject({
  address: text,
  name: text,
});

/** `recipient` — every address field on a message is one of these. */
const recipientWire = z.strictObject({ emailAddress: emailAddressWire });

/** `itemBody` — `text` when the door sends `Prefer: outlook.body-content-type="text"`, else whatever was stored. */
const itemBodyWire = z.strictObject({
  content: z.string(),
  contentType: z.enum(["text", "html"]),
});

/** A recipient list. Graph answers `[]` rather than omitting a list it selected. */
const recipients = z.array(recipientWire).optional();

/**
 * `message`, every documented v1.0 property. `id` is the only required field: a message without one cannot be
 * read, moved or sent, and an answer missing it is exactly the shape change worth failing on.
 */
const messageWire = z.strictObject({
  "@odata.context": unread,
  "@odata.etag": unread,
  "@odata.type": unread,
  bccRecipients: recipients,
  body: itemBodyWire.optional(),
  bodyPreview: z.string().optional(),
  categories: z.array(z.string()).optional(),
  ccRecipients: recipients,
  changeKey: text,
  conversationId: text,
  conversationIndex: unread,
  createdDateTime: unread,
  flag: unread,
  from: recipientWire.nullable().optional(),
  hasAttachments: z.boolean().optional(),
  id: z.string(),
  importance: unread,
  inferenceClassification: unread,
  internetMessageHeaders: unread,
  internetMessageId: text,
  isDeliveryReceiptRequested: unread,
  isDraft: z.boolean().optional(),
  isRead: z.boolean().optional(),
  isReadReceiptRequested: unread,
  lastModifiedDateTime: unread,
  parentFolderId: text,
  receivedDateTime: text,
  replyTo: unread,
  sender: recipientWire.nullable().optional(),
  sentDateTime: text,
  subject: text,
  toRecipients: recipients,
  uniqueBody: unread,
  webLink: text,
});

/** One message as the door reads it. */
export type GraphMessage = z.output<typeof messageWire>;

/**
 * A delta item: a changed message, or a tombstone carrying `@removed` and its id. One strict object rather than
 * a union, because two object arms with no shared tag cannot say which one a failed read meant
 * (`src/lib/boundaryWalk.ts`).
 */
const deltaMessageWire = messageWire.extend({ "@removed": z.strictObject({ reason: z.string() }).optional() });

/** One delta item as the door reads it: a changed message, or a tombstone when `@removed` is set. */
export type GraphDeltaMessage = z.output<typeof deltaMessageWire>;

/** `GET /me` — the account the grant is bound to. A personal account's `mail` is often null; its UPN is the address. */
export const GET_ME = defineBoundary({
  endpoint: "GET /me",
  schema: z.strictObject({
    "@odata.context": unread,
    ageGroup: unread,
    businessPhones: unread,
    displayName: text,
    givenName: unread,
    id: z.string(),
    jobTitle: unread,
    mail: text,
    mobilePhone: unread,
    officeLocation: unread,
    preferredLanguage: unread,
    surname: unread,
    userPrincipalName: text,
  }),
});

/** `GET /me/messages/{id}` and every write that answers the message it acted on (POST, PATCH, createReply, move). */
export const MESSAGE = defineBoundary({ endpoint: "Graph message", schema: messageWire });

/** A page of messages — a folder listing, a `$search`, or a conversation's `$filter`. */
export const MESSAGE_PAGE = defineBoundary({
  endpoint: "GET /me/messages (page)",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.count": unread,
    "@odata.deltaLink": z.string().optional(),
    "@odata.nextLink": z.string().optional(),
    value: z.array(messageWire),
  }),
});

/** One page of a folder's message delta: changed messages, tombstones, and the link the next round resumes from. */
export const MESSAGE_DELTA_PAGE = defineBoundary({
  endpoint: "GET /me/mailFolders/{id}/messages/delta",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.deltaLink": z.string().optional(),
    "@odata.nextLink": z.string().optional(),
    value: z.array(deltaMessageWire),
  }),
});

/** `mailFolder`. v1.0 documents no `wellKnownName`; it is declared because beta answers it and some tenants leak it. */
const mailFolderWire = z.strictObject({
  "@odata.context": unread,
  "@odata.etag": unread,
  childFolderCount: z.number().optional(),
  displayName: text,
  id: z.string(),
  isHidden: z.boolean().optional(),
  parentFolderId: text,
  sizeInBytes: unread,
  totalItemCount: z.number().optional(),
  unreadItemCount: z.number().optional(),
  wellKnownName: unread,
});

/** One mail folder as the door reads it. */
export type GraphMailFolder = z.output<typeof mailFolderWire>;

/** `GET /me/mailFolders/{id-or-well-known-name}`. */
export const MAIL_FOLDER = defineBoundary({ endpoint: "GET /me/mailFolders/{id}", schema: mailFolderWire });

/** `GET /me/mailFolders` and `/childFolders`. */
export const MAIL_FOLDER_PAGE = defineBoundary({
  endpoint: "GET /me/mailFolders (page)",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.nextLink": z.string().optional(),
    value: z.array(mailFolderWire),
  }),
});

/** `outlookCategory` — a master category; a message carries its `displayName` in `categories`. */
const categoryWire = z.strictObject({
  "@odata.etag": unread,
  color: text,
  displayName: z.string(),
  id: z.string(),
});

/** One master category as the door reads it. */
export type GraphCategory = z.output<typeof categoryWire>;

/** `GET /me/outlook/masterCategories`. */
export const CATEGORY_PAGE = defineBoundary({
  endpoint: "GET /me/outlook/masterCategories",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.nextLink": z.string().optional(),
    value: z.array(categoryWire),
  }),
});

/** The properties every `attachment` carries, whatever its derived type. */
const attachmentBase = {
  "@odata.mediaContentType": unread,
  contentType: text,
  id: z.string(),
  isInline: z.boolean().optional(),
  lastModifiedDateTime: unread,
  name: text,
  size: z.number().optional(),
};

/**
 * `attachment`, discriminated on the `@odata.type` Graph always stamps on an item of a base-typed collection.
 * Only a `fileAttachment` has bytes the door can save; the other two are listed so a refusal can name the kind.
 */
const attachmentWire = z.discriminatedUnion("@odata.type", [
  z.strictObject({
    ...attachmentBase,
    "@odata.type": z.literal("#microsoft.graph.fileAttachment"),
    contentBytes: unread,
    contentId: unread,
    contentLocation: unread,
  }),
  z.strictObject({
    ...attachmentBase,
    "@odata.type": z.literal("#microsoft.graph.itemAttachment"),
    item: unread,
  }),
  z.strictObject({
    ...attachmentBase,
    "@odata.type": z.literal("#microsoft.graph.referenceAttachment"),
  }),
]);

/** One attachment as the door reads it. */
export type GraphAttachment = z.output<typeof attachmentWire>;

/** `GET /me/messages/{id}/attachments` — metadata only; a file's bytes come from `/$value`. */
export const ATTACHMENT_PAGE = defineBoundary({
  endpoint: "GET /me/messages/{id}/attachments",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.nextLink": z.string().optional(),
    value: z.array(attachmentWire),
  }),
});
