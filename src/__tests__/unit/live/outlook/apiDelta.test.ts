/**
 * The Outlook seam's message delta (`live/outlook/apiDelta.ts`) over a real Graph SDK client whose wire is
 * scripted: the exact request a round sends, the header on every continuation, the one-link-per-page rule, and
 * an expired round named as such. Every value is synthetic.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { PREFER_READ } from "../../../../live/outlook/apiCore.js";
import { deltaMethods } from "../../../../live/outlook/apiDelta.js";
import { fakeGraph } from "./fakeGraph.js";

const NEXT = "https://graph.microsoft.com/v1.0/me/mailFolders/f1/messages/delta?$skiptoken=page2";
const DELTA = "https://graph.microsoft.com/v1.0/me/mailFolders/f1/messages/delta?$deltatoken=round1";

/** A delta page with one changed message and one tombstone, ending on the given link. */
function page({ link }: { link: Record<string, string> }): unknown {
  return {
    ...link,
    value: [
      { id: "m1", subject: "Synthetic one" },
      { "@removed": { reason: "deleted" }, id: "m2" },
    ],
  };
}

describe("messageDelta", () => {
  it("opens a folder's round with the full select and the read, id and page-size preferences", async () => {
    const graph = fakeGraph({ answers: [{ json: page({ link: { "@odata.nextLink": NEXT } }), status: 200 }] });
    const { messageDelta } = deltaMethods({ graph: graph.client, scopeId: "scope" });

    const result = unwrap(await messageDelta({ maxPageSize: 25, start: { first: { folderId: "f1" } } }));

    expect(result.nextLink).toBe(NEXT);
    expect(result.deltaLink).toBeUndefined();
    expect(result.items.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(result.items[1]!["@removed"]).toEqual({ reason: "deleted" });
    expect(graph.seen[0]!.url).toBe(
      "https://graph.microsoft.com/v1.0/me/mailFolders/f1/messages/delta?$select=id,conversationId,parentFolderId,subject,bodyPreview,from,sender,receivedDateTime,sentDateTime,isRead,hasAttachments,categories,internetMessageId,body,toRecipients,ccRecipients,bccRecipients,isDraft,webLink",
    );
    expect(graph.seen[0]!.headers["prefer"]).toBe(`${PREFER_READ}, odata.maxpagesize=25`);
  });

  it("sends the same preferences on a continuation link, and bounds the page size at 100", async () => {
    const graph = fakeGraph({ answers: [{ json: page({ link: { "@odata.deltaLink": DELTA } }), status: 200 }] });
    const { messageDelta } = deltaMethods({ graph: graph.client, scopeId: "scope" });

    const result = unwrap(await messageDelta({ maxPageSize: 500, start: { link: NEXT } }));

    expect(result.deltaLink).toBe(DELTA);
    expect(graph.seen[0]!.url).toBe(NEXT);
    expect(graph.seen[0]!.headers["prefer"]).toBe(`${PREFER_READ}, odata.maxpagesize=100`);
  });

  it("refuses a continuation link that is not Graph's, sending nothing", async () => {
    const graph = fakeGraph({ answers: [{ json: {}, status: 200 }] });
    const { messageDelta } = deltaMethods({ graph: graph.client, scopeId: "scope" });

    const result = await messageDelta({ maxPageSize: 10, start: { link: "https://elsewhere.example.test/delta" } });

    expect(result._unsafeUnwrapErr().code).toBe("NEXT_LINK_REFUSED");
    expect(graph.seen).toEqual([]);
  });

  it("refuses a page carrying both links, or neither", async () => {
    const both = fakeGraph({
      answers: [{ json: page({ link: { "@odata.deltaLink": DELTA, "@odata.nextLink": NEXT } }), status: 200 }],
    });
    const neither = fakeGraph({ answers: [{ json: page({ link: {} }), status: 200 }] });

    const fromBoth = await deltaMethods({ graph: both.client, scopeId: "s" }).messageDelta({
      maxPageSize: 10,
      start: { first: { folderId: "f1" } },
    });
    const fromNeither = await deltaMethods({ graph: neither.client, scopeId: "s" }).messageDelta({
      maxPageSize: 10,
      start: { first: { folderId: "f1" } },
    });

    expect(fromBoth._unsafeUnwrapErr().code).toBe("RESPONSE_FIELD_MISSING");
    expect(fromNeither._unsafeUnwrapErr().code).toBe("RESPONSE_FIELD_MISSING");
  });

  it("names an expired round from a 410, and from Graph's syncStateNotFound", async () => {
    const gone = fakeGraph({ answers: [{ json: { error: { code: "Gone", message: "expired" } }, status: 410 }] });
    const lost = fakeGraph({
      answers: [{ json: { error: { code: "syncStateNotFound", message: "no state" } }, status: 400 }],
    });

    const fromGone = await deltaMethods({ graph: gone.client, scopeId: "s" }).messageDelta({
      maxPageSize: 10,
      start: { link: DELTA },
    });
    const fromLost = await deltaMethods({ graph: lost.client, scopeId: "s" }).messageDelta({
      maxPageSize: 10,
      start: { link: DELTA },
    });

    expect(fromGone._unsafeUnwrapErr().code).toBe("DELTA_STATE_EXPIRED");
    expect(fromLost._unsafeUnwrapErr().code).toBe("DELTA_STATE_EXPIRED");
  });

  it("keeps any other refusal an ordinary API failure", async () => {
    const graph = fakeGraph({
      answers: [{ json: { error: { code: "ErrorAccessDenied", message: "no" } }, status: 403 }],
    });

    const result = await deltaMethods({ graph: graph.client, scopeId: "s" }).messageDelta({
      maxPageSize: 10,
      start: { first: { folderId: "f1" } },
    });

    expect(result._unsafeUnwrapErr().code).toBe("API_FAILED");
  });
});
