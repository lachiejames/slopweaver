/**
 * The Outlook door's Graph boundaries read Microsoft's documented v1.0 shapes and refuse drift by name. Every
 * fixture here is SYNTHETIC — the shape of Microsoft's published examples with invented values — because no
 * mail content may enter a test.
 */
import { describe, expect, it } from "vitest";

import { BoundaryErrors } from "#lib/boundary.js";
import { unwrap, unwrapErr } from "#lib/result.js";

import {
  ATTACHMENT_PAGE,
  CATEGORY_PAGE,
  GET_ME,
  MAIL_FOLDER,
  MESSAGE,
  MESSAGE_DELTA_PAGE,
  MESSAGE_PAGE,
} from "../../../../live/outlook/graphWire.js";

/** A message as a `$select`ed GET answers it, with `Prefer: outlook.body-content-type="text"`. */
const SELECTED_MESSAGE = {
  "@odata.etag": 'W/"CQAAABYAAAAA"',
  bccRecipients: [],
  body: { content: "synthetic body", contentType: "text" },
  categories: ["Blue category"],
  ccRecipients: [],
  conversationId: "AAQkAGConv=",
  from: { emailAddress: { address: "sender@example.com", name: "Sender Example" } },
  hasAttachments: true,
  id: "AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0A",
  internetMessageId: "<synthetic@example.com>",
  isDraft: false,
  isRead: false,
  parentFolderId: "AAMkAGFolder=",
  receivedDateTime: "2026-10-17T01:02:03Z",
  sentDateTime: "2026-10-17T01:02:00Z",
  subject: "synthetic subject",
  toRecipients: [{ emailAddress: { address: "owner@example.com", name: "Owner" } }],
  webLink: "https://outlook.live.com/owa/?ItemID=synthetic",
};

describe("Graph message boundaries", () => {
  it("reads a selected message and keeps the fields the door reads", () => {
    const message = unwrap(
      MESSAGE.parse({
        value: {
          "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('x')/messages/$entity",
          ...SELECTED_MESSAGE,
        },
      }),
    );

    expect(message.id).toBe("AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0A");
    expect(message.from?.emailAddress.address).toBe("sender@example.com");
    expect(message.body).toEqual({ content: "synthetic body", contentType: "text" });
  });

  it("reads a draft whose sender Graph answers as null", () => {
    const draft = unwrap(MESSAGE.parse({ value: { from: null, id: "AAkAdraft", isDraft: true, sender: null } }));

    expect(draft.from).toBe(null);
  });

  it("reads a page with a next link", () => {
    const page = unwrap(
      MESSAGE_PAGE.parse({
        value: {
          "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('x')/messages",
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skip=10",
          value: [SELECTED_MESSAGE],
        },
      }),
    );

    expect(page["@odata.nextLink"]).toBe("https://graph.microsoft.com/v1.0/me/messages?$skip=10");
    expect(page.value.length).toBe(1);
  });

  it("refuses an undocumented message field by name rather than dropping it", () => {
    const error = unwrapErr(MESSAGE.parse({ value: { id: "AAkA1", mentionsPreview: null } }));

    expect(error).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [{ detail: 'new field "mentionsPreview"', kind: "new", path: "mentionsPreview" }],
        endpoint: "Graph message",
      }),
    );
  });

  it("refuses a message with no id", () => {
    const error = unwrapErr(MESSAGE.parse({ value: { subject: "s" } }));

    expect(error.message).toBe(
      'Graph message answered a shape this version does not read — refused, not guessed: field "id" is missing',
    );
  });

  it("reads a delta page carrying a tombstone and a delta link", () => {
    const page = unwrap(
      MESSAGE_DELTA_PAGE.parse({
        value: {
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=t",
          value: [
            SELECTED_MESSAGE,
            { "@odata.type": "#microsoft.graph.message", "@removed": { reason: "deleted" }, id: "AAkAgone" },
          ],
        },
      }),
    );

    expect(page.value[1]!["@removed"]).toEqual({ reason: "deleted" });
    expect(page["@odata.deltaLink"]).toBe(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=t",
    );
  });
});

describe("Graph attachment boundary", () => {
  it("discriminates the three attachment kinds on @odata.type", () => {
    const page = unwrap(
      ATTACHMENT_PAGE.parse({
        value: {
          value: [
            {
              "@odata.type": "#microsoft.graph.fileAttachment",
              contentType: "application/pdf",
              id: "A1",
              isInline: false,
              name: "a.pdf",
              size: 10,
            },
            {
              "@odata.type": "#microsoft.graph.itemAttachment",
              contentType: null,
              id: "A2",
              isInline: false,
              name: "fwd",
              size: 20,
            },
            {
              "@odata.type": "#microsoft.graph.referenceAttachment",
              contentType: null,
              id: "A3",
              isInline: false,
              name: "link",
              size: 0,
            },
          ],
        },
      }),
    );

    expect(page.value.map((attachment) => attachment["@odata.type"])).toEqual([
      "#microsoft.graph.fileAttachment",
      "#microsoft.graph.itemAttachment",
      "#microsoft.graph.referenceAttachment",
    ]);
  });

  it("refuses an attachment kind Graph has not documented", () => {
    const error = unwrapErr(
      ATTACHMENT_PAGE.parse({ value: { value: [{ "@odata.type": "#microsoft.graph.cloudAttachment", id: "A4" }] } }),
    );

    expect(error.code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});

describe("Graph account, folder and category boundaries", () => {
  it("reads a personal account whose mail is null and whose UPN is the address", () => {
    const me = unwrap(
      GET_ME.parse({
        value: { displayName: "Owner", id: "0123abcd", mail: null, userPrincipalName: "owner@example.com" },
      }),
    );

    expect(me.userPrincipalName).toBe("owner@example.com");
    expect(me.mail).toBe(null);
  });

  it("reads /me carrying ageGroup, the field Graph started answering on a personal account", () => {
    const me = unwrap(
      GET_ME.parse({
        value: {
          ageGroup: null,
          displayName: "Owner",
          id: "0123abcd",
          mail: null,
          userPrincipalName: "owner@example.com",
        },
      }),
    );

    expect(me.id).toBe("0123abcd");
    expect(me.userPrincipalName).toBe("owner@example.com");
  });

  it("still refuses a /me field Graph has not documented, by name", () => {
    const error = unwrapErr(GET_ME.parse({ value: { id: "0123abcd", legalAgeGroupClassification: null } }));

    expect(error).toEqual(
      BoundaryErrors.shapeChanged({
        drift: [
          { detail: 'new field "legalAgeGroupClassification"', kind: "new", path: "legalAgeGroupClassification" },
        ],
        endpoint: "GET /me",
      }),
    );
  });

  it("reads a well-known folder", () => {
    const folder = unwrap(
      MAIL_FOLDER.parse({
        value: {
          childFolderCount: 0,
          displayName: "Inbox",
          id: "AAMkInbox",
          isHidden: false,
          parentFolderId: "AAMkRoot",
          totalItemCount: 3,
          unreadItemCount: 1,
        },
      }),
    );

    expect(folder.unreadItemCount).toBe(1);
  });

  it("reads the master category list", () => {
    const page = unwrap(
      CATEGORY_PAGE.parse({ value: { value: [{ color: "preset0", displayName: "Red category", id: "c1" }] } }),
    );

    expect(page.value[0]!.displayName).toBe("Red category");
  });
});
